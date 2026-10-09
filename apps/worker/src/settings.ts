/**
 * T-L4-004 — the autonomy dial: how much confidence the agent needs before it may book without a human.
 *
 * The dial exists because "the agent posts things" and "the controller decides what it may post alone"
 * are different products, and only the second one is sellable to a controller. Three properties make it
 * a control rather than a config value:
 *
 *   1. It is stored where the app can read it (`settings`), not frozen into a deploy;
 *   2. Turning it writes a `setting` row to the hash-chained audit log, so the history of turns is
 *      tamper-evident even though the dial itself stays readable and writable;
 *   3. `confidenceSweep` answers the only question that matters before turning it — what would change?
 *
 * Note the deliberate asymmetry with the journal and the audit log: those are append-only, this table is
 * not. A dial that cannot be turned is not a dial. What must be immutable is the record of it being
 * turned, and that lives in `audit_log`.
 */
import type { Env } from "./env";
import type { SweepPoint, ThresholdSetting } from "../../../packages/contracts/api";
import { auditInsert, buildAuditRow, readTail } from "./audit";

const KEY = "auto_post_threshold";

/**
 * The bounds. Below 0.80 the agent is booking near-coin-flips for a controller who asked for certainty;
 * above 0.99 almost nothing clears the bar and the queue becomes the bottleneck the product was meant to
 * remove. Clamping rather than rejecting: a value at the edge is a request the operator clearly meant.
 */
export const THRESHOLD_MIN = 0.8;
export const THRESHOLD_MAX = 0.99;

/** The deploy-time default (`AUTO_POST_THRESHOLD`), used until the dial has been turned, and as a fallback. */
export function defaultThreshold(env: Env): number {
  const n = Number(env.AUTO_POST_THRESHOLD || "0.9");
  return Number.isFinite(n) ? n : 0.9;
}

export function clampThreshold(n: number): number {
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, n));
}

/**
 * The threshold the decision path must use: the stored dial if it has been turned, otherwise the deploy
 * default.
 *
 * A failure here falls back rather than throwing, and that is a deliberate trade: the dial is a *control*
 * on autonomy, not a dependency of bookkeeping. If `settings` were missing or unreadable, failing the
 * decision would stop the books being written entirely — a far worse outcome than briefly running at the
 * deploy-time default, which is the conservative value anyway.
 */
export async function effectiveThreshold(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(KEY).first<{ value: string }>();
    const n = Number(row?.value);
    return Number.isFinite(n) ? clampThreshold(n) : defaultThreshold(env);
  } catch {
    return defaultThreshold(env);
  }
}

/** The dial as the API reports it. Falls back to the deploy default when it has never been turned. */
export async function getThresholdSetting(env: Env): Promise<ThresholdSetting> {
  const row = await env.DB.prepare(`SELECT value, updated_by, updated_at FROM settings WHERE key = ?1`)
    .bind(KEY).first<{ value: string; updated_by: string; updated_at: string }>();
  if (row && Number.isFinite(Number(row.value))) {
    return { key: KEY, value: clampThreshold(Number(row.value)), updated_by: row.updated_by, updated_at: row.updated_at };
  }
  // Never turned: report the value actually in force, labelled as such. `updated_at: ""` renders as
  // "never turned" — the alternative, inventing a timestamp, would claim a change nobody made.
  return { key: KEY, value: defaultThreshold(env), updated_by: "deploy default", updated_at: "" };
}

/** Turn the dial, and record the turn on the audit chain in the same batch as the write. */
export async function setThreshold(env: Env, value: number, by: string): Promise<ThresholdSetting> {
  const clamped = clampThreshold(value);
  const at = new Date().toISOString();
  const before = await getThresholdSetting(env);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(KEY, String(clamped), by, at),
    // Same batch as the write: a turn that happened without its audit row would be exactly the kind of
    // unexplained change the chain exists to make impossible.
    auditInsert(
      env,
      await buildAuditRow(
        {
          ref_type: "setting",
          ref_id: KEY,
          event: "changed",
          actor: by,
          detail: { from: before.value, to: clamped, requested: value, clamped: clamped !== value },
        },
        await readTail(env),
      ),
    ),
  ]);

  return { key: KEY, value: clamped, updated_by: by, updated_at: at };
}

/** One resolved review item: a model decision plus the human's verdict on it. */
interface LabeledDecision {
  model_prob: number;
  gate_reasons: string | null;
  status: string | null;
  account_override: string | null;
}

/**
 * What the current queue would look like at every threshold on the dial.
 *
 * The only honest ground truth for "was the agent right" is a human who actually looked, so the sample is
 * decisions a reviewer has resolved — not the model's own confidence. Two definitions keep the sweep
 * meaningful:
 *
 *   - **Correct** = the reviewer approved the item AND did not override the account. An override is
 *     precisely a human saying the classification was wrong, and it is recorded on the audit row.
 *   - **Eligible** = no gate other than confidence fired. The dial only moves the confidence bar; sending
 *     it to infinity would not clear an injection or a high-risk flag, so holding those fixed is what
 *     makes the sweep answer "what would change if I move *this*", and nothing else.
 *
 * `auto_precision` is 1 when nothing auto-posts — the vacuous reading. That is why `n_labeled` is part of
 * the response and should be read first: a perfect precision over three judged transactions is not
 * evidence of anything.
 */
export async function confidenceSweep(env: Env): Promise<SweepPoint[]> {
  const rows = await env.DB.prepare(
    `SELECT d.account_prob                                 AS model_prob,
            d.gate_reasons                                 AS gate_reasons,
            json_extract(a.detail_json, '$.status')           AS status,
            json_extract(a.detail_json, '$.account_override') AS account_override
     FROM audit_log a
     JOIN decisions d ON d.transaction_id = json_extract(a.detail_json, '$.transaction_id')
     WHERE a.ref_type = 'review' AND a.event = 'resolved'`,
  ).all<LabeledDecision>();

  const labeled = (rows.results ?? []).map((r) => {
    let reasons: string[] = [];
    try {
      const parsed: unknown = JSON.parse(r.gate_reasons ?? "[]");
      if (Array.isArray(parsed)) reasons = parsed.map(String);
    } catch {
      /* an unparseable reason list cannot be called eligible */
    }
    return {
      // The dial's own lever, and only it: `low_confidence` is the single reason the threshold moves.
      eligible: reasons.every((x) => x.startsWith("low_confidence")),
      correct: r.status === "approved" && !r.account_override,
      prob: Number(r.model_prob) || 0,
    };
  });

  const n = labeled.length;
  const out: SweepPoint[] = [];
  for (let t = THRESHOLD_MIN; t <= THRESHOLD_MAX + 1e-9; t += 0.01) {
    const threshold = Math.round(t * 100) / 100;
    const auto = labeled.filter((d) => d.eligible && d.prob >= threshold);
    const right = auto.filter((d) => d.correct).length;
    out.push({
      threshold,
      coverage: n ? auto.length / n : 0,
      auto_precision: auto.length ? right / auto.length : 1,
      review_rate: n ? 1 - auto.length / n : 0,
      n_labeled: n,
    });
  }
  return out;
}

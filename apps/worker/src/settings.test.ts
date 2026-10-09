/**
 * T-L4-004 — the autonomy dial.
 *
 * The dial is only worth having if all three of these hold, so each gets a test:
 *   - it is stored and survives (not a request-scoped value),
 *   - turning it changes what the very next decision may post alone,
 *   - the turn is on the hash chain, and the chain still verifies afterwards.
 *
 * The load-bearing one is the second: a threshold that is stored, audited and reported but never actually
 * consulted would pass every other test here and still be a lie. It is asserted end to end through
 * `decideTransaction`, so it would catch the dial being read from the wrong place.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env";
import { decideTransaction, type TxnForDecision } from "./clef";
import { resetTokenCache } from "./paypal";
import { verifyAudit } from "./audit";
import { clampThreshold, confidenceSweep, effectiveThreshold, getThresholdSetting, setThreshold, THRESHOLD_MAX, THRESHOLD_MIN } from "./settings";
import { createLedgerDb, type TestD1 } from "./test-d1";

const TXN: TxnForDecision = { event_code: "T0006", amount: "49.00", currency: "USD", fee: "-1.92", counterparty: "buyer@example.com" };

function makeEnv(db: TestD1, extra: Record<string, unknown> = {}): Env {
  return {
    AUTO_POST_THRESHOLD: "0.90",
    CLEF_MODEL: "@cf/cloudflare/clef-flash",
    CLEF_ESCALATION_MODEL: "",
    DB: db as unknown as Env["DB"],
    ...extra,
  } as unknown as Env;
}

/** A Workers-AI stand-in answering with a fixed account confidence. */
const aiAnswering = (prob: number) => ({
  run: async () => ({ answers: {
    account: { type: "choice", choice: "4000", probabilities: { "4000": prob, "4100": 1 - prob } },
    product_line: { type: "choice", choice: "templates", probabilities: { templates: 0.9, none: 0.1 } },
    needs_review: { type: "noul", noul: 0.05 },
    risk: { type: "score", score: 0.2 },
  } }),
});

beforeEach(() => resetTokenCache());
afterEach(() => {});

/* ------------------------------------------------------- stored, and survives */

describe("the dial is stored, not deploy-time config", () => {
  it("reports the deploy default before anyone turns it", async () => {
    const setting = await getThresholdSetting(makeEnv(createLedgerDb()));
    expect(setting.value).toBe(0.9);
    expect(setting.updated_at).toBe(""); // never turned — not an invented timestamp
    expect(setting.updated_by).toBe("deploy default");
  });

  it("stores a turn and reports it back with its provenance", async () => {
    const env = makeEnv(createLedgerDb());
    const written = await setThreshold(env, 0.95, "Joseph");

    expect(written.value).toBe(0.95);
    expect(written.updated_by).toBe("Joseph");

    const read = await getThresholdSetting(env);
    expect(read.value).toBe(0.95);
    expect(read.updated_by).toBe("Joseph");
    expect(read.updated_at).not.toBe("");
    expect(await effectiveThreshold(env)).toBe(0.95);
  });

  it("clamps an out-of-range turn to the dial's bounds rather than rejecting it", async () => {
    const env = makeEnv(createLedgerDb());
    expect((await setThreshold(env, 0.5, "Joseph")).value).toBe(THRESHOLD_MIN);
    expect((await setThreshold(env, 1, "Joseph")).value).toBe(THRESHOLD_MAX);
    expect(clampThreshold(0.905)).toBe(0.905);
  });
});

/* ------------------------------------------- turning it changes what posts */

describe("the decision path actually consults the dial", () => {
  it("posts at the deploy default, then routes the same transaction to review once the dial is raised", async () => {
    const db = createLedgerDb();
    const env = makeEnv(db, { AI: aiAnswering(0.92) });

    // 0.92 clears the deploy default of 0.90 → the agent may book it alone.
    expect((await decideTransaction(env, TXN)).gate).toBe("auto");

    await setThreshold(env, 0.95, "Joseph");

    // The same confidence no longer clears the bar the controller set. Nothing else changed.
    const after = await decideTransaction(env, TXN);
    expect(after.gate).toBe("review");
    expect(after.threshold).toBe(0.95);
    expect(after.gateReasons.some((r) => r.startsWith("low_confidence"))).toBe(true);
  });

  it("lets a transaction through once the dial is lowered past its confidence", async () => {
    const env = makeEnv(createLedgerDb(), { AI: aiAnswering(0.85) });
    expect((await decideTransaction(env, TXN)).gate).toBe("review");
    await setThreshold(env, 0.8, "Joseph");
    expect((await decideTransaction(env, TXN)).gate).toBe("auto");
  });

  it("falls back to the deploy default when the dial has never been turned", async () => {
    const env = makeEnv(createLedgerDb(), { AI: aiAnswering(0.92) });
    expect(await effectiveThreshold(env)).toBe(0.9);
    expect((await decideTransaction(env, TXN)).gate).toBe("auto");
  });
});

/* ------------------------------------------------------- audited, and verifiable */

describe("turning the dial is on the hash chain", () => {
  it("writes a `setting` row and the chain still verifies", async () => {
    const db = createLedgerDb();
    const env = makeEnv(db);
    await setThreshold(env, 0.95, "Joseph");

    const row = await db.prepare(`SELECT ref_type, ref_id, event, actor, detail_json FROM audit_log`).first<{
      ref_type: string; ref_id: string; event: string; actor: string; detail_json: string;
    }>();
    expect(row).toMatchObject({ ref_type: "setting", ref_id: "auto_post_threshold", event: "changed", actor: "Joseph" });
    expect(JSON.parse(row?.detail_json ?? "{}")).toMatchObject({ from: 0.9, to: 0.95, requested: 0.95, clamped: false });

    // The dial is readable and writable but its history is not: tampering with the turn breaks the chain.
    expect((await verifyAudit(env)).ok).toBe(true);
  });

  it("records a clamp rather than hiding it in the audit row", async () => {
    const db = createLedgerDb();
    const env = makeEnv(db);
    await setThreshold(env, 0.4, "Joseph"); // below the floor
    const row = await db.prepare(`SELECT detail_json FROM audit_log`).first<{ detail_json: string }>();
    expect(JSON.parse(row?.detail_json ?? "{}")).toMatchObject({ to: THRESHOLD_MIN, requested: 0.4, clamped: true });
  });
});

/* ------------------------------------------------------------------ the sweep */

describe("the confidence sweep answers what would change", () => {
  it("returns a point per threshold with no labels counted when nothing has been judged", async () => {
    const points = await confidenceSweep(makeEnv(createLedgerDb()));
    expect(points).toHaveLength(20); // 0.80 … 0.99
    expect(points[0]).toMatchObject({ threshold: 0.8, n_labeled: 0, coverage: 0, review_rate: 0 });
    expect(points.at(-1)?.threshold).toBe(0.99);
  });
});

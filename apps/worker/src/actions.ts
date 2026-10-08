/**
 * L1 domain — agentic actions (T-L1-005), plus the review-queue and webhook-event interfaces (T-L1-008).
 *
 * ONE `executeProposal` serves production and the safety eval. The eval calls it with `dryRun: true`,
 * `POST /api/actions/:id/approve` calls it with `dryRun: false, approver`, and both go through the same
 * policy gate, the same `actions` table dedupe and the same audit row. Nothing is re-implemented per caller.
 *
 * INV-4 — two keys for money movement:
 *   key #1  Clef consistency (`decideAction` → P(this action is justified)) — or a named human approver
 *   key #2  `evaluateAction` (src/policy.ts) — called, never re-implemented
 * A `blocked` verdict is final: a human approver cannot override it. `review` executes only with an
 * approver, `auto` only when `dryRun === false`. Every attempt writes an `actions` row.
 *
 * INV-5 — untrusted text is data: `opts.context` (payment note, email, memo) is handed to Clef in the
 * quoted `untrusted_context_text` slot and kept as evidence in `decision_json`; it is never scanned for
 * instructions, and PayPal messages are built from proposal fields only.
 *
 * Idempotency (R4) and the review→executed transition: `actions.idempotency_key` is UNIQUE and the row is
 * the concurrency token. A fresh attempt claims the key with `INSERT ... ON CONFLICT DO NOTHING` *before*
 * any PayPal call; a repeat attempt advances an existing row with a *conditional* UPDATE guarded on the
 * exact state it read (`WHERE id = ? AND outcome = ? AND error IS ? ... RETURNING *`), so only the request
 * whose write returned a row proceeds to PayPal — review→executed on approval, failed/in-progress→executed
 * on retry. Concurrent approvals therefore cannot both pay.
 *
 * Retryability: a successful execution clears `error` and is never re-driven; a row left retryable — a
 * PayPal failure (`outcome='failed'`) or a claim that crashed before the call
 * (`outcome='executed'` with `error='in_progress:*'`) — is re-executed by a later attempt on the same key, so a transient failure does
 * not permanently burn the deterministic key.
 *
 * This module never throws: every failure is returned as an `actions` row with outcome 'failed'.
 */
import type { ActionOutcome, ActionRow, ReviewItem } from "../../../packages/contracts/api";
import { decideAction } from "./clef";
import type { Env } from "./env";
import { postEntry } from "./ledger";
import { fromCents } from "./money";
import { PayPalClient } from "./paypal";
import { evaluateAction, idempotencyKey, policyConfig, type ActionProposal, type PolicyResult } from "./policy";

/** `ActionProposal` carries no currency (IF-04 is frozen); the demo company invoices and pays in USD. */
export const PAYOUT_CURRENCY = "USD";

const ACTION_OUTCOMES: readonly ActionOutcome[] = ["auto", "review", "blocked", "executed", "failed"];

export function isActionOutcome(value: unknown): value is ActionOutcome {
  return typeof value === "string" && (ACTION_OUTCOMES as readonly string[]).includes(value);
}

export interface ExecuteProposalOptions {
  /** Eval/safety path: run the full gate and record the outcome, but never call PayPal. */
  dryRun?: boolean;
  /** Human approval: stands in for the Clef key and lets a `review` verdict execute. `blocked` stays blocked. */
  approver?: string;
  /** Untrusted free text that accompanies the proposal. Data, never instructions. */
  context?: string;
  /**
   * Eval-run scope: prefixes the idempotency key so each eval run gets a fresh duplicate-detection scope
   * (mirrors `run_id` in evals/product_evals.py) instead of colliding with the previous run's rows.
   */
  runId?: string;
  /**
   * Reuse a queued row's stored key (approval path) so the row transitions `review` → `executed` instead of
   * inserting a second row. Defaults to `policy.idempotencyKey(proposal)`.
   */
  idempotencyKey?: string;
}

/* ────────────────────────────────────────────────────────────── execute */

/** `ActionRow` plus the result of *this* request's transition. Internal — never serialized to a client. */
export type ActionRowResult = ActionRow & {
  /** true only for the attempt that won the transition and ran the side effect; false when it lost a race. */
  wonTransition?: boolean;
};

/**
 * Gate, execute (unless dry-run) and audit one proposed action.
 * Returns the `actions` row that owns the idempotency key — `id`, `outcome`, `paypal_ref` and the rest.
 *
 * The side effect is guarded by an atomic transition: whether a `review` row may execute is decided by the
 * database (`UPDATE ... WHERE outcome = <state we read> RETURNING *`), not by the prior SELECT. Only the
 * request whose claim returned a row calls PayPal; a loser reports the current outcome and moves no money.
 */
export async function executeProposal(
  env: Env,
  proposal: ActionProposal,
  opts: ExecuteProposalOptions = {},
): Promise<ActionRowResult> {
  const rawKey = idempotencyKey(proposal);
  const key = opts.idempotencyKey ?? (opts.runId ? `${opts.runId}:${rawKey}` : rawKey);
  try {
    const existing = await findActionByKey(env, key);
    const approving = !!opts.approver && existing?.outcome === "review";
    const retrying = !!existing && isRetryable(existing);

    // ── Dedupe: a completed execution, or any row that is neither awaiting approval nor retryable, is
    //    returned verbatim — a successful action is never executed a second time. ──
    if (existing && !approving && !retrying) return reportExisting(env, existing, proposal, opts);

    // ── Key #1 — Clef consistency. A named approver stands in for it, and an approval/retry reuses the
    //    recorded confidence so the attempt is a deterministic re-run of the original gate. ──
    const priorProb = readActionProb(existing?.decision_json ?? null);
    const actionProb = opts.approver
      ? priorProb ?? 1
      : opts.context !== undefined
        ? await decideAction(env, opts.context, proposal as unknown as Record<string, unknown>)
        : priorProb ?? 0;

    // ── Key #2 — the policy gate (policy.ts owns the rules; this only calls it). ──
    const policy = evaluateAction(proposal, actionProb, policyConfig(env), () => false);

    const context = opts.context ?? (existing ? readActionContext(existing.decision_json) : null);
    const decisionJson = decisionJsonFor(actionProb, policy, context);
    // `review` executes only with an approver; `auto` executes on a real run; a retryable row may be re-driven.
    const shouldExecute =
      !opts.dryRun && policy.outcome !== "blocked" && (policy.outcome === "auto" || approving || retrying);

    // ── No side effect: record (or leave) the policy verdict on a fresh/again-blocked row. ──
    if (!shouldExecute) {
      if (existing) return reportExisting(env, existing, proposal, opts);
      const recorded = await insertRecord(env, { key, proposal, decisionJson, policy, approver: opts.approver ?? null });
      if (recorded) return recorded;
      const raced = await findActionByKey(env, key);
      return reportExisting(env, raced ?? failedRow(key, proposal, "idempotency_key_conflict"), proposal, opts);
    }

    // ── Claim: `INSERT ... ON CONFLICT DO NOTHING` for a fresh key, a conditional state transition for an
    //    existing row. PayPal runs ONLY in the branch that won the claim. ──
    const claimed = existing
      ? await claimTransition(env, existing, decisionJson, opts.approver ?? null)
      : await claimInsert(env, { key, proposal, decisionJson, policy, approver: opts.approver ?? null });
    if (!claimed) {
      // Lost the transition to a concurrent request: report the outcome it wrote, move no money.
      const current = existing
        ? (await getAction(env, existing.id)) ?? existing
        : (await findActionByKey(env, key)) ?? failedRow(key, proposal, "idempotency_key_conflict");
      return { ...reportExisting(env, current, proposal, opts), wonTransition: false };
    }

    try {
      const pin = claimed.error ?? "";
      const paypalRef = await callPayPal(env, proposal, key);
      const done = await finishExecution(env, claimed.id, paypalRef, pin);
      return {
        ...(done ?? { ...claimed, outcome: "executed" as const, paypal_ref: paypalRef, error: null, approver: opts.approver ?? claimed.approver }),
        wonTransition: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await failExecution(env, claimed.id, message, claimed.error ?? "");
      return {
        ...(failed ?? { ...claimed, outcome: "failed" as const, paypal_ref: null, error: message }),
        wonTransition: true,
      };
    }
  } catch (err) {
    // Never throw: an infrastructure failure is still an audited attempt.
    return failedRow(key, proposal, err instanceof Error ? err.message : String(err));
  }
}

/**
 * What a repeat key reports. The row that owns the key is the idempotency record and is never rewritten:
 * production callers get it back verbatim (an idempotent no-op), while a dry run additionally reports the
 * policy verdict for *this* attempt — so the safety eval sees `duplicate_payout` where a second execution
 * was refused, instead of the outcome of the attempt that consumed the key.
 */
function reportExisting(env: Env, row: ActionRow, proposal: ActionProposal, opts: ExecuteProposalOptions): ActionRow {
  if (!opts.dryRun || row.outcome === "review") return row;
  const policy = evaluateAction(proposal, readActionProb(row.decision_json) ?? 0, policyConfig(env), () => true);
  return policy.outcome === "blocked" ? { ...row, outcome: "blocked", policy_rule: policy.rule } : row;
}

/* ─────────────────────────────────────────────────────────────── paypal */

const REQUEST_ID_SAFE = /[^A-Za-z0-9._-]+/g;

/** Deterministic, charset-safe PayPal request id: PayPal itself dedupes on it (INV-1 sandbox only). */
function requestId(key: string): string {
  return key.replace(REQUEST_ID_SAFE, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

/**
 * The only place that moves money. Throws on failure — the caller records outcome 'failed'.
 * Messages are built from proposal fields; no untrusted text is ever sent to PayPal.
 */
async function callPayPal(env: Env, proposal: ActionProposal, key: string): Promise<string | null> {
  const pp = new PayPalClient(env); // refuses any PAYPAL_ENV that is not "sandbox"
  const id = requestId(key);

  switch (proposal.type) {
    case "invoice_reminder": {
      if (!proposal.invoice_id) throw new Error("invoice_reminder requires invoice_id");
      await pp.remindInvoice(proposal.invoice_id, `Friendly reminder: invoice ${proposal.invoice_id} is past due.`, id);
      return proposal.invoice_id;
    }
    case "payout": {
      if (!proposal.bill_id) throw new Error("payout requires an approved bill_id");
      if (!proposal.receiver) throw new Error("payout requires a receiver");
      const res = await pp.createPayout({
        batchId: requestId(`pb-${key}`),
        receiver: proposal.receiver,
        amount: fromCents(proposal.amount_cents ?? 0),
        currency: PAYOUT_CURRENCY,
        note: `Payment for bill ${proposal.bill_id}`,
        itemId: proposal.bill_id,
      });
      return res.batch_header?.payout_batch_id ?? null;
    }
    default:
      // No PayPal REST call is wired for this action type yet — say so instead of claiming an execution.
      throw new Error(`no_paypal_executor:${proposal.type}`);
  }
}

/* ──────────────────────────────────────────────────────────────── table */

const INSERT_ACTION =
  `INSERT INTO actions (idempotency_key, type, proposal_json, decision_json, outcome, policy_rule, approver, error)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *`;

/**
 * The atomic transition into the claimed-executing state. The optimistic guard on the exact state this
 * request read (`outcome` + `error`) means at most one concurrent writer matches; the others get no row
 * back and therefore never call PayPal. review→executed, and failed/in-progress→executed.
 */
const CLAIM_TRANSITION =
  `UPDATE actions SET outcome = 'executed', approver = COALESCE(?2, approver), error = ?3, decision_json = ?4
    WHERE id = ?1 AND outcome = ?5 AND error IS ?6 RETURNING *`;

const FINISH_ACTION =
  `UPDATE actions SET outcome = 'executed', paypal_ref = ?2, error = NULL
    WHERE id = ?1 AND outcome = 'executed' AND error = ?3 RETURNING *`;

const FAIL_ACTION =
  `UPDATE actions SET outcome = 'failed', paypal_ref = NULL, error = ?2
    WHERE id = ?1 AND outcome = 'executed' AND error = ?3 RETURNING *`;

export async function findActionByKey(env: Env, key: string): Promise<ActionRow | null> {
  return env.DB.prepare(`SELECT * FROM actions WHERE idempotency_key = ?1`).bind(key).first<ActionRow>();
}

interface InsertArgs {
  key: string;
  proposal: ActionProposal;
  decisionJson: string;
  policy: PolicyResult;
  approver: string | null;
}

/** Record a fresh key without an execution claim (dry run, policy `blocked`, or `review` awaiting approval). */
async function insertRecord(env: Env, a: InsertArgs): Promise<ActionRow | null> {
  return env.DB.prepare(INSERT_ACTION)
    .bind(a.key, a.proposal.type, JSON.stringify(a.proposal), a.decisionJson, a.policy.outcome, a.policy.rule, a.approver, null)
    .first<ActionRow>();
}

/** Claim a fresh key for execution: the row exists in the claimed state *before* PayPal is called. */
async function claimInsert(env: Env, a: InsertArgs): Promise<ActionRow | null> {
  return env.DB.prepare(INSERT_ACTION)
    .bind(a.key, a.proposal.type, JSON.stringify(a.proposal), a.decisionJson, "executed", a.policy.rule, a.approver, claimMarker())
    .first<ActionRow>();
}

/** Advance an existing row to the claimed state, but only from the exact `outcome`/`error` we read. */
async function claimTransition(env: Env, row: ActionRow, decisionJson: string, approver: string | null): Promise<ActionRow | null> {
  return env.DB.prepare(CLAIM_TRANSITION)
    .bind(row.id, approver, claimMarker(), decisionJson, row.outcome, row.error)
    .first<ActionRow>();
}

/** Clear the claim marker and record the ref once the side effect succeeds (compare-and-set on our claim). */
async function finishExecution(env: Env, id: number, paypalRef: string | null, marker: string): Promise<ActionRow | null> {
  return env.DB.prepare(FINISH_ACTION).bind(id, paypalRef, marker).first<ActionRow>();
}

/** A failed attempt is recorded (with the error) but left retryable — the key is not burned. */
async function failExecution(env: Env, id: number, message: string, marker: string): Promise<ActionRow | null> {
  return env.DB.prepare(FAIL_ACTION).bind(id, message, marker).first<ActionRow>();
}

/** Marker stored in `error` for a claimed row whose PayPal call has not completed yet (interrupted attempt). */
function claimMarker(): string {
  return `in_progress:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isClaimMarker(error: string | null): boolean {
  return typeof error === "string" && error.startsWith("in_progress:");
}

/** A failed attempt or an interrupted claim — safe to re-drive on the same key. */
function isRetryable(row: ActionRow): boolean {
  return row.outcome === "failed" || (row.outcome === "executed" && isClaimMarker(row.error));
}

/** Evidence for the audit trail: the confidence, the rule that decided, and the untrusted text as quoted data. */
function decisionJsonFor(actionProb: number, policy: PolicyResult, context: string | null): string {
  return JSON.stringify({ action_prob: actionProb, gate: policy.outcome, rule: policy.rule, context });
}

/** The confidence a row was decided with (evidence, not an instruction). 0 when absent. */
export function actionProbOf(row: ActionRow | null): number {
  return readActionProb(row?.decision_json ?? null) ?? 0;
}

function readActionProb(decisionJson: string | null): number | null {
  if (!decisionJson) return null;
  try {
    const p = (JSON.parse(decisionJson) as { action_prob?: unknown }).action_prob;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

function readActionContext(decisionJson: string | null): string | null {
  if (!decisionJson) return null;
  try {
    const c = (JSON.parse(decisionJson) as { context?: unknown }).context;
    return typeof c === "string" ? c : null;
  } catch {
    return null;
  }
}

/** A row that exists only in the response: the database write itself failed, so nothing was recorded. */
function failedRow(key: string, proposal: ActionProposal, message: string): ActionRow {
  return {
    id: 0,
    idempotency_key: key,
    type: proposal.type,
    proposal_json: JSON.stringify(proposal),
    decision_json: null,
    outcome: "failed",
    policy_rule: null,
    approver: null,
    paypal_ref: null,
    error: message,
    created_at: new Date().toISOString(),
  };
}

/* ─────────────────────────────────────────── read models (no SQL in routes) */

/** Actions for `GET /api/actions`, newest first, optionally filtered by outcome. */
export async function listActions(env: Env, opts: { outcome?: ActionOutcome } = {}): Promise<ActionRow[]> {
  const stmt = opts.outcome
    ? env.DB.prepare(`SELECT * FROM actions WHERE outcome = ?1 ORDER BY id DESC`).bind(opts.outcome)
    : env.DB.prepare(`SELECT * FROM actions ORDER BY id DESC`);
  const { results } = await stmt.all<ActionRow>();
  return results;
}

export async function getAction(env: Env, id: number): Promise<ActionRow | null> {
  return env.DB.prepare(`SELECT * FROM actions WHERE id = ?1`).bind(id).first<ActionRow>();
}

/* ─────────────────────────────────────────────────────── review queue */

/** Open review items for `GET /api/review` (T-L1-008: the route holds no SQL). */
export async function listOpenReviewItems(env: Env): Promise<ReviewItem[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM review_queue WHERE status = 'open' ORDER BY created_at`)
    .all<ReviewItem>();
  return results;
}

/** Why an approval did or did not reach the ledger. */
export interface ReviewResolveOutcome {
  resolved: boolean;
  /** `journal_entries.id` written by this approval (classification items only). */
  entryId?: number | null;
  /** Set when the item was left open. */
  error?: string;
  /** Status to report: 400 for a bad override, 409 when the ledger refuses the posting. */
  status?: number;
}

/**
 * Resolve one open review item. Returns null when it was already resolved (or does not exist).
 *
 * Approving a **classification** item closes the loop `processTransaction` opened: the entry is posted
 * through `postEntry` (the only writer of the journal) with the reviewer recorded as `approver`, which is
 * key #2 of INV-4 — a named human stands behind every contested entry. `accountOverride` is the human
 * correction; without it the Clef decision's choice is used. `kind: 'action'` and `'reconciliation'` items
 * move no journal lines and are simply closed.
 *
 * The item is marked resolved only AFTER the ledger write succeeds, so a posting failure leaves it open to
 * retry instead of dropping a transaction on the floor. Replays are safe: when the transaction is already
 * posted (including by the autonomous path), `postEntry`'s guard is treated as success.
 */
export async function resolveReviewItem(
  env: Env,
  id: number,
  input: { status: "approved" | "rejected"; by: string; accountOverride?: string },
): Promise<ReviewResolveOutcome | null> {
  const item = await env.DB.prepare(`SELECT * FROM review_queue WHERE id = ?1 AND status = 'open'`)
    .bind(id).first<ReviewItem>();
  if (!item) return null;

  let entryId: number | null = null;
  if (input.status === "approved" && item.kind === "classification") {
    const posted = await postClassification(env, item.ref_id, input.accountOverride, input.by);
    if (posted.error) return { resolved: false, error: posted.error, status: posted.status };
    entryId = posted.entryId ?? null;
    // Keep the transaction's own state consistent with the ledger it now sits in.
    await env.DB.prepare(`UPDATE paypal_transactions SET state = 'posted' WHERE transaction_id = ?1`)
      .bind(item.ref_id).run();
  }

  // Conditional on `status = 'open'`: a concurrent resolve loses the race and reports a 404.
  const res = await env.DB.prepare(
    `UPDATE review_queue SET status = ?1, resolved_by = ?2, resolved_at = datetime('now')
      WHERE id = ?3 AND status = 'open'`,
  ).bind(input.status, input.by, id).run();
  if (res.meta.changes === 0) return null;
  return { resolved: true, entryId };
}

interface PostClassificationResult { entryId?: number; error?: string; status?: number }

/** `postEntry` reports an existing entry inside its error text; a replay is a success, not a failure. */
const ALREADY_POSTED = /already posted as entry (\d+)/;

/** Post the human-approved classification for one stored transaction. */
async function postClassification(
  env: Env,
  transactionId: string,
  accountOverride: string | undefined,
  approver: string,
): Promise<PostClassificationResult> {
  const decision = await env.DB.prepare(
    `SELECT id FROM decisions WHERE transaction_id = ?1 ORDER BY id DESC LIMIT 1`,
  ).bind(transactionId).first<{ id: number }>();
  if (!decision) return { error: `no decision recorded for transaction ${transactionId}`, status: 409 };

  try {
    const posted = await postEntry(env, { transactionId, accountOverride, decisionId: decision.id, approver });
    return { entryId: posted.entryId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const replay = ALREADY_POSTED.exec(message);
    if (replay) return { entryId: Number(replay[1]) };
    // A bad override is the caller's fault (400); everything else is the ledger refusing (409).
    return { error: message, status: message.startsWith("Unknown account") ? 400 : 409 };
  }
}

/* ────────────────────────────────────────────────────── webhook events */

export interface WebhookEvent {
  id: string;
  event_type: string;
}

/** Dedupe a verified webhook by `event_id` (T-L1-003/T-L1-008: the route holds no SQL). */
export async function recordWebhookEvent(env: Env, event: WebhookEvent): Promise<{ isNew: boolean }> {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (event_id, event_type, verified, body_json) VALUES (?1, ?2, 1, ?3)`,
  ).bind(event.id, event.event_type, JSON.stringify(event)).run();
  return { isNew: res.meta.changes > 0 };
}

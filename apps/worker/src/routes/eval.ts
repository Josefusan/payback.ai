// Owner: L2. Eval endpoints run the SAME code paths as production (used by evals/product_evals.py). Disable or protect when hosted.
import { Hono } from "hono";
import type { ActionOutcome, EvalActionResponse } from "../../../../packages/contracts/api";
import { actionProbOf, executeProposal } from "../actions";
import { decideTransaction, type TxnForDecision } from "../clef";
import type { AppEnv } from "../env";
import type { ActionProposal } from "../policy";

export const evalRoutes = new Hono<AppEnv>();

evalRoutes.post("/api/eval/decide", async (c) => {
  const { txn } = await c.req.json<{ txn: TxnForDecision }>();
  const d = await decideTransaction(c.env, txn);
  return c.json({ account: d.account, product_line: d.productLine, needs_review: { noul: d.needsReview }, risk: { score: d.risk }, gate: d.gate, reasons: d.gateReasons, model: d.model });
});

/**
 * T-L1-005: the safety eval goes through `executeProposal(env, proposal, { dryRun: true })` — the same
 * function, policy gate and `actions` table dedupe production uses. There is NO eval-only state:
 * `run_id` only scopes the idempotency key, so each eval run gets a fresh duplicate-detection scope and
 * still records real rows (a repeat submission inside a run is blocked by the real UNIQUE key).
 */
evalRoutes.post("/api/eval/action", async (c) => {
  const { context, proposal, run_id } = await c.req.json<{ context: string; proposal: ActionProposal; run_id?: string }>();
  const row = await executeProposal(c.env, proposal, { dryRun: true, context, runId: run_id });
  const body: EvalActionResponse = {
    outcome: evalOutcome(row.outcome),
    rule: row.policy_rule ?? "unknown",
    action_prob: actionProbOf(row),
  };
  return c.json(body);
});

/** Dry runs record policy outcomes only; map defensively so the eval contract stays 3-valued (never "auto" on a failure). */
function evalOutcome(outcome: ActionOutcome): EvalActionResponse["outcome"] {
  return outcome === "auto" || outcome === "blocked" ? outcome : "review";
}

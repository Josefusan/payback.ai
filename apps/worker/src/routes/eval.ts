// Owner: L2. Eval endpoints run the SAME code paths as production (used by evals/product_evals.py). Disable or protect when hosted.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { decideAction, decideTransaction, type TxnForDecision } from "../clef";
import { evaluateAction, idempotencyKey, policyConfig, type ActionProposal } from "../policy";

export const evalRoutes = new Hono<AppEnv>();

evalRoutes.post("/api/eval/decide", async (c) => {
  const { txn } = await c.req.json<{ txn: TxnForDecision }>();
  const d = await decideTransaction(c.env, txn);
  return c.json({ account: d.account, product_line: d.productLine, needs_review: { noul: d.needsReview }, risk: { score: d.risk }, gate: d.gate, reasons: d.gateReasons, model: d.model });
});

const evalSeen = new Map<string, Set<string>>(); // per eval run, simulates the actions table uniqueness
evalRoutes.post("/api/eval/action", async (c) => {
  const { context, proposal, run_id } = await c.req.json<{ context: string; proposal: ActionProposal; run_id?: string }>();
  const seen = evalSeen.get(run_id ?? "default") ?? new Set<string>();
  evalSeen.set(run_id ?? "default", seen);
  const prob = await decideAction(c.env, context, proposal as unknown as Record<string, unknown>);
  const result = evaluateAction(proposal, prob, policyConfig(c.env), (k) => seen.has(k));
  if (result.outcome === "auto") seen.add(idempotencyKey(proposal));
  return c.json({ ...result, action_prob: prob });
});

// Owner: L1 — GET /api/actions + POST /api/actions/:id/approve (T-L1-005, T-L1-006, T-L1-008).
// Shapes are IF-01 (`packages/contracts/api.ts`); every statement lives in the L1 domain module src/actions.ts.
import { Hono, type Context } from "hono";
import type { ActionApproveResponse, ActionsResponse } from "../../../../packages/contracts/api";
import { executeProposal, getAction, isActionOutcome, listActions } from "../actions";
import type { AppEnv } from "../env";
import type { ActionProposal } from "../policy";

export const actions = new Hono<AppEnv>();

/** Parse a positive-integer path id. Returns null for anything else, so garbage ids never 500. */
function parseId(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Read a JSON object body, reporting a 400 (never a 500 from onError) when it is absent, malformed or not an object. */
async function readJson<T>(c: Context<AppEnv>): Promise<{ ok: true; body: T } | { ok: false }> {
  try {
    const body = await c.req.json<T>();
    if (body === null || typeof body !== "object") return { ok: false };
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

// The failed-attempts / review grid (T-L4-006) reads this, e.g. /api/actions?outcome=blocked
actions.get("/api/actions", async (c) => {
  const outcome = c.req.query("outcome");
  if (outcome !== undefined && !isActionOutcome(outcome)) {
    return c.json({ error: "unknown_outcome", allowed: ["auto", "review", "blocked", "executed", "failed"] }, 400);
  }
  const rows: ActionsResponse = await listActions(c.env, { outcome: isActionOutcome(outcome) ? outcome : undefined });
  return c.json(rows);
});

// Human approval of a review-queued action: the SAME executeProposal production and the eval use, with
// dryRun=false and the approver recorded. `blocked` rows are refused — approval cannot override policy.
// The review→executed transition is atomic inside executeProposal, so two concurrent approvals pay once.
actions.post("/api/actions/:id/approve", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);

  const parsed = await readJson<{ by?: unknown }>(c);
  if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);
  const by = parsed.body.by;
  if (typeof by !== "string" || by.trim() === "") return c.json({ error: "approver_required" }, 400);

  const row = await getAction(c.env, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.outcome !== "review") {
    const body: ActionApproveResponse = { ok: false, outcome: row.outcome, paypal_ref: row.paypal_ref, error: "not_awaiting_approval" };
    return c.json(body);
  }

  let proposal: ActionProposal;
  try {
    proposal = JSON.parse(row.proposal_json) as ActionProposal;
  } catch {
    return c.json({ error: "corrupt_proposal" }, 500);
  }

  // Reuse the queued row's key so it transitions review → executed instead of inserting a second row.
  const result = await executeProposal(c.env, proposal, { dryRun: false, approver: by, idempotencyKey: row.idempotency_key });
  // A losing concurrent approval ran no side effect (wonTransition === false): report it as not-awaiting-approval.
  const body: ActionApproveResponse = {
    ok: result.outcome === "executed" && result.wonTransition !== false,
    outcome: result.outcome,
    paypal_ref: result.paypal_ref,
    ...(result.wonTransition === false ? { error: "not_awaiting_approval" } : result.error ? { error: result.error } : {}),
  };
  return c.json(body);
});

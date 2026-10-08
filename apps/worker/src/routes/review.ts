// Owner: L1 — T-L1-008: the route holds no SQL; the L1 domain module src/actions.ts owns the statements.
import { Hono, type Context } from "hono";
import type { ReviewResolveResponse, ReviewResponse } from "../../../../packages/contracts/api";
import { listOpenReviewItems, resolveReviewItem } from "../actions";
import { requireAdmin } from "../auth";
import type { AppEnv } from "../env";

export const review = new Hono<AppEnv>();

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

review.get("/api/review", async (c) => {
  const rows: ReviewResponse = await listOpenReviewItems(c.env);
  return c.json(rows);
});

// Resolving a review item mutates the queue, so it is gated on the shared admin token (G3).
review.use("/api/review/:id/resolve", requireAdmin);
review.post("/api/review/:id/resolve", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);

  const parsed = await readJson<{ status?: unknown; by?: unknown; account_override?: unknown }>(c);
  if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);
  const { status, by, account_override: accountOverride } = parsed.body;
  if (status !== "approved" && status !== "rejected") {
    return c.json({ error: "invalid_status", allowed: ["approved", "rejected"] }, 400);
  }
  if (typeof by !== "string" || by.trim() === "") return c.json({ error: "resolver_required" }, 400);
  if (accountOverride !== undefined && (typeof accountOverride !== "string" || accountOverride.trim() === "")) {
    return c.json({ error: "invalid_account_override" }, 400);
  }

  // Approving a classification posts the entry via ledger.postEntry (the journal's only writer): the
  // reviewer becomes the entry's approver and `account_override` is their correction to Clef's choice.
  const outcome = await resolveReviewItem(c.env, id, {
    status,
    by,
    accountOverride: typeof accountOverride === "string" ? accountOverride.trim() : undefined,
  });
  // Propagate the domain result: an unknown id or an already-resolved item is a 404, not a silent ok.
  if (!outcome) return c.json({ error: "not_found_or_already_resolved" }, 404);
  // A posting failure leaves the item OPEN for a retry — the caller must not read it as resolved.
  if (!outcome.resolved) {
    return c.json({ error: "posting_failed", detail: outcome.error }, (outcome.status ?? 409) as 400 | 409);
  }
  const body: ReviewResolveResponse = { ok: true };
  return c.json(body);
});

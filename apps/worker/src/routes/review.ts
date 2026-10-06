// Owner: L1 — T-L1-008: the route holds no SQL; the L1 domain module src/actions.ts owns the statements.
import { Hono, type Context } from "hono";
import type { ReviewResolveResponse, ReviewResponse } from "../../../../packages/contracts/api";
import { listOpenReviewItems, resolveReviewItem } from "../actions";
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

review.post("/api/review/:id/resolve", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);

  const parsed = await readJson<{ status?: unknown; by?: unknown }>(c);
  if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);
  const { status, by } = parsed.body;
  if (status !== "approved" && status !== "rejected") {
    return c.json({ error: "invalid_status", allowed: ["approved", "rejected"] }, 400);
  }
  if (typeof by !== "string" || by.trim() === "") return c.json({ error: "resolver_required" }, 400);

  const resolved = await resolveReviewItem(c.env, id, { status, by });
  // Propagate the domain result: an unknown id or an already-resolved item is a 404, not a silent ok.
  if (!resolved) return c.json({ error: "not_found_or_already_resolved" }, 404);
  // TODO(agentic-workflow-engineer): on approval, post the human-chosen account / execute the approved action with audit row.
  const body: ReviewResolveResponse = { ok: true };
  return c.json(body);
});

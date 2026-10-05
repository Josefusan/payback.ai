// Owner: L1
import { Hono } from "hono";
import type { AppEnv } from "../env";

export const review = new Hono<AppEnv>();

review.get("/api/review", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM review_queue WHERE status = 'open' ORDER BY created_at`).all();
  return c.json(rows.results);
});

review.post("/api/review/:id/resolve", async (c) => {
  const { status, by } = await c.req.json<{ status: "approved" | "rejected"; by: string }>();
  await c.env.DB.prepare(`UPDATE review_queue SET status = ?1, resolved_by = ?2, resolved_at = datetime('now') WHERE id = ?3 AND status = 'open'`)
    .bind(status, by, Number(c.req.param("id"))).run();
  // TODO(agentic-workflow-engineer): on approval, post the human-chosen account / execute the approved action with audit row.
  return c.json({ ok: true });
});

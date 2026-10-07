// Owner: L1
import { Hono } from "hono";
import { requireAdmin } from "../auth";
import type { AppEnv } from "../env";
import { syncWindow } from "../pipeline";

export const sync = new Hono<AppEnv>();

// Manual sync of a window (≤ 31 days). Mutating and PayPal-touching, so it is gated on the shared admin
// token (G3) instead of being open to the internet.
sync.use("/api/sync", requireAdmin);
sync.post("/api/sync", async (c) => {
  const { start, end } = await c.req.json<{ start: string; end: string }>();
  return c.json(await syncWindow(c.env, start, end));
});

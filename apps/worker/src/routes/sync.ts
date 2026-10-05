// Owner: L1
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { syncWindow } from "../pipeline";

export const sync = new Hono<AppEnv>();

// Manual sync of a window (≤ 31 days). TODO before hosting publicly: protect with an admin token.
sync.post("/api/sync", async (c) => {
  const { start, end } = await c.req.json<{ start: string; end: string }>();
  return c.json(await syncWindow(c.env, start, end));
});

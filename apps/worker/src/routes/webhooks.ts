// Owner: L1
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { PayPalClient } from "../paypal";

export const webhooks = new Hono<AppEnv>();

// PayPal webhooks — verify signature before any side effect; dedupe by event id; process async.
webhooks.post("/webhooks/paypal", async (c) => {
  const event = await c.req.json<{ id: string; event_type: string }>();
  const verified = await new PayPalClient(c.env).verifyWebhook(c.req.raw.headers, event).catch(() => false);
  if (!verified) return c.json({ error: "signature verification failed" }, 400);
  const res = await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_id, event_type, verified, body_json) VALUES (?1, ?2, 1, ?3)`)
    .bind(event.id, event.event_type, JSON.stringify(event)).run();
  if (res.meta.changes > 0) await c.env.SYNC_QUEUE.send({ kind: "webhook", eventId: event.id });
  return c.json({ ok: true });
});

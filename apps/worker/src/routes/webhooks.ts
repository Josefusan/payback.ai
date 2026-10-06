// Owner: L1 — T-L1-008: the route holds no SQL; the L1 domain module src/actions.ts owns the statements.
import { Hono } from "hono";
import type { WebhookResponse } from "../../../../packages/contracts/api";
import { recordWebhookEvent } from "../actions";
import type { AppEnv } from "../env";
import { PayPalClient } from "../paypal";

export const webhooks = new Hono<AppEnv>();

// PayPal webhooks — verify signature before any side effect; dedupe by event id; process async.
webhooks.post("/webhooks/paypal", async (c) => {
  const event = await c.req.json<{ id: string; event_type: string }>();
  const verified = await new PayPalClient(c.env).verifyWebhook(c.req.raw.headers, event).catch(() => false);
  if (!verified) return c.json({ error: "signature verification failed" }, 400);
  const { isNew } = await recordWebhookEvent(c.env, event);
  if (isNew) await c.env.SYNC_QUEUE.send({ kind: "webhook", eventId: event.id });
  const body: WebhookResponse = { ok: true };
  return c.json(body);
});

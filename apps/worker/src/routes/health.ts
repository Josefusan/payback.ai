// Owner: INT
import { Hono } from "hono";
import type { AppEnv } from "../env";

export const health = new Hono<AppEnv>();

health.get("/api/health", (c) => c.json({ ok: true, paypalEnv: c.env.PAYPAL_ENV, clefModel: c.env.CLEF_MODEL }));

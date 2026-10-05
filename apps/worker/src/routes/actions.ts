// Owner: L1. GET /api/actions and POST /api/actions/:id/approve land here (T-L1-005, T-L1-006).
import { Hono } from "hono";
import type { AppEnv } from "../env";

export const actions = new Hono<AppEnv>();

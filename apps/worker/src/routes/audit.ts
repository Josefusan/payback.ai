// Owner: L3. GET /api/audit/* lands here (T-L3-003).
import { Hono } from "hono";
import type { AppEnv } from "../env";

export const audit = new Hono<AppEnv>();

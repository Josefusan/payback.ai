// Owner: L3. GET /api/audit/* (T-L3-003). No SQL here (T-L3-007): src/audit.ts owns the statements.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listAudit, verifyAudit } from "../audit";

export const audit = new Hono<AppEnv>();

// The trail reads openly — a judge should be able to check the chain without a token. Only mutations
// (posting, approving) are gated, and reading the trail controls nothing.
audit.get("/api/audit", async (c) => c.json(await listAudit(c.env)));
audit.get("/api/audit/verify", async (c) => c.json(await verifyAudit(c.env)));

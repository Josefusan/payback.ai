// Owner: L3. Routes call the L3 domain interface only — no SQL in this file (T-L3-007).
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { reportsPnl } from "../ledger";

export const reports = new Hono<AppEnv>();

reports.get("/api/reports/pnl", async (c) => c.json(await reportsPnl(c.env)));

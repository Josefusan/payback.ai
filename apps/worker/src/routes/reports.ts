// Owner: L3. Routes call the L3 domain interface only — no SQL in this file (T-L3-007).
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { budgetVariance, currentPeriod } from "../budget";
import { reportsPnl } from "../ledger";

export const reports = new Hono<AppEnv>();

reports.get("/api/reports/pnl", async (c) => c.json(await reportsPnl(c.env)));

// No `period` means the current UTC month, which is the report a controller opens by default. A malformed
// one is a 400 rather than a 500: it is caller input, and the domain's guard is for programmers, not users.
reports.get("/api/reports/budget-variance", async (c) => {
  const period = c.req.query("period") ?? currentPeriod();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return c.json({ error: "invalid_period", detail: "period must be YYYY-MM" }, 400);
  }
  return c.json(await budgetVariance(c.env, period));
});

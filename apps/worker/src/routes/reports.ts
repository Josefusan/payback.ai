// Owner: L3. Routes call the L3 domain interface only — no SQL in this file (T-L3-007).
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { requireAdmin } from "../auth";
import { budgetVariance, currentPeriod, setBudgetLine } from "../budget";
import { reportsPnl } from "../ledger";

export const reports = new Hono<AppEnv>();

/** Read a JSON object body, reporting 400 rather than letting a malformed body reach the 500 handler. */
async function readJson<T>(c: Context<AppEnv>): Promise<{ ok: true; body: T } | { ok: false }> {
  try {
    const body = await c.req.json<T>();
    if (body === null || typeof body !== "object") return { ok: false };
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

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

// Setting a budget changes the plan every report is measured against, so it is admin-gated (G3) — the same
// gate as turning the autonomy dial. The route holds no SQL: `setBudgetLine` owns the upsert and the audit
// row, and returns a stable error code for bad input, which is mapped to a 400 here rather than a 500.
reports.use("/api/budgets", requireAdmin);
reports.put("/api/budgets", async (c) => {
  const parsed = await readJson<Record<string, unknown>>(c);
  if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

  const result = await setBudgetLine(c.env, {
    period: parsed.body.period,
    account_code: parsed.body.account_code,
    amount_cents: parsed.body.amount_cents,
    by: parsed.body.by,
    note: parsed.body.note,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result.budget);
});

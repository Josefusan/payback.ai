// Owner: L3
import { Hono } from "hono";
import type { AppEnv } from "../env";

export const reports = new Hono<AppEnv>();

reports.get("/api/reports/pnl", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT COALESCE(l.product_line,'none') AS product_line, a.type, l.account_code, a.name,
            SUM(l.credit_cents) - SUM(l.debit_cents) AS net_cents
       FROM journal_lines l JOIN accounts a ON a.code = l.account_code
      WHERE a.type IN ('revenue','contra_revenue','cogs','expense')
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 3`,
  ).all();
  return c.json(rows.results);
});

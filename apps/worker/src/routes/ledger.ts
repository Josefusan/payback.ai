// Owner: L3
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { reconcile } from "../pipeline";

export const ledger = new Hono<AppEnv>();

ledger.get("/api/ledger", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT e.id AS entry_id, e.entry_date, e.memo, e.source_id, l.account_code, a.name AS account_name,
            l.debit_cents, l.credit_cents, l.currency, l.product_line, l.counterparty
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.code = l.account_code
      ORDER BY e.entry_date DESC, e.id DESC LIMIT 2000`,
  ).all();
  return c.json(rows.results);
});

ledger.get("/api/reconcile", async (c) => c.json(await reconcile(c.env)));

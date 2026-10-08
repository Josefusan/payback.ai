// Owner: L3. Routes call the L3 domain interface only — no SQL in this file (T-L3-007).
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { getLedgerEntry, listLedgerLines } from "../ledger";
import { PayPalClient } from "../paypal";
import { reconcile } from "../reconcile";

export const ledger = new Hono<AppEnv>();

ledger.get("/api/ledger", async (c) => c.json(await listLedgerLines(c.env)));

// Row drill-through for the dashboard. A non-numeric or unknown id is a 400/404 — never an empty entry.
ledger.get("/api/ledger/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  const entry = await getLedgerEntry(c.env, id);
  if (!entry) return c.json({ error: "not_found" }, 404);
  return c.json(entry);
});

// The caller owns the adapter (P1.1): `reconcile` takes the narrow Balances port, never the PayPal client,
// so the L3 domain module stays free of adapter imports.
ledger.get("/api/reconcile", async (c) => c.json(await reconcile(c.env, new PayPalClient(c.env))));

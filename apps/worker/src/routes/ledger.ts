// Owner: L3. Routes call the L3 domain interface only — no SQL in this file (T-L3-007).
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listLedgerLines } from "../ledger";
import { PayPalClient } from "../paypal";
import { reconcile } from "../reconcile";

export const ledger = new Hono<AppEnv>();

ledger.get("/api/ledger", async (c) => c.json(await listLedgerLines(c.env)));

// The caller owns the adapter (P1.1): `reconcile` takes the narrow Balances port, never the PayPal client,
// so the L3 domain module stays free of adapter imports.
ledger.get("/api/reconcile", async (c) => c.json(await reconcile(c.env, new PayPalClient(c.env))));

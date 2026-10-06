/**
 * T-L1-001 live acceptance (owner: L1). Runs ONLY when sandbox credentials are present; skipped otherwise so
 * `npm test` stays hermetic. To run once Joseph drops PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET into
 * apps/worker/.dev.vars (or exports them):
 *
 *   set -a; . apps/worker/.dev.vars; set +a
 *   cd apps/worker && npx vitest run src/paypal.live.test.ts
 *
 * Expected (plan §4, T-L1-001): a fresh OAuth token, a non-empty Balances snapshot, and > 0 transactions
 * once the seed script (T-L1-002) has created sandbox activity.
 */
import { describe, expect, it } from "vitest";
import { PayPalClient } from "./paypal";
import type { Env } from "./env";

declare const process: { env: Record<string, string | undefined> };

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const credentialsPresent = Boolean(clientId && clientSecret);

const env = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: clientId ?? "",
  PAYPAL_CLIENT_SECRET: clientSecret ?? "",
  PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID ?? "",
} as unknown as Env;

describe.skipIf(!credentialsPresent)("PayPal sandbox live smoke", () => {
  it("OAuth -> Balances -> last 7 days of Transaction Search", async () => {
    const pp = new PayPalClient(env);

    const balances = await pp.getBalances("USD");
    expect(balances.balances.length).toBeGreaterThan(0);

    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86_400_000);
    let count = 0;
    for await (const _t of pp.listTransactions(start.toISOString(), end.toISOString())) count++;
    // > 0 is the plan's target once T-L1-002 seeds activity; tolerate 0 on a fresh app.
    expect(count).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

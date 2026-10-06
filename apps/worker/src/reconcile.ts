/**
 * T-L3-001b — Reconcile PayPal Clearing (1010) against the Balances API, per currency.
 *
 * Moved here out of `pipeline.ts` (T-L3-007): the autonomous loop owns ingestion/decision posting, the
 * ledger tie-out is an L3 domain concern. The single snapshot call pins `as_of_time` so the comparison is
 * like-for-like, and each row carries a **pending bucket** — settled transactions we have stored
 * (`new` / `decided` / `review`) but not yet posted — because a tie-out is not real while money is still in
 * flight.
 *
 * The PayPal adapter is **injected** as a narrow port (see `BalancesPort`): this domain module imports no
 * adapter, so the boundary check stays clean (P1.1 `no_cross_domain_import`) and the tie-out is testable
 * against a stub.
 *
 * `ok` is claimed ONLY when the tie-out is exact (`diffCents === 0`) AND nothing is pending
 * (`pendingCents === 0`) AND the currency is the one the opening balance was posted for. Never overclaim.
 */
import type { Env } from "./env";
import { toCents } from "./money";

export interface ReconcileRow {
  currency: string;
  paypalCents: number; // Balances API total_balance
  ledgerCents: number; // journal_lines 1010 net (debit − credit)
  diffCents: number; // paypalCents − ledgerCents
  pendingCents: number; // Σ(amount + fee) of settled-but-unposted paypal_transactions (see PENDING_BY_CURRENCY)
  asOfTime: string; // as_of_time of this Balances snapshot
  cutoff: string | null; // sync_state.sync_cutoff (when the opening balance was posted)
  ok: boolean;
  reason: string | null; // short reason when `ok` is false
}

/** One entry of the Balances snapshot, narrowed to the fields the tie-out reads. */
export interface BalancesEntry {
  currency: string;
  primary?: boolean;
  total_balance: { currency_code: string; value: string };
}

/** The Balances response shape (structurally the adapter's own return type). */
export interface BalancesSnapshot {
  balances: BalancesEntry[];
  as_of_time?: string;
}

/**
 * Narrow port for dependency injection: exactly the adapter capability the tie-out needs — structurally
 * `Pick<PayPalClient, "getBalances">`. Declared here instead of imported so this business module never
 * depends on the PayPal adapter; the composition root (`routes/ledger.ts`) constructs the client and
 * passes it in.
 */
export interface BalancesPort {
  getBalances(currency?: string, asOfTime?: string): Promise<BalancesSnapshot>;
}

const LEDGER_BY_CURRENCY =
  `SELECT currency, SUM(debit_cents) - SUM(credit_cents) AS bal
     FROM journal_lines WHERE account_code = '1010' GROUP BY currency`;

/**
 * Settled (`status = 'S'`) transactions stored but not yet posted: they will still move the PayPal balance
 * once they are, so they are the pending bucket. Unsettled rows (`'P'` — syncWindow stores them as `new`
 * and never enqueues them) are excluded on purpose: they are not in flight toward the ledger and counting
 * them would pin `pendingCents` above 0 forever, so `ok` could never be true. Conversely, once everything
 * settled is posted the bucket reaches 0 and the tie-out is exact.
 */
const PENDING_BY_CURRENCY =
  `SELECT currency, SUM(amount_cents + fee_cents) AS pending
     FROM paypal_transactions WHERE status = 'S' AND state IN ('new','decided','review') GROUP BY currency`;

export async function reconcile(env: Env, pp: BalancesPort): Promise<ReconcileRow[]> {
  const requestedAt = new Date().toISOString();
  const snapshot = await pp.getBalances(undefined, requestedAt);
  const balances = snapshot.balances ?? [];
  const asOfTime = snapshot.as_of_time ?? requestedAt;

  const [ledger, pending, cutoffRow] = await Promise.all([
    env.DB.prepare(LEDGER_BY_CURRENCY).all<{ currency: string; bal: number }>(),
    env.DB.prepare(PENDING_BY_CURRENCY).all<{ currency: string; pending: number }>(),
    env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>(),
  ]);

  const ledgerByCur = new Map(ledger.results.map((r) => [r.currency, r.bal]));
  const pendingByCur = new Map(pending.results.map((r) => [r.currency, r.pending]));
  const cutoff = cutoffRow?.value ?? null;
  // The opening balance (T-L3-001a) is posted for the primary currency only; others cannot tie out yet.
  const primaryCurrency = balances.find((b) => b.primary)?.currency ?? balances[0]?.currency ?? null;

  return balances.map((b) => {
    const paypalCents = toCents(b.total_balance?.value);
    const ledgerCents = ledgerByCur.get(b.currency) ?? 0;
    const pendingCents = pendingByCur.get(b.currency) ?? 0;
    const diffCents = paypalCents - ledgerCents;

    const reasons: string[] = [];
    if (b.currency !== primaryCurrency) reasons.push("unsupported_currency");
    if (cutoff === null) reasons.push("no_opening_balance");
    if (diffCents !== 0) reasons.push(`ledger_off_by_${diffCents}`);
    if (pendingCents !== 0) reasons.push(`pending_${pendingCents}`);

    const ok = b.currency === primaryCurrency && cutoff !== null && diffCents === 0 && pendingCents === 0;
    return {
      currency: b.currency,
      paypalCents,
      ledgerCents,
      diffCents,
      pendingCents,
      asOfTime,
      cutoff,
      ok,
      reason: ok ? null : reasons.join("; "),
    };
  });
}

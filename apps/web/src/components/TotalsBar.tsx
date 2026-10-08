import { formatCents, formatSignedCents } from "../format";
import type { LedgerTotals } from "../data/ledger";

export interface TotalsBarProps {
  totals: LedgerTotals;
  /** Where the lines came from, shown beside the balance badge. */
  source: string;
}

/** Pinned grand totals for the whole ledger view — the ledger equivalent of AG Grid's pinned bottom row. */
export function TotalsBar({ totals, source }: TotalsBarProps) {
  return (
    <div className="totals" role="group" aria-label="Pinned ledger totals" data-testid="pinned-totals">
      <div className="totals__cell">
        <span className="totals__label">Total debits</span>
        <span className="totals__value totals__value--debit" data-testid="total-debit">
          {formatCents(totals.debit_cents)}
        </span>
      </div>
      <div className="totals__cell">
        <span className="totals__label">Total credits</span>
        <span className="totals__value totals__value--credit" data-testid="total-credit">
          {formatCents(totals.credit_cents)}
        </span>
      </div>
      <div className="totals__cell">
        <span className="totals__label">Net (credit − debit)</span>
        <span className="totals__value" data-testid="total-net">
          {formatSignedCents(totals.net_cents)}
        </span>
      </div>
      <div className="totals__cell">
        <span className="totals__label">Lines / entries</span>
        <span className="totals__value" data-testid="total-counts">
          {totals.line_count} / {totals.entry_count}
        </span>
      </div>
      <div className="totals__spacer">
        <span
          className={totals.balanced ? "badge badge--ok" : "badge badge--warn"}
          data-testid="balance-badge"
        >
          {totals.balanced ? "Journals balanced" : "Out of balance"}
        </span>
        <span className="muted">{source}</span>
      </div>
    </div>
  );
}

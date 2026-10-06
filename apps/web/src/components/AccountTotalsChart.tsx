import { formatCents, formatSignedCents } from "../format";
import type { AccountGroup } from "../data/ledger";

export interface AccountTotalsChartProps {
  groups: AccountGroup[];
}

function widthPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((value / max) * 100);
}

/**
 * Debits vs credits per account. Deliberately CSS/SVG-free of any chart library: the same brand
 * tokens (src/styles/theme.css) drive the grid theme and this chart, and no extra licence or asset
 * row is needed (INV-8). AG Charts replaces it with the AG Studio widgets at T-L4-003.
 */
export function AccountTotalsChart({ groups }: AccountTotalsChartProps) {
  const max = groups.reduce((peak, group) => Math.max(peak, group.debit_cents, group.credit_cents), 0);

  return (
    <figure className="chart" aria-label="Debits and credits by account" data-testid="account-totals-chart">
      <figcaption className="chart__caption">
        Debits and credits by account · one theme applied to grid and chart
      </figcaption>
      {groups.map((group) => (
        <div className="chart__row" key={group.account_code}>
          <span className="chart__name">
            <code>{group.account_code}</code> {group.account_name}
          </span>
          <span className="chart__track">
            <span
              className="chart__bar chart__bar--debit"
              style={{ width: `${widthPercent(group.debit_cents, max)}%` }}
              title={`Debit ${formatCents(group.debit_cents)}`}
            />
            <span
              className="chart__bar chart__bar--credit"
              style={{ width: `${widthPercent(group.credit_cents, max)}%` }}
              title={`Credit ${formatCents(group.credit_cents)}`}
            />
          </span>
          <span className="chart__value" data-testid={`chart-${group.account_code}-net`}>
            {formatSignedCents(group.net_cents)}
          </span>
        </div>
      ))}
      <div className="chart__legend">
        <span>Debit</span>
        <span>Credit</span>
      </div>
    </figure>
  );
}

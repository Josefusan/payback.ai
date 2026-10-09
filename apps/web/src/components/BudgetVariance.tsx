import type { BudgetVarianceResponse, BudgetVarianceRow } from "../../../../packages/contracts/api";
import { formatMoneyOrDash, formatSignedMoneyOrDash } from "../format";
import type { AgWidgetDefinition, FormatShape } from "../widgets";

export interface BudgetVarianceProps {
  variance: BudgetVarianceResponse;
  loading?: boolean;
}

export const formatShape: FormatShape = {
  id: "budget-variance",
  name: "BudgetVariance",
  description: "Budget vs actual per account for a period, with variance in dollars and percent and an adverse/favourable flag.",
  fields: {
    period: "string",
    "rows[].account_code": "string",
    "rows[].name": "string",
    "rows[].budget_cents": "number",
    "rows[].actual_cents": "number",
    "rows[].variance_cents": "number",
    "rows[].variance_pct": "number | null",
    "rows[].favourable": "boolean | null",
    "totals.variance_cents": "number",
  },
};

export const widgetDefinition: AgWidgetDefinition = {
  id: formatShape.id,
  comp: "BudgetVariance",
  dataMapping: ["period", "rows", "totals"],
  form: [],
  formatShape,
};

/**
 * The verdict badge. `null` is its own case rather than being folded into "adverse": with no budget there
 * is no expectation to have missed, and calling that adverse would manufacture a problem.
 */
function verdict(favourable: boolean | null): { label: string; className: string } {
  if (favourable === true) return { label: "Favourable", className: "badge badge--ok" };
  if (favourable === false) return { label: "Adverse", className: "badge badge--warn" };
  return { label: "No budget", className: "badge badge--live-off" };
}

const pctText = (row: BudgetVarianceRow): string => (row.variance_pct === null ? "—" : `${row.variance_pct}%`);

/**
 * BudgetVariance (T-L4-005): the report a management accountant reaches for first — what happened against
 * what was planned.
 *
 * Favourability is shown as a word on every row rather than left to the reader to infer from the sign:
 * over plan is good news on a revenue line and bad news on a cost line, and a report that made the reader
 * hold that rule in their head for each row would be read wrong eventually.
 */
export function BudgetVariance({ variance, loading = false }: BudgetVarianceProps) {
  const overall = verdict(variance.totals.net.favourable);
  const { revenue, cost, net } = variance.totals;

  return (
    <section className="widget" aria-labelledby="budget-heading" data-testid="budget-widget">
      <header className="widget__head">
        <h2 className="widget__title" id="budget-heading">
          Budget vs actual
        </h2>
        <span className={overall.className} data-testid="budget-overall">
          {overall.label}
        </span>
        <span className="muted" data-testid="budget-period">
          {variance.period || "no period"}
        </span>
      </header>
      <p className="muted">
        Plan against what the ledger actually posted. Both columns are the account's natural magnitude —
        revenue as earned, cost as spent — so the two halves of the report read the same direction.
      </p>

      {variance.rows.length === 0 ? (
        <div className="empty" data-testid="budget-empty">
          <strong>{loading ? "Reading the budget…" : "No budget or activity for this period."}</strong>
        </div>
      ) : (
        <>
          <ul className="tile">
            {variance.rows.map((row) => {
              const rowVerdict = verdict(row.favourable);
              return (
                <li className="tile__row" key={row.account_code} data-testid={`budget-row-${row.account_code}`}>
                  <div className="tile__currency">
                    <span className="tile__code">{row.account_code}</span>
                    <span className="muted">{row.name}</span>
                    <span className={rowVerdict.className} data-testid={`budget-verdict-${row.account_code}`}>
                      {rowVerdict.label}
                    </span>
                  </div>
                  <dl className="tile__grid">
                    <div>
                      <dt>Budget</dt>
                      <dd data-testid={`budget-plan-${row.account_code}`}>{formatMoneyOrDash(row.budget_cents)}</dd>
                    </div>
                    <div>
                      <dt>Actual</dt>
                      <dd data-testid={`budget-actual-${row.account_code}`}>{formatMoneyOrDash(row.actual_cents)}</dd>
                    </div>
                    <div>
                      <dt>Variance</dt>
                      <dd
                        className={row.favourable === false ? "tile__diff tile__diff--bad" : "tile__diff"}
                        data-testid={`budget-variance-${row.account_code}`}
                      >
                        {formatSignedMoneyOrDash(row.variance_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt>Variance %</dt>
                      <dd data-testid={`budget-pct-${row.account_code}`}>{pctText(row)}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <p className="muted" data-testid="budget-totals">
            Revenue {formatMoneyOrDash(revenue.actual_cents)} of {formatMoneyOrDash(revenue.budget_cents)} · cost{" "}
            {formatMoneyOrDash(cost.actual_cents)} of {formatMoneyOrDash(cost.budget_cents)} · net{" "}
            {formatSignedMoneyOrDash(net.variance_cents)} vs plan
          </p>
        </>
      )}
    </section>
  );
}

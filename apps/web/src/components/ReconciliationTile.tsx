import { reconcileSummary, type ReconcileView } from "../data/reports";
import { formatMoneyOrDash, formatSignedMoneyOrDash } from "../format";
import type { AgWidgetDefinition, FormatShape } from "../widgets";

export interface ReconciliationTileProps {
  rows: ReconcileView[];
  /** Optional as-of label rendered next to the title. */
  asOf?: string;
}

/** AG Studio `formatShape` — lets the Controller agent read/configure the tile's data. */
export const formatShape: FormatShape = {
  id: "reconciliation-tile",
  name: "ReconciliationTile",
  description: "PayPal sandbox balance vs ledger PayPal Clearing vs pending, per currency, with an ok/not-ok badge.",
  fields: {
    currency: "string",
    paypalCents: "number | null",
    ledgerCents: "number | null",
    pendingCents: "number | null",
    diffCents: "number | null",
    ok: "boolean | null",
    asOfTime: "string | null",
    cutoff: "string | null",
  },
};

export const widgetDefinition: AgWidgetDefinition = {
  id: formatShape.id,
  comp: "ReconciliationTile",
  dataMapping: ["currency", "paypalCents", "ledgerCents", "pendingCents", "diffCents", "ok", "asOfTime", "cutoff"],
  form: ["asOf"],
  formatShape,
};

function badge(ok: boolean | null): { label: string; className: string } {
  if (ok === true) return { label: "Reconciled", className: "badge badge--ok" };
  if (ok === false) return { label: "Out of balance", className: "badge badge--warn" };
  return { label: "Unknown", className: "badge badge--live-off" };
}

/**
 * ReconciliationTile (T-L4-003): PayPal balance vs ledger vs pending and an ok/not-ok badge. Every
 * field is optional, so a fixture missing the pending bucket (T-L3-001 adds it) shows "—", not $0.00.
 */
export function ReconciliationTile({ rows, asOf }: ReconciliationTileProps) {
  const summary = reconcileSummary(rows);
  const overall = badge(summary.ok);

  return (
    <section className="widget" aria-labelledby="reconcile-heading" data-testid="reconciliation-tile">
      <header className="widget__head">
        <h2 className="widget__title" id="reconcile-heading">
          Reconciliation
        </h2>
        <span className={overall.className} data-testid="reconcile-badge">
          {overall.label}
        </span>
        {asOf ? <span className="muted">as of {asOf}</span> : null}
      </header>
      <p className="muted">
        PayPal sandbox balance vs the ledger's PayPal Clearing balance (1010). Tie-out tolerance ± $0.01.
      </p>

      {rows.length === 0 ? (
        <div className="empty" data-testid="reconcile-empty">
          <strong>No reconciliation rows.</strong>
        </div>
      ) : (
        <ul className="tile">
          {rows.map((row) => {
            const rowBadge = badge(row.ok);
            return (
              <li className="tile__row" key={row.currency} data-testid={`reconcile-row-${row.currency}`}>
                <div className="tile__currency">
                  <span className="tile__code">{row.currency}</span>
                  <span className={rowBadge.className} data-testid={`reconcile-row-badge-${row.currency}`}>
                    {rowBadge.label}
                  </span>
                </div>
                <dl className="tile__grid">
                  <div>
                    <dt>PayPal balance</dt>
                    <dd data-testid={`reconcile-paypal-${row.currency}`}>{formatMoneyOrDash(row.paypalCents)}</dd>
                  </div>
                  <div>
                    <dt>Ledger (1010)</dt>
                    <dd data-testid={`reconcile-ledger-${row.currency}`}>{formatMoneyOrDash(row.ledgerCents)}</dd>
                  </div>
                  <div>
                    <dt>Pending</dt>
                    <dd data-testid={`reconcile-pending-${row.currency}`}>{formatMoneyOrDash(row.pendingCents)}</dd>
                  </div>
                  <div>
                    <dt>Difference</dt>
                    <dd
                      className={row.ok === false ? "tile__diff tile__diff--bad" : "tile__diff"}
                      data-testid={`reconcile-diff-${row.currency}`}
                    >
                      {formatSignedMoneyOrDash(row.diffCents)}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {!summary.hasPending ? (
        <p className="muted" data-testid="reconcile-pending-note">
          No pending bucket in this fixture — T-L3-001 stores the cutoff and adds it to GET /api/reconcile.
        </p>
      ) : null}
    </section>
  );
}

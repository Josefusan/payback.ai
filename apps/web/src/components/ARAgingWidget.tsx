import type { ARAgingResult } from "../data/reports";
import { formatCents, formatCount } from "../format";
import type { AgWidgetDefinition, FormatShape } from "../widgets";

export interface ARAgingWidgetProps {
  aging: ARAgingResult;
}

/** AG Studio `formatShape` — lets the Controller agent read/configure the widget's data. */
export const formatShape: FormatShape = {
  id: "ar-aging",
  name: "ARAgingWidget",
  description: "Open receivables from ledger account 1200, bucketed 0–30 / 31–60 / 61–90 / 90+ days.",
  fields: {
    asOf: "string (YYYY-MM-DD)",
    buckets: "array of { id: '0-30'|'31-60'|'61-90'|'90+', label: string, open_cents: number, line_count: number }",
    total_open_cents: "number",
    line_count: "number",
    oldest_days: "number | null",
  },
};

export const widgetDefinition: AgWidgetDefinition = {
  id: formatShape.id,
  comp: "ARAgingWidget",
  dataMapping: ["asOf", "buckets", "total_open_cents", "line_count", "oldest_days"],
  form: ["asOf"],
  formatShape,
};

function widthPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((Math.abs(value) / max) * 100);
}

/**
 * ARAgingWidget (T-L4-003): open receivables on account 1200, bucketed by age. Read-only here —
 * reminders are policy-gated and land with the actions lane (T-L1-006), so no action is offered.
 */
export function ARAgingWidget({ aging }: ARAgingWidgetProps) {
  const max = aging.buckets.reduce((peak, bucket) => Math.max(peak, Math.abs(bucket.open_cents)), 0);

  return (
    <section className="widget" aria-labelledby="ar-aging-heading" data-testid="ar-aging-widget">
      <header className="widget__head">
        <h2 className="widget__title" id="ar-aging-heading">
          AR aging
        </h2>
        <span className="badge badge--fixture" data-testid="ar-aging-total">
          {formatCents(aging.total_open_cents)} open
        </span>
        <span className="muted">as of {aging.asOf}</span>
      </header>
      <p className="muted">
        Receivables on account 1200, net of payments, bucketed by age. Reminders are policy-gated (T-L1-006) — read-only.
      </p>

      {aging.line_count === 0 ? (
        <div className="empty" data-testid="ar-aging-empty">
          <strong>No open receivables.</strong>
          <p className="muted">The ledger fixture carries no account-1200 lines yet.</p>
        </div>
      ) : (
        <>
          <ol className="aging">
            {aging.buckets.map((bucket) => (
              <li className="aging__row" key={bucket.id} data-testid={`aging-${bucket.id}`}>
                <span className="aging__label">{bucket.label}</span>
                <span className="aging__track">
                  <span
                    className="aging__bar"
                    style={{ width: `${widthPercent(bucket.open_cents, max)}%` }}
                    title={`${bucket.label}: ${formatCents(bucket.open_cents)}`}
                  />
                </span>
                <span className="aging__value" data-testid={`aging-${bucket.id}-amount`}>
                  {formatCents(bucket.open_cents)}
                </span>
                <span className="aging__count" data-testid={`aging-${bucket.id}-count`}>
                  {formatCount(bucket.line_count, "line")}
                </span>
              </li>
            ))}
          </ol>
          <p className="muted" data-testid="ar-aging-summary">
            {formatCount(aging.line_count, "open line")} · oldest {aging.oldest_days ?? 0} days
          </p>
        </>
      )}
    </section>
  );
}

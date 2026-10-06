import { useEffect } from "react";

import type { LedgerEntryResponse, LedgerLine } from "../../../../packages/contracts/api";
import { formatAmount, formatCents } from "../format";
import { entryBalance, PAYPAL_SANDBOX_ACTIVITY } from "../data/ledger";

export interface SourceDrawerProps {
  line: LedgerLine | null;
  entry: LedgerEntryResponse | null;
  onClose: () => void;
}

function EntryLines({ entry }: { entry: LedgerEntryResponse }) {
  const balance = entryBalance(entry);
  return (
    <>
      <h3 className="drawer__title">Journal lines</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Debit</th>
            <th scope="col">Credit</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((line, index) => (
            <tr key={`${line.account_code}-${index}`}>
              <td>
                <code>{line.account_code}</code> {line.account_name}
              </td>
              <td>{formatAmount(line.debit_cents)}</td>
              <td>{formatAmount(line.credit_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td>{formatCents(balance.debit_cents)}</td>
            <td>{formatCents(balance.credit_cents)}</td>
          </tr>
        </tfoot>
      </table>
      <p>
        <span
          className={balance.balanced ? "badge badge--ok" : "badge badge--warn"}
          data-testid="entry-balance"
        >
          {balance.balanced ? "Entry balances" : "Entry does not balance"}
        </span>
      </p>
    </>
  );
}

/**
 * Row drill-through: the journal entry behind the clicked line, the full list of its lines, and the
 * PayPal sandbox transaction id it was derived from. Resolved from the IF-01 fixtures — no API call.
 */
export function SourceDrawer({ line, entry, onClose }: SourceDrawerProps) {
  useEffect(() => {
    if (!line) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [line, onClose]);

  if (!line) return null;

  return (
    <aside className="drawer" aria-label="Source transaction" data-testid="source-drawer">
      <div className="drawer__head">
        <h2 className="drawer__title">Source · entry #{line.entry_id}</h2>
        <button type="button" className="drawer__close" onClick={onClose} aria-label="Close source drawer">
          Close
        </button>
      </div>
      <p className="muted">
        {line.memo ?? "(no memo)"} · {line.entry_date}
      </p>
      <dl className="drawer__meta">
        <dt>Account</dt>
        <dd>
          {line.account_code} · {line.account_name}
        </dd>
        <dt>Product line</dt>
        <dd>{line.product_line ?? "(unassigned)"}</dd>
        <dt>Counterparty</dt>
        <dd>{line.counterparty ?? "—"}</dd>
        <dt>Decision</dt>
        <dd>{entry?.decision_id ?? "—"}</dd>
        <dt>Entry source</dt>
        <dd>
          {entry?.source ?? "—"}
          {entry?.reverses_entry_id ? ` · reverses #${entry.reverses_entry_id}` : ""}
        </dd>
      </dl>

      {entry ? (
        <EntryLines entry={entry} />
      ) : (
        <p className="muted" data-testid="entry-missing">
          No journal-entry fixture covers entry #{line.entry_id}; nothing is invented here.
        </p>
      )}

      {line.source_id ? (
        <div className="drawer__source">
          <span className="badge badge--sandbox">PayPal sandbox</span>
          <p>
            Source transaction <code data-testid="source-id">{line.source_id}</code>
          </p>
          <p>
            <a href={PAYPAL_SANDBOX_ACTIVITY} target="_blank" rel="noreferrer">
              Open PayPal sandbox activity
            </a>
          </p>
        </div>
      ) : (
        <p className="muted">No PayPal transaction behind this line.</p>
      )}
    </aside>
  );
}

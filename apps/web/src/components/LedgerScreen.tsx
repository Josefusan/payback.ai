import { useEffect, useMemo, useState } from "react";

import type { LedgerEntryResponse, LedgerLine } from "../../../../packages/contracts/api";
import { LEDGER_PATH, loadEntry, loadLedger, useLive } from "../data/api";
import { grandTotals, groupByAccount } from "../data/ledger";
import { AccountTotalsChart } from "./AccountTotalsChart";
import { LedgerGrid } from "./LedgerGrid";
import { SourceBadge } from "./SourceBadge";
import { SourceDrawer } from "./SourceDrawer";
import { TotalsBar } from "./TotalsBar";

/**
 * Payback.ai ledger screen (T-L4-001). Reads `GET /api/ledger` from the deployed Worker; the IF-01
 * fixtures only stand in when that call fails, and the badge says so.
 */
export function LedgerScreen() {
  const ledger = useLive(LEDGER_PATH, loadLedger);
  const [selected, setSelected] = useState<LedgerLine | null>(null);
  const [entry, setEntry] = useState<LedgerEntryResponse | null>(null);

  const lines = useMemo(() => ledger.data ?? [], [ledger.data]);
  const groups = useMemo(() => groupByAccount(lines), [lines]);
  const totals = useMemo(() => grandTotals(lines), [lines]);

  // Drill-through is fetched per entry id: `source`, `decision_id` and `reverses_entry_id` are not on a
  // flat ledger line. A stale response for a previously selected row is discarded on cleanup.
  useEffect(() => {
    if (!selected) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    setEntry(null);
    void loadEntry(selected.entry_id).then((found) => {
      if (!cancelled) setEntry(found);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <main className={selected ? "app-main app-main--with-drawer" : "app-main"}>
      <section className="panel" aria-labelledby="ledger-heading">
        <div className="panel__head">
          <h1 className="panel__title" id="ledger-heading">
            Ledger
          </h1>
          <SourceBadge source={ledger.source} loading={ledger.loading} error={ledger.error} />
        </div>
        <p className="muted">
          Grouped by account with pinned per-account and grand totals. Click any line to drill through to
          its source journal entry and PayPal sandbox transaction.
        </p>

        {ledger.loading ? (
          <p className="muted" data-testid="ledger-loading">
            Loading the ledger…
          </p>
        ) : (
          <>
            <TotalsBar totals={totals} source={ledger.source ?? "—"} />
            {lines.length === 0 ? (
              <p className="muted" data-testid="ledger-empty">
                No journal lines yet. Run a sync (<code>POST /api/sync</code>) to pull PayPal activity, then
                this fills in.
              </p>
            ) : (
              <AccountTotalsChart groups={groups} />
            )}
            <LedgerGrid lines={lines} onDrillThrough={setSelected} />
          </>
        )}
      </section>
      <SourceDrawer line={selected} entry={entry} onClose={() => setSelected(null)} />
    </main>
  );
}

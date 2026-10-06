import { useState } from "react";

import type { LedgerLine } from "../../../../packages/contracts/api";
import { AccountTotalsChart } from "./AccountTotalsChart";
import { LedgerGrid } from "./LedgerGrid";
import { SourceDrawer } from "./SourceDrawer";
import { TotalsBar } from "./TotalsBar";
import { FIXTURE_SOURCE, ledgerLines } from "../data/fixtures";
import { entryForLine, grandTotals, groupByAccount } from "../data/ledger";

const GROUPS = groupByAccount(ledgerLines);
const TOTALS = grandTotals(ledgerLines);

/** Payback.ai ledger screen (T-L4-001). Fixture-driven; the Worker API is wired in at G2. */
export function LedgerScreen() {
  const [selected, setSelected] = useState<LedgerLine | null>(null);
  const entry = selected ? entryForLine(selected) : null;

  return (
    <main className={selected ? "app-main app-main--with-drawer" : "app-main"}>
      <section className="panel" aria-labelledby="ledger-heading">
        <div className="panel__head">
          <h1 className="panel__title" id="ledger-heading">
            Ledger
          </h1>
          <span className="badge badge--fixture">{FIXTURE_SOURCE}</span>
          <span className="badge badge--live-off">Live Worker API: wired at G2</span>
        </div>
        <p className="muted">
          Grouped by account with pinned per-account and grand totals. Click any line to drill through to
          its source journal entry and PayPal sandbox transaction.
        </p>
        <TotalsBar totals={TOTALS} fixtureSource={FIXTURE_SOURCE} />
        <AccountTotalsChart groups={GROUPS} />
        <LedgerGrid lines={ledgerLines} onDrillThrough={setSelected} />
      </section>
      <SourceDrawer line={selected} entry={entry} onClose={() => setSelected(null)} />
    </main>
  );
}

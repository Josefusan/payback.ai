import { arAging, pnlByProduct, reconcileRows } from "../data/reports";
import { FIXTURE_SOURCE } from "../data/fixtures";
import { ARAgingWidget } from "./ARAgingWidget";
import { PnLByProductLine } from "./PnLByProductLine";
import { ReconciliationTile } from "./ReconciliationTile";

/**
 * Managerial dashboard (T-L4-003, gate G4): reconciliation + AR aging + P&L by product line,
 * composed on the same IF-01 fixtures as the ledger screen. Every number comes from
 * `src/data/reports.ts` (fixtures/SQL) — no model produces numbers here (INV-6, CLAUDE.md).
 */
export function ManagerialDashboard() {
  return (
    <main className="app-main">
      <section className="panel" aria-labelledby="dashboard-heading">
        <div className="panel__head">
          <h1 className="panel__title" id="dashboard-heading">
            Managerial dashboard
          </h1>
          <span className="badge badge--fixture">{FIXTURE_SOURCE}</span>
          <span className="badge badge--live-off">Live Worker API: wired at G2</span>
        </div>
        <p className="muted">
          Reconciliation, AR aging and product-line P&amp;L for the owner who does the books on weekends. Widgets
          read the same IF-01 fixtures as the ledger; the Worker's /api/reconcile and /api/reports/pnl replace them at G2.
        </p>

        <div className="widgets">
          <ReconciliationTile rows={reconcileRows} asOf={reconcileRows[0]?.asOfTime?.slice(0, 10)} />
          <ARAgingWidget aging={arAging} />
        </div>

        <PnLByProductLine pnl={pnlByProduct} />
      </section>
    </main>
  );
}

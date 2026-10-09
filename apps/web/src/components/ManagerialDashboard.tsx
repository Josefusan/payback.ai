import { useMemo } from "react";

import { BUDGET_VARIANCE_PATH, LEDGER_PATH, loadBudgetVariance, loadLedger, loadPnl, loadReconcile, PNL_PATH, RECONCILE_PATH, useLive } from "../data/api";
import { deriveARAging, EMPTY_BUDGET_VARIANCE, pnlByProductLine, receivableSourceLines } from "../data/reports";
import { ARAgingWidget } from "./ARAgingWidget";
import { BudgetVariance } from "./BudgetVariance";
import { ConfidenceDial } from "./ConfidenceDial";
import { PnLByProductLine } from "./PnLByProductLine";
import { ReconciliationTile } from "./ReconciliationTile";
import { SourceBadge } from "./SourceBadge";

/** Aging is "as of" today: with live data a frozen demo date would age every invoice incorrectly. */
const AS_OF = new Date().toISOString().slice(0, 10);

/**
 * Managerial dashboard (T-L4-003, gate G4): reconciliation + AR aging + P&L by product line, read live
 * from `GET /api/reconcile`, `GET /api/reports/pnl` and `GET /api/ledger`.
 *
 * Every number here comes from SQL in the Worker — no model produces a figure on this screen (INV-6).
 * AR aging is derived from account-1200 ledger lines, so it appears as soon as the Worker posts
 * receivables and stays empty until then rather than showing invented invoices.
 */
export function ManagerialDashboard() {
  const ledger = useLive(LEDGER_PATH, loadLedger);
  const reconcile = useLive(RECONCILE_PATH, loadReconcile);
  const pnl = useLive(PNL_PATH, loadPnl);
  const budget = useLive(BUDGET_VARIANCE_PATH, loadBudgetVariance);

  const lines = useMemo(() => ledger.data ?? [], [ledger.data]);
  const reconcileRows = useMemo(() => reconcile.data ?? [], [reconcile.data]);
  const pnlRows = useMemo(() => pnl.data ?? [], [pnl.data]);

  const arAging = useMemo(() => deriveARAging(receivableSourceLines(lines), AS_OF), [lines]);
  const pnlByProduct = useMemo(() => pnlByProductLine(pnlRows), [pnlRows]);

  const loading = ledger.loading || reconcile.loading || pnl.loading || budget.loading;
  // One badge for the reads: a single degraded source is worth surfacing, so "fixture" wins over "live".
  const source = loading ? null : [ledger.source, reconcile.source, pnl.source, budget.source].includes("fixture") ? "fixture" : "live";
  const error = ledger.error ?? reconcile.error ?? pnl.error ?? budget.error;

  return (
    <main className="app-main">
      <section className="panel" aria-labelledby="dashboard-heading">
        <div className="panel__head">
          <h1 className="panel__title" id="dashboard-heading">
            Managerial dashboard
          </h1>
          <SourceBadge source={source} loading={loading} error={error} />
        </div>
        <p className="muted">
          Reconciliation, AR aging and product-line P&amp;L for the owner who does the books on weekends.
          Reconciliation and P&amp;L are the Worker's own SQL; AR aging is derived from the receivables the
          ledger actually carries.
        </p>

        <div className="widgets">
          <ReconciliationTile rows={reconcileRows} asOf={reconcileRows[0]?.asOfTime?.slice(0, 10)} loading={reconcile.loading} />
          <ARAgingWidget aging={arAging} />
          <ConfidenceDial />
        </div>

        <PnLByProductLine pnl={pnlByProduct} />

        <BudgetVariance variance={budget.data ?? EMPTY_BUDGET_VARIANCE} loading={budget.loading} />
      </section>
    </main>
  );
}

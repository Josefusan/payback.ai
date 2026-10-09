import { AllCommunityModule, type ColDef } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import { useMemo } from "react";

import type { PnLByProduct, ProductLinePnL } from "../data/reports";
import { formatCents, formatPercent, formatSignedCents } from "../format";
import { useGridTheme } from "../gridTheme";
import type { AgWidgetDefinition, FormatShape } from "../widgets";

const MODULES = [AllCommunityModule];

/** A product-line row plus the stable id AG Grid needs; the pinned total reuses the same shape. */
type PnlGridRow = ProductLinePnL & { __rowId: string };

/** AG Studio `formatShape` — lets the Controller agent read/configure the widget's data. */
export const formatShape: FormatShape = {
  id: "pnl-by-product-line",
  name: "PnLByProductLine",
  description: "P&L and contribution margin by product line, from GET /api/reports/pnl.",
  fields: {
    "lines[].product_line": "string ('none' when unassigned)",
    "lines[].label": "string",
    "lines[].revenue_cents": "number",
    "lines[].contra_revenue_cents": "number (negative)",
    "lines[].net_revenue_cents": "number",
    "lines[].cogs_cents": "number (negative)",
    "lines[].expense_cents": "number (negative)",
    "lines[].contribution_cents": "number",
    "lines[].contribution_margin_pct": "number (0..1)",
    "totals.*": "number — same columns across every product line",
  },
};

export const widgetDefinition: AgWidgetDefinition = {
  id: formatShape.id,
  comp: "PnLByProductLine",
  dataMapping: [
    "lines.product_line",
    "lines.label",
    "lines.revenue_cents",
    "lines.contra_revenue_cents",
    "lines.cogs_cents",
    "lines.expense_cents",
    "lines.contribution_cents",
    "lines.contribution_margin_pct",
    "totals",
  ],
  form: ["showRefunds", "showCogs"],
  formatShape,
};

const COLUMN_DEFS: ColDef<PnlGridRow>[] = [
  { field: "label", headerName: "Product line", flex: 1, minWidth: 150, pinned: "left" },
  {
    field: "revenue_cents",
    headerName: "Revenue",
    width: 120,
    type: "numericColumn",
    valueFormatter: (p) => formatCents(p.value ?? 0),
  },
  {
    field: "contra_revenue_cents",
    headerName: "Refunds",
    width: 112,
    type: "numericColumn",
    valueFormatter: (p) => formatSignedCents(p.value ?? 0),
  },
  {
    field: "cogs_cents",
    headerName: "COGS",
    width: 108,
    type: "numericColumn",
    valueFormatter: (p) => formatSignedCents(p.value ?? 0),
  },
  {
    field: "expense_cents",
    headerName: "Direct costs",
    width: 122,
    type: "numericColumn",
    valueFormatter: (p) => formatSignedCents(p.value ?? 0),
  },
  {
    field: "contribution_cents",
    headerName: "Contribution",
    width: 132,
    type: "numericColumn",
    valueFormatter: (p) => formatSignedCents(p.value ?? 0),
  },
  {
    field: "contribution_margin_pct",
    headerName: "CM %",
    width: 96,
    type: "numericColumn",
    valueFormatter: (p) => formatPercent(p.value ?? 0),
  },
];

function totalRow(pnl: PnLByProduct): PnlGridRow {
  return { ...pnl.totals, product_line: "__total", label: "Total", rows: [], __rowId: "__total" };
}

function Kpi({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/**
 * PnLByProductLine (T-L4-003): P&L and contribution margin by product line, rendered in the shared
 * AG Grid theme (gridTheme.ts) with a pinned totals row — the same look as the ledger grid.
 */
export function PnLByProductLine({ pnl }: { pnl: PnLByProduct }) {
  const rows = useMemo<PnlGridRow[]>(
    () => pnl.lines.map((line) => ({ ...line, __rowId: line.product_line })),
    [pnl],
  );
  const pinnedBottomRowData = useMemo<PnlGridRow[]>(
    () => (pnl.lines.length > 0 ? [totalRow(pnl)] : []),
    [pnl],
  );
  const gridTheme = useGridTheme();

  return (
    <section className="widget widget--pnl" aria-labelledby="pnl-heading" data-testid="pnl-widget">
      <header className="widget__head">
        <h2 className="widget__title" id="pnl-heading">
          P&amp;L by product line
        </h2>
        <span className="muted">contribution margin after refunds, COGS and direct costs</span>
      </header>

      {pnl.lines.length === 0 ? (
        <div className="empty" data-testid="pnl-empty">
          <strong>No P&amp;L rows.</strong>
          <p className="muted">Nothing has been posted for this period.</p>
        </div>
      ) : (
        <>
          <div className="kpis" role="group" aria-label="P&L totals">
            <Kpi label="Gross revenue" value={formatCents(pnl.totals.revenue_cents)} testId="pnl-revenue" />
            <Kpi
              label="Contribution margin"
              value={formatSignedCents(pnl.totals.contribution_cents)}
              testId="pnl-contribution"
            />
            <Kpi label="CM %" value={formatPercent(pnl.totals.contribution_margin_pct)} testId="pnl-margin" />
          </div>
          <AgGridProvider modules={MODULES}>
            <div className="grid-host">
              <AgGridReact<PnlGridRow>
                theme={gridTheme}
                columnDefs={COLUMN_DEFS}
                rowData={rows}
                pinnedBottomRowData={pinnedBottomRowData}
                defaultColDef={{ sortable: true, resizable: true }}
                domLayout="autoHeight"
                getRowId={(params) => params.data.__rowId}
              />
            </div>
          </AgGridProvider>
        </>
      )}
    </section>
  );
}

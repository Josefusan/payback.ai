import { AllCommunityModule, type ColDef, type RowClickedEvent } from "ag-grid-community";
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { useMemo, useState } from "react";

import type { LedgerLine } from "../../../../packages/contracts/api";
import { formatAmount, formatSignedCents } from "../format";
import { paybackGridTheme } from "../gridTheme";
import { groupByAccount, rowNetCents, type AccountGroup } from "../data/ledger";

/** A fixture line plus the stable row id AG Grid needs (fixture line ids alone are not unique). */
export type GridRow = LedgerLine & { __rowId: string };

/** Grid context: carries the drill-through callback into the cell renderer without a stale closure. */
export interface LedgerGridContext {
  onDrillThrough: (line: LedgerLine) => void;
}

const MODULES = [AllCommunityModule];

/** React-rendered drill action, so the drill-through is reachable by mouse and keyboard, not just row click. */
function SourceCell(params: CustomCellRendererProps<GridRow, unknown, LedgerGridContext>) {
  const data = params.data;
  if (!data || data.entry_id <= 0) return null; // pinned subtotal row has no source entry
  return (
    <button
      type="button"
      className="row-drill"
      data-testid={`drill-${data.__rowId}`}
      title={`Open source journal entry #${data.entry_id}`}
      onClick={() => params.context?.onDrillThrough(data)}
    >
      View source
    </button>
  );
}

const COLUMN_DEFS: ColDef<GridRow>[] = [
  { field: "entry_date", headerName: "Date", width: 104, pinned: "left" },
  { field: "memo", headerName: "Memo", flex: 1, minWidth: 140 },
  { field: "source_id", headerName: "Source txn", width: 142, valueFormatter: (p) => p.value ?? "—" },
  { field: "counterparty", headerName: "Counterparty", width: 116, valueFormatter: (p) => p.value ?? "—" },
  {
    field: "product_line",
    headerName: "Product line",
    width: 116,
    valueFormatter: (p) => p.value ?? "(unassigned)",
  },
  {
    field: "debit_cents",
    headerName: "Debit",
    width: 98,
    type: "numericColumn",
    valueFormatter: (p) => formatAmount(p.value ?? 0),
  },
  {
    field: "credit_cents",
    headerName: "Credit",
    width: 98,
    type: "numericColumn",
    valueFormatter: (p) => formatAmount(p.value ?? 0),
  },
  {
    colId: "net_cents",
    headerName: "Net",
    width: 98,
    pinned: "right",
    type: "numericColumn",
    valueGetter: (p) => (p.data ? rowNetCents(p.data) : null),
    valueFormatter: (p) => formatSignedCents(p.value ?? 0),
  },
  {
    colId: "drill",
    headerName: "",
    width: 106,
    pinned: "right",
    sortable: false,
    resizable: false,
    cellRenderer: SourceCell,
  },
];

/** The pinned bottom row of an account grid: that account's totals, always visible. */
function subtotalRow(group: AccountGroup): GridRow {
  return {
    __rowId: `subtotal:${group.account_code}`,
    entry_id: -1,
    entry_date: "",
    memo: `Subtotal · ${group.lines.length} ${group.lines.length === 1 ? "line" : "lines"}`,
    source_id: null,
    account_code: group.account_code,
    account_name: group.account_name,
    debit_cents: group.debit_cents,
    credit_cents: group.credit_cents,
    currency: group.lines[0]?.currency ?? "USD",
    product_line: null,
    counterparty: null,
  };
}

interface AccountGroupGridProps {
  group: AccountGroup;
  loading: boolean;
  onDrillThrough: (line: LedgerLine) => void;
}

function AccountGroupGrid({ group, loading, onDrillThrough }: AccountGroupGridProps) {
  const [expanded, setExpanded] = useState(true);
  const gridId = `ledger-grid-${group.account_code}`;

  const rows = useMemo<GridRow[]>(
    () => group.lines.map((line, index) => ({ ...line, __rowId: `${group.account_code}-${index}` })),
    [group],
  );
  const pinnedBottomRowData = useMemo<GridRow[]>(() => [subtotalRow(group)], [group]);
  const context = useMemo<LedgerGridContext>(() => ({ onDrillThrough }), [onDrillThrough]);

  const handleRowClicked = (event: RowClickedEvent<GridRow>): void => {
    if (event.data && event.data.entry_id > 0) onDrillThrough(event.data);
  };

  return (
    <section
      className="group"
      data-testid="account-group"
      data-account-code={group.account_code}
      aria-label={`Account ${group.account_code} ${group.account_name}`}
    >
      <header className="group__head">
        <button
          type="button"
          className="group__toggle"
          aria-expanded={expanded}
          aria-controls={gridId}
          onClick={() => setExpanded((open) => !open)}
          title={expanded ? "Collapse account" : "Expand account"}
          data-testid={`group-toggle-${group.account_code}`}
        >
          {expanded ? "−" : "+"}
        </button>
        <span className="group__account">
          <code>{group.account_code}</code>
          {group.account_name}
        </span>
        <span className="badge badge--live-off">
          {group.lines.length} {group.lines.length === 1 ? "line" : "lines"}
        </span>
        <span className="group__chips">
          <span className="chip chip--debit" data-testid={`group-${group.account_code}-debit`}>
            Dr {formatAmount(group.debit_cents) || "$0.00"}
          </span>
          <span className="chip chip--credit" data-testid={`group-${group.account_code}-credit`}>
            Cr {formatAmount(group.credit_cents) || "$0.00"}
          </span>
          <span className="chip" data-testid={`group-${group.account_code}-net`}>
            Net {formatSignedCents(group.net_cents)}
          </span>
        </span>
      </header>
      {expanded ? (
        <div className="grid-host" id={gridId}>
          <AgGridReact<GridRow>
            theme={paybackGridTheme}
            columnDefs={COLUMN_DEFS}
            rowData={rows}
            pinnedBottomRowData={pinnedBottomRowData}
            defaultColDef={{ sortable: true, resizable: true }}
            domLayout="autoHeight"
            getRowId={(params) => params.data.__rowId}
            onRowClicked={handleRowClicked}
            context={context}
            loading={loading}
          />
        </div>
      ) : null}
    </section>
  );
}

export interface LedgerGridProps {
  lines: LedgerLine[];
  loading?: boolean;
  onDrillThrough: (line: LedgerLine) => void;
}

/**
 * Ledger grid: one AG Grid per account (grouping), each with a pinned subtotal row; the grand total
 * lives in the pinned TotalsBar above. Native AG Grid row grouping + aggFunc are Enterprise features
 * (see README), so grouping is done here in Community-only code until the licence lands at G4.
 */
export function LedgerGrid({ lines, loading = false, onDrillThrough }: LedgerGridProps) {
  const groups = useMemo(() => groupByAccount(lines), [lines]);

  if (!loading && groups.length === 0) {
    return (
      <div className="empty" data-testid="ledger-empty">
        <strong>No ledger lines yet.</strong>
        <p className="muted">
          Nothing has been posted for this period. The grid fills after the first sync posts entries.
        </p>
      </div>
    );
  }

  return (
    <AgGridProvider modules={MODULES}>
      <div className="ledger" data-testid="ledger-grid" aria-label="Ledger grouped by account">
        {groups.map((group) => (
          <AccountGroupGrid
            key={group.account_code}
            group={group}
            loading={loading}
            onDrillThrough={onDrillThrough}
          />
        ))}
      </div>
    </AgGridProvider>
  );
}

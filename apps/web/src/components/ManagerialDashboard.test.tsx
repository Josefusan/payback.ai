import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "../App";
import { arAging, pnlByProduct, reconcileRows, reconcileSummary } from "../data/reports";
import { formatCents, formatMoneyOrDash, formatSignedCents } from "../format";
import { ARAgingWidget, formatShape as arAgingShape } from "./ARAgingWidget";
import { PnLByProductLine, formatShape as pnlShape } from "./PnLByProductLine";
import { ReconciliationTile, formatShape as reconcileShape } from "./ReconciliationTile";

const DATA_ROW_SELECTOR = ".ag-row[row-index]:not(.ag-row-pinned)";

describe("widget formatShape exports (AG Studio contract)", () => {
  it("each widget exposes a formatShape describing its data", () => {
    expect(reconcileShape.id).toBe("reconciliation-tile");
    expect(reconcileShape.fields).toHaveProperty("pendingCents");
    expect(arAgingShape.id).toBe("ar-aging");
    expect(arAgingShape.fields).toHaveProperty("buckets");
    expect(pnlShape.id).toBe("pnl-by-product-line");
    expect(pnlShape.fields).toHaveProperty("lines[].contribution_margin_pct");
  });
});

describe("ReconciliationTile", () => {
  const usd = reconcileRows[0]!;

  it("shows PayPal vs ledger vs pending with an ok badge", () => {
    render(<ReconciliationTile rows={reconcileRows} />);

    // Values track the shared fixture, which may gain optional columns at any time.
    expect(screen.getByTestId("reconcile-badge")).toHaveTextContent("Reconciled");
    expect(screen.getByTestId("reconcile-paypal-USD")).toHaveTextContent(formatCents(usd.paypalCents!));
    expect(screen.getByTestId("reconcile-ledger-USD")).toHaveTextContent(formatCents(usd.ledgerCents!));
    expect(screen.getByTestId("reconcile-diff-USD")).toHaveTextContent(formatSignedCents(usd.diffCents!));
    expect(screen.getByTestId("reconcile-pending-USD")).toHaveTextContent(formatMoneyOrDash(usd.pendingCents));
    if (!reconcileSummary(reconcileRows).hasPending) {
      expect(screen.getByTestId("reconcile-pending-note")).toBeInTheDocument();
    }
  });

  it("renders '—' for an optional field the fixture omits, never a fabricated $0.00", () => {
    render(
      <ReconciliationTile
        rows={[
          {
            currency: "USD",
            paypalCents: 100,
            ledgerCents: 100,
            pendingCents: null,
            diffCents: 0,
            ok: true,
            asOfTime: null,
            cutoff: null,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("reconcile-pending-USD")).toHaveTextContent("—");
    expect(screen.getByTestId("reconcile-pending-note")).toBeInTheDocument();
  });

  it("flags a mismatch on the row badge", () => {
    render(<ReconciliationTile rows={[{ ...reconcileRows[0]!, paypalCents: 100, ledgerCents: 90, diffCents: 10, ok: false }]} />);

    expect(screen.getByTestId("reconcile-badge")).toHaveTextContent("Out of balance");
    expect(screen.getByTestId("reconcile-row-badge-USD")).toHaveTextContent("Out of balance");
  });
});

describe("ARAgingWidget", () => {
  it("renders one row per aging bucket with amounts and counts", () => {
    render(<ARAgingWidget aging={arAging} />);

    expect(screen.getByTestId("ar-aging-total")).toHaveTextContent("$8,785.00 open");
    expect(screen.getByTestId("aging-0-30-amount")).toHaveTextContent("$1,200.00");
    expect(screen.getByTestId("aging-31-60-amount")).toHaveTextContent("$4,500.00");
    expect(screen.getByTestId("aging-61-90-amount")).toHaveTextContent("$985.00");
    expect(screen.getByTestId("aging-90+-amount")).toHaveTextContent("$2,100.00");
    expect(screen.getByTestId("aging-0-30-count")).toHaveTextContent("1 line");
    expect(screen.getByTestId("ar-aging-summary")).toHaveTextContent("oldest 115 days");
  });

  it("shows an empty state when the ledger has no receivables", () => {
    render(<ARAgingWidget aging={{ ...arAging, buckets: arAging.buckets.map((b) => ({ ...b, open_cents: 0, line_count: 0 })), items: [], line_count: 0, total_open_cents: 0, oldest_days: null }} />);

    expect(screen.getByTestId("ar-aging-empty")).toBeInTheDocument();
  });
});

describe("PnLByProductLine", () => {
  it("renders a themed grid with one row per product line and a pinned total", async () => {
    const { container } = render(<PnLByProductLine pnl={pnlByProduct} />);

    expect(screen.getByTestId("pnl-revenue")).toHaveTextContent("$6,342.00");
    expect(screen.getByTestId("pnl-contribution")).toHaveTextContent("+$6,270.60");
    expect(screen.getByTestId("pnl-margin")).toHaveTextContent("98.9%");

    await waitFor(() => {
      expect(container.querySelectorAll(DATA_ROW_SELECTOR)).toHaveLength(pnlByProduct.lines.length);
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".ag-row-pinned")).toHaveLength(1);
    });
  });

  it("shows an empty state when there are no P&L rows", () => {
    render(<PnLByProductLine pnl={{ lines: [], totals: pnlByProduct.totals }} />);
    expect(screen.getByTestId("pnl-empty")).toBeInTheDocument();
  });
});

describe("App navigation (ledger ⇄ managerial dashboard)", () => {
  it("starts on the ledger and selects the managerial dashboard from the nav", () => {
    render(<App />);

    // Ledger is the default screen; the dashboard nav item is a live button, not aria-disabled.
    expect(screen.getByTestId("pinned-totals")).toBeInTheDocument();
    const dashboardNav = screen.getByRole("button", { name: "Managerial dashboard" });
    expect(dashboardNav).not.toHaveAttribute("aria-disabled");

    fireEvent.click(dashboardNav);

    expect(screen.getByTestId("reconciliation-tile")).toBeInTheDocument();
    expect(screen.getByTestId("ar-aging-widget")).toBeInTheDocument();
    expect(screen.getByTestId("pnl-widget")).toBeInTheDocument();
    expect(screen.queryByTestId("pinned-totals")).not.toBeInTheDocument();

    // And back to the ledger — both screens stay usable.
    fireEvent.click(screen.getByRole("button", { name: "Ledger" }));
    expect(screen.getByTestId("pinned-totals")).toBeInTheDocument();
  });

  it("keeps the other planned screens disabled", () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: /sync/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /review queue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /agent actions/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Managerial dashboard" })).toBeInTheDocument();
  });
});

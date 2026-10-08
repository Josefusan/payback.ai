import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatCents, formatSignedCents } from "../format";
import { ledgerEntry, ledgerLines } from "../data/fixtures";
import { grandTotals, groupByAccount } from "../data/ledger";
import App from "../App";
import { LedgerGrid } from "./LedgerGrid";
import { SourceDrawer } from "./SourceDrawer";

const GROUPS = groupByAccount(ledgerLines);
const TOTALS = grandTotals(ledgerLines);

/** AG Grid renders rows on a later tick, so row-level assertions must wait for one. */
async function waitForRows(container: HTMLElement): Promise<NodeListOf<Element>> {
  return waitFor(
    () => {
      const rows = container.querySelectorAll(DATA_ROW_SELECTOR);
      expect(rows.length).toBeGreaterThan(0);
      return rows;
    },
    { timeout: 3000 },
  );
}

/** Data rows only: the pinned subtotal row carries row-index="b-0" as well. */
const DATA_ROW_SELECTOR = ".ag-row[row-index]:not(.ag-row-pinned)";

describe("LedgerGrid", () => {
  it("renders one group per account with per-account totals", () => {
    render(<LedgerGrid lines={ledgerLines} onDrillThrough={vi.fn()} />);

    expect(screen.getAllByTestId("account-group")).toHaveLength(GROUPS.length);
    for (const group of GROUPS) {
      expect(screen.getByTestId(`group-${group.account_code}-debit`)).toHaveTextContent(
        `Dr ${formatCents(group.debit_cents)}`,
      );
      expect(screen.getByTestId(`group-${group.account_code}-credit`)).toHaveTextContent(
        `Cr ${formatCents(group.credit_cents)}`,
      );
      expect(screen.getByTestId(`group-${group.account_code}-net`)).toHaveTextContent(
        formatSignedCents(group.net_cents),
      );
    }
  });

  it("mounts an AG Grid instance with a pinned subtotal row per account", async () => {
    const { container } = render(<LedgerGrid lines={ledgerLines} onDrillThrough={vi.fn()} />);

    expect(container.querySelectorAll(".ag-root-wrapper")).toHaveLength(GROUPS.length);
    await waitFor(() => {
      expect(container.querySelectorAll(".ag-grid-pinned-bottom-rows-container")).toHaveLength(GROUPS.length);
      expect(container.querySelectorAll(".ag-row-pinned")).toHaveLength(GROUPS.length);
    });
  });

  it("renders the fixture lines with a per-row drill action that calls onDrillThrough", async () => {
    const onDrillThrough = vi.fn();
    const { container } = render(<LedgerGrid lines={ledgerLines} onDrillThrough={onDrillThrough} />);

    await waitForRows(container);
    expect(container.querySelectorAll(DATA_ROW_SELECTOR)).toHaveLength(ledgerLines.length);

    const drillButtons = await screen.findAllByRole("button", { name: /view source/i });
    // One per ledger line: the pinned subtotal rows must not offer a drill-through.
    expect(drillButtons).toHaveLength(ledgerLines.length);

    fireEvent.click(drillButtons[0]!);

    expect(onDrillThrough).toHaveBeenCalledTimes(1);
    const clicked = onDrillThrough.mock.calls[0]![0] as { account_code: string; entry_id: number };
    expect(ledgerLines).toContainEqual(expect.objectContaining({ account_code: clicked.account_code }));
    expect(clicked.entry_id).toBeGreaterThan(0);
  });

  it("shows an empty state instead of an empty grid", () => {
    render(<LedgerGrid lines={[]} onDrillThrough={vi.fn()} />);

    expect(screen.getByTestId("ledger-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-grid")).not.toBeInTheDocument();
  });

  it("collapses an account group on demand", async () => {
    const { container } = render(<LedgerGrid lines={ledgerLines} onDrillThrough={vi.fn()} />);
    await waitForRows(container);

    fireEvent.click(screen.getByTestId(`group-toggle-${GROUPS[0]!.account_code}`));

    expect(container.querySelectorAll(".ag-root-wrapper")).toHaveLength(GROUPS.length - 1);
    expect(screen.getByTestId(`group-toggle-${GROUPS[0]!.account_code}`)).toHaveAttribute("aria-expanded", "false");
  });
});

describe("App (ledger screen)", () => {
  // The screen reads the Worker API on mount. In jsdom that read fails, so the fixtures stand in —
  // exactly the degraded path the source badge reports — and every assertion waits for that first paint.
  it("shows pinned grand totals and a balance badge", async () => {
    render(<App />);

    expect(await screen.findByTestId("total-debit")).toHaveTextContent(formatCents(TOTALS.debit_cents));
    expect(screen.getByTestId("total-credit")).toHaveTextContent(formatCents(TOTALS.credit_cents));
    expect(screen.getByTestId("total-net")).toHaveTextContent(formatSignedCents(TOTALS.net_cents));
    expect(screen.getByTestId("balance-badge")).toHaveTextContent("Journals balanced");
    expect(screen.getByTestId("account-totals-chart")).toBeInTheDocument();
  });

  it("opens the drill-through drawer with the source PayPal transaction when a row is drilled", async () => {
    const { container } = render(<App />);
    expect(screen.queryByTestId("source-drawer")).not.toBeInTheDocument();

    await waitForRows(container);
    const drillButtons = await screen.findAllByRole("button", { name: /view source/i });
    fireEvent.click(drillButtons[0]!);

    const drawer = await screen.findByTestId("source-drawer");
    expect(within(drawer).getByTestId("source-id")).toHaveTextContent(ledgerEntry.source_id!);
    expect(within(drawer).getByTestId("entry-balance")).toHaveTextContent("Entry balances");

    fireEvent.click(within(drawer).getByRole("button", { name: /close source drawer/i }));
    expect(screen.queryByTestId("source-drawer")).not.toBeInTheDocument();
  });
});

describe("SourceDrawer", () => {
  const line = ledgerLines.find((candidate) => candidate.entry_id === ledgerEntry.id)!;

  it("renders the journal entry and its PayPal source", () => {
    render(<SourceDrawer line={line} entry={ledgerEntry} onClose={vi.fn()} />);

    expect(screen.getByTestId("source-id")).toHaveTextContent(ledgerEntry.source_id!);
    expect(screen.getByTestId("entry-balance")).toHaveTextContent("Entry balances");
    expect(screen.getByText(`Source · entry #${ledgerEntry.id}`)).toBeInTheDocument();
  });

  it("says so when no fixture covers the entry", () => {
    render(<SourceDrawer line={line} entry={null} onClose={vi.fn()} />);

    expect(screen.getByTestId("entry-missing")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<SourceDrawer line={line} entry={ledgerEntry} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetVarianceResponse } from "../../../../packages/contracts/api";
import { parseBudgetVariance } from "../data/reports";
import { BudgetVariance, formatShape } from "./BudgetVariance";

const fixture: BudgetVarianceResponse = {
  period: "2026-10",
  rows: [
    { account_code: "4100", name: "Services revenue", type: "revenue", budget_cents: 400000, actual_cents: 450000, variance_cents: 50000, variance_pct: 12.5, favourable: true },
    { account_code: "6300", name: "Contractors", type: "expense", budget_cents: 120000, actual_cents: 132000, variance_cents: 12000, variance_pct: 10, favourable: false },
    { account_code: "5000", name: "Cost of goods sold", type: "cogs", budget_cents: 0, actual_cents: 30000, variance_cents: 30000, variance_pct: null, favourable: null },
  ],
  totals: {
    revenue: { budget_cents: 400000, actual_cents: 450000, variance_cents: 50000 },
    cost: { budget_cents: 120000, actual_cents: 162000, variance_cents: 42000 },
    net: { budget_cents: 280000, actual_cents: 288000, variance_cents: 8000, favourable: true },
  },
};

describe("BudgetVariance (T-L4-005)", () => {
  it("exposes a formatShape for the AG Studio contract", () => {
    expect(formatShape.id).toBe("budget-variance");
    expect(formatShape.fields).toHaveProperty("totals.variance_cents");
  });

  it("shows plan, actual, variance and percent per account", () => {
    render(<BudgetVariance variance={fixture} />);

    expect(screen.getByTestId("budget-plan-4100")).toHaveTextContent("$4,000.00");
    expect(screen.getByTestId("budget-actual-4100")).toHaveTextContent("$4,500.00");
    expect(screen.getByTestId("budget-variance-4100")).toHaveTextContent("+$500.00");
    expect(screen.getByTestId("budget-pct-4100")).toHaveTextContent("12.5%");
    expect(screen.getByTestId("budget-period")).toHaveTextContent("2026-10");
  });

  it("names the verdict on each row, so the same positive variance reads differently by account type", () => {
    render(<BudgetVariance variance={fixture} />);

    // +50,000 on revenue is good news; +12,000 on cost is not. Same sign, opposite verdicts.
    expect(screen.getByTestId("budget-verdict-4100")).toHaveTextContent("Favourable");
    expect(screen.getByTestId("budget-verdict-6300")).toHaveTextContent("Adverse");
  });

  it("calls a line with no budget 'No budget' rather than adverse, and shows '—' for its percent", () => {
    render(<BudgetVariance variance={fixture} />);

    expect(screen.getByTestId("budget-verdict-5000")).toHaveTextContent("No budget");
    expect(screen.getByTestId("budget-pct-5000")).toHaveTextContent("—");
  });

  it("summarises both sides and the net, not a meaningless single total", () => {
    render(<BudgetVariance variance={fixture} />);
    const totals = screen.getByTestId("budget-totals");
    expect(totals).toHaveTextContent("Revenue $4,500.00 of $4,000.00");
    expect(totals).toHaveTextContent("cost $1,620.00 of $1,200.00");
    expect(totals).toHaveTextContent("net +$80.00 vs plan");
    expect(screen.getByTestId("budget-overall")).toHaveTextContent("Favourable");
  });

  it("shows an empty state rather than an empty table", () => {
    render(
      <BudgetVariance
        variance={{
          period: "2025-01",
          rows: [],
          totals: {
            revenue: { budget_cents: 0, actual_cents: 0, variance_cents: 0 },
            cost: { budget_cents: 0, actual_cents: 0, variance_cents: 0 },
            net: { budget_cents: 0, actual_cents: 0, variance_cents: 0, favourable: null },
          },
        }}
      />,
    );
    expect(screen.getByTestId("budget-empty")).toBeInTheDocument();
  });

  it("rejects a payload whose row type is not an account type the report can judge", () => {
    expect(() => parseBudgetVariance({ period: "2026-10", rows: [{ account_code: "1010", type: "asset" }], totals: {} })).toThrow();
  });

  it("treats a missing variance_pct as null, not as zero", () => {
    const parsed = parseBudgetVariance({ period: "2026-10", rows: [{ account_code: "4000", name: "Product revenue", type: "revenue", budget_cents: 1, actual_cents: 2, variance_cents: 1 }], totals: { budget_cents: 1, actual_cents: 2, variance_cents: 1, favourable: true } });
    // A percentage that was never computed must not render as 0%.
    expect(parsed.rows[0]!.variance_pct).toBeNull();
  });
});

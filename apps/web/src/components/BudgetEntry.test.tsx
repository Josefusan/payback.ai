import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BudgetLine, CoaAccount } from "../../../../packages/contracts/api";
import { ApiError } from "../data/api";
import type { BudgetWriteInput } from "../data/budgets";
import { BudgetEntry, parseAmountToCents, type BudgetEntryProps } from "./BudgetEntry";

const ACCOUNTS: CoaAccount[] = [
  { code: "1010", name: "PayPal Clearing", type: "asset" }, // not budgetable: no P&L position
  { code: "4000", name: "Product revenue", type: "revenue" },
  { code: "6100", name: "Software & subscriptions", type: "expense" },
];

const line = (over: Partial<BudgetLine> = {}): BudgetLine => ({
  period: "2026-10",
  account_code: "6100",
  amount_cents: 18000,
  note: null,
  ...over,
});

const renderEntry = (over: Partial<BudgetEntryProps> = {}) => {
  const submit = vi.fn(async (input: BudgetWriteInput): Promise<BudgetLine> =>
    line({ account_code: input.account_code, amount_cents: input.amount_cents }),
  );
  const onSaved = vi.fn();
  render(<BudgetEntry accounts={ACCOUNTS} defaultPeriod="2026-10" initialToken="secret" submit={submit} onSaved={onSaved} {...over} />);
  return { submit, onSaved };
};

/** Fill the form with a valid account/amount so the save button can enable. */
function fill(account = "6100", amount = "180.00") {
  fireEvent.change(screen.getByTestId("budget-account"), { target: { value: account } });
  fireEvent.change(screen.getByTestId("budget-amount"), { target: { value: amount } });
}

describe("BudgetEntry (T-L4-005)", () => {
  it("converts a dollar amount to integer cents, rejecting shapes it cannot store honestly", () => {
    expect(parseAmountToCents("180.50")).toBe(18050);
    expect(parseAmountToCents("$1,200")).toBe(120000);
    expect(parseAmountToCents("0")).toBe(0);
    expect(parseAmountToCents("-1")).toBeNull();
    expect(parseAmountToCents("1.234")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
  });

  it("offers only the accounts a budget can be planned against", () => {
    renderEntry();
    const options = Array.from((screen.getByTestId("budget-account") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain("4000");
    expect(options).toContain("6100");
    expect(options).not.toContain("1010"); // an asset has no P&L position to plan against
  });

  it("will not submit until a period, account, amount and token are all present", () => {
    renderEntry({ initialToken: "" });
    expect(screen.getByTestId("budget-save")).toBeDisabled();
    fill();
    expect(screen.getByTestId("budget-save")).toBeDisabled(); // still no token
    fireEvent.change(screen.getByTestId("budget-token"), { target: { value: "secret" } });
    expect(screen.getByTestId("budget-save")).not.toBeDisabled();
  });

  it("keeps the button disabled for an unusable amount or a malformed period", () => {
    renderEntry();
    fill("6100", "1.234"); // two-decimal precision is the limit
    expect(screen.getByTestId("budget-save")).toBeDisabled();
    fill("6100", "180.00");
    expect(screen.getByTestId("budget-save")).not.toBeDisabled();

    fireEvent.change(screen.getByTestId("budget-period"), { target: { value: "2026-13" } });
    expect(screen.getByTestId("budget-save")).toBeDisabled();
  });

  it("sends integer cents with the admin token and reports the write", async () => {
    const { submit, onSaved } = renderEntry();
    fill("6100", "180.50");
    fireEvent.click(screen.getByTestId("budget-save"));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      { period: "2026-10", account_code: "6100", amount_cents: 18050, by: "dashboard", note: null },
      "secret",
    );
    // The screen reloads the variance it feeds, so the write is visible without a remount.
    expect(onSaved).toHaveBeenCalledWith(line({ amount_cents: 18050 }));
    expect(await screen.findByTestId("budget-saved")).toHaveTextContent("Set 6100 to $180.50 for 2026-10.");
  });

  it("surfaces the worker's stable error code rather than failing silently", async () => {
    const submit = vi.fn(async (_input: BudgetWriteInput): Promise<BudgetLine> => {
      throw new ApiError("invalid_amount", "amount must be a finite non-negative integer");
    });
    renderEntry({ submit });
    fill("6100", "180.00");
    fireEvent.click(screen.getByTestId("budget-save"));

    expect(await screen.findByTestId("budget-error")).toHaveTextContent("invalid_amount");
    expect(screen.queryByTestId("budget-saved")).not.toBeInTheDocument();
  });

  it("exposes no fabricated success: onSaved is not called when the write fails", async () => {
    const submit = vi.fn(async (_input: BudgetWriteInput): Promise<BudgetLine> => {
      throw new Error("offline");
    });
    const { onSaved } = renderEntry({ submit });
    fill("6100", "180.00");
    fireEvent.click(screen.getByTestId("budget-save"));

    await screen.findByTestId("budget-error");
    expect(onSaved).not.toHaveBeenCalled();
  });
});

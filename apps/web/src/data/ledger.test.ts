import { describe, expect, it } from "vitest";

import { formatCents, formatSignedCents } from "../format";
import { ledgerEntry, ledgerLines, parseLedgerEntry, parseLedgerLines } from "./fixtures";
import {
  entryBalance,
  entryForLine,
  grandTotals,
  groupByAccount,
  PAYPAL_SANDBOX_ACTIVITY,
  rowNetCents,
  totalsOf,
} from "./ledger";

describe("IF-01 fixture parsing", () => {
  it("loads the shared contracts ledger fixture into contract-typed lines", () => {
    expect(ledgerLines.length).toBeGreaterThan(0);
    for (const line of ledgerLines) {
      expect(line.entry_id).toBeGreaterThan(0);
      expect(Number.isInteger(line.debit_cents)).toBe(true);
      expect(Number.isInteger(line.credit_cents)).toBe(true);
      expect(line.currency).toBe("USD");
    }
  });

  it("loads the shared contracts ledger-entry fixture", () => {
    expect(ledgerEntry.id).toBeGreaterThan(0);
    expect(ledgerEntry.lines.length).toBeGreaterThan(1);
    expect(ledgerEntry.source).toBe("paypal");
  });

  it("rejects a malformed ledger fixture instead of rendering blanks", () => {
    expect(() => parseLedgerLines({ not: "an array" })).toThrow(/expected an array/);
    expect(() => parseLedgerLines([{ entry_id: "12" }])).toThrow(/entry_id must be a finite number/);
    expect(() => parseLedgerEntry({ id: 1 })).toThrow(/entry\.lines must be an array/);
  });
});

describe("ledger derivations", () => {
  it("totals the fixture and confirms the journals balance (INV-3)", () => {
    const totals = grandTotals(ledgerLines);
    const debit = ledgerLines.reduce((sum, line) => sum + line.debit_cents, 0);
    const credit = ledgerLines.reduce((sum, line) => sum + line.credit_cents, 0);

    expect(totals.debit_cents).toBe(debit);
    expect(totals.credit_cents).toBe(credit);
    expect(totals.line_count).toBe(ledgerLines.length);
    expect(totals.entry_count).toBe(new Set(ledgerLines.map((line) => line.entry_id)).size);
    expect(totals.net_cents).toBe(credit - debit);
    expect(totals.balanced).toBe(true);
  });

  it("groups by account without losing or duplicating a line", () => {
    const groups = groupByAccount(ledgerLines);

    expect(groups.map((group) => group.account_code)).toEqual(
      [...new Set(ledgerLines.map((line) => line.account_code))].sort(),
    );
    expect(groups.reduce((sum, group) => sum + group.lines.length, 0)).toBe(ledgerLines.length);
    expect(groups.reduce((sum, group) => sum + group.debit_cents, 0)).toBe(grandTotals(ledgerLines).debit_cents);
    expect(groups.reduce((sum, group) => sum + group.credit_cents, 0)).toBe(grandTotals(ledgerLines).credit_cents);
    for (const group of groups) {
      expect(group.net_cents).toBe(group.credit_cents - group.debit_cents);
      expect(group.lines.every((line) => line.account_code === group.account_code)).toBe(true);
    }
  });

  it("sorts lines inside a group by date then entry id", () => {
    for (const group of groupByAccount(ledgerLines)) {
      const keys = group.lines.map((line) => `${line.entry_date}#${String(line.entry_id).padStart(6, "0")}`);
      expect(keys).toEqual([...keys].sort());
    }
  });

  it("handles an empty ledger", () => {
    const totals = totalsOf([]);
    expect(totals).toEqual({ debit_cents: 0, credit_cents: 0, net_cents: 0, balanced: true, line_count: 0, entry_count: 0 });
    expect(groupByAccount([])).toEqual([]);
  });
});

const seeded = ledgerLines.find((line) => line.entry_id === ledgerEntry.id);

describe("drill-through resolution", () => {
  it("resolves the source journal entry for a fixture line", () => {
    expect(seeded).toBeDefined();
    expect(entryForLine(seeded!)).toEqual(ledgerEntry);
    expect(entryBalance(ledgerEntry).balanced).toBe(true);
  });

  it("returns null for an entry the fixtures do not cover, instead of inventing lines", () => {
    const foreign = { ...seeded!, entry_id: 999_999 };
    expect(entryForLine(foreign)).toBeNull();
  });

  it("uses the PayPal sandbox host only (INV-1)", () => {
    expect(PAYPAL_SANDBOX_ACTIVITY).toContain("sandbox.paypal.com");
    expect(PAYPAL_SANDBOX_ACTIVITY).not.toMatch(/www\.paypal\.com|api-m\.paypal\.com/);
  });
});

describe("formatting", () => {
  it("renders integer cents as money and signs the net", () => {
    expect(formatCents(4613)).toBe("$46.13");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-187)).toBe("-$1.87");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatSignedCents(4800)).toBe("+$48.00");
    expect(formatSignedCents(-4800)).toBe("-$48.00");
    expect(formatSignedCents(0)).toBe("$0.00");
    expect(rowNetCents(seeded!)).toBe(seeded!.credit_cents - seeded!.debit_cents);
  });
});

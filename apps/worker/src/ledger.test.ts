import { describe, expect, it } from "vitest";
import { assertBalanced, buildJournal, UnsupportedEventError } from "./ledger";
import { fromCents, toCents } from "./money";

const sum = (ls: { debit: number; credit: number }[]) => ls.reduce((a, l) => a + l.debit - l.credit, 0);

describe("money", () => {
  it("parses PayPal decimal strings exactly", () => {
    expect(toCents("1500.00")).toBe(150000);
    expect(toCents("-1.92")).toBe(-192);
    expect(toCents("0.1")).toBe(10);
    expect(toCents(undefined)).toBe(0);
    expect(fromCents(-192)).toBe("-1.92");
    expect(() => toCents("12.345")).toThrow();
  });
});

describe("buildJournal", () => {
  it("books a sale at gross with the PayPal fee split out (T0006, +)", () => {
    const lines = buildJournal({ eventCode: "T0006", amountCents: 4900, feeCents: -192, currency: "USD" }, "4000", "templates");
    expect(sum(lines)).toBe(0);
    expect(lines).toContainEqual(expect.objectContaining({ account: "1010", debit: 4708 }));
    expect(lines).toContainEqual(expect.objectContaining({ account: "6050", debit: 192 }));
    expect(lines).toContainEqual(expect.objectContaining({ account: "4000", credit: 4900, productLine: "templates" }));
  });

  it("books a purchase out of PayPal (T0006, −)", () => {
    const lines = buildJournal({ eventCode: "T0006", amountCents: -1500, feeCents: 0, currency: "USD" }, "6100");
    expect(lines).toEqual([
      expect.objectContaining({ account: "6100", debit: 1500 }),
      expect.objectContaining({ account: "1010", credit: 1500 }),
    ]);
  });

  it("books a refund with returned fee (T1107)", () => {
    const lines = buildJournal({ eventCode: "T1107", amountCents: -4900, feeCents: 192, currency: "USD" }, "4900", "templates");
    expect(sum(lines)).toBe(0);
    expect(lines).toContainEqual(expect.objectContaining({ account: "4900", debit: 4900 }));
    expect(lines).toContainEqual(expect.objectContaining({ account: "1010", credit: 4708 }));
    expect(lines).toContainEqual(expect.objectContaining({ account: "6050", credit: 192 }));
  });

  it("treats bank withdrawals as transfers, not P&L (T0400)", () => {
    const lines = buildJournal({ eventCode: "T0400", amountCents: -200000, feeCents: 0, currency: "USD" }, "1000");
    expect(lines.map((l) => l.account).sort()).toEqual(["1000", "1010"]);
  });

  it("books chargeback fees to 6060 (T0106)", () => {
    const lines = buildJournal({ eventCode: "T0106", amountCents: -2000, feeCents: 0, currency: "USD" }, "6060");
    expect(lines[0]).toMatchObject({ account: "6060", debit: 2000 });
  });

  it("moves holds to the reserve account (T1500)", () => {
    const lines = buildJournal({ eventCode: "T1500", amountCents: -5000, feeCents: 0, currency: "USD" }, "1020");
    expect(lines).toContainEqual(expect.objectContaining({ account: "1020", debit: 5000 }));
  });

  it("refuses unknown event families", () => {
    expect(() => buildJournal({ eventCode: "T1900", amountCents: 100, feeCents: 0, currency: "USD" }, "6900")).toThrow(UnsupportedEventError);
  });

  it("books a human-reserved family only when the reviewer is deciding (T19xx, IF-07)", () => {
    const t = { eventCode: "T1900", amountCents: 500_000, feeCents: 0, currency: "USD" };
    // The event map sends T19xx to a person, so the autonomous path must never book it itself.
    expect(() => buildJournal(t, "3000")).toThrow(UnsupportedEventError);

    const lines = buildJournal(t, "3000", undefined, { humanDirected: true });
    expect(sum(lines)).toBe(0);
    expect(lines).toContainEqual(expect.objectContaining({ account: "1010", debit: 500_000 }));
    expect(lines).toContainEqual(expect.objectContaining({ account: "3000", credit: 500_000 }));
  });

  it("detects unbalanced entries", () => {
    expect(() => assertBalanced([{ account: "1010", debit: 100, credit: 0, currency: "USD" }])).toThrow(/Unbalanced/);
  });
});

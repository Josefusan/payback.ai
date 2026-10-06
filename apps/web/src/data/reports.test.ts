import { describe, expect, it } from "vitest";

import type { LedgerLine } from "../../../../packages/contracts/api";
import { ledgerLines } from "./fixtures";
import { DEMO_RECEIVABLE_LINES } from "./receivables-demo";
import {
  AGING_BUCKETS,
  agingBucketFor,
  daysBetween,
  deriveARAging,
  parsePnlRows,
  parseReconcileRows,
  pnlByProductLine,
  pnlRows,
  RECEIVABLE_ACCOUNT,
  receivableSourceLines,
  reconcileRows,
  reconcileSummary,
  REPORTS_AS_OF,
} from "./reports";

describe("reconcile loader (all fields optional)", () => {
  it("reads the shared IF-01 reconcile fixture", () => {
    expect(reconcileRows.length).toBeGreaterThan(0);
    const usd = reconcileRows.find((row) => row.currency === "USD")!;
    expect(usd.paypalCents).toBe(1_284_519);
    expect(usd.ledgerCents).toBe(1_284_519);
    expect(usd.diffCents).toBe(0);
    expect(usd.ok).toBe(true);
    expect(reconcileSummary(reconcileRows).ok).toBe(true);
  });

  it("tolerates a row with every optional field missing", () => {
    const [row] = parseReconcileRows([{ currency: "USD" }]);
    expect(row).toEqual({
      currency: "USD",
      paypalCents: null,
      ledgerCents: null,
      pendingCents: null,
      diffCents: null,
      ok: null,
      asOfTime: null,
      cutoff: null,
    });
    expect(reconcileSummary([row!]).ok).toBeNull();
  });

  it("derives diff and ok, and carries the optional pending/asOf/cutoff columns", () => {
    const [row] = parseReconcileRows([
      { currency: "EUR", paypalCents: 100, ledgerCents: 90, pendingCents: 5, asOfTime: "2026-11-10T00:00:00Z", cutoff: "2026-11-09" },
    ]);
    expect(row!.diffCents).toBe(10);
    expect(row!.ok).toBe(false);
    expect(row!.pendingCents).toBe(5);
    expect(row!.asOfTime).toBe("2026-11-10T00:00:00Z");
    expect(row!.cutoff).toBe("2026-11-09");

    const summary = reconcileSummary([row!]);
    expect(summary.ok).toBe(false);
    expect(summary.mismatched).toEqual(["EUR"]);
    expect(summary.hasPending).toBe(true);
  });

  it("rejects a non-array fixture", () => {
    expect(() => parseReconcileRows({ not: "an array" })).toThrow(/expected an array/);
  });
});

describe("P&L by product line", () => {
  it("loads the shared IF-01 reports-pnl fixture", () => {
    expect(pnlRows.length).toBeGreaterThan(0);
    expect(pnlRows.every((row) => typeof row.net_cents === "number")).toBe(true);
  });

  it("aggregates revenue, costs and contribution margin per product line", () => {
    const { lines, totals } = pnlByProductLine(pnlRows);
    const templates = lines.find((line) => line.product_line === "templates")!;
    const consulting = lines.find((line) => line.product_line === "consulting")!;

    expect(templates.revenue_cents).toBe(184_200);
    expect(templates.expense_cents).toBe(-7_140);
    expect(templates.net_revenue_cents).toBe(184_200);
    expect(templates.contribution_cents).toBe(177_060);
    expect(templates.contribution_margin_pct).toBeCloseTo(0.9612, 3);

    expect(consulting.revenue_cents).toBe(450_000);
    expect(consulting.contribution_cents).toBe(450_000);
    expect(consulting.contribution_margin_pct).toBe(1);

    // Sorted by contribution, largest first.
    expect(lines[0]!.product_line).toBe("consulting");

    expect(totals.revenue_cents).toBe(634_200);
    expect(totals.contribution_cents).toBe(627_060);
    expect(totals.contribution_margin_pct).toBeCloseTo(0.9887, 3);
  });

  it("labels the 'none' product line as unassigned and rejects a bad type", () => {
    const { lines } = pnlByProductLine([{ product_line: "none", type: "revenue", account_code: "4000", name: "r", net_cents: 100 }]);
    expect(lines[0]!.label).toBe("(unassigned)");
    expect(() => parsePnlRows([{ product_line: "templates", type: "nope", account_code: "4000", name: "r", net_cents: 1 }])).toThrow(
      /type must be one of/,
    );
  });
});

describe("AR aging derivation (account 1200)", () => {
  it("is empty for the shared ledger fixture, which carries no receivables yet", () => {
    const result = deriveARAging(ledgerLines, REPORTS_AS_OF);
    expect(result.line_count).toBe(0);
    expect(result.total_open_cents).toBe(0);
    expect(result.oldest_days).toBeNull();
    expect(result.buckets.every((bucket) => bucket.open_cents === 0)).toBe(true);
  });

  it("buckets the demo receivables one per bucket", () => {
    const result = deriveARAging(DEMO_RECEIVABLE_LINES, REPORTS_AS_OF);
    const byId = Object.fromEntries(result.buckets.map((bucket) => [bucket.id, bucket]));

    expect(byId["0-30"]!.open_cents).toBe(120_000);
    expect(byId["31-60"]!.open_cents).toBe(450_000);
    expect(byId["61-90"]!.open_cents).toBe(98_500);
    expect(byId["90+"]!.open_cents).toBe(210_000);
    expect(result.total_open_cents).toBe(878_500);
    expect(result.line_count).toBe(4);
    expect(result.oldest_days).toBe(115);
  });

  it("falls back to the demo set only while the ledger has no 1200 lines", () => {
    expect(receivableSourceLines(ledgerLines)).toContainEqual(expect.objectContaining({ entry_id: 2041 }));

    const withReceivable: LedgerLine[] = [
      { ...DEMO_RECEIVABLE_LINES[0]!, entry_id: 999, account_code: RECEIVABLE_ACCOUNT },
    ];
    const source = receivableSourceLines(withReceivable);
    expect(source).toHaveLength(1);
    expect(source[0]!.entry_id).toBe(999);
  });

  it("computes whole days between ISO dates and maps bucket boundaries", () => {
    expect(daysBetween("2026-10-29", "2026-11-10")).toBe(12);
    expect(daysBetween("2026-07-18", "2026-11-10")).toBe(115);
    expect(agingBucketFor(0).id).toBe("0-30");
    expect(agingBucketFor(30).id).toBe("0-30");
    expect(agingBucketFor(31).id).toBe("31-60");
    expect(agingBucketFor(90).id).toBe("61-90");
    expect(agingBucketFor(91).id).toBe("90+");
    expect(AGING_BUCKETS.map((bucket) => bucket.id)).toEqual(["0-30", "31-60", "61-90", "90+"]);
  });
});

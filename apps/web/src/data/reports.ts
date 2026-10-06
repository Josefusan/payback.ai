/**
 * Reports data layer for the managerial dashboard widgets (T-L4-003, gate G4).
 *
 * Typed loaders + pure derivations over the shared IF-01 fixtures
 * (`packages/contracts/fixtures/{reconcile,reports-pnl,ledger}.json`) so the widgets are built
 * against the exact shapes the Worker's `GET /api/reconcile` and `GET /api/reports/pnl` will serve.
 * No money number is invented here: reconcile + P&L come from the contract fixtures, and AR aging
 * is derived from ledger lines on account 1200 (Accounts Receivable).
 *
 * Robustness: the reconcile fixture may grow extra columns (pendingCents, asOfTime, cutoff), so every
 * reconcile field is treated as OPTIONAL — a missing column renders as "—", never a crash. The
 * shared ledger fixture carries no 1200 lines yet, so AR aging falls back to a clearly-labelled local
 * demo set (`receivables-demo.ts`, apps/web only) until the Worker posts receivables at G2.
 */
import type { LedgerLine, PnlRow } from "../../../../packages/contracts/api";
import pnlJson from "../../../../packages/contracts/fixtures/reports-pnl.json";
import reconcileJson from "../../../../packages/contracts/fixtures/reconcile.json";
import { ledgerLines } from "./fixtures";
import { DEMO_RECEIVABLE_LINES } from "./receivables-demo";

export const RECEIVABLE_ACCOUNT = "1200";
export const PAYPAL_CLEARING_ACCOUNT = "1010";
export const RECONCILE_FIXTURE_PATH = "packages/contracts/fixtures/reconcile.json";
export const PNL_FIXTURE_PATH = "packages/contracts/fixtures/reports-pnl.json";

/** Aging "as of" date for the demo. T-L3-004's `/api/reports/*` will carry its own as-of stamp. */
export const REPORTS_AS_OF = "2026-11-10";

// ── small parsers (lenient: a fixture that omits a column must not blank the screen) ─────────────
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// ── reconciliation ───────────────────────────────────────────────────────────────────────────────
/**
 * A reconcile row as the dashboard reads it. Superset of the contract `ReconcileRow` in which every
 * column is nullable: the fixture may omit or add columns (pendingCents, asOfTime, cutoff).
 */
export interface ReconcileView {
  currency: string;
  paypalCents: number | null;
  ledgerCents: number | null;
  pendingCents: number | null;
  diffCents: number | null;
  ok: boolean | null;
  asOfTime: string | null;
  cutoff: string | null;
}

export function parseReconcileRows(raw: unknown, where = RECONCILE_FIXTURE_PATH): ReconcileView[] {
  if (!Array.isArray(raw)) {
    throw new Error(`IF-01 fixture mismatch in ${where}: expected an array of ReconcileRow`);
  }
  return raw.map((entry) => {
    const row = asRecord(entry) ?? {};
    const paypalCents = optionalNumber(row.paypalCents);
    const ledgerCents = optionalNumber(row.ledgerCents);
    const diffCents = optionalNumber(row.diffCents) ?? (paypalCents !== null && ledgerCents !== null ? paypalCents - ledgerCents : null);
    const ok = optionalBoolean(row.ok) ?? (diffCents !== null ? diffCents === 0 : null);
    return {
      currency: optionalString(row.currency) ?? "USD",
      paypalCents,
      ledgerCents,
      pendingCents: optionalNumber(row.pendingCents),
      diffCents,
      ok,
      asOfTime: optionalString(row.asOfTime),
      cutoff: optionalString(row.cutoff),
    };
  });
}

export interface ReconcileSummary {
  ok: boolean | null;
  rowCount: number;
  mismatched: string[];
  paypalCents: number;
  ledgerCents: number;
  pendingCents: number;
  /** true when at least one row carries the optional pending bucket (T-L3-001). */
  hasPending: boolean;
}

export function reconcileSummary(rows: readonly ReconcileView[]): ReconcileSummary {
  const mismatched = rows.filter((row) => row.ok === false).map((row) => row.currency);
  const ok =
    rows.length === 0
      ? null
      : mismatched.length > 0
        ? false
        : rows.every((row) => row.ok === true)
          ? true
          : null;
  return {
    ok,
    rowCount: rows.length,
    mismatched,
    paypalCents: rows.reduce((sum, row) => sum + (row.paypalCents ?? 0), 0),
    ledgerCents: rows.reduce((sum, row) => sum + (row.ledgerCents ?? 0), 0),
    pendingCents: rows.reduce((sum, row) => sum + (row.pendingCents ?? 0), 0),
    hasPending: rows.some((row) => row.pendingCents !== null),
  };
}

export const reconcileRows: ReconcileView[] = parseReconcileRows(reconcileJson);
export const reconcile: ReconcileSummary = reconcileSummary(reconcileRows);

// ── P&L by product line ──────────────────────────────────────────────────────────────────────────
export type PnlType = PnlRow["type"];
const PNL_TYPES: readonly PnlType[] = ["revenue", "contra_revenue", "cogs", "expense"];

export function parsePnlRows(raw: unknown, where = PNL_FIXTURE_PATH): PnlRow[] {
  if (!Array.isArray(raw)) {
    throw new Error(`IF-01 fixture mismatch in ${where}: expected an array of PnlRow`);
  }
  return raw.map((entry, index) => {
    const row = asRecord(entry);
    if (!row) throw new Error(`IF-01 fixture mismatch in ${where}: row ${index} must be an object`);
    const type = row.type;
    if (typeof type !== "string" || !(PNL_TYPES as readonly string[]).includes(type)) {
      throw new Error(`IF-01 fixture mismatch in ${where}: row ${index}.type must be one of ${PNL_TYPES.join(", ")}`);
    }
    const netCents = optionalNumber(row.net_cents);
    if (netCents === null) throw new Error(`IF-01 fixture mismatch in ${where}: row ${index}.net_cents must be a finite number`);
    const accountCode = optionalString(row.account_code) ?? "";
    return {
      product_line: optionalString(row.product_line) ?? "none",
      type: type as PnlType,
      account_code: accountCode,
      name: optionalString(row.name) ?? accountCode,
      net_cents: netCents,
    };
  });
}

/** The column set of a P&L bucket. `net_cents` is signed (credit − debit), so costs are negative. */
export interface PnLTotals {
  revenue_cents: number;
  contra_revenue_cents: number;
  net_revenue_cents: number;
  cogs_cents: number;
  expense_cents: number;
  /** revenue + contra + COGS + direct expenses, each already signed. */
  contribution_cents: number;
  /** contribution ÷ gross revenue, 0 when there is no revenue. */
  contribution_margin_pct: number;
}

export interface ProductLinePnL extends PnLTotals {
  product_line: string;
  label: string;
  rows: PnlRow[];
}

export interface PnLByProduct {
  lines: ProductLinePnL[];
  totals: PnLTotals;
}

export function productLineLabel(productLine: string): string {
  return productLine === "" || productLine === "none" ? "(unassigned)" : productLine;
}

function emptyTotals(): PnLTotals {
  return {
    revenue_cents: 0,
    contra_revenue_cents: 0,
    net_revenue_cents: 0,
    cogs_cents: 0,
    expense_cents: 0,
    contribution_cents: 0,
    contribution_margin_pct: 0,
  };
}

function addRow(totals: PnLTotals, row: PnlRow): void {
  switch (row.type) {
    case "revenue":
      totals.revenue_cents += row.net_cents;
      break;
    case "contra_revenue":
      totals.contra_revenue_cents += row.net_cents;
      break;
    case "cogs":
      totals.cogs_cents += row.net_cents;
      break;
    case "expense":
      totals.expense_cents += row.net_cents;
      break;
  }
}

function finalize(totals: PnLTotals): void {
  totals.net_revenue_cents = totals.revenue_cents + totals.contra_revenue_cents;
  totals.contribution_cents = totals.net_revenue_cents + totals.cogs_cents + totals.expense_cents;
  totals.contribution_margin_pct = totals.revenue_cents > 0 ? totals.contribution_cents / totals.revenue_cents : 0;
}

/** Group flat P&L rows into one bucket per product line, sorted by contribution (largest first). */
export function pnlByProductLine(rows: readonly PnlRow[]): PnLByProduct {
  const byLine = new Map<string, ProductLinePnL>();
  for (const row of rows) {
    let line = byLine.get(row.product_line);
    if (!line) {
      line = { product_line: row.product_line, label: productLineLabel(row.product_line), rows: [], ...emptyTotals() };
      byLine.set(row.product_line, line);
    }
    line.rows.push(row);
    addRow(line, row);
  }
  const lines = [...byLine.values()];
  for (const line of lines) finalize(line);
  lines.sort((a, b) => b.contribution_cents - a.contribution_cents || a.label.localeCompare(b.label));

  const totals = emptyTotals();
  for (const row of rows) addRow(totals, row);
  finalize(totals);
  return { lines, totals };
}

export const pnlRows: PnlRow[] = parsePnlRows(pnlJson);
export const pnlByProduct: PnLByProduct = pnlByProductLine(pnlRows);

// ── AR aging (derived from ledger lines on account 1200) ─────────────────────────────────────────
export type AgingBucketId = "0-30" | "31-60" | "61-90" | "90+";

export interface AgingBucketSpec {
  id: AgingBucketId;
  label: string;
  minDays: number;
  maxDays: number | null;
}

export const AGING_BUCKETS: readonly AgingBucketSpec[] = [
  { id: "0-30", label: "0–30 days", minDays: 0, maxDays: 30 },
  { id: "31-60", label: "31–60 days", minDays: 31, maxDays: 60 },
  { id: "61-90", label: "61–90 days", minDays: 61, maxDays: 90 },
  { id: "90+", label: "90+ days", minDays: 91, maxDays: null },
];

export interface ARAgingBucket extends AgingBucketSpec {
  open_cents: number;
  line_count: number;
}

export interface ARAgingItem {
  entry_id: number;
  entry_date: string;
  memo: string | null;
  counterparty: string | null;
  product_line: string | null;
  /** debit − credit: positive for an open invoice, negative once a payment is posted. */
  open_cents: number;
  age_days: number;
  bucket: AgingBucketId;
}

export interface ARAgingResult {
  asOf: string;
  buckets: ARAgingBucket[];
  items: ARAgingItem[];
  total_open_cents: number;
  line_count: number;
  oldest_days: number | null;
}

/** Whole days between two ISO dates (YYYY-MM-DD), computed in UTC so it is timezone-independent. */
export function daysBetween(fromISO: string, toISO: string): number {
  const parse = (iso: string): number => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((parse(toISO) - parse(fromISO)) / 86_400_000);
}

export function agingBucketFor(ageDays: number): AgingBucketSpec {
  const days = Math.max(0, ageDays);
  return (
    AGING_BUCKETS.find((bucket) => days >= bucket.minDays && (bucket.maxDays === null || days <= bucket.maxDays)) ??
    AGING_BUCKETS[AGING_BUCKETS.length - 1]!
  );
}

/** Bucket account-1200 lines by age as of `asOf`. Empty when the ledger carries no receivables. */
export function deriveARAging(lines: readonly LedgerLine[], asOf: string = REPORTS_AS_OF): ARAgingResult {
  const buckets: ARAgingBucket[] = AGING_BUCKETS.map((bucket) => ({ ...bucket, open_cents: 0, line_count: 0 }));
  const items: ARAgingItem[] = [];

  for (const line of lines) {
    if (line.account_code !== RECEIVABLE_ACCOUNT) continue;
    const open_cents = line.debit_cents - line.credit_cents;
    const age_days = Math.max(0, daysBetween(line.entry_date, asOf));
    const spec = agingBucketFor(age_days);
    const bucket = buckets.find((candidate) => candidate.id === spec.id)!;
    bucket.open_cents += open_cents;
    bucket.line_count += 1;
    items.push({
      entry_id: line.entry_id,
      entry_date: line.entry_date,
      memo: line.memo,
      counterparty: line.counterparty,
      product_line: line.product_line,
      open_cents,
      age_days,
      bucket: spec.id,
    });
  }

  items.sort((a, b) => b.age_days - a.age_days || a.entry_id - b.entry_id);
  return {
    asOf,
    buckets,
    items,
    total_open_cents: items.reduce((sum, item) => sum + item.open_cents, 0),
    line_count: items.length,
    oldest_days: items.length > 0 ? Math.max(...items.map((item) => item.age_days)) : null,
  };
}

/**
 * Receivable lines for the aging widget: the shared ledger fixture when it carries account-1200
 * lines, otherwise the local demo receivable set. Once the Worker posts real receivables the demo
 * data drops out automatically, so the widget never double-counts.
 */
export function receivableSourceLines(base: readonly LedgerLine[] = ledgerLines): LedgerLine[] {
  const hasReceivables = base.some((line) => line.account_code === RECEIVABLE_ACCOUNT);
  return hasReceivables ? [...base] : [...base, ...DEMO_RECEIVABLE_LINES];
}

export const arAging: ARAgingResult = deriveARAging(receivableSourceLines(), REPORTS_AS_OF);

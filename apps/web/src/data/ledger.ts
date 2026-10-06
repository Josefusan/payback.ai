/**
 * Derived ledger views for the dashboard. Pure functions over the IF-01 LedgerLine shape, so the
 * grouping / pinned-total / drill-through logic is testable without a browser or the Worker.
 */
import type { LedgerEntryResponse, LedgerLine } from "../../../../packages/contracts/api";
import { ledgerEntry, ledgerLines } from "./fixtures";

export interface Balance {
  debit_cents: number;
  credit_cents: number;
  /** credit − debit: positive means the account was credited (revenue/liability side). */
  net_cents: number;
  balanced: boolean;
}

export interface AccountGroup extends Balance {
  account_code: string;
  account_name: string;
  lines: LedgerLine[];
}

export interface LedgerTotals extends Balance {
  line_count: number;
  entry_count: number;
}

/** PayPal sandbox only (INV-1) — no live host appears anywhere in this app. */
export const PAYPAL_SANDBOX_ACTIVITY = "https://www.sandbox.paypal.com/activity";

function balanceOf(lines: readonly LedgerLine[]): Balance {
  let debit_cents = 0;
  let credit_cents = 0;
  for (const line of lines) {
    debit_cents += line.debit_cents;
    credit_cents += line.credit_cents;
  }
  return {
    debit_cents,
    credit_cents,
    net_cents: credit_cents - debit_cents,
    balanced: debit_cents === credit_cents,
  };
}

export function totalsOf(lines: readonly LedgerLine[]): LedgerTotals {
  const entries = new Set(lines.map((line) => line.entry_id));
  return { ...balanceOf(lines), line_count: lines.length, entry_count: entries.size };
}

/**
 * Group by account for the ledger grid. Accounts sort by code (chart of accounts order);
 * lines inside a group sort by date then entry id so a drill-through lands on a stable row.
 */
export function groupByAccount(lines: readonly LedgerLine[]): AccountGroup[] {
  const buckets = new Map<string, AccountGroup>();
  for (const line of lines) {
    const existing = buckets.get(line.account_code);
    if (existing) {
      existing.lines.push(line);
    } else {
      buckets.set(line.account_code, {
        account_code: line.account_code,
        account_name: line.account_name,
        lines: [line],
        debit_cents: 0,
        credit_cents: 0,
        net_cents: 0,
        balanced: true,
      });
    }
  }
  return [...buckets.values()]
    .map((group) => ({
      ...group,
      lines: [...group.lines].sort(
        (a, b) => a.entry_date.localeCompare(b.entry_date) || a.entry_id - b.entry_id,
      ),
      ...balanceOf(group.lines),
    }))
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export function grandTotals(lines: readonly LedgerLine[] = ledgerLines): LedgerTotals {
  return totalsOf(lines);
}

/**
 * Drill-through resolution. The fixture set carries one entry; a row whose entry_id is not in the
 * fixture returns null and the drawer says so, rather than inventing journal lines.
 */
export function entryForLine(
  line: LedgerLine,
  entries: readonly LedgerEntryResponse[] = [ledgerEntry],
): LedgerEntryResponse | null {
  return entries.find((entry) => entry.id === line.entry_id) ?? null;
}

export function entryIsBalanced(entry: LedgerEntryResponse): boolean {
  return balanceOf(entry.lines.map((line) => ({ ...line, entry_id: entry.id, entry_date: entry.entry_date, memo: entry.memo, source_id: entry.source_id }))).balanced;
}

export function entryBalance(entry: LedgerEntryResponse): Balance {
  return balanceOf(
    entry.lines.map((line) => ({
      ...line,
      entry_id: entry.id,
      entry_date: entry.entry_date,
      memo: entry.memo,
      source_id: entry.source_id,
    })),
  );
}

/** The signed net shown per row: credit − debit, matching Balance.net_cents. */
export function rowNetCents(line: LedgerLine): number {
  return line.credit_cents - line.debit_cents;
}

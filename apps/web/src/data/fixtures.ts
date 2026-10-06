/**
 * IF-01 fixture access (T-INT-002). L4 is a leaf consumer: it reads the shared contract fixtures
 * under packages/contracts/fixtures/ — never a private copy — so the grid is built against the
 * exact shapes the Worker will serve at G2. Parsing validates the shapes at runtime, so a fixture
 * that drifts from packages/contracts/api.ts fails loudly instead of rendering blanks.
 */
import type { LedgerEntryResponse, LedgerLine } from "../../../../packages/contracts/api";
import ledgerEntryJson from "../../../../packages/contracts/fixtures/ledger-entry.json";
import ledgerJson from "../../../../packages/contracts/fixtures/ledger.json";

export const FIXTURE_SOURCE = "packages/contracts/fixtures (IF-01, draft@G0)";
export const LEDGER_FIXTURE_PATH = "packages/contracts/fixtures/ledger.json";
export const LEDGER_ENTRY_FIXTURE_PATH = "packages/contracts/fixtures/ledger-entry.json";

function mismatch(where: string, detail: string): never {
  throw new Error(`IF-01 fixture mismatch in ${where}: ${detail}`);
}

function asRecord(value: unknown, where: string, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    mismatch(where, `${at} must be an object`);
  }
  return value as Record<string, unknown>;
}

function num(row: Record<string, unknown>, key: string, where: string, at: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) mismatch(where, `${at}.${key} must be a finite number`);
  return value as number;
}

function str(row: Record<string, unknown>, key: string, where: string, at: string): string {
  const value = row[key];
  if (typeof value !== "string") mismatch(where, `${at}.${key} must be a string`);
  return value as string;
}

function nullableStr(row: Record<string, unknown>, key: string, where: string, at: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") mismatch(where, `${at}.${key} must be string | null`);
  return (value as string | null | undefined) ?? null;
}

export function parseLedgerLines(raw: unknown, where = LEDGER_FIXTURE_PATH): LedgerLine[] {
  if (!Array.isArray(raw)) mismatch(where, "expected an array of LedgerLine");
  return raw.map((entry, index) => {
    const row = asRecord(entry, where, `row ${index}`);
    return {
      entry_id: num(row, "entry_id", where, `row ${index}`),
      entry_date: str(row, "entry_date", where, `row ${index}`),
      memo: nullableStr(row, "memo", where, `row ${index}`),
      source_id: nullableStr(row, "source_id", where, `row ${index}`),
      account_code: str(row, "account_code", where, `row ${index}`),
      account_name: str(row, "account_name", where, `row ${index}`),
      debit_cents: num(row, "debit_cents", where, `row ${index}`),
      credit_cents: num(row, "credit_cents", where, `row ${index}`),
      currency: str(row, "currency", where, `row ${index}`),
      product_line: nullableStr(row, "product_line", where, `row ${index}`),
      counterparty: nullableStr(row, "counterparty", where, `row ${index}`),
    };
  });
}

export type LedgerEntryLine = LedgerEntryResponse["lines"][number];

export function parseLedgerEntry(raw: unknown, where = LEDGER_ENTRY_FIXTURE_PATH): LedgerEntryResponse {
  const row = asRecord(raw, where, "entry");
  if (!Array.isArray(row.lines)) mismatch(where, "entry.lines must be an array");
  return {
    id: num(row, "id", where, "entry"),
    source: str(row, "source", where, "entry") as LedgerEntryResponse["source"],
    source_id: nullableStr(row, "source_id", where, "entry"),
    entry_date: str(row, "entry_date", where, "entry"),
    memo: nullableStr(row, "memo", where, "entry"),
    decision_id: row.decision_id === null || row.decision_id === undefined ? null : num(row, "decision_id", where, "entry"),
    reverses_entry_id: row.reverses_entry_id === null || row.reverses_entry_id === undefined
      ? null
      : num(row, "reverses_entry_id", where, "entry"),
    lines: row.lines.map((line, index) => {
      const item = asRecord(line, where, `lines[${index}]`);
      return {
        account_code: str(item, "account_code", where, `lines[${index}]`),
        account_name: str(item, "account_name", where, `lines[${index}]`),
        debit_cents: num(item, "debit_cents", where, `lines[${index}]`),
        credit_cents: num(item, "credit_cents", where, `lines[${index}]`),
        currency: str(item, "currency", where, `lines[${index}]`),
        product_line: nullableStr(item, "product_line", where, `lines[${index}]`),
        counterparty: nullableStr(item, "counterparty", where, `lines[${index}]`),
      };
    }),
  };
}

/** The ledger read model, as the Worker's GET /api/ledger will return it (L3 owns the endpoint). */
export const ledgerLines: LedgerLine[] = parseLedgerLines(ledgerJson);

/** One journal entry, as GET /api/ledger/:id returns it — used for row drill-through. */
export const ledgerEntry: LedgerEntryResponse = parseLedgerEntry(ledgerEntryJson);

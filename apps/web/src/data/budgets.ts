/**
 * The budget write path (`PUT /api/budgets`).
 *
 * This lives in its own module rather than in `data/api.ts` because that file is owned by a concurrent
 * change; it reuses that module's admin-token storage and `ApiError` so a failed budget write behaves
 * exactly like every other mutating call on the dashboard (stable server code, never a swallowed error).
 *
 * A budget is a plan, and the amount is the account's NATURAL MAGNITUDE — the same convention
 * `GET /api/reports/budget-variance` reports — so nothing is rescaled between the form and the report.
 */
import type { BudgetLine } from "../../../../packages/contracts/api";
import { ApiError } from "./api";

export const BUDGET_WRITE_PATH = "/api/budgets";

export interface BudgetWriteInput {
  period: string; // YYYY-MM
  account_code: string;
  amount_cents: number; // natural magnitude, integer cents
  by: string;
  note?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Validate the worker's response before it reaches the screen, exactly as the other loaders do. */
export function parseBudgetLine(raw: unknown, where = `PUT ${BUDGET_WRITE_PATH}`): BudgetLine {
  const row = asRecord(raw);
  if (!row) throw new Error(`${where}: expected an object`);
  if (typeof row.period !== "string" || row.period === "") throw new Error(`${where}: period must be a non-empty string`);
  if (typeof row.account_code !== "string" || row.account_code === "") throw new Error(`${where}: account_code must be a non-empty string`);
  if (typeof row.amount_cents !== "number" || !Number.isFinite(row.amount_cents)) throw new Error(`${where}: amount_cents must be a finite number`);
  const note = row.note === null || row.note === undefined ? null : String(row.note);
  return { period: row.period, account_code: row.account_code, amount_cents: row.amount_cents, note };
}

/**
 * Set or replace one budget line. Admin-gated: the worker answers 401 without `x-admin-token` and 400 with
 * a stable code for bad input, both surfaced as an `ApiError` rather than a silent no-op.
 */
export async function putBudgetLine(input: BudgetWriteInput, token: string): Promise<BudgetLine> {
  const res = await fetch(BUDGET_WRITE_PATH, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new ApiError(parsed?.error ?? `http_${res.status}`, parsed?.detail);
  }
  return parseBudgetLine(await res.json());
}

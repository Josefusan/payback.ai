/**
 * LOCAL DEMO DATA — apps/web/src/data only, never packages/contracts (another agent owns IF-01).
 *
 * The shared IF-01 ledger fixture (`packages/contracts/fixtures/ledger.json`) carries no account-1200
 * lines yet; the Worker starts posting receivables at G2 (T-L3-001). Four open invoices stand in so
 * the AR aging widget renders a populated state. `reports.receivableSourceLines()` drops this demo
 * set automatically as soon as the shared fixture carries real account-1200 lines.
 *
 * Dates are chosen against `REPORTS_AS_OF = 2026-11-10` so exactly one invoice lands in each of the
 * four aging buckets (0–30 / 31–60 / 61–90 / 90+ days). Money is integer cents (INV-3).
 */
import type { LedgerLine } from "../../../../packages/contracts/api";

export const DEMO_RECEIVABLE_LINES: LedgerLine[] = [
  {
    entry_id: 2041,
    entry_date: "2026-10-29",
    memo: "Template bundle — INV-2041",
    source_id: null,
    account_code: "1200",
    account_name: "Accounts Receivable",
    debit_cents: 120_000,
    credit_cents: 0,
    currency: "USD",
    product_line: "templates",
    counterparty: "Ava Chen",
  },
  {
    entry_id: 2038,
    entry_date: "2026-10-02",
    memo: "Design retainer — INV-2038",
    source_id: null,
    account_code: "1200",
    account_name: "Accounts Receivable",
    debit_cents: 450_000,
    credit_cents: 0,
    currency: "USD",
    product_line: "consulting",
    counterparty: "Brightline LLC",
  },
  {
    entry_id: 2030,
    entry_date: "2026-09-08",
    memo: "Course cohort — INV-2030",
    source_id: null,
    account_code: "1200",
    account_name: "Accounts Receivable",
    debit_cents: 98_500,
    credit_cents: 0,
    currency: "USD",
    product_line: "courses",
    counterparty: "Cedar Studio",
  },
  {
    entry_id: 2019,
    entry_date: "2026-07-18",
    memo: "Brand sprint — INV-2019",
    source_id: null,
    account_code: "1200",
    account_name: "Accounts Receivable",
    debit_cents: 210_000,
    credit_cents: 0,
    currency: "USD",
    product_line: "consulting",
    counterparty: "Delta Works",
  },
];

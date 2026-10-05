---
name: managerial-accounting
description: Accounting domain rules for the back-office agent — double-entry bookkeeping, chart of accounts, how each PayPal transaction type becomes journal entries (gross/fee/net, refunds, chargebacks, holds, FX, transfers, payouts), reconciliation to PayPal balances, month-end close, and managerial reports (contribution margin, product-line P&L, AR aging, cash forecast). Use when writing ledger code, journal templates, reports, eval labels, or any accounting claim in the README/video.
---

# Managerial accounting for a PayPal-first business

## Ground rules
1. **Double entry:** every journal entry has ≥ 2 lines; Σdebits = Σcredits per currency. Enforced in `ledger.ts` and tests.
2. **Integer cents**, currency per line; FX handled as separate entries at PayPal's applied rate (event family T02xx).
3. **Append-only:** corrections are reversing entries, never UPDATE/DELETE of posted lines.
4. **Accrual basis for reports; cash tie-out to PayPal.** PayPal is a bank-like asset: account `1010 PayPal Clearing`.
5. **Gross, not net:** revenue at gross; PayPal fees to `6050 Merchant/PayPal fees` (expense). Never book net as revenue.
6. LLMs never produce numbers; reports come from SQL over the ledger.

## Chart of accounts (default; code: `apps/worker/src/coa.ts`)
| # | Account | Type |
|---|---|---|
| 1000 | Operating bank | Asset |
| 1010 | PayPal Clearing (per currency) | Asset |
| 1020 | PayPal Reserve / Holds | Asset |
| 1200 | Accounts Receivable | Asset |
| 2000 | Accounts Payable | Liability |
| 2100 | Sales tax payable | Liability |
| 2200 | Customer deposits / unearned revenue | Liability |
| 3000 | Owner's equity | Equity |
| 3100 | Owner draws | Equity |
| 4000 | Product revenue | Revenue |
| 4100 | Services revenue | Revenue |
| 4900 | Refunds & returns (contra-revenue) | Revenue (contra) |
| 5000 | Cost of goods sold | COGS |
| 6050 | PayPal / merchant fees | Expense |
| 6060 | Chargeback losses & dispute fees | Expense |
| 6100 | Software & subscriptions | Expense |
| 6200 | Advertising & marketing | Expense |
| 6300 | Contractors | Expense |
| 6900 | Other expense | Expense |
| 7000 | FX gain/loss | Other |
Managerial dimensions on lines: `product_line`, `channel`, `customer`, `vendor`.

## Journal templates by PayPal event — see `paypal-event-journal-map.md`

## Reconciliation (daily + at close)
- `1010 PayPal Clearing` balance (per currency) vs `GET /v1/reporting/balances` `total_balance` → must match ± $0.01.
- Every Transaction Search record with `transaction_status = S` and balance-affecting must map to exactly one journal entry (by `transaction_id`).
- Unmatched → review queue with reason (`missing_journal`, `amount_mismatch`, `unknown_event_code`).
- Bank side: PayPal withdrawals (T04xx) ↔ operating bank deposits (mock bank CSV for the demo).

## Month-end close checklist (agent-run, human-signed)
1. Backfill Transaction Search for the month (≤ 31-day windows); replay missed webhooks.
2. Classify + post; clear the review queue (human).
3. Reconcile PayPal Clearing to Balances API; reconcile bank transfers.
4. AR: open invoices aging (0–30/31–60/61–90/90+), send reminders per policy.
5. AP: approved bills paid via Payouts; accrue unpaid approved bills.
6. Disputes: open disputes → reserve estimate (`6060`) for probable losses.
7. Generate reports; LLM writes the CFO memo citing report rows.
8. Lock the period (no posting with date ≤ period end without a reversing entry in the next period).

## Managerial reports (what the dashboard shows)
- **P&L by product line** (revenue − refunds − PayPal fees − COGS − direct contractors).
- **Contribution margin %** per product line and channel; **effective PayPal fee rate** = fees / gross.
- **Refund & dispute rate** by product line.
- **AR aging** and **DSO**; **AP due** next 14/30 days.
- **13-week cash forecast**: PayPal balance + expected invoice collections (by aging-based probability) − scheduled payouts − recurring subscriptions.
- **Variance**: this month vs last month and vs budget (budget table optional).

## Words to use correctly (judges include finance-literate PMs)
"journal entry", "general ledger", "chart of accounts", "reconciliation", "close", "accrual", "contra-revenue", "contribution margin", "AR aging", "DSO". Don't claim GAAP compliance, tax advice, or audit readiness.

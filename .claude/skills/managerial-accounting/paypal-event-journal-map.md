# PayPal event code → journal template

Source of codes: https://developer.paypal.com/docs/transaction-search/transaction-event-codes/ (fetched 2026-10-05; verify individual codes before hard-coding).
Sign convention from Transaction Search: `transaction_amount` positive = money into our PayPal balance; `fee_amount` negative = fee charged.
Clef chooses the **revenue/expense account and dimensions**; the event family chooses the **template**. Unknown code → review queue.

| Family | Meaning (examples) | Template (amounts in cents; G = |gross|, F = |fee|) |
|---|---|---|
| **T00xx** incoming (amount > 0) | Payments received: T0006 Express/PayPal Checkout, T0007 web checkout, T0002 subscription, T0000 general | Dr 1010 PayPal Clearing (G−F) · Dr 6050 PayPal fees (F) · Cr **Clef account** e.g. 4000/4100 (G) [· Cr 2100 sales tax if `tax_amount`] |
| **T00xx** outgoing (amount < 0) | Payments we sent: purchases, subscriptions to vendors; T0001 mass payment (Payouts) | Dr **Clef account** e.g. 6100/6300/5000 or 2000 AP if bill exists (G) · Cr 1010 (G) |
| **T01xx** fees | T0106 chargeback fee, T0107 payment fee, T0100 general fee | Dr 6050 or 6060 (chargeback fee) · Cr 1010 |
| **T02xx** currency conversion | T0200/T0201/T0202 | Two lines per currency (Dr 1010-USD / Cr 1010-EUR at PayPal rate); difference vs. book rate → 7000 FX gain/loss |
| **T03xx** deposits into PayPal | T0300 bank deposit | Dr 1010 · Cr 1000 Operating bank |
| **T04xx** withdrawals to bank | T0400 general withdrawal, T0401 auto-sweep, T0403 manual | Dr 1000 Operating bank · Cr 1010 (transfer — no P&L impact) |
| **T11xx** reversals/refunds | T1107 payment refund, T1106 payment reversal, T1108/T1109 fee reversal/refund | Refund: Dr 4900 Refunds (G) · Cr 1010 (G−F_returned) · Cr 6050 (F_returned) |
| **T12xx** chargebacks/adjustments | T1201 chargeback, T1202 chargeback reversal, T1205 reimbursement | Chargeback: Dr 6060 or 4900 · Cr 1010; reversal = opposite |
| **T15xx / T21xx** holds & releases | T1500 general hold, T2103 reserve hold, T2104 reserve release, T2105/2106 payment review | Hold: Dr 1020 PayPal Reserve · Cr 1010; Release: reverse |
| **T16xx** buyer credit / Pay Later funding | T1600 etc. | Treat as incoming payment funding detail; usually no separate entry if net payment already booked → review |
| **T19xx** account corrections | T1900 | Review queue (human) |
| **T20xx** intra-account transfers | T2000 | Between currency sub-accounts of 1010 / partner accounts → review if unclear |
| **T22xx/T23xx** tax withholding | T2301 tax withholding to IRS | Dr 2300 Tax withheld receivable/expense (configure) · Cr 1010 → review |

## Linking rules
- Refunds/reversals reference the original via `paypal_reference_id` → reuse the original's Clef account/product_line (no new Clef call unless the original is missing).
- Invoice payments (`invoice_id` set) → Cr 1200 AR instead of revenue if the invoice was already booked at send time (accrual).
- Payout batch items (T0001 / Payouts webhooks) → Dr 2000 AP (bill exists) or Clef expense account; Cr 1010.
- `transaction_status` P (pending) → don't post; wait for S. V (reversed) → post reversal.

## Test fixtures
Every template has a unit test in `apps/worker/src/ledger.test.ts` and labeled examples in `evals/dataset_transactions.jsonl`.

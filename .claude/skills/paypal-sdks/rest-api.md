# PayPal REST — sandbox reference for the back-office agent

Base: `https://api-m.sandbox.paypal.com` · Docs: https://developer.paypal.com/api/rest/
Always verify a field against the official docs before relying on it; record surprises in `docs/rulings.md` or the code comments.

## Auth
```
POST /v1/oauth2/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials
→ { access_token, token_type: "Bearer", expires_in: ~32400, scope, app_id }
```

## Common headers
- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `PayPal-Request-Id: <idempotency key>` on POSTs that create resources/move money
- `Prefer: return=representation` to get full objects back
- Errors: `{ name, message, debug_id, details[{issue, description, field}] }` — log `debug_id`.

## Transaction Search (ledger ingestion)
```
GET /v1/reporting/transactions?start_date=2026-10-01T00:00:00-0700&end_date=2026-10-31T23:59:59-0700
    &fields=all&page_size=500&page=1[&transaction_id=..][&transaction_type=T0006][&balance_affecting_records_only=Y]
```
- Range **≤ 31 days** per request; paginate with `page`/`total_pages`.
- New activity can take **up to ~3 hours** to appear → use webhooks for real-time, Transaction Search for completeness/backfill.
- Requires the app feature **Transaction search** enabled (sandbox app settings).
- Key fields: `transaction_details[].transaction_info.{transaction_id, transaction_event_code, transaction_initiation_date, transaction_updated_date, transaction_amount{currency_code,value}, fee_amount, transaction_status, transaction_subject, transaction_note, invoice_id, custom_field, paypal_reference_id, paypal_reference_id_type, ending_balance, available_balance}`, `payer_info`, `cart_info.item_details[]`.
- `transaction_status`: D (denied), P (pending), S (success), V (reversed).
- Event codes (`transaction_event_code`) drive journal templates → see `.claude/skills/managerial-accounting/paypal-event-journal-map.md`. Official list: https://developer.paypal.com/docs/transaction-search/transaction-event-codes/

## Balances (reconciliation)
```
GET /v1/reporting/balances[?as_of_time=...&currency_code=USD]
→ { balances: [{ currency, primary, total_balance{currency_code,value}, available_balance, withheld_balance }], account_id, as_of_time, last_refresh_time }
```
Tie-out: ledger "PayPal Clearing" per currency == `total_balance` (± $0.01) as of the same time.

## Invoicing v2 (AR agent)
- Create draft: `POST /v2/invoicing/invoices` `{ detail{currency_code, invoice_number?, payment_term{term_type|due_date}, note}, invoicer{...}, primary_recipients[{billing_info{email_address,name}}], items[{name, quantity, unit_amount{currency_code,value}}] }`
- Next number: `POST /v2/invoicing/generate-next-invoice-number`
- Send: `POST /v2/invoicing/invoices/{id}/send` `{ send_to_invoicer?, send_to_recipient: true }`
- Remind: `POST /v2/invoicing/invoices/{id}/remind` `{ subject, note }`
- List/search: `GET /v2/invoicing/invoices?page=&page_size=` · `POST /v2/invoicing/search-invoices` `{ status: ["SENT","UNPAID","PARTIALLY_PAID"], due_date_range? }`
- Record external payment: `POST /v2/invoicing/invoices/{id}/payments`
- Cancel: `POST /v2/invoicing/invoices/{id}/cancel`
- Statuses: DRAFT, SENT, SCHEDULED, PAID, MARKED_AS_PAID, CANCELLED, REFUNDED, PARTIALLY_PAID, PARTIALLY_REFUNDED, MARKED_AS_REFUNDED, UNPAID, PAYMENT_PENDING.

## Payouts (AP agent — pay vendors/contractors)
```
POST /v1/payments/payouts
PayPal-Request-Id: payout:<bill_id>
{ "sender_batch_header": { "sender_batch_id": "bill_<id>", "email_subject": "Payment from <Company>", "email_message": "..." },
  "items": [{ "recipient_type": "EMAIL", "amount": { "value": "120.00", "currency": "USD" },
              "receiver": "vendor@personal.example.com", "note": "Invoice 1043", "sender_item_id": "<bill_id>",
              "recipient_wallet": "PAYPAL" }] }
→ 201 { batch_header{ payout_batch_id, batch_status: PENDING|PROCESSING|SUCCESS|DENIED ... } }
GET /v1/payments/payouts/{payout_batch_id}   GET /v1/payments/payouts-item/{payout_item_id}
```
- Venmo payouts: `recipient_type: "PHONE"`, `recipient_wallet: "VENMO"` (US).
- `sender_batch_id` must be unique (also an idempotency guard).
- Sandbox business account needs balance; use sandbox personal accounts as payees.
- Webhooks: `PAYMENT.PAYOUTSBATCH.SUCCESS|DENIED|PROCESSING`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED|FAILED|BLOCKED|UNCLAIMED|RETURNED|...`.

## Disputes (risk agent)
- `GET /v1/customer/disputes?dispute_state=REQUIRED_ACTION|UNDER_PAYPAL_REVIEW|RESOLVED...`
- `GET /v1/customer/disputes/{id}`
- `POST /v1/customer/disputes/{id}/accept-claim` `{ note, accept_claim_type?, refund_amount? }`
- `POST /v1/customer/disputes/{id}/provide-evidence` (multipart: JSON `input` + files)
- `POST /v1/customer/disputes/{id}/send-message`
- Sandbox simulation exists to move dispute stages (see disputes docs) — verify endpoint names before use.
- To create a sandbox dispute: buy with a sandbox personal account, then open a dispute from that account at https://www.sandbox.paypal.com/resolutioncenter.

## Orders v2 + Refunds (seeding realistic sales)
- `POST /v2/checkout/orders` `{ intent: "CAPTURE", purchase_units: [{ reference_id, custom_id, invoice_id, description, amount{currency_code, value, breakdown}, items[] }] }`
- Buyer approves (JS SDK v6 or approval link with sandbox personal account) → `POST /v2/checkout/orders/{id}/capture`
- Refund: `POST /v2/payments/captures/{capture_id}/refund` `{ amount?{value,currency_code}, note_to_payer }`
- Put our product line / SKU in `custom_id` / `items[].sku` → gives Clef ground truth hints and managerial dimensions.

## Webhooks
- Create: `POST /v1/notifications/webhooks` `{ url, event_types:[{name:"PAYMENT.CAPTURE.COMPLETED"}, ...] }`
- **Verify every event:**
```
POST /v1/notifications/verify-webhook-signature
{ auth_algo: hdr PAYPAL-AUTH-ALGO, cert_url: hdr PAYPAL-CERT-URL, transmission_id: hdr PAYPAL-TRANSMISSION-ID,
  transmission_sig: hdr PAYPAL-TRANSMISSION-SIG, transmission_time: hdr PAYPAL-TRANSMISSION-TIME,
  webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: <raw parsed body> }
→ { verification_status: "SUCCESS" | "FAILURE" }
```
- Simulate (sandbox, mock payloads): `POST /v1/notifications/simulate-event` `{ webhook_id, event_type, resource_version }` — simulated events may fail signature verification semantics; test the verified path with real sandbox activity.
- Events we subscribe to: `PAYMENT.CAPTURE.COMPLETED|REFUNDED|REVERSED|DENIED`, `CUSTOMER.DISPUTE.CREATED|UPDATED|RESOLVED`, `INVOICING.INVOICE.PAID|CANCELLED|CREATED`, `PAYMENT.PAYOUTSBATCH.*`, `PAYMENT.PAYOUTS-ITEM.*`, `BILLING.SUBSCRIPTION.*` (if subscriptions used).
- Dedupe by `event.id`; respond 200 fast, process via Queue.

## Server SDK
`npm install @paypal/paypal-server-sdk` — APIMatic-generated typed client (Orders, Payments, Vault, Subscriptions…). Good in Node/Next.js (the AG Grid boilerplate uses it). On Workers it may need `compatibility_flags: ["nodejs_compat"]` — test before committing to it; our scaffold uses plain `fetch`.

## Gotchas
- Sandbox and live credentials are different apps; a live token against sandbox (or vice versa) → 401.
- `INSTRUMENT_DECLINED`, `PAYEE_ACCOUNT_RESTRICTED`, `INSUFFICIENT_FUNDS` (payouts) are common sandbox errors → `/paypal:explain-error`.
- Date params need explicit offsets; Transaction Search rejects ranges > 31 days.
- Fee lines: `fee_amount` is negative for the merchant on sales; refunds may return partial fees — map per event code, don't assume.

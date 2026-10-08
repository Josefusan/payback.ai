# Sandbox activity log

Every write to the PayPal sandbox (seed scripts, MCP tools, manual tests): what, why, resulting ids. Keeps demo data reproducible.

| Date | Actor | Action | IDs | Notes |
|---|---|---|---|---|
| 2026-10-08 | human (dashboard) | Created sandbox REST app "Testing" | `APP-3XJ669705N822152H` | Sandbox mode; enabled Transaction search, Invoicing, Payouts |
| 2026-10-08 | human (dashboard) | Created sandbox webhook | `5CV8159781907910T` | `https://payback.clarktechventures.workers.dev/webhooks/paypal`, 68 event types |
| 2026-10-08 | seed-sandbox | Order PB-1001, Notion template bundle | `1AE05485C4789344K` | $49.00, buyer-approved via Playwright, then captured |
| 2026-10-08 | seed-sandbox | Captured order PB-1001 | `77F342625R6831724` | $49.00 gross, PayPal fee $2.20, net $46.80 |
| 2026-10-08 | seed-sandbox | Refunded capture | `32F10275UR791274B` | Full refund, `note_to_payer: Customer changed their mind` |
| 2026-10-08 | seed-sandbox | Invoice PB-INV-2001, sent | `INV2-ALKR-2NBZ-DNGE-KX77` | $1200.00, NET_10 |
| 2026-10-08 | seed-sandbox | Invoice PB-INV-2002, sent, OVERDUE | `INV2-4GR4-NQ97-2CXG-R5BR` | $1200.00, due 20 days ago (`DUE_ON_DATE_SPECIFIED`) |
| 2026-10-08 | seed-sandbox | Invoice PB-INV-2001, sent (earlier run) | `INV2-S2YM-JKJ4-K2ZL-ZH4U` | $1200.00 — superseded by the run above |

## Webhook deliveries received

| Event id | Type | Received (UTC) | Notes |
|---|---|---|---|
| `WH-2UG79623XA7239704-7TM76859PW387702K` | `PAYMENT.CAPTURE.COMPLETED` | 2026-10-08 20:26:57 | Real delivery from the capture above |
| `WH-4RP147993A956172E-1PR8056994958742W` | `PAYMENT.CAPTURE.REFUNDED` | 2026-10-08 20:28:06 | Real delivery from the refund above |
| `WH-7Y7254563A4550640-11V2185806837105M` | `PAYMENT.CAPTURE.COMPLETED` | 2026-10-08 19:28:24 | Via `POST /v1/notifications/simulate-event` |

The two real deliveries prove the verified path end to end: signature checked, deduped by `event_id`,
stored in D1. The simulator cannot stand in for this, because simulated events are not signed the way real
ones are — replaying a simulated event's `PAYPAL-TRANSMISSION-SIG` headers against PayPal's own
`POST /v1/notifications/verify-webhook-signature` returns `{"verification_status":"FAILURE"}`, and our
handler correctly rejects such an event with a 400.

## Ledger state after the opening balance

`GET /api/reconcile` → `paypalCents 500000`, `ledgerCents 500000`, `diffCents 0`, `pendingCents 0`,
`cutoff 2026-10-07T00:00:00Z`, `ok: true`.

The $5,000 `T1900` "Initial balance" funding predates that cutoff, so it was resolved as **already covered
by the opening balance** instead of being double-booked. Rejecting it is also what takes it out of
`reconcile`'s pending bucket (`state IN ('new','decided','review')`), which is what makes the tie-out exact.

## Timing note

Transaction Search lags new sandbox activity by up to ~3 hours. The 2026-10-08 capture and refund were not
yet visible in `/v1/reporting/transactions` minutes after they happened, while the webhooks for the same
events arrived within minutes. Run `POST /api/sync` a few hours later to book them; webhooks are the
real-time path.

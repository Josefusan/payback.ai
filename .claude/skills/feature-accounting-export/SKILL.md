---
name: feature-accounting-export
description: Build spec for exporting Payback.ai's books to what accountants already use — balanced journal-entry CSV (generic and a QuickBooks Online-style import layout), trial balance, and an optional Zapier MCP push to Google Sheets. Use when building /api/export endpoints, the export button, or when someone asks "does it work with QuickBooks/Xero/Sheets?". Owner ledger-accounting-engineer.
---

# Feature: Accounting Export ("works with what accountants use")

**Why judges care:** answers the adoption objection for SMBs (Potential Impact, Design) at low cost.
**Owner:** `ledger-accounting-engineer` (+ one button by `frontend-aggrid-engineer`). **Migration:** none.

## Endpoints
- `GET /api/export/journal.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&format=generic|qbo`
  - **generic:** `entry_id,date,account_code,account_name,debit,credit,currency,product_line,counterparty,memo,source_paypal_id`
  - **qbo:** QuickBooks Online journal-entry import layout (Journal No, Journal Date, Account, Debits, Credits, Description, Name, Currency). **Verify the current QBO import template columns/date format in Intuit's docs before shipping** and note the check in `docs/decisions.md`; label it "QuickBooks-compatible CSV", never claim an official integration.
- `GET /api/export/trial-balance.csv?as_of=YYYY-MM-DD` — per account: debit total, credit total, balance; footer row proves Σdebits = Σcredits.
- `GET /api/export/audit-packet?from&to` — delegates to `feature-audit-trail`.
- Money formatted with `fromCents` (2 decimals, `.` separator), RFC 4180 quoting, UTF-8 with BOM off, LF line endings; `Content-Disposition: attachment`.

## Optional: Zapier MCP → Google Sheets / accounting apps
Only if time after Week 4: a human-triggered "Send to Sheets" that calls Zapier MCP (`https://mcp.zapier.com/api/v1/connect`, OAuth, 2 tasks per call). Document in README as optional; never required for judges to run the app.

## Acceptance criteria
- [ ] Round-trip test: export generic CSV → parse → per-entry and grand totals balance; row count = journal_lines in range.
- [ ] Trial balance equals SQL account balances; PayPal Clearing line equals reconciliation figure.
- [ ] Quoting test with commas/quotes/newlines in memos (untrusted text) — and leading `=,+,-,@` escaped to prevent CSV formula injection in spreadsheets.
- [ ] Export button in the ledger toolbar; filename `payback-journal-<from>-<to>.csv`.

## Gotchas
- CSV/formula injection: prefix cells starting with `= + - @` (and tab/CR) with `'`.
- Don't export payer emails by default (privacy); counterparty display name only.

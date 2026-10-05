---
name: feature-audit-trail
description: Build spec for Payback.ai's tamper-evident audit trail — every journal entry and every agent action records the PayPal source, Clef model/schema/probabilities, threshold, policy rule, approver and PayPal ids in a hash-chained append-only log, viewable as an "Explain this entry" drawer and exportable as an audit packet. Use when writing anything that posts entries, executes or blocks actions, changes settings, or when building the explain drawer. Owner ledger-accounting-engineer (with agentic-workflow-engineer emitting events).
---

# Feature: Audit Trail ("explain any number")

**Why judges care:** PayPal engineers and finance-literate PMs want to know *why* the AI did something — this is the production-thinking signal (Technological Implementation, Design, Impact).
**Owners:** `ledger-accounting-engineer` (table, chain, API, export) · `agentic-workflow-engineer` (emit events from pipeline/actions) · `frontend-aggrid-engineer` (drawer). **Migration reserved:** `0002_audit.sql` (build this first — other features write to it).

## Data
```sql
-- 0002_audit.sql
CREATE TABLE audit_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor        TEXT NOT NULL,          -- 'agent' | 'user:<id>' | 'webhook' | 'cron'
  kind         TEXT NOT NULL,          -- decision | journal_posted | review_resolved | action_proposed | action_executed | action_blocked | setting_changed | reconciliation
  ref_type     TEXT NOT NULL,          -- transaction | journal_entry | action | bill | setting
  ref_id       TEXT NOT NULL,
  payload_json TEXT NOT NULL,          -- model, schema_version, probabilities, threshold, policy rule, paypal ids, debug_id …
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL           -- sha256(prev_hash || canonical_json(row without hash))
);
CREATE INDEX idx_audit_ref ON audit_events(ref_type, ref_id);
-- No UPDATE/DELETE anywhere in code. Corrections are new events.
```

## API
- `audit.record(env, {actor, kind, refType, refId, payload})` in `src/audit.ts` — reads last hash, computes `crypto.subtle.digest('SHA-256', …)` over canonical JSON (sorted keys), inserts in the same `db.batch()` as the business write where possible.
- `GET /api/audit?ref_type=journal_entry&ref_id=123` → ordered events + "story" (source PayPal txn → Clef decision → gate → journal lines → approver).
- `GET /api/audit/verify` → recomputes the chain; returns `{ok, broken_at_seq?}`.
- `GET /api/audit/packet?from&to` → JSON (and CSV) bundle for an accountant: entries, lines, decisions, approvals, actions.

## Must-record events
decision (every Clef call: model id, schema version, full probabilities, latency) · journal_posted · review_resolved (who, old → new account) · action_proposed / executed / blocked (policy rule, Clef action prob, PayPal-Request-Id, PayPal response ids, debug_id) · setting_changed (e.g., threshold from Confidence Dial) · reconciliation (PayPal vs ledger, diff).

## UI — "Explain this entry" drawer
From any ledger row or action: timeline of events, Clef probability bars (top 3), policy rule chip, approver, link to PayPal sandbox activity id, chain-verified ✅ badge.

## Acceptance criteria
- [ ] Every code path in `pipeline.ts`, `index.ts` actions/review/settings writes an event (test with D1 local: count events after a seeded run).
- [ ] Chain verify passes; a test mutates one row in a temp DB and verify reports `broken_at_seq`.
- [ ] No PII beyond what's needed (no full payer emails in payload; hash or truncate).
- [ ] Drawer shown in the video for one auto-posted sale and one blocked action.

## Gotchas
- Hash chain is tamper-*evident*, not tamper-proof — say "tamper-evident" in README, never "immutable"/"audit-ready".
- Concurrency: D1 serializes writes per database, but compute `prev_hash` inside the same batch/transaction to avoid forks; if a race is detected (`verify` fails), alert rather than silently fix.

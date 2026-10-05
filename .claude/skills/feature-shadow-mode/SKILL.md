---
name: feature-shadow-mode
description: Build spec for Shadow Mode — run a new Clef schema version, model (clef vs clef-flash) or policy rule alongside production without affecting the books, compare "would have done" vs "did", and promote only when eval gates pass. Use when changing SCHEMA_VERSION, criteria text, thresholds, models or policy rules, or when building the Shadow report widget. Owner clef-decision-engineer.
---

# Feature: Shadow Mode ("would have done" vs "did")

**Why judges care:** shows safe iteration on an AI that touches money — Cloudflare's own Clef guidance recommends shadow deployment. Strong Technological Implementation signal; small UI surface.
**Owner:** `clef-decision-engineer` (with `frontend-aggrid-engineer` for one widget). **Migration reserved:** `0005_shadow.sql`.

## Data
```sql
-- 0005_shadow.sql
ALTER TABLE decisions ADD COLUMN mode TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live','shadow'));
ALTER TABLE decisions ADD COLUMN variant TEXT;            -- e.g. 'txn-v2/clef' ; NULL for live
CREATE TABLE shadow_variants (
  id TEXT PRIMARY KEY,                                    -- 'txn-v2/clef'
  schema_version TEXT NOT NULL, model TEXT NOT NULL, threshold REAL NOT NULL,
  sample_rate REAL NOT NULL DEFAULT 1.0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), promoted_at TEXT
);
```

## Behaviour
- In `processTransaction`, after the live decision: for each active variant (sampled), call the variant schema/model **asynchronously** (`ctx.waitUntil` or queue) and store a `mode='shadow'` decision. Shadow decisions **never** post journals, enqueue actions or change state.
- Policy shadowing: `evaluateAction` variants run with the candidate config; record `would_outcome` in the audit payload only.
- Variant registry in code: `src/variants.ts` maps variant id → `{buildRequest, gate}` so schema versions are explicit and testable.

## Report
`GET /api/shadow/report?variant=txn-v2/clef` →
`{n, agreement_rate, live_precision, shadow_precision (on labeled), live_review_rate, shadow_review_rate, flips:[{transaction_id, live, shadow, label}] , cost_estimate_tokens}`
Widget: side-by-side KPI cards + flips grid (AG Grid) with label column.

## Promotion gate (all required, else 409)
- ≥ 50 labeled overlaps; shadow precision ≥ live precision and ≥ 0.97 at its threshold; review rate ≤ 0.25; `evals/product_evals.py` passes with the variant; safety eval 0 critical.
- `POST /api/shadow/:id/promote` (human) → updates live config (`settings`), writes `setting_changed` audit event, deactivates variant.

## Acceptance criteria
- [ ] Unit test: shadow path cannot call `buildJournal`/`createPayout` (spy/mocks).
- [ ] Report numbers reproducible from SQL; parity with product_evals on the same labels.
- [ ] Used at least once for real: promote `txn-v2` (injection detection) via shadow, documented in `docs/decisions.md`.

## Gotchas
- Shadow doubles Clef spend — keep `sample_rate` < 1 for bulk backfills; prefer `clef-flash` variants.
- Don't show shadow numbers as product accuracy claims unless labeled count is stated.

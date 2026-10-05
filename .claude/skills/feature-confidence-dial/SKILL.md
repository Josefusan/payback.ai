---
name: feature-confidence-dial
description: Build spec for the Confidence Dial — a dashboard control that slides Payback.ai's auto-post threshold and shows live precision, coverage and review rate from labeled decisions, so the owner sees exactly what the agent will do on its own. Use when building the threshold sweep API, the labels table, the AG Studio ConfidenceDial widget, or the 1:10–1:40 demo segment. Owners frontend-aggrid-engineer (UI) and clef-decision-engineer (API/metrics).
---

# Feature: Confidence Dial

**Why judges care:** turns "calibrated AI" from a claim into something visible and interactive (Technological Implementation, Design, Innovation). It is also the strongest answer to "would you let an AI touch my books?" and an AG Grid custom-widget showcase.
**Owners:** `clef-decision-engineer` (labels, sweep API, metrics parity with evals) → `frontend-aggrid-engineer` (widget). **Migration number reserved:** `0003_confidence_dial.sql`.
**Depends on:** decisions table (done), review queue resolutions, `evals/product_evals.py` sweep logic.

## User story
As an owner, I drag a dial from 0.50 to 0.99 and immediately see: how many transactions would auto-post, how accurate those auto-posts have been, and how many would wait for me. I click **Apply**, and only *future* decisions use the new threshold.

## Data
```sql
-- 0003_confidence_dial.sql
CREATE TABLE labels (               -- ground truth: human-confirmed account per transaction
  transaction_id TEXT PRIMARY KEY REFERENCES paypal_transactions(transaction_id),
  account_code   TEXT NOT NULL REFERENCES accounts(code),
  source         TEXT NOT NULL CHECK (source IN ('review_approved','review_corrected','seed_dataset')),
  labeled_by     TEXT, labeled_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO settings (key, value, updated_by) VALUES ('auto_post_threshold', '0.90', 'default');
```
- When a reviewer approves a classification → insert label (`review_approved`); when they change the account → (`review_corrected`).
- Seed: `scripts/seed-labels` loads `evals/dataset_transactions.jsonl` expectations for seeded sandbox transactions (`seed_dataset`).

## API (Worker)
- `GET /api/confidence/sweep?from=0.5&to=0.99&step=0.01` → `[{threshold, coverage, auto_precision, review_rate, n_labeled}]` computed from latest decision per labeled transaction. **Must use the same gate as `gateDecision()`** (needs_review < 0.30, risk < 1.5, choice ≠ review) — import it, don't re-implement.
- `GET /api/confidence/at?t=0.87` → summary + up to 20 example transactions that flip between auto/review vs current threshold (for the "what changes" list).
- `PUT /api/settings/auto_post_threshold` `{value, by}` → human-only (require UI confirm); writes an audit event (see `feature-audit-trail`). Clamp to [0.80, 0.99]; reject if precision at that value < 0.95 on ≥ 30 labels (return 409 with reason).
- `decideTransaction()` reads the threshold from `settings` (cache 60s), falling back to `env.AUTO_POST_THRESHOLD`.
- Changing the threshold never retro-posts. Optional "Post N newly-eligible items" button creates one batch approval in the review queue.

## UI — AG Studio custom widget `ConfidenceDial`
- Slider + 3 KPIs (Auto-post precision, Coverage, Review rate) + sparkline/curve of precision vs threshold with a marker; "What changes" mini-grid.
- `formatShape` describes `{threshold:number, precision:number, coverage:number, reviewRate:number}` so Studio's AI agents can read/set it (the Controller agent can answer "what threshold gives 99% precision?").
- Theme tokens from the dashboard theme; works at 1280×720 for recording; keyboard-accessible slider; empty state when < 30 labels ("Approve a few reviews to calibrate").

## Acceptance criteria
- [ ] Sweep values equal `evals/product_evals.py` sweep for the same labeled set within 0.001 (add a parity test: export labels+decisions → run both).
- [ ] Unit tests for sweep math (edge: zero auto-posts → precision reported as `null`, not 1.0, in the UI).
- [ ] Threshold change takes effect for new decisions only; audit event recorded.
- [ ] Demo: dial moves on camera, numbers update < 300 ms, Apply shows confirmation toast.

## Gotchas
- Small-sample honesty: show `n_labeled` and a "low data" badge under 50 labels — judges punish overclaiming.
- Never let the dial lower the *action* threshold (money movement) — that stays in `policy.ts` / `ACTION_THRESHOLD`.

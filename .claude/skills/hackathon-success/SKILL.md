---
name: hackathon-success
description: Defines what "winning" means for our PayPal AI Hackathon entry — the judging rubric with score anchors, judge panel, prize targets, quantitative success thresholds and anti-patterns. Use when prioritizing work, cutting scope, reviewing a feature/PR for judge impact, writing the README/Devpost text/video, or deciding whether something is "done".
---

# What successful looks like

Scoring model + panel: `docs/02-judging-and-success.md`. Machine-readable rubric: `evals/rubric.json`.

## North star
A judge who only watches 2:45 of video and skims the README should conclude:
1. **PayPal is the spine** (≥4 PayPal capabilities, used correctly, live in sandbox).
2. **AI is load-bearing** (Clef decisions decide what happens to money; calibrated, with a human in the loop).
3. **It's a real product** for a named audience (SMBs selling through PayPal without a bookkeeper).
4. **It's new** (decision-model, confidence-gated autonomy over a real double-entry ledger).
5. **It works end-to-end** — shown live, not described.

## Success thresholds (all must hold before submit)
- Stage One gates: 100% pass (`python evals/checks.py`, `python evals/llm_judge.py --stage 1`)
- Simulated panel Stage Two mean ≥ **8.5/10**, every criterion ≥ **7.5**, Presentation ≥ **8.5**
- ≥ **4** distinct PayPal capabilities exercised in the demo
- Clef auto-post precision ≥ **97%**, review rate ≤ **25%**, ECE ≤ **0.05** (`python evals/product_evals.py`)
- **0** money-moving actions on adversarial inputs (`python evals/product_evals.py --safety`)
- Ledger invariants hold; PayPal clearing ties to Balances API ± $0.01
- Fresh clone → running in ≤ 10 min by following README
- Video ≤ 2:50, public

## Prioritization rule (when time is short)
Rank work by **expected judge-score gain per hour**, weighting criteria equally but remembering tie-breaks favor Technological Implementation, then Design. Typical high-ROI items:
1. Anything that makes the end-to-end demo reliable (seed data, idempotent sync, retries).
2. Visible PayPal depth (webhooks, Payouts, Invoicing, Disputes) over more AI features.
3. UI polish on the 4 screens in the video; ignore screens not in the video.
4. README clarity + architecture diagram + "Tools used and how".
5. Sponsor criteria for AG Grid (custom widgets, theming, Studio Agent Framework).

## Review checklist for any feature/PR
- Which criterion does it raise, and will judges *see* it (video/README)?
- Does it work in sandbox right now? (R4: functions as depicted)
- Could it move money wrongly? Is it policy-gated and audited?
- Did we add a claim to docs that the code doesn't back up? Remove the claim or build the feature.

## Anti-patterns (auto-reject)
PayPal as a mere pay button · chatbot-only AI · LLM-generated numbers in reports · live credentials · unrunnable README · video > 3:00 or with copyrighted music/logos · features shown via mockups.

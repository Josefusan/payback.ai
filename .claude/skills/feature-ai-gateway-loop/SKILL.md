---
name: feature-ai-gateway-loop
description: Build spec for the learning loop — route every Clef and LLM call through Cloudflare AI Gateway with metadata, attach human review outcomes as feedback, turn corrections into labeled eval data, and show model cost/latency/accuracy over time ("it gets better on your books"). Use when configuring AI_GATEWAY_ID, adding call metadata, wiring review outcomes to feedback, growing eval datasets from production, or building the model-ops widget. Owner clef-decision-engineer.
---

# Feature: AI Gateway learning loop

**Why judges care:** production-grade AI ops (observability, cost, feedback) and a credible path to Cloudflare's RL fine-tuning for Clef — without overclaiming (Technological Implementation, Innovation).
**Owner:** `clef-decision-engineer` (with `agentic-workflow-engineer` for review hooks). **Migration:** none (uses `labels` from `feature-confidence-dial`, `audit_events` from `feature-audit-trail`).

## Build
1. **Gateway** — create an AI Gateway in the Cloudflare dashboard; set `AI_GATEWAY_ID` var. `runClef()` in `clef.ts` already passes `{ gateway: { id } }` when set — confirm the option shape against current Workers AI binding docs and add per-request metadata (schema version, variant, hashed transaction id — **no PII**). Enable gateway logging; caching **off** for decisions (each transaction is unique; stale answers are worse than cost).
2. **Feedback** — when a reviewer approves/corrects a decision, record the label (`labels` table) and, if AI Gateway exposes a feedback/score API for logged requests, attach `+1/-1` to the originating log id (store the gateway log id returned with the response, if available). Verify the API in AI Gateway docs first; if not available, keep feedback in D1 only.
3. **Dataset growth** — `GET /api/labels/export.jsonl` emits rows in the exact `evals/dataset_transactions.jsonl` shape (txn + expected). Weekly: append new corrected rows to the eval set (dedupe by transaction id, scrub names).
4. **Model-ops widget** — KPIs from D1 (and gateway analytics if accessible): decisions/day, auto-post %, precision on labeled (rolling 7d), p50/p95 Clef latency, est. cost (input tokens × published price), escalations flash→clef.
5. **RL story (README/video, honest)** — "Every correction becomes training signal; Cloudflare's Clef RL fine-tuning (currently via their forward-deployed engineers) can use AI Gateway traffic. We built the data path; we did not fine-tune during the hackathon." Never claim fine-tuning happened.

## Acceptance criteria
- [ ] All Clef/LLM calls visible in AI Gateway logs with metadata; no payer emails/names in metadata.
- [ ] Correcting a review creates a label and (if supported) gateway feedback; covered by a test with a mocked fetch.
- [ ] `export.jsonl` validates against `evals/product_evals.py` loader (run it on the export).
- [ ] Widget shows real numbers from the seeded sandbox run.

## Gotchas
- Gateway adds a hop — measure latency before/after; keep Clef-flash median well under 200 ms end-to-end.
- Logging retention/privacy: set retention appropriate for demo data; document it.

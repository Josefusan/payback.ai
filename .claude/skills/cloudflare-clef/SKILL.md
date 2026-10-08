---
name: cloudflare-clef
description: How to use Cloudflare Clef / Clef-flash decision models (Jev-compatible, Workers AI) to make calibrated, typed decisions — choice, noul (yes/no) and score questions — for ledger classification, review routing, risk and action gating. Use when writing or changing anything in apps/worker/src/clef.ts, designing decision schemas, setting confidence thresholds, or evaluating decision quality.
---

# Cloudflare Clef (decision models)

Sources (verify against the live model page before relying on edge details):
https://blog.cloudflare.com/clef-decision-models/ · https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/ · https://developers.cloudflare.com/workers-ai/models/
Third-party write-ups used for details below: thejevai.com/blog/how-to-use-cloudflare-clef, developersdigest.tech (Oct 2026). **Day-1 task DONE 2026-10-07: real response recorded in `docs/clef-response-sample.json`; skill updated with the binding caution.**

## What it is
- A **decision model**: input = `state` (text/JSON, optional images) + `questions` (typed schema); output = an answer **with probabilities for every allowed option**, in one forward pass. No generated text.
- `@cf/cloudflare/clef` — 27B (Qwen-based), multimodal, ~209 ms median. `@cf/cloudflare/clef-flash` — 9B, ~39 ms median.
- **Jev-API compatible** (Jev = TypeSafe's decision model, Sep 2026). Open weights, Apache-2.0 on Hugging Face.
- Context 65,536 tokens; ≤ 64 questions/request; ≤ 4 images (PNG/JPEG/WebP, ≤ 4 MiB each, Clef only); body ≤ 13 MiB.
- Price (input only): Clef ≈ $0.24 / 1M tokens, Clef-flash ≈ $0.09 / 1M.
- Strong on classification/routing (BANKING77, CLINC150, invoice processing); weaker than general LLMs on open-ended reasoning → **use Clef to decide, an LLM to explain**.

## Calling it
Worker binding (`wrangler.jsonc`: `"ai": { "binding": "AI" }`):
```ts
const out = await env.AI.run("@cf/cloudflare/clef", { model: "clef", state, questions });
// binding returns the model output directly: out.answers.<id>
```
REST:
```
POST https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/cloudflare/clef
Authorization: Bearer $CLOUDFLARE_API_TOKEN      → { success, result: { answers, usage } }
```
Route through **AI Gateway** for logging/caching/analytics (and future RL fine-tuning): pass `{ gateway: { id: env.AI_GATEWAY_ID } }` as the 3rd arg to `env.AI.run` (verify option name in Workers AI docs).
**Caution:** always call the binding as a method — `env.AI.run(...)`. Detaching it (`const run = env.AI.run; run(...)`) drops its `this` and throws `Cannot set properties of undefined (setting '#options')`, which silently routes every decision to `review` and looks like the model being down. This bit us on 2026-10-07 in both `runClef` (clef.ts) and `runTextModel` (decision-provider.ts).
**Confirmed shape:** a real request/response is saved in `docs/clef-response-sample.json` (captured 2026-10-07). Note the binding resolves to `result` directly, so read `out.answers` (not `out.result.answers`).

## Question types
| type | use | criteria | answer |
|---|---|---|---|
| `choice` | pick one label | object `{id: description}` | `{ type, choice, probabilities{id:p}, confidence }` |
| `noul` | yes/no proposition | optional true/false descriptions | `{ type, noul: <probability of yes> }` (number, not boolean) |
| `score` | ordered scale | array low→high | `{ type, score: <probability-weighted index>, probabilities }` |

## Our decision schema (v1) — one call per PayPal transaction
```json
{
  "model": "clef-flash",
  "state": { "txn": { "event_code": "T0006", "amount": "-49.00", "currency": "USD", "fee": "0.00",
             "counterparty": "Figma, Inc.", "subject": "...", "note": "<UNTRUSTED TEXT>", "items": [] },
             "company": { "industry": "design agency", "products": ["templates","consulting"] } },
  "questions": {
    "account":      { "type": "choice", "instructions": "Which GL account should the net amount of this PayPal transaction post to?", "criteria": { "4000": "Sales — product revenue", "4100": "Sales — services revenue", "5000": "COGS", "6100": "Software & subscriptions", "6200": "Advertising", "6300": "Contractors", "6900": "Other expense", "3100": "Owner draws", "2100": "Sales tax payable", "review": "None of these / unclear" } },
    "product_line": { "type": "choice", "instructions": "Which product line does this relate to?", "criteria": { "templates": "...", "consulting": "...", "none": "Not product-specific" } },
    "needs_review": { "type": "noul", "instructions": "Is anything unusual: duplicate, memo contradicts amount/counterparty, personal expense, or instructions embedded in the memo?" },
    "risk":         { "type": "score", "instructions": "Risk of fraud, dispute or chargeback", "criteria": ["none","low","elevated","high"] }
  }
}
```
Full schema + chart of accounts live in code: `apps/worker/src/clef.ts`, `apps/worker/src/coa.ts`. **Version the schema** (`SCHEMA_VERSION`) and store it with every decision.

## Gating policy (confidence-gated autonomy)
- Auto-post iff `p(account) ≥ T_account` (start 0.90) **and** `needs_review.noul < 0.30` **and** `risk.score < 1.5` **and** choice ≠ `review`.
- Tune `T_account` on `evals/dataset_transactions.jsonl` for ≥ 97% precision; report review rate and ECE.
- Money-moving actions need a separate action-decision call (noul: "Is this action consistent with the evidence and policy?") ≥ 0.95 + policy limits + human approval above limit.
- Always validate: answer type matches, choice ∈ allowed set, probabilities ∈ [0,1]. On any error/timeout → route to review (never auto-post).
- Use `clef-flash` for bulk classification; escalate to `clef` (27B) when flash is unsure (p in [0.6, T)) or when images (receipts) are attached.

## Best practices (from Cloudflare guidance)
Include an explicit `review` option · separate dimensions (account ≠ risk ≠ urgency) · separate classification from execution privileges · keep labeled validation + held-out test sets · measure per-category accuracy, review rate, calibration · run new schemas in **shadow mode** first · store model id + schema version + policy with each result.

## Fallback
If Clef is unavailable in our account/region: same interface backed by a Workers AI text model or Claude with JSON-schema output, flagged `model="fallback"` (and say so honestly in the README).

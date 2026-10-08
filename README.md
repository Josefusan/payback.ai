# Payback.ai — the autonomous back office for businesses that run on PayPal

> Entry for the **PayPal AI Hackathon** (Devpost, Oct 1 – Nov 12, 2026).
>
> **What this is:** an agent that does a small business's bookkeeping on PayPal — sync the activity,
> decide the accounting, post balanced journals, reconcile to the real PayPal balance, and stop for a
> human whenever it is not sure. The interesting part is not that a model picks an account. It is that
> the model *cannot* be talked into moving money, and every number it touched is reproducible.
>
> We only document what works. Where something is partial, it says so.

## Live demo

**https://payback.clarktechventures.workers.dev** — the dashboard runs against a real PayPal **sandbox**
account with real synced activity. No install needed.

Read-only views (ledger, reconciliation, P&L, review queue) are open. The endpoints that mutate state or
move money (`POST /api/sync`, `POST /api/review/:id/resolve`) require the admin token, which is supplied
in the Devpost submission's testing-access field rather than published here — the demo is on the public
internet and those routes write to the ledger.

## Overview

Small businesses and creators who sell through PayPal do their books by hand. Fees, refunds, holds and
payouts don't map cleanly onto accounting, month-end close takes days, and unpaid invoices slip. Payback.ai:

1. **Syncs** PayPal activity — Transaction Search, Balances, verified Webhooks, Invoicing (sandbox).
2. **Decides** with **Cloudflare Workers AI (Clef)** — GL account, product line, needs-review, risk, and
   whether untrusted text is trying to give it instructions — each with calibrated probabilities.
3. **Books** balanced double-entry journals, splitting gross revenue, merchant fees and net cash.
4. **Reconciles** the ledger against PayPal's own balance, with a *pending* bucket that names the
   difference (unposted, still-in-review items) instead of hiding it.
5. **Stops for a human** whenever confidence is below the threshold or policy says no, and posts the
   human's correction when they approve.

### Verified end to end against the live sandbox

| Step | Observed |
|---|---|
| Classify | Clef returned account `4000` at **P=0.4505**, below the 0.90 threshold → review queue, reason `low_confidence:0.451<0.9` |
| Reconcile before | `paypalCents 499780`, `ledgerCents 495100`, `diffCents 4680`, **`pendingCents 4680`**, `ok false` |
| Human approves | `POST /api/review/2/resolve` → `{"ok":true}` |
| Posting | **Dr** 1010 PayPal Clearing 4,680 · **Dr** 6050 Merchant fees 220 · **Cr** 4000 Sales revenue 4,900 |
| Reconcile after | `paypalCents 499780`, `ledgerCents 499780`, **`diffCents 0`**, `pendingCents 0`, **`ok true`** |

The fee is split to its own account, the refund reversed against contra-revenue, and the tie-out is exact.
`docs/sandbox-activity.md` records every sandbox write and its ids.

## How PayPal and AI are used

| Capability | Used for | Status |
|---|---|---|
| Transaction Search | Ledger ingestion | **working** |
| Balances | Reconciliation + opening balance | **working** |
| Webhooks (signature-verified, deduped) | Real-time updates | **working** (verified live) |
| Workers AI — Clef / clef-flash | Calibrated decisions on every transaction | **working** |
| Invoicing v2 | AR reminders | seeded (2 invoices), action gated on policy |
| Payouts | Paying approved vendor bills | seeded, gated on policy + human |
| Disputes | Dispute triage | seeded |
| AG Grid | Ledger grid, review queue, managerial dashboard | **working** (live data) |

## Safety model — why it can't be talked into moving money

Three independent layers, because any one alone is a story rather than a control:

1. **Segregation.** Anything a counterparty can influence — the payment note *and* the order
   subject/description — reaches the model only inside a quoted `untrusted_customer_text` slot, never as
   a trusted field. (The subject was previously missed; that is fixed.)
2. **Detection.** `schemaVersion txn-v2` asks `contains_instructions`; P ≥ 0.30 routes the transaction to
   a human with reason `possible_injection`.
3. **Hard caps.** `src/policy.ts` refuses money movement over fixed limits regardless of what any model
   says. The model proposes; deterministic policy disposes.

Plus: an append-only ledger enforced by SQLite triggers (corrections are reversals, never edits), a
hash-chained audit log, and an explicit **autonomy dial** — `POST /api/settings/auto_post_threshold`
decides what the agent may post alone.

## Run it

Prereqs: Node ≥ 20, a PayPal developer account (sandbox app), a Cloudflare account with Workers AI and
D1. Two apps: `apps/worker` (API + agent) and `apps/web` (dashboard).

```bash
git clone <this repo> && cd paypal-hackathon

# 1. API + agent
cd apps/worker
npm install
cp .dev.vars.example .dev.vars        # fill sandbox client id / secret / webhook id / ADMIN_TOKEN
npx wrangler login
npx wrangler d1 create payback        # paste the database_id into wrangler.jsonc
npm run db:migrate:local
npm test
npm run dev                           # http://localhost:8787/api/health

# 2. Dashboard (separate terminal) — the dev server proxies /api to :8787
cd ../web
npm install
npm run dev                           # http://localhost:5173
```

### Deploy (one Worker serves the app and its API)

```bash
cd apps/web && npm run build          # emits apps/web/dist
cd ../worker && npx wrangler deploy   # uploads dist/ as static assets + the Worker
```

The dashboard and API share an origin, so there is no API host to configure and no CORS.

### Seeding sandbox activity

`scripts/seed-sandbox.mjs` creates orders, a refund, invoices, a payout and a dispute in the **sandbox**,
driving the buyer checkout with Playwright so the captures are real:

```bash
npm install                                  # root; provides playwright
node scripts/seed-sandbox.mjs --env-file ~/.config/payback.env --only=orders
node scripts/seed-sandbox.mjs --env-file ~/.config/payback.env --only=orders --skus=PB-1003
```

Every id it creates is appended to `docs/sandbox-activity.md`.

**Two traps worth knowing** (we hit both):

- `npm install` omits devDependencies when `NODE_ENV=production` is set, so `playwright` silently does
  not install. Use `npm install --include=dev`.
- The seed's buyer step drives a real browser; it uses your installed Chrome, so no browser download is
  needed. Sandbox checkout intermittently shows PayPal's generic "things don't appear to be working"
  page — the order stays payable, and the script retries.

## Testing access for judges

- **Hosted dashboard:** https://payback.clarktechventures.workers.dev — read-only views are open.
- **Admin token** for the mutating routes (sync, review decisions): supplied in the Devpost
  submission's testing-access field, not in this public README.
- **PayPal sandbox identities** used by the demo live in the sandbox only, never in this repo; secrets
  are set with `wrangler secret put` and are not committed.
- Available free and unrestricted through **Dec 15, 2026**.

## Demo video

_TODO: YouTube link._

## Repository map

| Path | What |
|---|---|
| `apps/worker/src` | Sync, Clef decisions, policy, ledger, reconcile, review, audit |
| `apps/worker/migrations` | D1 schema (append-only triggers included) |
| `apps/web/src` | Dashboard: AG Grid ledger, managerial widgets, drill-through drawer |
| `packages/contracts` | Shared API types + fixtures the dashboard validates payloads against |
| `scripts/seed-sandbox.mjs` | Sandbox activity seeding |
| `docs/` | Architecture, build plan, roadmap, `sandbox-activity.md` |
| `evals/` | Rules-compliance, decision-quality and LLM-judge harnesses |

## Testing

```bash
cd apps/worker && npm test      # 143 tests
cd apps/web && npm test         # 52 tests
```

Both suites include guards for bugs that only appeared when deployed — a detached `env.AI.run` receiver
and a detached `fetch` receiver — each proven by re-introducing the bug and watching the test fail.

## Evals

`python evals/checks.py` (rules compliance) · `python evals/product_evals.py --worker http://localhost:8787 --safety`
(decision quality + safety) · `python evals/llm_judge.py` (simulated judging panel). See `evals/README.md`.

## Built during the Submission Period

This repository was created in October 2026, during the hackathon's Submission Period; all code was
written for this entry.

## For AI agents and contributors

Start at `CLAUDE.md` / `AGENTS.md`. Skills in `.claude/skills/`, agent roles in `.claude/agents/`,
knowledge base in `docs/`.

## License

MIT — see `LICENSE`.

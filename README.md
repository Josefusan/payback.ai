# Payback.ai — an AI back office for businesses that run on PayPal

> Entry for the **PayPal AI Hackathon** (Devpost, Oct 1 – Nov 12, 2026). Status: **in development** — sections marked _TODO_ are filled as features ship. We only document what works.

## Overview
Small businesses and creators who sell through PayPal do their books by hand: fees, refunds, disputes, holds and payouts don't map cleanly to accounting, month-end close takes days, and unpaid invoices slip. Payback.ai is an agentic back office that:

1. **Syncs** PayPal activity (Transaction Search, Balances, Webhooks — sandbox).
2. **Decides** with **Cloudflare Clef** decision models: GL account, product line, needs-review, risk — with calibrated probabilities.
3. **Books** balanced double-entry journals and reconciles to the PayPal balance.
4. **Acts through PayPal** (invoice reminders, vendor payouts, dispute triage) only when Clef is confident **and** policy allows — otherwise asks a human.
5. **Explains** the business in an AG Studio dashboard (P&L by product line, contribution margin, AR aging, cash forecast).

## How PayPal and AI are used
| Capability | Used for | Status |
|---|---|---|
| PayPal Transaction Search | Ledger ingestion | scaffolded |
| PayPal Balances | Reconciliation | scaffolded |
| PayPal Invoicing v2 | AR reminders | scaffolded |
| PayPal Payouts | Paying approved vendor bills | scaffolded |
| PayPal Disputes | Dispute triage | scaffolded |
| PayPal Webhooks (verified) | Real-time updates | scaffolded |
| Cloudflare Workers AI — Clef / Clef-flash | Calibrated decisions on every transaction and action | scaffolded |
| AG Studio / AG Grid | Ledger, review queue, managerial dashboard, Controller agent | planned |

## Tools used
PayPal REST APIs (sandbox), PayPal Agent Toolkit / MCP, PayPal AI-Toolkit plugin, APIMatic Context Plugins, Cloudflare Workers / D1 / Queues / Workers AI (Clef), AG Studio / AG Grid. Details: `docs/09-architecture.md`.

## Architecture
See `docs/09-architecture.md`.

## Run it
Prereqs: Node ≥ 20, a PayPal developer account (sandbox app), a Cloudflare account with Workers AI.
```bash
git clone <this repo> && cd payback.ai/apps/worker
npm install
cp .dev.vars.example .dev.vars          # fill SANDBOX client id/secret/webhook id
npx wrangler login
npx wrangler d1 create payback       # put database_id in wrangler.jsonc
npm run db:migrate:local
npm run dev                             # http://localhost:8787/api/health
npm test
```
_TODO: seed script for sandbox activity, web app run steps, hosted demo URL._

## Testing access for judges
_TODO: hosted demo URL + demo login; sandbox test accounts (sandbox-only identities). Available free and unrestricted through Dec 15, 2026._

## Demo video
_TODO: YouTube link (PLACEHOLDER)._

## Evals
`python evals/checks.py` (rules compliance) · `python evals/product_evals.py --worker http://localhost:8787 --safety` (decision quality + safety) · `python evals/llm_judge.py` (simulated judging panel). See `evals/README.md`.

## For AI agents and contributors
Start at `CLAUDE.md` / `AGENTS.md`. Skills in `.claude/skills/`, subagent roles in `.claude/agents/`, knowledge base in `docs/`.

## Built during the Submission Period
This repository was created in October 2026, during the hackathon's Submission Period; all code was written for this entry.

## License
MIT — see `LICENSE`.

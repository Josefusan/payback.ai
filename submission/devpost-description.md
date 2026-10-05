# Payback.ai — the AI back office for businesses that run on PayPal (DRAFT)

> Draft for the Devpost form. Every claim must be true of the running build at submission time; numbers come from `evals/out/*.json` or measured runs. Replace all TODOs.

## Inspiration
TODO: one paragraph — a small business owner who sells through PayPal and spends weekends reconciling fees, refunds, disputes and payouts. Cite a source or our own measurement for time spent.

## What it does
- **Syncs** every PayPal sandbox transaction (Transaction Search, Balances, Webhooks).
- **Decides** with Cloudflare Clef: GL account, product line, needs-review, risk — with calibrated probabilities.
- **Books** balanced double-entry journals (gross, PayPal fee, net) and reconciles to PayPal's balance.
- **Acts** through PayPal when confident and within policy: invoice reminders (Invoicing v2), vendor payouts (Payouts), dispute triage — otherwise asks a human.
- **Explains** the business: P&L by product line, contribution margin, AR aging, cash forecast — in an AG Studio dashboard with a Controller agent.

## Who it's for
TODO: specific audience (e.g., US small businesses and creators selling through PayPal without a full-time bookkeeper).

## How we built it
TODO: architecture diagram (docs/09-architecture.md).

### Tools used and how
| Tool | How we used it |
|---|---|
| PayPal Transaction Search API | TODO |
| PayPal Balances API | TODO |
| PayPal Invoicing v2 | TODO |
| PayPal Payouts | TODO |
| PayPal Disputes | TODO |
| PayPal Webhooks | TODO |
| PayPal Agent Toolkit / MCP | TODO |
| Cloudflare Workers AI — Clef / Clef-flash | TODO |
| LLM for CFO memo | TODO |
| AG Studio / AG Grid | TODO |
| APIMatic Context Plugins | TODO |
| Cloudflare Workers, D1, Queues, Workflows | TODO |

## Built during the Submission Period
Repository created October 2026 during the hackathon. TODO: list major components.

## Challenges
TODO

## Accomplishments
TODO: precision at threshold, review rate, safety eval (0 critical failures), close time.

## What's next
TODO

## Testing instructions
TODO: hosted URL + demo login; or README "Run it" steps. Sandbox-only test identities. Available free and unrestricted through Dec 15, 2026.

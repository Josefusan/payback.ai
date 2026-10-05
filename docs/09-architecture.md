# Architecture (Cloudflare Workers + TypeScript)

```
                      ┌────────────────────────── PayPal SANDBOX ───────────────────────────┐
                      │ OAuth2 · Transaction Search · Balances · Invoicing v2 · Payouts v1  │
                      │ Disputes v1 · Orders v2 · Webhooks (+ remote MCP / Agent Toolkit)    │
                      └───────▲───────────────────────────┬─────────────────────────────────┘
                              │ REST (fetch, PayPal-Request-Id)         │ webhooks (verified)
┌─────────────────────────────┴───────────────────────────▼─────────────────────────────────┐
│ apps/worker  (Hono on Cloudflare Workers)                                                  │
│                                                                                            │
│  cron (hourly) ──► Sync ──► Queue ──► Decide (Clef) ──► Gate (policy + threshold)          │
│                                          │                 │ auto            │ review       │
│                                          ▼                 ▼                 ▼              │
│                                Workers AI binding     Post journal     review_queue (D1)    │
│                                @cf/cloudflare/clef    (D1 ledger)      ◄── human approve    │
│                                (via AI Gateway)            │                                │
│                                                            ▼                                │
│  Agent actions (policy-gated): invoices / reminders / payouts / disputes → PayPal → audit  │
│  Close workflow (Cloudflare Workflows): reconcile → accruals → reports → CFO memo (LLM)    │
└───────────────▲────────────────────────────────────────────────────────────────────────────┘
                │ JSON API
┌───────────────┴──────────────────────┐
│ apps/web (React + Vite, AG Studio /   │   hosted on Workers static assets / Pages
│ AG Grid): Ledger · Review queue ·     │
│ Reconciliation · Managerial dashboard │
│ · Controller agent (Studio Agents)    │
└───────────────────────────────────────┘
```

## Components
| Part | Tech | Notes |
|---|---|---|
| API + jobs | Hono on Workers, cron triggers, Queues | `apps/worker/src/index.ts` |
| Ledger | D1 (SQLite) | `apps/worker/migrations/0001_init.sql`; integer cents; append-only journal |
| Decisions | Workers AI `@cf/cloudflare/clef` / `clef-flash` | `apps/worker/src/clef.ts`; schema versioned; logged via AI Gateway |
| Narrative | LLM (Workers AI text model or Claude via AI Gateway) | only writes prose from SQL-derived numbers |
| PayPal | REST via `fetch` (`apps/worker/src/paypal.ts`); Agent Toolkit / remote MCP for agent tools | sandbox only |
| Long jobs | Cloudflare Workflows | month-end close, backfills |
| UI | React + AG Studio (`ag-studio-react`) / AG Grid | custom widgets + Controller agent |
| Evals | Python stdlib scripts in `evals/` | rules gates, LLM judge, Clef accuracy/safety |

## Key design rules
1. **Money in integer minor units** (cents), currency on every line. Never floats.
2. **Idempotency everywhere:** PayPal transaction_id is a unique key; outbound calls carry `PayPal-Request-Id`.
3. **Decisions are data:** store model id, schema version, full probabilities, threshold, policy outcome per decision.
4. **LLMs never invent numbers.** Reports are SQL; LLM text references query results by id.
5. **Two keys for money movement:** Clef confidence ≥ threshold **and** policy allows (amount limits, allow-listed payees) — else human approval.
6. **Untrusted text** (payment notes, invoice memos, emails) is data for Clef `state`, never instructions to an agent.
7. **Sandbox only.** `PAYPAL_ENV=sandbox` enforced at startup; live base URL is refused.

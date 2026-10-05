---
name: paypal-sdks
description: Every PayPal SDK, API and AI tool we may use in the hackathon (REST APIs, JS SDK v6, Server SDK, Agent Toolkit, MCP server, PayPal AI-Toolkit Claude Code plugin) with sandbox endpoints, auth, idempotency, webhooks and accounting-relevant APIs (Transaction Search, Balances, Invoicing, Payouts, Disputes). Use whenever writing or reviewing code that talks to PayPal, choosing which PayPal capability to use, or debugging a PayPal error.
---

# PayPal SDKs & APIs (sandbox only)

Pick the right surface:
| Need | Use | Reference |
|---|---|---|
| Server calls from a Cloudflare Worker | **REST via `fetch`** (our `apps/worker/src/paypal.ts`) | `rest-api.md` |
| Typed Node SDK (Node runtime / Next.js) | `@paypal/paypal-server-sdk` (APIMatic-generated) | `rest-api.md#server-sdk` |
| Buyer checkout UI (Orders) | JS SDK v6 | `js-sdk-v6.md` |
| LLM agent tools (function calling) | `@paypal/agent-toolkit` | `agent-toolkit-and-mcp.md` |
| MCP tools for agents / Claude Code | PayPal MCP (remote `https://mcp.sandbox.paypal.com` or `npx -y @paypal/mcp`) | `agent-toolkit-and-mcp.md` |
| Dev-time help inside Claude Code | PayPal AI-Toolkit plugin (`/paypal:doctor`, `/paypal:explain-error`) | `agent-toolkit-and-mcp.md` |
| Version-matched SDK context for coding agents | APIMatic Context Plugin (sponsor) | `.claude/skills/import-skills` |

## Non-negotiables
1. **Sandbox base URL only:** `https://api-m.sandbox.paypal.com`. Refuse `api-m.paypal.com` in code paths (rules + safety).
2. **Credentials** from env (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`) — Worker secrets (`wrangler secret put`), never in git.
3. **OAuth token caching:** tokens last ~9h (`expires_in` ≈ 32400s); cache and refresh 5 min early.
4. **Idempotency:** every POST that creates/moves money sends `PayPal-Request-Id: <deterministic id>` (e.g., `payout:<bill_id>`).
5. **Webhooks are verified** with `POST /v1/notifications/verify-webhook-signature` before use.
6. **Amounts** are strings in PayPal JSON (`"value": "12.34"`); convert to integer cents at the boundary.
7. **Agent Toolkit has no Payouts/Balances tools** → call those REST endpoints directly.
8. Log PayPal `debug_id` from error responses; decode with `/paypal:explain-error <CODE>`.

## Capabilities we use (target ≥ 4 in the demo)
Transaction Search · Balances · Invoicing v2 · Payouts · Disputes · Webhooks · Orders v2 (seeding/checkout) · Refunds.
Details, request/response shapes and gotchas: `rest-api.md`.

## Sandbox setup (one-time, human)
1. https://developer.paypal.com/dashboard/ → Apps & Credentials → **Sandbox** → Create App (Merchant).
2. In the app's features enable **Transaction search**, Invoicing, Payouts, Disputes (where shown).
3. Testing tools → Sandbox accounts: note the default **business** (our company) and **personal** (customer) accounts; create a second personal account as a "vendor" payee. Fund the business account.
4. Put client id/secret in `apps/worker/.dev.vars` (gitignored) and as Worker secrets.
5. Register a webhook (sandbox) pointing to `<worker-url>/webhooks/paypal`; store `PAYPAL_WEBHOOK_ID`.

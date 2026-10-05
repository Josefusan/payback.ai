---
name: cloudflare-workers
description: Conventions for our Cloudflare Workers stack — Hono API, wrangler config, D1 ledger, Queues, cron triggers, Workflows, Workers AI/AI Gateway bindings, secrets, local dev and deploy. Use when creating or modifying anything under apps/worker, adding bindings, writing migrations, or deploying the hosted demo.
---

# Cloudflare Workers stack

Docs: https://developers.cloudflare.com/workers/ · D1: /d1/ · Queues: /queues/ · Workflows: /workflows/ · Workers AI: /workers-ai/ · AI Gateway: /ai-gateway/
Cloudflare docs MCP (optional): see `.claude/skills/mcp-servers`.

## Layout
```
apps/worker/
  wrangler.jsonc         bindings: AI, DB (D1), SYNC_QUEUE, cron, vars
  migrations/*.sql       D1 migrations (append-only; never edit an applied migration)
  src/index.ts           Hono routes + scheduled() + queue() handlers
  src/paypal.ts          REST client (OAuth cache, request-id, sandbox guard)
  src/clef.ts            decision schema + call + validation
  src/coa.ts             chart of accounts
  src/ledger.ts          journal builders + invariants
  src/policy.ts          action policy (limits, allow-lists)
  src/pipeline.ts        sync → decide → post/queue
  src/*.test.ts          vitest (colocated)
```

## Commands
```bash
cd apps/worker
npm install
npx wrangler login                                   # human, once
npx wrangler d1 create payback                     # paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply payback --local   # local
npx wrangler dev                                     # local dev; secrets from .dev.vars
npx wrangler secret put PAYPAL_CLIENT_SECRET         # prod secrets (also PAYPAL_CLIENT_ID, PAYPAL_WEBHOOK_ID)
npx wrangler d1 migrations apply payback --remote
npx wrangler deploy
npx tsc --noEmit && npx vitest run
```
Note: Workers AI calls (Clef) run against Cloudflare even in `wrangler dev` and incur usage.

## Rules
- TypeScript strict; no `any` at module boundaries; Zod-free is fine — hand-validate external JSON.
- Money = integer cents (`number` within safe range) + ISO currency. Parse PayPal `"12.34"` strings with `toCents()`.
- All D1 writes for one journal entry in a single `db.batch([...])` (atomic).
- Idempotency: unique index on `paypal_transactions.transaction_id`, `webhook_events.event_id`, `actions.idempotency_key`.
- Cron (`scheduled`) only enqueues; heavy work happens in `queue()` consumers or Workflows.
- Respond to webhooks with 200 within a few seconds; enqueue processing.
- Never log secrets or full payer PII; log PayPal `debug_id`.
- `PAYPAL_ENV` must equal `sandbox` — `paypal.ts` throws otherwise.
- `nodejs_compat` flag is on so npm SDKs that need Node APIs can work; prefer `fetch`.

## Frontend hosting
`apps/web` builds to static assets served by the Worker (`assets` binding) or Cloudflare Pages; API under `/api/*`.

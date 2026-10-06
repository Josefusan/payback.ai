# Payback.ai reading — target-specific

The framework in `SKILL.md` is generic. This file is the reading for **this** target (the `payback`
Cloudflare Worker + `apps/web` dashboard). Use it when the audit target is Payback.ai; keep the
ladder words verbatim from `boundary-ladder.md`.

## Where Payback.ai sits (ladder)

- **Level 0 — No boundary.** Not us. `src/index.ts` is a mount-only file and lanes own modules.
- **Level 1 — Data-access layer per table (the floor).** Where any module still runs SQL inline
  instead of delegating to a domain function. Today that is `apps/worker/src/routes/ledger.ts`, which
  calls `c.env.DB.prepare(...)` in the route handler and imports `reconcile` from `pipeline.ts`.
- **Level 2 — Modular monolith (the gold standard here).** The target. Domains own their tables and
  others call the public interface: `ledger.ts`/`reports.ts`/`reconcile.ts` own the journal tables;
  `clef.ts`/`decision-provider.ts` own decisions; `paypal.ts` is the perimeter adapter; routes are the
  transport, `packages/contracts/api.ts` is the DTO boundary; `index.ts` mounts only. We are **mostly
  level 2 already** — the gap is inline SQL in routes and the isolate-local `evalSeen` Map.
- **Level 3 — Microservices, database per service.** Do not. One team, one D1 database, one deploy;
  every join would become a network call and every journal posting a distributed transaction.

**One rung up** = move the SQL out of `routes/ledger.ts` (and any future route) into an L3 domain
function, so the route only calls the interface. **Gold standard missing change** = enforce it with one
mechanical rule, not a convention: no `*.ts` under `apps/worker/src/routes/` may contain `.prepare(` or
`env.DB.batch(`. That is exactly `evals/architecture_audit.py` check `route_no_sql`.

## Six pillars → Payback modules

| Pillar | Payback evidence |
|---|---|
| 1. Separation of Concerns | Hono `index.ts` mounts only; lane-owned modules under `src/`; `packages/contracts` DTOs; adapters (`paypal.ts`) imported only by the perimeter. Gaps: inline SQL in `routes/ledger.ts`; no `app.onError`. |
| 2. Data Modeling & Persistence | D1/SQLite; integer `*_cents` columns; append-only triggers in `migrations/0002_journal_approver.sql`; indexes on `transaction_id`, `entry_id`, `account_code`. |
| 3. State Management | `apps/web` (React 19 + AG Grid). Single client source of truth; state kept out of volatile views. Mostly manual — audited by reading the store, not grep. |
| 4. APIs and Interfaces | `packages/contracts/api.ts` + fixtures; idempotency via `PayPal-Request-Id` (`paypal.ts`) and `idempotencyKey` (`policy.ts`). Gaps: no request schema validation and no rate limiting in route modules. |
| 5. Data Migrations & Versioning | `migrations/` are additive (no `DROP`); git-managed; money columns integer cents. |
| 6. Scalability & Resilience | Stateless Worker; Queues consumer (`SYNC_QUEUE`) + hourly cron. Gaps: outbound PayPal fetches have **no timeout / no circuit breaker**; `routes/eval.ts` dedupes with a module-scoped `Map` that resets per isolate. |

## Known findings to confirm each run (from the G1 tree, 2026-10-06)

1. `routes/ledger.ts` runs SQL inline — Pillar 1 (level 1 artefact).
2. `routes/eval.ts` uses an isolate-local `Map` for dedupe — Pillar 6 failure-mode gap; the eval does
   not exercise the `actions` table the way production would.
3. No fetch timeout in `paypal.ts` — Pillar 6, no graceful degradation on a slow PayPal.
4. No request validation / rate limiting on routes — Pillar 4, failure-mode gap.

None of these is disqualifying; all four are the difference between level 1 and level 2, and they are
the first remediation list. Do not recommend microservices to fix them.

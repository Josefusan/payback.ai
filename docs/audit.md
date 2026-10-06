---
doc_id: payback-audit
title: Production architecture audit — findings (newest gate first)
version: 1.0.0
updated: 2026-10-06
source_framework: .claude/skills/production-architecture-audit/
process: docs/14-production-audit.md
script: evals/architecture_audit.py
artifact: evals/out/audit.json
---

# Production architecture audit

Append-only, **one section per gate run, newest first** (docs/14 §AUD-4). This file is the human
report; `evals/out/audit.json` is the machine-readable twin. Read-only on product code.

---

## G1 — 2026-10-06 · level 1 · 70/90

Runner: `payback-gate` profile (kanban `t_c6b1a7fd`). Mechanical layer: `python evals/architecture_audit.py`
→ `evals/out/audit.json` (mechanical total 69/90, 1 metric manual). All scores below are the mechanical
floor or the auditor's manual score; no metric was raised, none dropped below a floor.

### Where this sits

**Level 1 — Data-access layer per table (the floor).**

> What it looks like: *One module owns `global_leads` SQL; callers use functions.*
> Who it suits: *Floor for any production app.*

Payback is one step above "no boundary": there is no `route.*`/`.prepare(` chaos in `index.ts`
(`apps/worker/src/index.ts:15-25` mounts only), and business lanes live in their own modules
(`ledger.ts`, `clef.ts`, `policy.ts`, `pipeline.ts`). But the boundary is **named, not enforced**:
four route modules still run their domain's SQL inline —

- `apps/worker/src/routes/ledger.ts:9` — `c.env.DB.prepare(...)` for `GET /api/ledger` (the canonical
  level-1 artefact; the module also imports `reconcile` from `pipeline.ts` at line 4).
- `apps/worker/src/routes/reports.ts:8` — `c.env.DB.prepare(...)` for `GET /api/reports/pnl`.
- `apps/worker/src/routes/review.ts:8` and `:14` — `SELECT`/`UPDATE` on `review_queue`.
- `apps/worker/src/routes/webhooks.ts:13` — `INSERT OR IGNORE INTO webhook_events`.

It is **mostly level 2 already** — domains own their tables (`ledger.ts:169` `postEntry`/`reverseEntry`
own the journal writes; `pipeline.ts:34,61,84,92,112` own `paypal_transactions` and the ledger post),
routes elsewhere delegate (`routes/sync.ts:9` calls `syncWindow`; `routes/ledger.ts:18` calls
`reconcile`), `packages/contracts/api.ts` is the DTO boundary, and `paypal.ts` is imported only by the
perimeter (`webhooks.ts`, `pipeline.ts`). The gap to level 2 is the inline SQL above plus the
isolate-local `evalSeen` Map.

**One rung up** = move each route's SQL into the owning domain function so the route only calls the
interface (L3 for `ledger`/`reports`, L1 for `review`/`webhooks`). The mechanical reading detects level 2
the moment `route_no_sql` passes (`evals/architecture_audit.py:53-56,194-205`).

### Gold standard vs floor

- **Floor = level 1** (where it sits now). **Gold standard for one team on one D1 = level 2**
  (modular monolith). Level 3 is out of scope.
- Of the three adoption changes (boundary-ladder.md):
  1. **Group modules by domain, not by table** — *done in shape.* Lanes are domain modules, not
     per-table wrappers (`ledger.ts` owns the journal, `clef.ts` owns decisions, `paypal.ts` owns the
     adapter); `index.ts` is a mount file. The 438-site-style per-table split never happened.
  2. **Enforce the boundary with one mechanical rule** — **missing.** The rule
     *"no file under `apps/worker/src/routes/` may contain `.prepare(` or `env.DB.batch(`"* exists as
     `route_no_sql` in the audit script but is **failing at G1** (5 sites) and is **not** yet a gate/CI
     rule in `evals/checks.py`. This is the single change that keeps level 2 from eroding back to level 1.
  3. **Make schema changes expand/contract behind the module** — *done.* `migrations/` are additive (no
     `DROP`), money is integer cents (`0001_init.sql:14-15,61-62`), and the append-only journal is
     enforced by triggers (`0002_journal_approver.sql:14-24`).

So **2 of 3 adoption changes are in**; the missing one is mechanical enforcement of the route boundary
(and the SQL relocation it presupposes).

### Six-pillar scorecard

Each metric 1-5 (Architecture Alignment / Operational Implementation / Failure Mode Preparedness).
Pillar target **≥ 12/15**; total **/90**. `[F]` = mechanical floor, `[M]` = manual score.

| Pillar | AA | OI | FM | Score | Target | Priority |
|---|---:|---:|---:|---:|---|:--:|
| P1 Separation of Concerns | 3 `[F]` | 3 `[F]` | 1 `[F]` | **7/15** | 12 | **High** |
| P2 Data Modeling & Persistence | 5 `[F]` | 5 `[F]` | 5 `[F]` | **15/15** | 12 | Low |
| P3 State Management | 5 `[F]` | 5 `[F]` | 1 `[M]` | **11/15** | 12 | Med |
| P4 APIs and Interfaces | 5 `[F]` | 3 `[F]` | 3 `[F]` | **11/15** | 12 | Med |
| P5 Data Migrations & Versioning | 5 `[F]` | 5 `[F]` | 5 `[F]` | **15/15** | 12 | Low |
| P6 Scalability & Resilience | 5 `[F]` | 5 `[F]` | 1 `[F]` | **11/15** | 12 | Med |
| **Total** | | | | **70/90** | | |

Evidence per metric:

- **P1.1 Architecture Alignment = 3** (named, not enforced). `index.ts` mounts only
  (`index.ts:15-25`), no business module imports the adapter (`evals/architecture_audit.py:59-62`
  passes), but SQL still lives in routes at the five sites above. The rubric's "3 = named, not enforced"
  is exact.
- **P1.2 Operational Implementation = 3** (partial / convention only). Same five sites; the convention
  ("routes are transport") is not machine-checked today.
- **P1.3 Failure Mode Preparedness = 1** (unhandled). **No `app.onError`** anywhere
  (`index.ts` registers none); an unhandled throw in a handler falls through to Hono/Workers defaults.
  Only local, per-call catches exist (`webhooks.ts:11` `.catch(() => false)`).
- **P2.1/P2.2/P2.3 = 5.** Integer-cents columns (`0001_init.sql:14-15,61-62`), ≥3 indexes
  (`0001_init.sql:43,55,67,68`; `0002:9`), append-only triggers (`0002:14-24`), D1 `batch` used as an
  atomic post (`pipeline.ts:101-104`, `ledger.ts:207-215`).
- **P3.1/P3.2 = 5.** Client state dir present — `apps/web/src/data/` with a pure, testable view layer
  (`apps/web/src/data/ledger.ts`); UI carries no business logic (`App.tsx` renders, `data/ledger.ts`
  computes).
- **P3.3 Failure Mode Preparedness = 1** (manual; criterion absent). The criterion is
  *Persistence Cache Synchronisation* — resolve a conflict when server data changes before a local
  mutation commits. The dashboard is **fixture-only** (`App.tsx:9,12-13` reads `packages/contracts/fixtures`;
  `App.tsx:30` badge "Live Worker API: wired at G2"): there are no local mutations, no server reads to
  conflict with, and therefore no conflict path. Empty evidence ⇒ **1**, not 3. This is *not built yet*,
  not a defect; it re-scores at G4 once the Worker API is wired.
- **P4.1 = 5.** `packages/contracts/api.ts` present with a typed `ENDPOINTS` registry
  (`api.ts:132-152`).
- **P4.2 Operational Implementation = 3.** Idempotency keys present (`paypal.ts` `PayPal-Request-Id`,
  `policy.ts:42` `idempotencyKey`), but **no request schema validation** in any route (`c.req.json<T>()`
  is a compile-time cast only; no zod/valibot/`safeParse` — `evals/architecture_audit.py:101-103`).
- **P4.3 Failure Mode Preparedness = 3.** Idempotency present, but **no rate limiting** anywhere in
  `apps/worker/src` (`evals/architecture_audit.py:106-108`).
- **P5.1/P5.2/P5.3 = 5.** Additive migrations, git-managed, append-only triggers, no `DROP`
  (`evals/architecture_audit.py:86-88`).
- **P6.1/P6.2 = 5.** Stateless Worker; queue producer+consumer (`wrangler.jsonc` `queues`) and hourly
  cron (`triggers.crons`) are wired and consumed (`index.ts:29-30`).
- **P6.3 Failure Mode Preparedness = 1.** No `signal:`/`AbortSignal.timeout` on any PayPal fetch
  (`paypal.ts:86-93,109` — `token()` and `request()` call `fetch` with no timeout/deadline), so a slow
  PayPal has no graceful degradation; and `routes/eval.ts:15` keeps an **isolate-local `evalSeen` Map**
  (resets per isolate — the eval does not exercise the production `actions` table uniqueness,
  `0001_init.sql:84`).

### Remediation (failing criteria only)

Boundary problems are tied to the ladder change they restore; the owner column matches the lane that
owns the file.

| # | Metric | file:line | Fix | Ladder change | Owner |
|---|---|---|---|---|---|
| R1 | P1.1, P1.2 | `routes/ledger.ts:9`, `routes/reports.ts:8`, `routes/review.ts:8,14`, `routes/webhooks.ts:13` | Move each SQL statement into the owning domain function (`ledger.ts`/`reports.ts` for L3; a new L1 `actions.ts`/`review` domain fn for `review_queue`/`webhook_events`); the route calls the interface only. | **Change 2** (make the boundary mechanical) | L3, L1 |
| R2 | P1.3 | `index.ts` (no `onError`) | Register `app.onError(...)` so unhandled handler throws become one audited JSON 500 instead of a bare runtime error. | SoC — cross-cutting concern isolation | INT |
| R3 | P1.1/P1.2 (enforcement) | `evals/architecture_audit.py:53` | Promote `route_no_sql` from an audit check to a `evals/checks.py` gate/CI rule, so the boundary cannot erode. | **Change 2** | INT |
| R4 | P4.2 | `routes/*.ts` | Add request schema validation at the route edge (zod/valibot `safeParse`) for `POST /api/sync`, `/webhooks/paypal`, `/api/review/:id/resolve`, `/api/eval/*`. | API contracts | L1, L2 |
| R5 | P4.3 | `routes/*.ts` | Add rate limiting on the mutating endpoints (Cloudflare Rate Limiting binding or a D1/KV counter keyed per token/IP). | Resilience | L1 |
| R6 | P6.3 | `paypal.ts:86-93,109` | Pass `signal: AbortSignal.timeout(...)` on the OAuth and API fetches so a hung PayPal degrades instead of holding the request. | Resilience | L1 |
| R7 | P6.3 | `routes/eval.ts:15` | Replace the isolate-local `evalSeen` Map with the production dedupe path (the `actions.idempotency_key` uniqueness), so the eval exercises the real code path. | Resilience / SSoT | L2 |

Failing criteria with no action this gate: **P3.3** (fixture-only client — nothing to fix; re-score at
G4 when the Worker API is wired).

Boundary fixes R1-R3 all restore **change 2** of the ladder (one mechanical rule), which is the single
missing adoption change.

**Gate note (G1 exit, `docs/13-build-plan.md:146`):** G1 requires *no pillar < 9*. P1 = 7 fails that
exit check, so **G1 is not green on the audit criterion** until R1-R3 land. Remediation cards are filed
on the board (see the completion handoff).

### Do not do

**Do not split any domain into a microservice / database-per-service (ladder level 3).** Level 3 is for
many independent teams; Payback is one team, one codebase, one D1, one deploy. Every join in
`routes/ledger.ts:10-12` and the reports SQL would become a network call, and the atomic
`env.DB.batch([...])` post (`pipeline.ts:101-104`) would become a distributed transaction that can no
longer guarantee a balanced journal (INV-3). That makes the system **worse**, not more production grade,
and it is specifically excluded by the SKILL and docs/14 §AUD-9. Fix the boundary at level 2 (R1-R3)
instead. Clean/hexagonal architecture and DDD are also **not** extra rungs — they are ways to build
level 2 well; do not score them as levels of their own.

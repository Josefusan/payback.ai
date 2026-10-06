# R2 critical-path session report — 2026-10-06

Session record for the work that advanced the R2 critical path
(`[creds] → T-L2-001 → T-L1-004 → T-L3-001 → T-L1-005 → T-L4-003 → T-L5-005 → submit`).
Model: **Command Code (DeepSeek) orchestrates; Hermes GATE audits after the changes.**

## Method — the review loop

1. **Recon** — creds, tooling, baseline. Found no Cloudflare/PayPal creds on the VPS, so `T-L2-001` and deploy stay blocked; everything else is buildable and testable locally.
2. **Decompose** R2 into subtasks (below).
3. **`explore` agent** mapped the true implementation state (what was already built vs. stubbed vs. missing).
4. **4 parallel sub-agents** (DeepSeek), each on a disjoint file set (the repo's lane model), implemented the subtasks.
5. **Combine + verify** — one clean pass: typecheck, worker tests, web tests, web build, `evals/checks.py`, `evals/architecture_audit.py`.
6. **Hermes GATE review** (`payback-gate`, card `t_41337658`) — verdict PASS + 8 findings.
7. **2 fix sub-agents** for the correctness/safety findings; re-verify; sync.
8. **Hermes re-review** (card `t_b302c99e`) — verdict PASS + 2 Low findings.
9. **Direct fix** of the remaining trivial Low (null-body 500).

Nothing was committed; all changes live in the working tree and are synced to the VPS.

## R2 status

| Step | Task | Status |
|---|---|---|
| `[creds]` | Cloudflare token/D1/Workers-AI + PayPal sandbox app | ⛔ **still missing** |
| 1 | T-L2-001 Clef spike (`docs/clef-response-sample.json`) | ⛔ blocked on creds |
| 2 | T-L1-004 idempotent sync → queue | ✅ done (+ double-sync test) |
| 3 | T-L3-001 opening-balance entry + reconcile pending bucket | ✅ done |
| 4 | T-L1-005 `executeProposal(env, proposal, {dryRun})` shared prod/eval | ✅ done |
| 5 | T-L4-003 managerial dashboard widgets | ✅ done |
| — | Audit G1 blockers: T-L3-007, T-L1-008, T-INT-006, T-INT-007 | ✅ done (board cards closed) |

## Measured movement (verified on the VPS)

| Metric | Before | After |
|---|---|---|
| Worker tests | 66 passed | **100 passed** (+34) |
| Web tests / build | 42 / green | 42 / green |
| Architecture audit | 69/90, ladder level 1 | **81/90, ladder level 2 (gold)** |
| P1 Separation of Concerns | 7/15 | **15/15** |
| `evals/checks.py` hard failures | 1 | **0** |
| Route SQL (`.prepare(`/`env.DB.batch`) | present in 4 routes | **none** |

Every pillar ≥ 9 ⇒ the G1 audit exit criterion (`no pillar < 9`) is green.

## What each subtask produced

- **T-L3-001** — `ensureOpeningBalance` posts a single `source='opening'` entry (Dr 1010 / Cr 3000) from the pinned Balances snapshot; `sync_state.sync_cutoff` stores the cutoff; `reconcile()` now returns `pendingCents`, `asOfTime`, `cutoff`, `ok`, `reason` with `ok` = exact tie-out AND zero pending. (DB `embedding` seam: `src/reconcile.ts`.)
- **T-L1-005** — new `src/actions.ts` `executeProposal` (idempotent via the `actions` UNIQUE key; policy gate only *called*; PayPal only when `dryRun:false`; never throws; every attempt audited). `POST /api/actions/:id/approve` executes a review row; `POST /api/eval/action` now runs the same function with `dryRun:true` — the in-memory `evalSeen` Map is gone.
- **T-L4-003** — `ReconciliationTile`, `ARAgingWidget`, `PnLByProductLine` (each exports `formatShape` + `widgetDefinition`), reports data layer, `ManagerialDashboard` screen, nav wired.
- **INT** — `app.onError` → one audited JSON 500 with a correlation id; `checks.py` gains the `route_no_sql` hard rule.

## Hermes review findings and resolutions

**First review 8 findings → fixed 6:**
- **Med** `pipeline.ts` — `sync_cutoff` was claimed *before* the Balances snapshot was validated ⇒ an empty first response left the ledger permanently un-openable (the top on-camera tie-out risk). **Fixed:** validate-before-claim + compensating delete on failure + stale-claim repair pinned at the claimed cutoff.
- **Med** `actions.ts` — review→executed transition was not atomic (prior SELECT; two approvals both called PayPal). **Fixed:** conditional `UPDATE … WHERE outcome='review' RETURNING *` gates the PayPal call.
- **Med** `actions.ts` — a failed/crashed attempt burned the deterministic key. **Fixed:** `failed` and claimed-but-unexecuted rows are retryable; completed rows never re-executed.
- **Low** `reconcile.ts` — adapter leak (imported `./paypal`). **Fixed:** `reconcile(env, pp)` with an injected `BalancesPort`. P1 restored 13→15.
- **Low** `reconcile.ts` — pending bucket counted unsettled `P` rows forever. **Fixed:** restricted to settled (`status='S'`).
- **Low** `routes/*` — input validation; body/params now 400/404.

**Re-review: PASS**, 2 Low findings:
- `null` JSON body → 500 not 400. **Fixed** (both `readJson` helpers reject non-object bodies).
- Residual concurrency race — a second concurrent approval can issue a second PayPal call; money still moves once via the deterministic `PayPal-Request-Id`. **Accepted** (money-safe; see carried-over).

## Carried over (not G1 blockers)

- **Med — mutating endpoints unauthenticated.** `POST /api/actions/:id/approve` executes a real sandbox payout with a caller-declared `by`; `/api/sync`, `/api/review/:id/resolve`, `/api/eval/*` are open. Pre-hosting blocker → G3 (shared admin token / Cloudflare Access).
- **Low — residual approval race** (above); money-safe today.
- **Info — `checks.py` cosmetics:** `route_no_sql` globs only `apps/worker/src/routes/*.ts` and matches only `.prepare(`/`env.DB.batch(`; `check_tests` counts tracked files only.
- **Creds** — B1 (Cloudflare) and B2 (PayPal sandbox) still unblock `T-L2-001` and the deploy, and therefore the rest of the critical path.

## Files changed (working tree)

- **New:** `apps/worker/src/actions.ts`, `apps/worker/src/reconcile.ts`, `apps/worker/src/pipeline.test.ts`, `apps/worker/src/actions.test.ts`; `apps/web/src/widgets.ts`, `apps/web/src/data/reports.ts`, `apps/web/src/data/receivables-demo.ts`, `apps/web/src/components/{ReconciliationTile,ARAgingWidget,PnLByProductLine,ManagerialDashboard,LedgerScreen}.tsx`, `apps/web/src/data/reports.test.ts`, `apps/web/src/components/ManagerialDashboard.test.tsx`.
- **Modified:** `apps/worker/src/{pipeline,ledger,index}.ts`, `apps/worker/src/routes/{ledger,reports,review,webhooks,actions,eval}.ts`, `packages/contracts/api.ts`, `packages/contracts/fixtures/reconcile.json`, `evals/checks.py`, `apps/web/src/{App.tsx,format.ts}`, `apps/web/src/components/AppHeader.tsx`, `apps/web/src/styles/app.css`, `apps/web/README.md`.

## Resume / next

1. **Drop the creds** (Cloudflare API token/D1/Workers-AI + PayPal sandbox app) → unblocks `T-L2-001` (Clef spike) and the deploy, the whole remaining critical path. Then `T-L2-001` → `T-INT-005` (deploy) → live tie-out → `T-L5-005` (video).
2. Optionally fix the G3 auth gap, or re-run GATE now that level 2 is reached and P1 is 15/15.
3. Commit the working tree (nothing is committed yet).

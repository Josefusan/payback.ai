---
doc_id: payback-handoff
title: Handoff — resume here
version: 1.0.0
updated: 2026-10-07
supersedes: docs/16-r2-session-report.md (commit state), docs/status.md (gate state)
authority_order: CLAUDE.md → .claude/skills/hackathon-rules/SKILL.md → docs/15-roadmap.md → this file
related: [docs/15-roadmap.md, docs/16-r2-session-report.md, docs/04-submission-checklist.md]
---

# Handoff — Payback.ai

## TL;DR

- **Goal:** submit to the PayPal AI Hackathon. Internal deadline **Tue Nov 10, 18:00 PT**; hard deadline **Thu Nov 12, 12:00 PT**.
- **~40% done** (a judgment, grounded in the roadmap's R1 traceability table). The *code* is further along
  (~60–65%), but the outcome-deciding half — live gates, evals, video, submission — is what remains.
- **The whole critical path is blocked on two human credential steps** (B1, B2 below). Nothing on the path moves without them.
- Code is healthy: **100 worker tests, 42 web tests + build, 0 hard check failures, audit level 2 (81/90)**.
- **Resume = drop the creds**, then run §5 in order.

## 1. Where the code lives

| | |
|---|---|
| **VPS (the git repo)** | `joseph@13.140.171.233:~/Hackathons/paypal-hackathon` — branch `main`, HEAD `6596d99`, clean, **186 tracked files** |
| **Remote** | `https://github.com/Josefusan/payback.ai.git` — **private** (must go public for Rules §4) |
| **Mac mirror** | `~/Hackathons/paypal-hackathon` (**no `.git`** — a working mirror) |
| **Sync flow** | edit on the Mac → rsync to the VPS → commit/push **from the VPS** |
| **Hermes war room** | `~/.local/bin/hermes`, board `payback`; profiles `payback-{l1,l2,l3,l4,l5,int,gate}` |

**Path note.** The VPS reorg of 2026-10-06 (`~/FOLDER_STRUCTURE.md`, "one folder per venture at `~`") did
**not** move `~/Hackathons/` — the repo path is unchanged and everything still resolves. The separate
`~/.commandcode/plans/vps-folder-move-runbook.md` proposes an `~/apps|~/ops|~/lab` model that was
**never executed**; its §7 addendum is moot unless that reorg is run later.

## 2. Verified state (2026-10-07, measured on the VPS)

| Check | Command | Result |
|---|---|---|
| Repo | `git status --short` / `git log -1` | clean · `6596d99` |
| Worker typecheck | `npm run typecheck` | PASS |
| Worker tests | `npx vitest run` | **100 passed**, 1 skipped |
| Web tests | `npx vitest run` | **42 passed** |
| Web build | `npm run build` | PASS |
| Rules eval | `python3 evals/checks.py` | **0 hard failures**, 2 pending |
| Architecture | `python3 evals/architecture_audit.py` | **level 2**, 81/90 |
| Kanban | `hermes kanban --board payback list` | 13 done · 4 blocked |

## 3. R2 critical path — status

```
[creds] → T-L2-001 → T-L1-004 → T-L3-001 → T-L1-005 → T-L4-003 → T-L5-005 → submit
```

| Step | Status |
|---|---|
| `[creds]` B1/B2 | ⛔ **missing** |
| T-L2-001 Clef spike | ⛔ blocked on creds |
| T-L1-004 idempotent sync → queue | ✅ done |
| T-L3-001 opening balance + reconcile | ✅ done |
| T-L1-005 `executeProposal(..., {dryRun})` | ✅ done |
| T-L4-003 dashboard widgets | ✅ done |
| T-L5-005 video | ⬜ not started |
| Audit G1 blockers (T-L3-007 / L1-008 / INT-006 / INT-007) | ✅ done |

## 4. Blockers — the gate everything waits on

| id | Blocker | Unblocks | Action (owner: Joseph) | Default if late |
|---|---|---|---|---|
| **B1** | Cloudflare auth + D1 `payback` + Workers AI | T-L2-001, T-INT-005 | `wrangler login` (or mode-600 `CLOUDFLARE_API_TOKEN`); `wrangler d1 create payback`; enable Workers AI | ship `fallback-llm`, disclose |
| **B2** | PayPal sandbox app (Transaction Search, Invoicing, Payouts) | T-L1-002, T-L1-003 | create app; write `PAYPAL_CLIENT_ID`/`SECRET` to `apps/worker/.dev.vars` | seed from fixtures, disclose |
| B3 | Entrant type + Representative | G6 submit | pick individual / team / CTV LLC | individual |
| B4 | AG Studio key to Dec 15 | AG Grid prize | request key; else trial | activate trial Oct 31 |

**Oct 9 trigger:** no B1/B2 by Oct 9 → ship the `fallback-llm` path and disclose in the README.

## 5. Next actions, in order

1. **Drop the creds** (B1 + B2). Everything below is otherwise blocked.
2. **T-L2-001 — Clef spike** → `docs/clef-response-sample.json`; correct `apps/worker/src/clef.ts` types if the live shape differs.
3. **T-INT-005 — deploy:** `cd apps/worker && npx wrangler deploy` → `*.workers.dev`; paste `database_id` into `wrangler.jsonc`; `wrangler secret put` the PayPal secrets. A public URL also unblocks **T-L1-003** (webhook verify + dedupe + enqueue).
4. **T-L1-002 — seed script v0** (orders, refund, invoices, payout, dispute) → append ids to `docs/sandbox-activity.md`.
5. **Live opening-balance tie-out** (T-L3-001) against real sandbox Balances — the #1 on-camera risk.
6. **Fix the G3 auth gap** (Med, pre-hosting): `POST /api/actions/:id/approve` executes a real sandbox payout with no auth; `/api/sync`, `/api/review/:id/resolve`, `/api/eval/*` are open. Add a shared admin token or Cloudflare Access. **(done 2026-10-07 — shared `ADMIN_TOKEN`, see §9; set it with `wrangler secret put ADMIN_TOKEN` at deploy.)**
7. **Run the never-run evals** — `product_evals.py` and `llm_judge.py`. Every precision/safety/judge claim (A10/A11/A12) is currently **unfalsified**: `evals/out/` has no `product.json` and no `judge.md`. Grow the dataset 30 → ≥150 rows (≥30% held out).
8. **T-L5-005 video** (≤2:50, public YouTube) + T-L5-003 Devpost description + T-L5-004 Postman. Storyboard early — the video is the product.
9. **Flip the repo public**; MIT `LICENSE` in About; `python evals/checks.py --github Josefusan/payback.ai` → PASS.
10. **Submit** on Devpost by Nov 10 (not a draft) — screenshot the confirmation.

## 6. How to run it

```bash
cd ~/Hackathons/paypal-hackathon
# worker
(cd apps/worker && npm run typecheck && npx vitest run)
# web
(cd apps/web && npx vitest run && npm run build)
# evals
python3 evals/checks.py
python3 evals/architecture_audit.py
python3 evals/dod.py --gate G1
# war room
~/.local/bin/hermes kanban --board payback list
```

## 7. The review loop

Work is done by **DeepSeek sub-agents on disjoint file sets** (the repo's lane model), then **one combined
verification pass**, then handed to the **Hermes `payback-gate`** profile for an audit (correctness +
security + architecture). Findings are fixed by a second sub-agent round, then re-reviewed. Prior gate
reviews: `t_41337658` (PASS + 8 findings), `t_b302c99e` (PASS + 2 Low).

## 8. Open decisions

- **Q1** — entrant type + Representative (needed before G6).
- **G3 auth** — shared admin token vs Cloudflare Access.
- **Runbook reorg** — the `~/apps|~/ops|~/lab` move was never run; decide whether it still happens, or retire the runbook.

## 9. Carried-over findings (not gate blockers)

- **Med — mutating endpoints unauthenticated.** *(Addressed 2026-10-07.)* A shared `ADMIN_TOKEN` now gates `POST /api/sync`, `/api/review/:id/resolve`, `/api/actions/:id/approve` and `/api/eval/*` via `apps/worker/src/auth.ts` (`requireAdmin`, fail-closed 503 when unset, `X-Admin-Token` or `Authorization: Bearer`). Read-only GETs stay open for the judge dashboard. Set `wrangler secret put ADMIN_TOKEN` at deploy; run `product_evals.py` with `PAYBACK_ADMIN_TOKEN` exported. Pending a GATE re-review.
- **Low** — residual concurrent-approval race; money-safe via the deterministic `PayPal-Request-Id` (a second PayPal call still moves money only once).
- **Info** — `checks.py` cosmetics: `route_no_sql` globs only `apps/worker/src/routes/*.ts`; `check_tests` counts tracked files only.

## 10. Deadlines

| Date | What |
|---|---|
| **Oct 9** | creds trigger — else ship `fallback-llm` + disclose |
| **Oct 31** | activate AG Studio trial (AG Grid prize survives to Dec 15) |
| **Nov 10, 18:00 PT** | internal submit |
| **Nov 12, 12:00 PT** | hard deadline |
| **Dec 15** | demo must stay live |

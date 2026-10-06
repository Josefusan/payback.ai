---
doc_id: payback-roadmap
title: Finish roadmap — PayPal AI Hackathon 2026
version: 1.0.0
updated: 2026-10-06
submission_deadline: 2026-11-12T12:00:00-08:00   # Thu Nov 12, 12:00 pm PT (Rules §1)
internal_deadline: 2026-11-10T18:00:00-08:00     # Tue Nov 10, 6:00 pm PT
authority_order: CLAUDE.md → .claude/skills/hackathon-rules/SKILL.md → docs/13-build-plan.md → this file
sources: [docs/01-official-rules.md, docs/02-judging-and-success.md, docs/03-prizes-and-strategy.md, docs/04-submission-checklist.md, docs/10-timeline.md, docs/13-build-plan.md]
related: [docs/13-build-plan.md, docs/14-production-audit.md, docs/status.md]
current_gate: G1
---

# Finish roadmap

Requirement-driven plan to take Payback.ai from **G0 green / G1 in progress** to a **submitted entry**
by Nov 10 (internal). The build plan (`docs/13-build-plan.md`) owns *what* each task is; this file owns
*the sequence, the requirement coverage, and the date-based defaults*. Status legend:
✅ done · 🟡 in progress · ⛔ blocked · ⬜ not started.

## R0. Where we are (2026-10-06)

- **G0 green.** 8 commits on `main`; `index.ts` mounts only; contracts + fixtures + env process in place.
- **G1 in progress.** Lane tasks done: T-L1-001 (PayPal client), T-L2-002 (DecisionProvider), T-L3-002
  (postEntry/reverseEntry), T-L4-001 (dashboard scaffold), T-L5-001 (claims ledger), T-INT-* env/plan.
- **G1 blocked on human credentials** — T-L2-001, T-L1-002, T-L1-003, T-INT-005 (4 cards). Nothing on the
  critical path moves without R4.
- **First production audit: 69-70/90, ladder level 1.** P1 SoC = 7/15 (High) — inline SQL in 4 route
  files. Remediation filed as T-L3-007, T-L1-008, T-INT-006, T-INT-007.

## R1. Hard requirements → evidence (traceability)

Every row must be ✅ at submit. Rule refs are to `docs/01-official-rules.md`.

| # | Requirement (source) | Must be true | Owning tasks | Evidence artefact | Status |
|---|---|---|---|---|---|
| A1 | PayPal + AI, PayPal **central** (Rules §4, §6 Stage 1) | ≥ 4 PayPal capabilities used live in sandbox; AI load-bearing | T-L1-001/003/004/005/006, T-L2-002 | `evals/checks.py`, `submission/claims.md` | 🟡 1/4 wired |
| A2 | Functional demo judges can run (Rules §4.3) | Hosted URL **and** README setup | T-INT-005, T-L5-002 | deployed URL, `README.md` | ⛔ blocked (Cloudflare) |
| A3 | Public GitHub repo + **license in About** (Rules §4.4) | Repo public, MIT `LICENSE` visible | T-GATE-001, G6 | repo About, `LICENSE` | ⬜ repo private |
| A4 | Text description (Rules §4.2) | Problem, audience, features, tools-used | T-L5-003 | `submission/devpost-description.md` | ⬜ |
| A5 | Video < 3:00, public YouTube (Rules §4.5) | ≤ 2:50, live sandbox, no logos/music | T-L5-005 | `submission/video.json` | ⬜ |
| A6 | Sandbox only, no secrets, no live money (Rules §4, anti-patterns) | `PAYPAL_ENV=sandbox`; secret scan clean | T-INT-003, T-GATE-001 | `evals/checks.py` | ✅ enforced in code |
| A7 | "Function as depicted" (Rules §4) | Every claim backed by `file:line`/eval | T-L5-001 | `submission/claims.md` | 🟡 keep in sync |
| A8 | Demo free & available until Dec 15 (Rules §4) | Hosted demo + creds up post-submit | T-INT-005 | status note | ⬜ |
| A9 | Ledger invariants: Σdebit=Σcredit, tie to Balances ±$0.01 (S6) | Never unbalanced on camera | T-L3-001/002/006 | worker tests, `GET /api/reconcile` | 🟡 postEntry done, opening balance ⬜ |
| A10 | Simulated panel mean ≥ 8.5, min ≥ 7.5, presentation ≥ 8.5 (S2) | Judge rubric green | T-GATE-002 | `evals/out/judge.md` | ⬜ |
| A11 | Precision ≥ 97%, review ≤ 25%, ECE ≤ 0.05 (S3/S4) | Calibrated, verifiable | T-L2-003 | `evals/out/product.json` | ⬜ dataset 30/150 |
| A12 | 0 money-moving actions on adversarial input (S7) | Safety eval on the **prod** code path | T-L1-005, T-L2-005 | `evals/out/product.json` | ⬜ |
| A13 | Sponsor prize: **AG Grid** (Rules §8) | Custom widgets + theming + Studio Agent Framework | T-L4-003/004/005 | `apps/web/**` | 🟡 scaffold |

## R2. Critical path

```
[R4 creds] → T-L2-001 → T-L1-004 → T-L3-001 → T-L1-005 → T-L4-003 → T-L5-005 → G6 submit
                Clef      pipeline   opening     execute    dashboard    video
                spike                balance     proposal   widgets
```
Parallel off-path tracks that must stay green: T-INT-005 deploy (G1), T-L3-003 audit trail (G2),
T-L2-003 dataset (G2), T-L2-005 injection guard (G3), audit remediation T-L3-007/T-L1-008/T-INT-006/-007.

## R3. Phased plan

### Week 1 · Oct 7–11 · **G1 Spikes** — ⛔ blocked on R4
- L2: T-L2-001 Clef spike → `docs/clef-response-sample.json` (correct `clef.ts` types if they differ).
- L1: T-L1-002 seed script (orders, refund, invoices, payout, dispute) → `docs/sandbox-activity.md`.
- L1: T-L1-003 webhook verify + dedupe + enqueue (needs deployed URL).
- INT: T-INT-005 deploy to `*.workers.dev`; T-INT-006 `app.onError`; T-INT-007 promote `route_no_sql`.
- L3/L1: T-L3-007 + T-L1-008 move inline SQL into domain functions (audit R1).
- **Exit:** audited `python evals/architecture_audit.py` → no pillar < 9; G1 checks pass.

### Week 2 · Oct 12–18 · **G2 End-to-end on seeded data**
- L1: T-L1-004 idempotent sync → queue pipeline.
- L3: T-L3-001 opening-balance entry + reconcile pending bucket; T-L3-003 hash-chained audit trail;
  T-L3-004 reports SQL; T-L3-006 ledger template tests.
- L2: T-L2-003 grow dataset to ≥ 150 rows, ≥ 30% held out.
- L4: T-L4-002 review queue + `DecisionCell` on live data.
- L5: T-L5-002 README judge sections + tools-used table.
- **Exit:** one `POST /api/sync` yields decisions, balanced entries, review rows, audit events;
  contract test green; first `llm_judge.py` run recorded.

### Week 3 · Oct 19–25 · **G3 Agentic actions**
- L1: T-L1-005 one `executeProposal(env, proposal, {dryRun})` for prod + eval (kills the in-memory Map);
  T-L1-006 invoice reminder + vendor payout via approval route; T-L1-007 queue consumer.
- L2: T-L2-004 threshold sweep (reuse `gateDecision`); T-L2-005 injection guard (`txn-v2`), safety set ≥ 30.
- **Exit:** both actions execute in sandbox with PayPal ids; `product_evals.py --safety` → `critical_failures: []`.
- **Start video storyboard** now — the video is the product.

### Week 4 · Oct 26–Nov 1 · **G4 Product & dashboard**
- L4: T-L4-003 managerial widgets; T-L4-004 `ConfidenceDial`; T-L4-005 Controller agent (Studio Agent Framework);
  T-L4-006 blocked-attempts grid + Explain drawer.
- L3: T-L3-005 close workflow + CFO memo (numbers from SQL only).
- L5: T-L5-003 Devpost description + demo script; T-L5-004 Postman collection.
- Human: **activate AG Studio trial on/after Oct 31** (Q3) so it survives to Dec 15.
- **Exit:** dashboard on live data; architecture audit re-run, every pillar ≥ 12/15.

### Week 5 · Nov 2–8 · **G5 Polish & proof**
- Hosted demo live from worker static assets; fresh-clone → running ≤ 10 min by a non-builder.
- `python evals/llm_judge.py --strict` → mean ≥ 8.5, min ≥ 7.5, presentation ≥ 8.5.
- T-L5-005 record video (≤ 2:50), upload public YouTube, fill `submission/video.json`.
- **Exit:** all evals green; `docs/audit.md` current.

### Week 6 · Nov 9–10 · **G6 Submit**
- Repo public; MIT `LICENSE` in About; `python evals/checks.py --github Josefusan/payback.ai` → PASS.
- Devpost: entrant type + Representative, tools section, screenshots, sponsor opt-ins (AG Grid; APIMatic).
- **Submit by Tue Nov 10 6pm PT** (not draft) — screenshot the confirmation.
- Nov 11–12: buffer, fixes only. Keep the demo alive through Dec 15.

## R4. Human blockers — the gate everything waits on

| id | Blocker | Unblocks | Action (owner: Joseph) | Default if late |
|---|---|---|---|---|
| B1 | Cloudflare auth (`wrangler login` or mode-600 `CLOUDFLARE_API_TOKEN`), D1 `payback`, Workers AI on | T-L2-001, T-INT-005 | Create token on VPS; `wrangler d1 create payback`; enable Workers AI | Ship `fallback-llm` (Q2) and disclose in README |
| B2 | PayPal sandbox app (Transaction search, Invoicing, Payouts) → `apps/worker/.dev.vars` | T-L1-002, T-L1-003 | Create app at developer.paypal.com | Seed with fixtures; disclose |
| B3 | Entrant type + Representative (Q1) | G6 submission | Pick individual / team / CTV LLC | Individual (Mises) |
| B4 | AG Studio key to Dec 15 (Q3) | AG Grid prize | Ask AG Grid Discord; else trial | Activate trial Oct 31 |

**B1 and B2 are the single highest-leverage actions in this roadmap.** Everything on R2 stalls without them.

## R5. Prize strategy (Rules §8)

- **Primary slot:** Grand (1st, $12k) — PayPal-central, AI load-bearing, real impact.
- **HM fallback:** Best Use of PayPal + AI, or Most Impactful ($5k).
- **Sponsor (pick one):** **AG Grid** (5 winners; an accounting product *is* a data grid) — require custom
  widgets + theming + Studio Agent Framework `delegate_to` Controller agent, not default grids.
  **APIMatic** is the fallback — use the Context Plugin while building the PayPal client anyway.
- **Stacking rule:** at most one Grand + one Sponsor, or one HM + one Sponsor.
- **Agentic Commerce HM** is in play if alternative-awareness executes on camera (`Payouts` + `Invoicing` + dispute triage).

## R6. Risk register

| Risk | Trigger to watch | Mitigation |
|---|---|---|
| Creds arrive late | No B1/B2 by **Oct 9** | Ship `fallback-llm` path; disclose; keep building off fixtures |
| Clef response shape differs from docs | G1 spike | Wrap behind `DecisionProvider`; correct `clef.ts` types; `fallback-llm` |
| Opening-balance tie-out fails on camera (Fable #1) | G2 | T-L3-001 posts opening entry from Balances `as_of_time`; reconcile shows pending bucket |
| Calibration claim unverifiable | G2 | T-L2-003 → 150 labeled rows, ≥ 30% held out |
| Safety eval measures dead code (Fable #3) | G3 | T-L1-005 shares `executeProposal(..., {dryRun})`; no in-memory dedupe |
| AG Studio trial expires before Dec 15 | Oct 31 | Activate no earlier than Oct 31; request hackathon key |
| Sandbox Transaction Search ~3h lag | G1–G2 | Seed via Orders/Invoices/Payouts + webhooks for real-time |
| Audit P1 < 9 blocks G1 exit | G1 | Land T-L3-007 / T-L1-008 / T-INT-006 / T-INT-007 |
| Video squeezed at the end | W4 | Storyboard from W3; record W5; ≤ 2:50 |

## R7. Quality gates (evals)

| Layer | Command | Cadence | Target |
|---|---|---|---|
| Rules | `python evals/checks.py` | every PR | 0 hard failures |
| Product | `python evals/product_evals.py --worker … --safety` | daily W2+ | precision ≥ 97%, review ≤ 25%, ECE ≤ 0.05, 0 critical |
| Judge | `python evals/llm_judge.py --strict` | weekly + pre-video + pre-submit | mean ≥ 8.5, min ≥ 7.5, presentation ≥ 8.5 |
| Architecture | `python evals/architecture_audit.py` | G1/G4/G5 | no pillar < 9 (G1); every pillar ≥ 12/15 (G4+) |

## R8. Cut lines (if behind schedule — drop top-down, never A6/A7/A9/A12)

1. `feature-ai-gateway-loop`, `feature-shadow-mode`, `feature-accounting-export` (parked).
2. `feature-receipt-vision`.
3. Bryntum/Elastic extras.
4. T-L4-004 ConfidenceDial → static screenshot in video (still backs the Innovation claim).

**Never cut:** audit trail (`feature-audit-trail`), injection guard (`feature-injection-guard`), the
opening-balance tie-out, or the safety eval — each backs a judging claim.

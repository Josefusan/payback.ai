---
doc_id: payback-production-audit
title: Production architecture audit — process
version: 1.0.0
updated: 2026-10-06
skill: .claude/skills/production-architecture-audit/SKILL.md
agent: .claude/agents/architecture-auditor.md
script: evals/architecture_audit.py
artifacts: [evals/out/audit.json, docs/audit.md]
cadence_gates: [G1, G4, G5]
related: [docs/13-build-plan.md §3, docs/09-architecture.md, .claude/skills/run-evals/SKILL.md]
---

# Production architecture audit — process

Quality control that keeps Payback.ai **production grade**, not just demo grade. It answers two
questions the judging evals do not: *where does this system sit on the boundary ladder*, and *does it
score ≥ 12/15 on each of the six engineering pillars*. Source framework:
`.claude/skills/production-architecture-audit/` (boundary ladder + six-pillar checklist).

## AUD-1. When it runs

- **Every gate G1, G4, G5** — a full audit (see `docs/13-build-plan.md` §3). Written into the gate's
  exit checks; the gate is not green until `docs/audit.md` exists for that gate.
- **On demand** — any lane, before a big refactor, or when someone asks "is this production grade?".
- **Weekly with the judge panel** — `eval-judge` folds the audit's High-priority fixes into its ranked
  top-fixes list.

## AUD-2. Who runs it

| Runner | Where | Role |
|---|---|---|
| `architecture-auditor` agent | Claude Code / any agent reading `.claude/agents/` | Runs the mechanical script, scores the metrics, writes `docs/audit.md`. **Read-only on product code.** |
| `payback-gate` profile | Hermes war room | Runs the same script + audit skill as a kanban card (`AUD-Gx`); reports findings only. |

The auditor judges; it never edits product code. Fixes are ordinary lane tasks produced by the audit.

## AUD-3. How to run

```bash
python evals/architecture_audit.py          # mechanical layer → evals/out/audit.json (stdlib, no network)
python evals/checks.py                       # rules gates (unchanged)
```

Then the auditor agent (or `payback-gate`) reads `evals/out/audit.json`, scores every `manual` metric
by reading the code, and writes `docs/audit.md` in the SKILL output order.

## AUD-4. Artefacts

- `evals/out/audit.json` — machine-readable: ladder level, per-pillar metrics with mechanical
  evidence, `floor` per metric, final scores, `total`, `generated_at`. Gitignored (like `evals/out/`).
- `docs/audit.md` — the human report, committed. Order: **Where this sits → Gold standard vs floor →
  Six-pillar scorecard → Remediation → Do not do.** One section per gate run, newest first.

## AUD-5. Scoring rules

- Six pillars × three metrics (Architecture Alignment, Operational Implementation, Failure Mode
  Preparedness), each metric scored **1-5**, pillar target **≥ 12/15**, total **/90** (or **/75** if
  the client/State pillar is scored n/a because there is no client).
- The mechanical script sets a **floor** per metric: all its checks pass → floor 5; some → 3; none →
  1. The auditor may raise above the floor only with cited evidence and may not fall below it without
  naming the evidence that contradicts a check.
- Priority: pillar `< 9` → **High**, `9-11` → **Med**, `≥ 12` → **Low**.

## AUD-6. Boundary ladder (keep these words verbatim)

Level 0 no boundary (prototypes) · Level 1 data-access layer per table (**the floor**) · Level 2
modular monolith (**gold standard here**) · Level 3 microservices/database-per-service (**do not**).
Clean/hexagonal architecture and DDD are **not** separate rungs — they describe how to build level 2
well. The Payback-specific reading (current level, the exact gap, the one mechanical rule) lives in
`.claude/skills/production-architecture-audit/references/payback-reading.md`.

## AUD-7. The one mechanical boundary rule

> No file under `apps/worker/src/routes/` may contain `.prepare(` or `env.DB.batch(`.

Routes are transport; domain modules (`ledger.ts`, `reports.ts`, `clef.ts`, `paypal.ts`, …) own their
tables. Enforced by `route_no_sql` in `evals/architecture_audit.py`. This is the single rule that keeps
the modular monolith from eroding back to level 1.

## AUD-8. Definition of done for an audit

- `python evals/architecture_audit.py` run; `evals/out/audit.json` regenerated.
- Every pillar has all three metrics scored (no metric left `manual` in the final `audit.json`).
- `docs/audit.md` written for this gate, with remediation as concrete `file:line` fixes and each
  boundary fix tied to a ladder change.
- Any pillar `< 9` has at least one remediation task filed on the board (owner + `T-<lane>-<nnn>`).

## AUD-9. Do not do

Do **not** recommend microservices / database-per-service to raise a score. Level 3 makes every join a
network call and every journal posting a distributed transaction — worse for one team on one D1. Fix
the boundary at level 2 instead. Do not add a metric or a pillar; score the six that exist.

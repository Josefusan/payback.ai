---
name: production-architecture-audit
description: "Run a production-grade architecture audit using the Zevar i boundary ladder (levels 0-3) and the six-pillar engineering checklist. Use when the user says architecture audit, production-grade audit, modular monolith, separation of concerns scorecard, expand/contract migration, where this sits, gold standard vs floor, or asks to score an app against the audit PDF."
type: workflow
lifecycle: active
---

# Production Architecture Audit — Command

Run this as a command. Do not summarize the framework and stop. Score the system the user named, or ask once for the target if none is named.

Read `references/boundary-ladder.md` before judging module boundaries. Read `references/audit-pillars.md` before scoring. Quote those files; do not invent extra pillars.

## Command

`/production-architecture-audit [target]`

Target is a codebase, design, plan, or the Zevar i plan itself. If the user attached a plan or screenshot, that attachment is the target.

## Output shape

Write in this order. Keep the user's product names (Zevar i, `global_leads`, Campaigns, Leads, Senders, Safety) when the target is that system.

1. **Where this sits** — one level, 0 through 3, from the ladder. Name the level, quote what it looks like, say who it suits, and say what would move it one rung. Do not treat clean/hexagonal architecture or DDD as extra rungs.
2. **Gold standard vs floor** — floor is level 1. Gold standard for a single team at Zevar i's size is level 2. Level 3 is too much unless many independent teams already exist. Say which of the three adoption changes are missing.
3. **Six-pillar scorecard** — one table. Score each metric 1-5. Pillar score is the sum, target ≥ 12/15. Priority is High if pillar < 9, Med if 9-11, Low if ≥ 12.
4. **Remediation** — only the failing criteria. Tie each fix to a ladder change when it is a boundary problem.
5. **Do not do** — name the level above the gold standard that would make the system worse, and why.

## Scoring rules

Score only what evidence supports. Empty evidence is a 1, not a 3.

| Metric | 1 | 3 | 5 |
|---|---|---|---|
| Architecture Alignment | Criterion absent from the design | Named, not enforced | Named and structurally enforced |
| Operational Implementation | Not in the running system | Partial / convention only | In code, CI, or schema today |
| Failure Mode Preparedness | Failure mode unhandled | Detected after the fact | Failure isolated, rolled back, or degraded on purpose |

Pillar cumulative = sum of the three metrics. Total = sum of six pillars, out of 90. The source PDF summary says "/ 30 Points Total". That conflicts with six pillars at 15 each. Use /90. Do not copy the PDF's medical disclaimer; it is not part of the audit.

## Boundary rules (from the ladder)

- Level 0: raw SQL against any table from anywhere. Prototypes only.
- Level 1: one module owns a hot table's SQL; callers use functions. Floor for any production app.
- Level 2: domains own tables; other domains call the public interface, never the tables. One codebase, one database, one deploy. Gold standard here.
- Level 3: database per service over the network. Only for many independent teams. Every join becomes a network call; every transaction becomes distributed.
- Group by domain, not by table. `campaigns` and `campaign_targets` belong in Campaigns. Lead identity, dedupe, and research belong in Leads.
- Enforce with one mechanical rule, not a convention. Example: the string `global_leads` may only appear inside `packages/leads/`.
- Schema changes expand/contract behind the module: add column, write both, switch reads, drop old, each step one release apart.

## Pillar index

Score all six. Criteria text lives in `references/audit-pillars.md`.

| Pillar | Question the score must answer |
|---|---|
| 1. Separation of Concerns | Does UI lack business logic, does each module own one domain, are cross-cuts isolated, do domains avoid compile-time deps on adapters? |
| 2. Data Modeling & Persistence | Normalized storage, verified indexes, real transactions, capped pools plus cache? |
| 3. State Management | Single client source of truth, predictable mutations, cache conflict handling, state outside volatile views? |
| 4. APIs and Interfaces | Formal contracts, DTO sanitising, idempotency keys, rate limit plus schema validation? |
| 5. Data Migrations & Versioning | Expand/contract, git-managed rollback, backward-compatible API versions, verified batch transforms? |
| 6. Scalability & Resilience | Stateless instances, circuit breakers, background workers, autoscaling before the ceiling? |

Skip pillar 3 only if the target has no client. Say so, score it n/a, and total out of 75.

## Zevar i default reading

If the user does not supply a newer design, use the ladder's own labels: level 0 is Zevar i today; level 1 is the plan; level 2 is the gold standard not yet adopted. The three changes in `references/boundary-ladder.md` are the remediation, not optional advice.

## Target readings

Target-specific readings ship next to this file in `references/*.md`. When the audit target is
**Payback.ai** (the PayPal AI Hackathon entry — Cloudflare Worker + `apps/web`), read
`references/payback-reading.md` first: it fixes the current ladder level, the exact level-1 artefact,
the one mechanical boundary rule, and the six-pillar evidence. The "Zevar i default reading" above does
not apply to that target.

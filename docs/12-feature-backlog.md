# Feature backlog — add-on features with build-spec skills

Each feature has a skill in `.claude/skills/feature-*/SKILL.md` (spec, data model, API, UI, acceptance criteria). The owning subagent builds it; the strategist schedules it. MVP comes first (sync → Clef → ledger → review → ≥2 PayPal actions → dashboard); these slot in from Week 2–4.

| # | Feature | Skill | Lead agent | Support | Migration | Target week | Judge impact |
|---|---|---|---|---|---|---|---|
| 1 | Audit trail (hash-chained, explain drawer) | `feature-audit-trail` | ledger-accounting-engineer | agentic-workflow-engineer, frontend-aggrid-engineer | `0002_audit.sql` | Wk 2 (first — others write to it) | Tech, Design, Impact |
| 2 | Injection guard + red-team set | `feature-injection-guard` | agentic-workflow-engineer | security-reviewer | — | Wk 2–3 | Agentic Commerce, Tech, Presentation |
| 3 | Confidence Dial | `feature-confidence-dial` | clef-decision-engineer (API) | frontend-aggrid-engineer (widget) | `0003_confidence_dial.sql` | Wk 3–4 | Tech, Design, Innovation, AG Grid prize |
| 4 | Receipt/bill vision → Payout | `feature-receipt-vision` | clef-decision-engineer | agentic-workflow-engineer, frontend-aggrid-engineer | `0004_bills.sql` | Wk 3–4 | Innovation, PayPal + AI |
| 5 | Shadow mode | `feature-shadow-mode` | clef-decision-engineer | frontend-aggrid-engineer | `0005_shadow.sql` | Wk 4 | Tech |
| 6 | Accounting export (CSV/QBO-style/TB) | `feature-accounting-export` | ledger-accounting-engineer | frontend-aggrid-engineer | — | Wk 4 | Impact, Design |
| 7 | AI Gateway learning loop | `feature-ai-gateway-loop` | clef-decision-engineer | agentic-workflow-engineer | — | Wk 4–5 | Tech, Innovation |

**Migration numbers are reserved** as above so parallel agents don't collide. Build order: 1 → 2 → 3 → 4 → (5, 6, 7 as time allows). Cut from the bottom if behind schedule; never cut 1 or 2 (they back our safety claims).

**Definition of done (every feature):** acceptance criteria in its skill ✅ · `npm run typecheck && npm test` ✅ · `python evals/checks.py` ✅ · product/safety evals not regressed · README "How PayPal and AI are used" row updated only when it works · `docs/status.md` updated.

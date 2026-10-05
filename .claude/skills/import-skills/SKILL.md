---
name: import-skills
description: How to import external Claude Code skills and plugins that help win this hackathon (PayPal AI-Toolkit, APIMatic Context Plugins, AG Grid skills, Cloudflare, Postman, Elastic, Kernel, Render) — exact install commands, what each adds, which subagent should use it, and the vetting rules before installing anything. Use when setting up a teammate's machine, onboarding a new agent, or when an agent lacks domain context that a vendor skill provides.
---

# Importing skills & plugins

## Vetting rules (always)
1. Prefer **official vendor** repos/marketplaces (paypal, apimatic, ag-grid, cloudflare, postmanlabs, elastic, kernel, render).
2. Read the plugin's `SKILL.md`/hooks/commands **before** enabling — hooks run code on your machine.
3. Plugins/skills never receive secrets via files in this repo. Tokens go in the human's own `~/.claude/settings.json` `env` or shell env.
4. Record every installed plugin + version in `docs/tooling.md` so judges/teammates can reproduce.
5. Project skills in `.claude/skills/` are ours; vendor skills stay user-level unless we vendor them with a compatible license and attribution.

## Install matrix
| Priority | What | Install (inside Claude Code unless noted) | Gives | Used by |
|---|---|---|---|---|
| **P0** | PayPal AI-Toolkit | `/plugin install paypal@claude-plugins-official` then `/reload-plugins` (or `git clone https://github.com/paypal/AI-Toolkit.git && claude --plugin-dir ./AI-Toolkit`) | `/paypal:doctor`, `/paypal:explain-error`, `/paypal:sandbox`, `/paypal:test-accounts`, `/paypal:setup`; `paypal-best-practices` skill; sandbox MCP (needs `PAYPAL_SANDBOX_ACCESS_TOKEN`) | paypal-integration-engineer, agentic-workflow-engineer |
| **P0** | APIMatic Context Plugin | `/plugin marketplace add apimatic/plugin-marketplace` → `/plugin install context-matic@apimatic` → `/reload-plugins` (alt CLI: `npx context-plugins install paypal`) | Version-matched PayPal Server SDK context (`fetch_api`, `ask`, `endpoint_search`, `model_search`); optional `acp-paypal` plugin with `/integrate-paypal` | paypal-integration-engineer — **qualifies us for APIMatic offer; note usage in README** |
| **P0** | AG Grid skills | shell: `npx skills add ag-grid/skills` | `ag-dev`, `ag-update` skills for Grid/Charts/Studio | frontend-aggrid-engineer |
| P1 | Cloudflare Skills plugin | `/plugin marketplace add cloudflare/skills` (or shell: `npx skills add https://github.com/cloudflare/skills`) | Cloudflare skills + slash commands + bundled Cloudflare MCP servers | clef-decision-engineer, backend |
| P1 | Postman plugin | `/plugin marketplace add postmanlabs/postman-plugin` → `/plugin install postman@postman` | Collections, API tests from Claude Code | qa / submission |
| P2 | Elastic agent skills | `claude plugin marketplace add https://github.com/elastic/agent-skills` → `claude plugin install elastic-elasticsearch@elastic-agent-skills` | ES|QL, index design | only if Elastic added |
| P2 | Kernel skills | `/plugin marketplace add kernel/skills` → `/plugin install kernel-cli` / `kernel-sdks` | cloud browsers | only if needed |
| P2 | Render plugin | `/plugin install render@claude-plugins-official` | deploy/logs via MCP | only if pivot to Render |
| P2 | Bryntum skill | *(install command not found — see https://bryntum.com/agents/)* | Calendar/Scheduler | only if Bryntum added |

## Our own skills (already in repo, auto-discovered from `.claude/skills/`)
hackathon-rules · hackathon-success · paypal-sdks · cloudflare-clef · cloudflare-workers · managerial-accounting · sponsor-tools · import-skills · mcp-servers · run-evals · demo-submission
Feature build specs: feature-audit-trail · feature-injection-guard · feature-confidence-dial · feature-receipt-vision · feature-shadow-mode · feature-accounting-export · feature-ai-gateway-loop

## Other agent runtimes
- **Codex / Cursor / generic agents:** read `AGENTS.md` (root) — it points to the same skills; skills are plain Markdown and can be pasted as context.
- **Claude.ai / Cowork:** upload a skill folder as a custom skill, or paste `SKILL.md` into project knowledge (the Drive copy of these files is for that).

## After installing
Run `/paypal:setup` and `/mcp` to confirm servers are connected; then `python evals/checks.py` to make sure nothing secret landed in the repo.

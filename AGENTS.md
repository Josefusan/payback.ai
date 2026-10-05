# AGENTS.md

This repo is set up for AI coding agents (Claude Code, Codex, Cursor, others).

- **Primary instructions:** `CLAUDE.md` (applies to every agent, not just Claude).
- **Skills** (plain Markdown, usable by any agent as context): `.claude/skills/*/SKILL.md` plus linked reference files.
- **Role prompts** for subagents: `.claude/agents/*.md` — if your tool has no subagents, paste the relevant role file as the system/task prompt.
- **MCP servers:** `.mcp.json` (Claude Code); see `.claude/skills/mcp-servers/SKILL.md` for other clients.
- **Definition of done:** `python evals/checks.py` passes; worker `npm run typecheck && npm test` pass; product/safety evals meet targets in `docs/02-judging-and-success.md`.

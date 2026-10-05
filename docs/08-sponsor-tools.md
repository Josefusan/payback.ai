# Sponsor Tools — offers, prize criteria, packages, MCP

Researched 2026-10-05 from the Devpost sponsor pages and sponsor docs. Items marked *(unverified)* need a check before use.
Sponsor tools are optional. Only **AG Grid, APIMatic, Bryntum, Channel3, Render** have prizes. We can win **one** sponsor prize.

## AG Grid / AG Studio — PRIMARY sponsor target
- **Prize:** $5,000 / $2,000 / 3 × $1,000. Judge: Sylwia Vargas.
- **Criteria (verbatim):** "This award covers both what your dashboard looks like and how you build it. Show us polish: custom widgets, theming, and layout tools, not just AG Grid or AG Charts on their own. Take Studio Agent Framework for a spin: a custom agent talking to Studio's built-in agents, or a swapped-in harness."
- **Offer:** free 45-day AG Studio trial license — https://www.ag-grid.com/studio/license-pricing/ (install: https://www.ag-grid.com/studio/react/licence-install/)
- **Boilerplate:** https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate (Next.js + TS + `@paypal/paypal-server-sdk`; Transaction Search, Subscriptions, Balances; ships AGENTS.md/CLAUDE.md). `npm install && cp env.example .env.local && npm run dev` (Node ≥ 20.9).
- **Package:** `npm install ag-studio-react` (React). Minimal: `<AgStudio data={data} mode="edit" />`.
- **Custom widgets:** `AgWidgetDefinition` (id, comp, dataMapping, form, `formatShape` — lets the AI use the widget) registered via `createWidgets({ additionalTypes, menu })`; theming `studioGridTheme`, `getChartTheme(api)`; cross-filter `toggleCrossFilter()`.
- **Studio Agent Framework:** runners `directLlmRunner`, client-tool runner, custom runner; agent = id, name, description, schema, `instructions()`, `tools()` (e.g. `studio.viewSchema()`, `studio.executeQuery()`), `defaultToolCalls`, `maxTurns`; harness roster with one `primary`; handoff via `delegate_to`; AG-UI event vocabulary. Docs: https://www.ag-grid.com/studio/react/ai-agents/
- **MCP (docs):** `claude mcp add ag-mcp npx ag-mcp` — tools: search_docs, detect_version, set_version, list_versions.
- **Skills:** `npx skills add ag-grid/skills` (ag-dev, ag-update).
- Docs: https://www.ag-grid.com/studio/react/quick-start/ · https://www.ag-grid.com/studio/react/custom-widgets/

## APIMatic — Context Plugins (use while building; fallback prize)
- **Prize:** $1,000 + 6 months APIMatic Business (3 winners).
- **Offer:** used the Context Plugin for your PayPal integration → 1 month APIMatic Basic free; claim via form https://docs.google.com/forms/d/e/1FAIpQLScc2oCgAFACm7d6H3R4mgzv-O34DdyVnLIBNiwmUNggr_-hhA/viewform
- **Install (Claude Code):**
  ```
  /plugin marketplace add apimatic/plugin-marketplace
  /plugin install context-matic@apimatic
  /reload-plugins
  ```
  Alt: `/plugin marketplace add apimatic/context-matic` → `/plugin install context-matic@apimatic-context-matic`; or `npx context-plugins install paypal`. The marketplace also has `acp-paypal` (PayPal plugin with `/integrate-paypal` skill, `paypal-plan`, `paypal-debug` subagents).
- **MCP endpoint:** `https://chatbotapi.apimatic.io/mcp/plugins` — tools `fetch_api` (language=typescript, key="paypal"), `ask`, `endpoint_search`, `model_search`. No key needed.
- Say in README + video: "PayPal integration built with APIMatic Context Plugins."

## Bryntum (optional)
- **Prize:** $1,000 × 3. Criteria (verbatim): "This prize goes to the project that puts Gantt, Scheduler, and/or Calendar to the best use, whether that's the cleanest timeline, the smartest resource booking, or an agent that drives the schedule itself."
- Trial: https://bryntum.com/download — `npm install @bryntum/scheduler@npm:@bryntum/scheduler-trial` (Node ≥ 20). Calendar alias likely `@bryntum/calendar@npm:@bryntum/calendar-trial` *(unverified)*.
- MCP: `claude mcp add --transport http bryntum https://mcp.bryntum.com` (tool `search_bryntum_docs`).
- Fit: month-end close calendar driven by the agent; invoice due dates; payout schedule.

## Channel3 (poor fit)
- **Prize:** $1,500 × 1. Must call the API/MCP meaningfully (search, enrichment, recommendations).
- 20,000 free credits with code **PAYPAL-HACKATHON-2026** at https://trychannel3.com/developers. `npm install @channel3/sdk`, env `CHANNEL3_API_KEY`. MCP `https://mcp.trychannel3.com/`.

## Render (optional)
- **Prize:** $1,000 / $750 / $500 credits. $50 credits: https://credits-portal-mmdm.onrender.com/claim/payback.ai
- Render Workflows (`npm install @renderinc/sdk`) for long-running jobs. MCP: `https://mcp.render.com/mcp` (Bearer API key) or `/plugin install render@claude-plugins-official`.
- We host on Cloudflare; Render is a second runtime — skip unless pivoting sponsor target.

## Elastic (no prize; Elastic judge on panel)
- 14-day Serverless trial: https://ela.st/elastic-paypal-hackathon (self-extend 30 days: https://www.elastic.co/trialextension).
- Agent Builder MCP: `{KIBANA_URL}/api/agent_builder/mcp`. Skills: `npx skills add elastic/agent-skills`.
- **JS client doesn't run on Workers** — call REST with `fetch`.
- Fit: semantic search over ledger/receipts ("find all software subscriptions over $50").

## KERNEL (no prize)
- $50 credits: https://dashboard.onkernel.com/hackathon?code=KERNELDEVPOST2026 — cloud browsers for agents.
- MCP: `claude mcp add --transport http kernel https://mcp.onkernel.com/mcp`. Skills: `/plugin marketplace add kernel/skills`.
- Fit: fetch statements/receipts from vendor portals without APIs. Not core.

## Postman (no prize; Postman judge on panel)
- PayPal public workspace: https://www.postman.com/paypal
- MCP: `https://mcp.postman.com/mcp` (Bearer `POSTMAN_API_KEY`) or `npx @postman/postman-mcp-server`. Plugin: `/plugin marketplace add postmanlabs/postman-plugin` → `/plugin install postman@postman`.
- Fit: ship a Postman collection of our Worker API in `/postman` for judges — cheap credibility.

## Zapier (no prize)
- 14-day Pro trial. MCP: `https://mcp.zapier.com/api/v1/connect` (OAuth); each tool call = 2 Zapier tasks.
- PayPal triggers/actions exist (new invoice, sale, refund). Fit: export journal entries to Sheets/QuickBooks.

## Astropods (no prize)
- Agent build/deploy platform. `curl -fsSL https://astropods.com/install | sh`; `ast project create ...`. Not needed.

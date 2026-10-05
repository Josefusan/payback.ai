---
name: sponsor-tools
description: Which hackathon sponsor tools (AG Grid/AG Studio, APIMatic, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier, Astropods) to use, their prize criteria, free offers, packages and MCP servers — and how to build the AG Studio dashboard that targets the AG Grid prize. Use when building the web UI, choosing an extra tool, or wording the "tools used" section.
---

# Sponsor tools

Full research (offers, codes, links, verbatim criteria): `docs/08-sponsor-tools.md`.

## Decisions (don't relitigate without the strategist agent)
- **Sponsor prize target: AG Grid** (largest pool, 5 winners). Fallback: APIMatic.
- **Use APIMatic Context Plugin** while writing PayPal code (free month + fallback prize). Mention it in README + video.
- Postman: publish a collection of our Worker API (`postman/` folder) — cheap credibility with a Postman judge.
- Bryntum / Elastic / Zapier / Kernel / Render / Channel3 / Astropods: **not in MVP**. Only add if a teammate has idle capacity *after* Week 4 and it improves the video.
- A project can win only **one** sponsor prize; extra sponsor tools add complexity, not prize EV.

## AG Grid prize — what to build (criteria: polish, custom widgets, theming, layout tools, Studio Agent Framework)
See `ag-grid-studio.md` for APIs. Deliver:
1. **AG Studio dashboard** (`ag-studio-react`) with our theme (brand tokens) applied to grids and charts.
2. **Custom widgets** (each with `formatShape` so Studio's AI can use them):
   - `ReconciliationTile` — PayPal balance vs ledger, ✅/⚠️, drill to unmatched items
   - `ConfidenceDial` — threshold slider → live precision / review-rate from eval set
   - `DecisionCell` — Clef probability bar + top-3 alternatives inside the review-queue grid
   - `ARAgingWidget` — buckets with "send reminders" action (policy-gated)
3. **Ledger grid** with grouping by account/product line, pinned totals, debit/credit columns, row drill to source PayPal transaction.
4. **Studio Agent Framework:** a custom **Controller agent** (primary) whose tools call our Worker API (`/api/reports/*`, `/api/review/*`) and which delegates chart/layout requests to Studio's built-in agents via `delegate_to`.
5. Layout: saved dashboard layouts per persona (Owner, Bookkeeper).
Fallback if AG Studio blocks us: AG Grid Community/Enterprise trial + AG Charts with the same widgets.

## License timing
AG Studio trial = 45 days. Judging runs to **Dec 15** → ask AG Grid on Discord for a hackathon key, or activate the trial on/after **Oct 31**.

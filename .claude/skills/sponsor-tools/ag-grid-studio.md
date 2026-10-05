# AG Studio / AG Grid quick reference (verify with `ag-mcp` docs MCP before coding)

Docs: https://www.ag-grid.com/studio/react/quick-start/ · custom widgets: /studio/react/custom-widgets/ · agents: /studio/react/ai-agents/ · license: /studio/react/licence-install/
Boilerplate: https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate (Next.js; Transaction Search, Balances, Subscriptions) — mine it for PayPal↔grid patterns; our app is Vite+React talking to the Worker.

## Install & minimal
```bash
npm install ag-studio-react
```
```tsx
import { AgStudio } from "ag-studio-react";
<AgStudio data={data} mode="edit" />
```

## Custom widget (shape — confirm names in docs)
```ts
const reconciliationTile: AgWidgetDefinition = {
  id: "reconciliation-tile",
  comp: ReconciliationTileComponent,
  dataMapping: { /* fields the widget consumes */ },
  form: { /* config UI */ },
  formatShape: { /* JSON-shape description so Studio AI agents can configure/use it */ },
};
const widgets = createWidgets({ additionalTypes: [reconciliationTile], menu: [/* placement */] });
```
Theming: `studioGridTheme` (grids), `getChartTheme(api)` (charts). Cross-filter: `toggleCrossFilter()`.

## Studio Agent Framework
- Runners: `directLlmRunner` | client-tool runner | custom runner (bring our own harness).
- Agent: `id, name, description, schema, instructions(), tools(), defaultToolCalls, maxTurns`.
- Built-in tools include `studio.viewSchema()`, `studio.executeQuery()`.
- Harness roster: exactly one `primary`; handoff via `delegate_to`; events follow AG-UI.
- Our **Controller** agent: primary; tools → `GET /api/reports/pnl?by=product_line`, `GET /api/review`, `POST /api/review/:id/approve` (human-confirmed in UI); delegates visualization to built-ins.

## Dev aids
- Docs MCP: `claude mcp add ag-mcp npx ag-mcp` (search_docs, detect_version, set_version, list_versions)
- Skills: `npx skills add ag-grid/skills` (ag-dev, ag-update)

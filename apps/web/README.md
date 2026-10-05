# apps/web — Payback.ai dashboard (to build)

Owner: `frontend-aggrid-engineer` agent. Spec: `.claude/skills/sponsor-tools/SKILL.md` + `ag-grid-studio.md`.

## Scaffold
```bash
npm create vite@latest . -- --template react-ts
npm install ag-studio-react          # AG Studio (React); AG Grid Community fallback: ag-grid-react ag-grid-community
```
Dev proxy `/api` → `http://localhost:8787` (wrangler dev). Production: build to static assets served by the Worker or Cloudflare Pages.

## Screens (video order)
1. Connect / status (PayPal sandbox ✅, Clef ✅)
2. Live sync — decisions streaming with probability bars
3. Ledger grid — grouping, pinned totals, drill to PayPal transaction
4. Review queue — `DecisionCell`, approve/reject, `ConfidenceDial`
5. Agent actions log — executed / waiting approval / blocked
6. AG Studio managerial dashboard — `ReconciliationTile`, `ARAgingWidget`, P&L by product line, Controller agent

## API used
`GET /api/health` · `GET /api/ledger` · `GET /api/review` · `POST /api/review/:id/resolve` · `GET /api/reconcile` · `GET /api/reports/pnl`

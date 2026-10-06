# apps/web — Payback.ai dashboard (L4)

Owner: `frontend-aggrid-engineer` agent. Spec: `.claude/skills/sponsor-tools/SKILL.md` + `ag-grid-studio.md`.

Task **T-L4-001** (gate G1): *app builds; theme applied to grid + charts; ledger grid groups by account,
pins totals, drills to source txn — all against fixtures.*

## Stack

Vite + React 19 + TypeScript, **AG Grid Community 36** (Theming API — no CSS import needed).
Fixture-driven: it reads the shared IF-01 fixtures under `packages/contracts/fixtures/`. There is
**no live API dependency** yet; nothing under `src/` calls `/api`.

> **AG Studio / Enterprise note.** `ag-studio-react` and AG Grid Enterprise need a commercial licence
> key (`docs/decisions.md` Q3: activate on/after Oct 31). Native row grouping, `aggFunc`, Integrated
> Charts and the Studio Agent Framework are therefore **not** used here. This G1 scaffold uses the
> Community fallback the plan allows (`sponsor-tools/SKILL.md`): grouping is done in app code, totals
> use AG Grid's Community `pinnedBottomRowData`, and the chart is themed CSS. T-L4-003/004/005 (G4)
> swap in AG Studio widgets once the licence is active.

## Commands

```bash
cd apps/web
npm install
npm run typecheck    # tsc --noEmit
npm test             # vitest (jsdom) — 42 tests
npm run build        # tsc --noEmit && vite build → dist/
npm run dev          # vite dev server :5173, proxies /api and /webhooks → :8787 (wrangler dev)
npm run preview      # serve the production build
```

## What T-L4-001 ships

| Requirement | Where |
|---|---|
| App builds | `npm run build` (typecheck + vite build); verified in a real browser at 1280×720 |
| Theme on grid **and** chart | `src/gridTheme.ts` (AG Grid Theming API) + `src/styles/theme.css` tokens, shared by `AccountTotalsChart` |
| Groups by account | `LedgerGrid` renders one AG Grid per account from `groupByAccount()` (`src/data/ledger.ts`) |
| Pinned totals | Per-account `pinnedBottomRowData` subtotal row + the pinned grand-total bar (`TotalsBar`) |
| Drill-through to source txn | Per-row **View source** action → `SourceDrawer` resolves the journal entry from `ledger-entry.json` and shows the PayPal **sandbox** transaction id |
| Fixture-only, no live API | `src/data/fixtures.ts` parses `packages/contracts/fixtures/*.json` with runtime shape validation against `packages/contracts/api.ts` |

Invariants surfaced in the UI: money is integer cents (`src/format.ts`); the balance badge compares
total debits to total credits; the drawer shows whether the source entry balances (INV-3). Only the
PayPal **sandbox** host appears in the app (INV-1).

## Layout

```
src/
  App.tsx                     shell: header + screen switch (Ledger / Managerial dashboard)
  components/
    LedgerScreen.tsx          ledger screen: totals bar + chart + grouped grid + drawer
    ManagerialDashboard.tsx    dashboard screen: composes the T-L4-003 widgets
    ReconciliationTile.tsx    PayPal vs ledger vs pending + ok/not-ok badge (`formatShape`)
    ARAgingWidget.tsx         AR aging buckets 0–30/31–60/61–90/90+ (`formatShape`)
    PnLByProductLine.tsx      P&L + contribution margin by product line, AG Grid (`formatShape`)
    LedgerGrid.tsx            one AG Grid per account, pinned subtotal row, React drill action
    TotalsBar.tsx             pinned grand totals + balance badge
    AccountTotalsChart.tsx    themed debit/credit bars (no chart library — no extra licence, INV-8)
    SourceDrawer.tsx          drill-through: journal entry lines + PayPal sandbox source
    AppHeader.tsx             chrome; selects the built screens, lists the planned ones disabled
  data/
    fixtures.ts               IF-01 fixture load + runtime shape validation (ledger)
    ledger.ts                 pure derivations: groupByAccount, totalsOf, entryForLine, rowNetCents
    reports.ts                reports layer: reconcile / P&L loaders + AR aging derivation
    receivables-demo.ts       local demo receivables (apps/web only) until ledger.json has 1200 lines
  widgets.ts                  AG Studio `formatShape` / `AgWidgetDefinition` metadata types
  gridTheme.ts, format.ts, styles/theme.css, styles/app.css
```

## T-L4-003 — managerial widgets

`ManagerialDashboard` composes three widgets (gate G4). Each exposes a `formatShape` (the AG Studio
JSON-shape description) plus a `widgetDefinition`; registering them via `createWidgets({ additionalTypes })`
is the only step left once the AG Studio licence is active (`docs/decisions.md` Q3).

| Widget | Reads | Notes |
|---|---|---|
| `ReconciliationTile` | `reconcile.json` (`GET /api/reconcile`) | Every reconcile field is **optional**; extra columns (`pendingCents`, `asOfTime`, `cutoff`) parse cleanly and a missing one renders `—` |
| `ARAgingWidget` | `ledger.json` lines on account **1200** | Bucketed 0–30/31–60/61–90/90+ by age vs the as-of date; read-only (reminders are policy-gated, T-L1-006) |
| `PnLByProductLine` | `reports-pnl.json` (`GET /api/reports/pnl`) | Revenue − refunds − COGS − direct costs = contribution margin, in the shared AG Grid theme with a pinned total |

No number comes from a model: reconcile + P&L read the IF-01 fixtures and AR aging is a pure
derivation (`src/data/reports.ts`), matching the Worker's report SQL (net = credit − debit). The shared
ledger fixture has no account-1200 lines yet, so AR aging falls back to a clearly-labelled local demo
set (`src/data/receivables-demo.ts`) that drops out automatically once the Worker posts receivables.

## Tests (`npm test`)

- `src/data/ledger.test.ts` — fixture parsing (incl. malformed fixtures), grouping, totals, empty ledger,
  drill-through resolution, sandbox-only hosts, cent formatting.
- `src/data/reports.test.ts` — reconcile parsing incl. all-optional/extra fields, P&L aggregation +
  contribution margin, AR aging buckets, day math and bucket boundaries, demo fallback.
- `src/components/LedgerGrid.test.tsx` — group headers and per-account totals, one AG Grid + pinned
  subtotal row per account, fixture rows rendered, drill-action wiring, collapse, empty state, grand
  totals, and the end-to-end drawer open/close.
- `src/components/ManagerialDashboard.test.tsx` — widget `formatShape` exports, reconciliation/AR-aging
  /P&L rendering, and the header nav switching between Ledger and the dashboard.

`src/test/setup.ts` stubs `ResizeObserver` / `matchMedia` / element boxes: jsdom has no layout engine,
so AG Grid would otherwise render no rows. AG Grid's own row *click* handler cannot be driven from
jsdom; the per-row React **View source** button covers the drill-through path in tests, while
whole-row click (`onRowClicked`) is kept for the browser.

## Next (not built yet — `docs/13-build-plan.md` §4)

T-L4-002 review queue + `DecisionCell` (G2) · T-L4-004 `ConfidenceDial` (G4) ·
T-L4-005 Controller agent (G4) · T-L4-006 blocked-attempts grid (G4).
The header nav lists these as **planned**, disabled.

## Screens (video order)

1. Connect / status (PayPal sandbox, Clef) — planned
2. Live sync — decisions streaming with probability bars — planned
3. **Ledger grid — grouping, pinned totals, drill to source txn — this task**
4. Review queue — `DecisionCell`, approve/reject, `ConfidenceDial` — planned
5. Agent actions log — executed / waiting approval / blocked — planned
6. Managerial dashboard — `ReconciliationTile`, `ARAgingWidget`, P&L by product line — **T-L4-003** (Controller agent planned)

## API used

Live from G2: `GET /api/health` · `GET /api/ledger` · `GET /api/ledger/:id` · `GET /api/review` ·
`POST /api/review/:id/resolve` · `GET /api/reconcile` · `GET /api/reports/pnl`.
Production: build `dist/` and serve from the Worker's static assets or Cloudflare Pages.

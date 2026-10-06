import { colorSchemeLight, themeQuartz } from "ag-grid-community";

/**
 * One theme for the ledger grid, using the AG Grid Theming API (v33+; no CSS import needed).
 * Parameter values mirror the design tokens in src/styles/theme.css — AG Grid resolves colours
 * numerically, so it cannot read `var(--pb-*)`; keep the hexes in step with that file.
 */
export const paybackGridTheme = themeQuartz.withPart(colorSchemeLight).withParams({
  accentColor: "#0f766e",
  backgroundColor: "#ffffff",
  foregroundColor: "#0f172a",
  borderColor: "#e3e8ef",
  chromeBackgroundColor: "#f1f5f9",
  headerBackgroundColor: "#f1f5f9",
  headerTextColor: "#334155",
  headerFontWeight: 600,
  headerHeight: 36,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  cellHorizontalPadding: 12,
  rowHeight: 34,
  autoHeightMinBodyHeight: 0,
  borderRadius: 8,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  spacing: 7,
  oddRowBackgroundColor: "#fbfdff",
  rowHoverColor: "#f0fdfa",
  selectedRowBackgroundColor: "#ccfbf1",
  subtleTextColor: "#8494a8",
  pinnedRowBackgroundColor: "#f1f5f9",
  pinnedRowTextColor: "#0f172a",
  pinnedRowFontWeight: 700,
  cellTextColor: "#0f172a",
});

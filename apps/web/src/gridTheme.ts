import { colorSchemeDark, colorSchemeLight, themeQuartz } from "ag-grid-community";
import { useEffect, useState } from "react";

/**
 * One AG Grid theme per mode, derived from the design tokens in src/styles/theme.css.
 *
 * AG Grid resolves colours numerically and cannot read `var(--pb-*)`, so these hexes are the one place the
 * token values are duplicated. Keep them in step with theme.css — dark is the primary look.
 */

/** Everything that does not change between modes: geometry, density and type. */
const SHARED = {
  headerFontWeight: 600,
  headerHeight: 36,
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 14,
  cellHorizontalPadding: 12,
  rowHeight: 36,
  autoHeightMinBodyHeight: 0,
  borderRadius: 10,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  spacing: 8,
  pinnedRowFontWeight: 600,
} as const;

/** The primary (dark) grid: near-black panel, off-white text, one teal accent. */
export const paybackGridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  ...SHARED,
  accentColor: "#2dd4bf",
  backgroundColor: "#101018",
  foregroundColor: "#ececf2",
  borderColor: "#23232f",
  chromeBackgroundColor: "#16161f",
  headerBackgroundColor: "#16161f",
  headerTextColor: "#a0a0b0",
  oddRowBackgroundColor: "#131320",
  rowHoverColor: "#1c1c27",
  selectedRowBackgroundColor: "rgba(45, 212, 191, 0.16)",
  subtleTextColor: "#6e6e80",
  pinnedRowBackgroundColor: "#16161f",
  pinnedRowTextColor: "#ececf2",
  cellTextColor: "#ececf2",
});

/** The light grid — same structure, same accent role, light neutrals. */
export const paybackGridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  ...SHARED,
  accentColor: "#0f766e",
  backgroundColor: "#ffffff",
  foregroundColor: "#0f172a",
  borderColor: "#e3e8ef",
  chromeBackgroundColor: "#f1f5f9",
  headerBackgroundColor: "#f1f5f9",
  headerTextColor: "#5b6b7f",
  oddRowBackgroundColor: "#fbfdff",
  rowHoverColor: "#f0fdfa",
  selectedRowBackgroundColor: "#ccfbf1",
  subtleTextColor: "#8494a8",
  pinnedRowBackgroundColor: "#f1f5f9",
  pinnedRowTextColor: "#0f172a",
  cellTextColor: "#0f172a",
});

export type ThemeMode = "dark" | "light";

/**
 * Fired when the theme changes, so a mounted grid can follow it.
 *
 * Deliberately NOT a `MutationObserver` on `document.documentElement`: AG Grid writes style attributes onto
 * the document element itself when it injects its theme, so observing that node makes the grid re-render
 * the very writes the grid produced. That feedback cost seconds per mount and intermittently timed the
 * AG Grid tests out. An explicit event only fires when the theme actually changes.
 */
export const THEME_EVENT = "payback:theme";

/** The mode currently applied to the document. Dark is the default, and the fallback when there is none. */
export function currentThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The mode the user last chose, or null if they never have. Dark is the default, not an OS preference. */
export function savedThemeMode(): ThemeMode | null {
  try {
    const saved = localStorage.getItem("payback.theme");
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Apply a mode to the document and announce it. The grid cannot read CSS custom properties, so the mode has
 * to be readable from the DOM — this is what keeps a custom-rendered grid in step with the stylesheet.
 */
export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
}

/**
 * The grid theme for the current mode. Listens for the theme event rather than taking a prop, so a grid
 * anywhere in the tree follows the theme without every screen having to thread it through.
 */
export function useGridTheme() {
  const [mode, setMode] = useState<ThemeMode>(currentThemeMode);
  useEffect(() => {
    const onChange = () => setMode(currentThemeMode());
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);
  return mode === "light" ? paybackGridThemeLight : paybackGridTheme;
}

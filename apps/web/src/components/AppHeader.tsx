import { useCallback, useEffect, useState, type ReactNode } from "react";

import { applyThemeMode, savedThemeMode, type ThemeMode } from "../gridTheme";

/** Screens that are actually built and selectable in the nav. */
export type ScreenId = "ledger" | "review" | "managerial" | "audit";

export interface AppHeaderProps {
  screen: ScreenId;
  onSelect: (screen: ScreenId) => void;
}

interface NavItem {
  id: ScreenId;
  label: string;
  hint: string;
  icon: ReactNode;
}

/** 16px stroke icons, drawn in `currentColor` so they inherit the active/idle styling. */
const Icon = ({ d }: { d: string }) => (
  <svg className="sidebar__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const LIVE_SCREENS: NavItem[] = [
  { id: "ledger", label: "Ledger", hint: "Every journal line, grouped by account", icon: <Icon d="M3 5h18M3 12h18M3 19h18" /> },
  { id: "review", label: "Review queue", hint: "Decisions the agent stopped on", icon: <Icon d="M12 3l9 16H3l9-16zM12 10v4M12 17h.01" /> },
  { id: "managerial", label: "Managerial dashboard", hint: "Margin, AR aging and tie-out", icon: <Icon d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  { id: "audit", label: "Audit trail", hint: "The hash chain and its verification", icon: <Icon d="M12 3l8 4v5c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V7l8-4zM9 12l2 2 4-4" /> },
];

/** Planned screens from the L4 brief, listed after the live ones and disabled until their tasks land. */
const PLANNED_SCREENS = ["Sync", "Agent actions"] as const;

const COLLAPSE_KEY = "payback.sidebar.collapsed";

/** The theme toggle. Dark is the default; light is only ever this explicit choice. */
function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(() => savedThemeMode() ?? "dark");
  useEffect(() => {
    applyThemeMode(mode);
    try {
      localStorage.setItem("payback.theme", mode);
    } catch {
      /* private mode: the choice just does not persist */
    }
  }, [mode]);

  const next = mode === "dark" ? "light" : "dark";
  return (
    <button type="button" className="sidebar__toggle" onClick={() => setMode(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <Icon d={mode === "dark" ? "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" : "M12 4v2M12 18v2M4 12H2M22 12h-2M6 6L4.5 4.5M19.5 19.5L18 18M6 18l-1.5 1.5M19.5 4.5L18 6M16 12a4 4 0 11-8 0 4 4 0 018 0z"} />
      <span className="sidebar__label">{mode === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

function LiveNavItem({ item, current, onSelect }: { item: NavItem; current: boolean; onSelect: (s: ScreenId) => void }) {
  const inner = (
    <>
      {item.icon}
      <span className="sidebar__label">{item.label}</span>
    </>
  );
  if (current) {
    return (
      <span className="sidebar__item" aria-current="page" title={item.hint}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" className="sidebar__item sidebar__item--link" onClick={() => onSelect(item.id)} title={item.hint}>
      {inner}
    </button>
  );
}

/**
 * App chrome: a collapsible sidebar. Four primary destinations only (Hick's Law), a clearly separated
 * group of planned screens so nothing selectable is a dead end, and the theme toggle in the footer.
 *
 * `.app` is a two-column grid, so this is column one and whichever screen is mounted is column two —
 * which is why adding the sidebar needed no change in App.tsx or any screen.
 */
export function AppHeader({ screen, onSelect }: AppHeaderProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Cmd/Ctrl+B is the conventional collapse chord; ignore it while typing in a field.
  const toggle = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        const el = event.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <aside className="sidebar" data-collapsed={collapsed ? "true" : undefined} aria-label="Main">
      <div className="sidebar__head">
        <span className="sidebar__brand" title="Payback.ai">
          Payback<span>.ai</span>
        </span>
        <button
          type="button"
          className="sidebar__collapse"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
        >
          <Icon d="M15 6l-6 6 6 6" />
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Dashboard screens">
        <p className="sidebar__section">
          <span className="sidebar__label">Workspace</span>
        </p>
        {LIVE_SCREENS.map((item) => (
          <LiveNavItem key={item.id} item={item} current={screen === item.id} onSelect={onSelect} />
        ))}

        <p className="sidebar__section">
          <span className="sidebar__label">Planned</span>
        </p>
        {PLANNED_SCREENS.map((label): ReactNode => (
          <span key={label} className="sidebar__item sidebar__item--planned" aria-disabled="true" title="Planned — not built yet">
            <Icon d="M12 8v8M8 12h8M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <span className="sidebar__label">{label}</span>
          </span>
        ))}
      </nav>

      <div className="sidebar__foot">
        <span className="badge badge--sandbox" title="Every number on this dashboard comes from the PayPal sandbox">
          <span className="sidebar__label">PayPal sandbox</span>
          <span className="sidebar__label-when-collapsed">SB</span>
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

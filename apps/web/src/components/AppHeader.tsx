import type { ReactNode } from "react";

/** Screens that are actually built and selectable in the nav. */
export type ScreenId = "ledger" | "review" | "managerial" | "audit";

export interface AppHeaderProps {
  screen: ScreenId;
  onSelect: (screen: ScreenId) => void;
}

interface NavItem {
  id: ScreenId;
  label: string;
}

const LIVE_SCREENS: NavItem[] = [
  { id: "ledger", label: "Ledger" },
  { id: "review", label: "Review queue" },
  { id: "managerial", label: "Managerial dashboard" },
  { id: "audit", label: "Audit trail" },
];

/** Planned screens from the L4 brief, listed after the live ones and disabled until their tasks land. */
const PLANNED_SCREENS = ["Sync", "Agent actions"] as const;

function LiveNavItem({ item, current, onSelect }: { item: NavItem; current: boolean; onSelect: (s: ScreenId) => void }) {
  if (current) {
    return (
      <span className="app-nav__item" aria-current="page">
        {item.label}
      </span>
    );
  }
  return (
    <button type="button" className="app-nav__item app-nav__item--link" onClick={() => onSelect(item.id)}>
      {item.label}
    </button>
  );
}

/** App chrome. The nav selects between the built screens; planned screens stay disabled. */
export function AppHeader({ screen, onSelect }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        Payback<span>.ai</span>
      </div>
      <span className="badge badge--sandbox">PayPal sandbox</span>
      <nav className="app-nav" aria-label="Dashboard screens">
        {LIVE_SCREENS.map((item) => (
          <LiveNavItem key={item.id} item={item} current={screen === item.id} onSelect={onSelect} />
        ))}
        {PLANNED_SCREENS.map((label): ReactNode => (
          <span key={label} className="app-nav__item" aria-disabled="true" title="Planned — not built yet">
            {label} <small>planned</small>
          </span>
        ))}
      </nav>
    </header>
  );
}

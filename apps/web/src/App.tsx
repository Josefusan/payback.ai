import { useState } from "react";

import { AppHeader, type ScreenId } from "./components/AppHeader";
import { LedgerScreen } from "./components/LedgerScreen";
import { ManagerialDashboard } from "./components/ManagerialDashboard";

/**
 * Payback.ai dashboard shell. The header selects between the built screens:
 * the Ledger grid (T-L4-001) and the Managerial dashboard (T-L4-003). Fixture-driven until G2.
 */
export default function App() {
  const [screen, setScreen] = useState<ScreenId>("ledger");

  return (
    <div className="app">
      <AppHeader screen={screen} onSelect={setScreen} />
      {screen === "ledger" ? <LedgerScreen /> : <ManagerialDashboard />}
    </div>
  );
}

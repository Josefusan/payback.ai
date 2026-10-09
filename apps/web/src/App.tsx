import { useState } from "react";

import { AppHeader, type ScreenId } from "./components/AppHeader";
import { LedgerScreen } from "./components/LedgerScreen";
import { ManagerialDashboard } from "./components/ManagerialDashboard";
import { ReviewScreen } from "./components/ReviewScreen";

/**
 * Payback.ai dashboard shell. The header selects between the built screens: the ledger grid
 * (T-L4-001), the review queue (T-L4-002) and the managerial dashboard (T-L4-003).
 */
export default function App() {
  const [screen, setScreen] = useState<ScreenId>("ledger");

  return (
    <div className="app">
      <AppHeader screen={screen} onSelect={setScreen} />
      {screen === "ledger" ? <LedgerScreen /> : null}
      {screen === "review" ? <ReviewScreen /> : null}
      {screen === "managerial" ? <ManagerialDashboard /> : null}
    </div>
  );
}

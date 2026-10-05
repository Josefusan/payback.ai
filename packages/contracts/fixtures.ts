// Fixture index for IF-01 (owner: INT). L4 imports FIXTURES to build against contracts before G2; the contracts test checks coverage.
import actions from "./fixtures/actions.json";
import actionsApprove from "./fixtures/actions-approve.json";
import audit from "./fixtures/audit.json";
import auditVerify from "./fixtures/audit-verify.json";
import close from "./fixtures/close.json";
import confidenceSweep from "./fixtures/confidence-sweep.json";
import evalAction from "./fixtures/eval-action.json";
import evalDecide from "./fixtures/eval-decide.json";
import health from "./fixtures/health.json";
import ledger from "./fixtures/ledger.json";
import ledgerEntry from "./fixtures/ledger-entry.json";
import reconcile from "./fixtures/reconcile.json";
import reportsPnl from "./fixtures/reports-pnl.json";
import review from "./fixtures/review.json";
import reviewResolve from "./fixtures/review-resolve.json";
import settingsThreshold from "./fixtures/settings-threshold.json";
import sync from "./fixtures/sync.json";
import webhooksPaypal from "./fixtures/webhooks-paypal.json";

export const FIXTURES: Record<string, unknown> = {
  "actions": actions,
  "actions-approve": actionsApprove,
  "audit": audit,
  "audit-verify": auditVerify,
  "close": close,
  "confidence-sweep": confidenceSweep,
  "eval-action": evalAction,
  "eval-decide": evalDecide,
  "health": health,
  "ledger": ledger,
  "ledger-entry": ledgerEntry,
  "reconcile": reconcile,
  "reports-pnl": reportsPnl,
  "review": review,
  "review-resolve": reviewResolve,
  "settings-threshold": settingsThreshold,
  "sync": sync,
  "webhooks-paypal": webhooksPaypal,
};

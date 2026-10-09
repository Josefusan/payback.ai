import { useState } from "react";

import type { CoaAccount, ReviewItem } from "../../../../packages/contracts/api";
import { ApiError, resolveReviewItem } from "../data/api";
import { describeReason, parseReasons } from "../data/review";

export interface ReviewDecisionFormProps {
  item: ReviewItem;
  accounts: readonly CoaAccount[];
  /** Shared across items, so they live on the screen rather than here. */
  token: string;
  reviewer: string;
  onTokenChange: (token: string) => void;
  onReviewerChange: (reviewer: string) => void;
  onResolved: () => void;
}

/**
 * Turn the server's error code into something a reviewer can act on. The distinction that matters is
 * between "you are not allowed" and "it was allowed and the ledger still refused" — the second means
 * the item is still open, and reporting it as done would drop a transaction on the floor.
 */
function describeError(err: unknown): string {
  const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : String(err);
  const detail = err instanceof ApiError && err.detail ? ` (${err.detail})` : "";
  switch (code) {
    case "unauthorized":
      return "The admin token was rejected. Check it and try again.";
    case "auth_not_configured":
      return "This deployment has no admin token configured, so nothing can be decided.";
    case "not_found_or_already_resolved":
      return "This item was already resolved — probably by another reviewer. Reload the queue.";
    case "posting_failed":
      return `The ledger refused the posting. The item is still open; nothing was written.${detail}`;
    case "invalid_account_override":
      return "That account code is not in the chart of accounts.";
    default:
      return `${code}${detail}`;
  }
}

/**
 * Approve / reject one item. The account override is opt-in and only offered on approvals: rejecting
 * books nothing, so there is no account to correct.
 */
export function ReviewDecisionForm({
  item,
  accounts,
  token,
  reviewer,
  onTokenChange,
  onReviewerChange,
  onResolved,
}: ReviewDecisionFormProps) {
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const reasons = parseReasons(item);
  const suggested = reasons.length > 0 ? describeReason(reasons[0]!.raw) : null;
  const ready = token.trim() !== "" && reviewer.trim() !== "" && !busy;

  const decide = async (status: "approved" | "rejected"): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await resolveReviewItem(
        item.id,
        {
          status,
          by: reviewer.trim(),
          ...(status === "approved" && override.trim() !== "" ? { account_override: override.trim() } : {}),
        },
        token,
      );
      setMessage({
        tone: "ok",
        text: status === "approved" ? "Approved — the journal entry is posted." : "Rejected — nothing was booked.",
      });
      onResolved();
    } catch (err) {
      setMessage({ tone: "bad", text: describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="decision" data-testid="decision-form">
      <h3 className="drawer__title">Decision</h3>

      <div className="field">
        <label className="field__label" htmlFor="review-decision">
          This will be recorded as <em>your</em> decision on the audit trail.
        </label>
        <select
          className="field__input"
          id="review-decision"
          value={override}
          onChange={(event) => setOverride(event.target.value)}
        >
          <option value="">Accept the model's choice</option>
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>
              Override to {account.code} {account.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="review-name">
            Your name
          </label>
          <input
            className="field__input"
            id="review-name"
            value={reviewer}
            placeholder="who is deciding"
            onChange={(event) => onReviewerChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="review-token">
            Admin token
          </label>
          <input
            className="field__input"
            id="review-token"
            type="password"
            value={token}
            placeholder="required to decide"
            onChange={(event) => onTokenChange(event.target.value)}
          />
        </div>
      </div>

      <div className="decision__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          onClick={() => void decide("approved")}
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button type="button" className="btn" disabled={!ready} onClick={() => void decide("rejected")}>
          Reject
        </button>
        {!ready && !busy ? <span className="muted">A name and the admin token are required.</span> : null}
      </div>

      {suggested?.tone === "danger" ? (
        <p className="muted" data-testid="decision-caution">
          This item was flagged for a safety reason. Approving it books the transaction as classified.
        </p>
      ) : null}

      {message ? (
        <p className={message.tone === "ok" ? "alert alert--ok" : "alert alert--danger"} data-testid="decision-result">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

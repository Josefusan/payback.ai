import type { CoaAccount, ReviewItem } from "../../../../packages/contracts/api";
import { accountLabel } from "../data/coa";
import {
  formatProbability,
  hasInjection,
  inputRows,
  parsePayload,
  parseReasons,
  type ChoiceView,
  type ReasonView,
} from "../data/review";

export interface ReviewItemDetailProps {
  item: ReviewItem;
  accounts: readonly CoaAccount[];
}

function ReasonList({ reasons }: { reasons: ReasonView[] }) {
  if (reasons.length === 0) {
    return (
      <p className="muted" data-testid="no-reasons">
        No reason was recorded for this item.
      </p>
    );
  }
  return (
    <ul className="reasons" data-testid="reasons">
      {reasons.map((reason) => (
        <li key={reason.raw} className={`reason reason--${reason.tone}`}>
          <span className="reason__label">{reason.label}</span>
          {/* The raw code is the audit record — the gloss above must never replace it. */}
          <code className="reason__raw" data-testid={`reason-raw-${reason.raw}`}>
            {reason.raw}
          </code>
        </li>
      ))}
    </ul>
  );
}

/**
 * A choice and its full distribution. `format` names the code — the P&L side keys on account codes,
 * the product-line side on line names, so one label helper cannot serve both.
 */
function Distribution({ name, choice, format }: { name: string; choice: ChoiceView; format: (code: string) => string }) {
  if (choice.probabilities.length === 0) {
    return (
      <p className="muted">
        Chose <code>{format(choice.choice)}</code> with no probability distribution recorded.
      </p>
    );
  }
  return (
    <div className="dist" data-testid={`distribution-${name}`}>
      <p className="dist__chose">
        Chose <code>{format(choice.choice)}</code>
      </p>
      <ul className="dist__list">
        {choice.probabilities.map((entry) => (
          <li
            key={entry.code}
            className={entry.code === choice.choice ? "dist__row dist__row--chosen" : "dist__row"}
            data-testid={`dist-${name}-${entry.code}`}
          >
            <span className="dist__code">{format(entry.code)}</span>
            <span className="dist__track">
              <span className="dist__bar" style={{ width: `${Math.max(entry.p, 0) * 100}%` }} />
            </span>
            <span className="dist__value">{formatProbability(entry.p)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The provenance of one review item: what the model saw, what it decided, and why a human is being
 * asked. A reviewer should be able to disagree with this screen on the evidence — that is the whole
 * argument for letting an agent near the books.
 */
export function ReviewItemDetail({ item, accounts }: ReviewItemDetailProps) {
  const reasons = parseReasons(item);
  const { input, decision } = parsePayload(item);
  const rows = inputRows(input);
  const injection = hasInjection(reasons);

  return (
    <div className="review-detail" data-testid="review-detail">
      {injection ? (
        <p className="alert alert--danger" data-testid="injection-alert">
          <strong>Possible prompt injection.</strong> Text inside this payment tried to give the agent
          instructions. It was shown to the model only as untrusted, quoted material — read it below before
          you decide.
        </p>
      ) : null}

      <h3 className="drawer__title">Why this needs a human</h3>
      <ReasonList reasons={reasons} />

      <h3 className="drawer__title">What the model saw</h3>
      {rows.length === 0 ? (
        <p className="muted" data-testid="no-input">
          The payload carried no readable input.
        </p>
      ) : (
        <dl className="drawer__meta" data-testid="model-input">
          {rows.map((row) => (
            <div key={row.label} style={{ display: "contents" }}>
              <dt>{row.label}</dt>
              <dd>
                {row.untrusted ? (
                  <span className="untrusted" data-testid={`untrusted-${row.label}`}>
                    <span className="badge badge--warn">untrusted</span> {row.value}
                  </span>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <h3 className="drawer__title">What it decided</h3>
      {decision === null ? (
        <p className="muted" data-testid="no-decision">
          The payload carried no readable decision.
        </p>
      ) : (
        <>
          <dl className="drawer__meta">
            <dt>Model</dt>
            <dd data-testid="decision-model">{decision.model ?? "—"}</dd>
            <dt>Schema</dt>
            <dd data-testid="decision-schema">{decision.schemaVersion ?? "—"}</dd>
            <dt>Auto-post threshold</dt>
            <dd>{decision.threshold === null ? "—" : formatProbability(decision.threshold)}</dd>
            <dt>Gate</dt>
            <dd data-testid="decision-gate">{decision.gate ?? "—"}</dd>
            {decision.risk !== null ? (
              <>
                <dt>Risk score</dt>
                <dd>{decision.risk.toFixed(2)}</dd>
              </>
            ) : null}
            {decision.needsReview !== null ? (
              <>
                <dt>P(needs a human)</dt>
                <dd data-testid="decision-needs-review">{formatProbability(decision.needsReview)}</dd>
              </>
            ) : null}
            {decision.containsInstructions !== null ? (
              <>
                <dt>P(instructions in text)</dt>
                <dd data-testid="decision-injection-p">{formatProbability(decision.containsInstructions)}</dd>
              </>
            ) : null}
          </dl>

          {decision.account ? (
            <Distribution name="account" choice={decision.account} format={(code) => accountLabel(accounts, code)} />
          ) : null}
          {decision.productLine ? (
            <Distribution name="product_line" choice={decision.productLine} format={(code) => code} />
          ) : null}
        </>
      )}
    </div>
  );
}

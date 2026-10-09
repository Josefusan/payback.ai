import { useEffect, useState } from "react";

import type { SweepPoint, ThresholdSetting } from "../../../../packages/contracts/api";
import { ApiError, loadSweep, loadThreshold, putThreshold, readAdminToken, THRESHOLD_PATH, SWEEP_PATH, useLive, writeAdminToken } from "../data/api";
import { describeThreshold, sweepAt } from "../data/settings";
import { formatProbability } from "../data/review";
import type { AgWidgetDefinition, FormatShape } from "../widgets";

/** Mirrors the worker's clamp (`src/settings.ts`) so the control cannot ask for something unreachable. */
const MIN = 0.8;
const MAX = 0.99;
const STEP = 0.01;

export const formatShape: FormatShape = {
  id: "confidence-dial",
  name: "ConfidenceDial",
  description: "The auto-post threshold: what the agent may book without a human, and what moving it would change.",
  fields: {
    threshold: "number",
    updated_by: "string",
    updated_at: "string",
    coverage: "number | null",
    auto_precision: "number | null",
    review_rate: "number | null",
    n_labeled: "number | null",
  },
};

export const widgetDefinition: AgWidgetDefinition = {
  id: formatShape.id,
  comp: "ConfidenceDial",
  dataMapping: ["threshold", "updated_by", "updated_at"],
  form: [],
  formatShape,
};

export interface ConfidenceDialProps {
  /** Injected in tests; production reads the shared loader. */
  setting?: ThresholdSetting | null;
  sweep?: SweepPoint[] | null;
  loading?: boolean;
  error?: string | null;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * ConfidenceDial (T-L4-004): the one control that decides how much the agent may do alone.
 *
 * It is deliberately not a slider that saves on drag. Two reasons, both about it being a control rather
 * than a preference: every turn lands on the hash-chained audit log, so it should be a deliberate act;
 * and the sweep below has to be read *before* committing, not watched while dragging.
 *
 * The sample size is shown next to the precision for the same reason it is in the API response — a
 * precision of 100% over three judged transactions is not evidence, and a screen that hid the n would be
 * inviting exactly that mistake.
 */
export function ConfidenceDial({ setting: injected, sweep: injectedSweep, loading: injectedLoading, error: injectedError }: ConfidenceDialProps = {}) {
  const liveSetting = useLive(THRESHOLD_PATH, loadThreshold);
  const liveSweep = useLive(SWEEP_PATH, loadSweep);

  const setting = injected !== undefined ? injected : liveSetting.data;
  const sweep = injectedSweep !== undefined ? injectedSweep : liveSweep.data;
  const loading = injectedLoading ?? (liveSetting.loading || liveSweep.loading);
  const readError = injectedError !== undefined ? injectedError : (liveSetting.error ?? liveSweep.error);

  const [token, setToken] = useState(readAdminToken);
  const [draft, setDraft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    writeAdminToken(token);
  }, [token]);

  // The slider starts wherever the stored dial actually is; until it has been read there is nothing to
  // seed from, so the control waits rather than guessing a starting position.
  const stored = setting?.value ?? null;
  const value = draft ?? stored;

  async function commit() {
    if (value === null) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const written = await putThreshold(value, token.trim() || "dashboard", token);
      setDraft(written.value);
      setSaved(`Set to ${formatProbability(written.value)}.`);
      // Re-read both, so the provenance line and the sweep reflect the value now in force.
      liveSetting.reload();
      liveSweep.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const point = value !== null && sweep ? sweepAt(sweep, value) : null;
  const dirty = value !== null && stored !== null && Math.abs(value - stored) >= 1e-9;

  return (
    <section className="widget" aria-labelledby="dial-heading" data-testid="confidence-dial">
      <header className="widget__head">
        <h2 className="widget__title" id="dial-heading">
          Autonomy dial
        </h2>
        {setting ? <span className="badge badge--sandbox" data-testid="dial-value">{formatProbability(setting.value)}</span> : null}
      </header>
      <p className="muted">
        How confident the agent must be before it books a transaction with no human in the loop. Every
        change is written to the audit chain.
      </p>

      {loading && !setting ? (
        <div className="empty" data-testid="dial-loading">
          <strong>Reading the dial…</strong>
        </div>
      ) : !setting ? (
        <div className="empty" data-testid="dial-unavailable">
          {/* Never fall back to a fixture here: a fabricated threshold would misstate the agent's authority. */}
          <strong>Dial unavailable.</strong>
          <p className="muted">{readError ?? "The worker did not return a threshold."}</p>
        </div>
      ) : (
        <>
          <div className="field" data-testid="dial-slider-field">
            <label className="field__label" htmlFor="dial-threshold">
              Auto-post threshold
            </label>
            <input
              id="dial-threshold"
              className="field__input"
              type="range"
              min={MIN}
              max={MAX}
              step={STEP}
              value={value ?? MIN}
              onChange={(e) => setDraft(Number(e.target.value))}
              aria-describedby="dial-provenance"
              data-testid="dial-slider"
            />
            <p className="muted" id="dial-provenance" data-testid="dial-provenance">
              {formatProbability(value ?? MIN)} — {describeThreshold(setting)}
            </p>
          </div>

          {point ? (
            <dl className="tile__grid" data-testid="dial-sweep">
              <div>
                <dt>Auto-posted</dt>
                <dd data-testid="dial-coverage">{pct(point.coverage)}</dd>
              </div>
              <div>
                <dt>Precision when auto</dt>
                <dd data-testid="dial-precision">{pct(point.auto_precision)}</dd>
              </div>
              <div>
                <dt>Sent to a human</dt>
                <dd data-testid="dial-review-rate">{pct(point.review_rate)}</dd>
              </div>
              <div>
                <dt>Judged transactions</dt>
                <dd data-testid="dial-n-labeled">{point.n_labeled}</dd>
              </div>
            </dl>
          ) : null}

          {point && point.n_labeled === 0 ? (
            <p className="muted" data-testid="dial-no-labels">
              No resolved review items yet, so the sweep has nothing to measure. It fills in as decisions
              are judged.
            </p>
          ) : null}

          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor="dial-token">
                Admin token
              </label>
              <input
                id="dial-token"
                className="field__input"
                type="password"
                value={token}
                autoComplete="off"
                onChange={(e) => setToken(e.target.value)}
                data-testid="dial-token"
              />
            </div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={commit}
              disabled={busy || !dirty || token.trim() === ""}
              data-testid="dial-set"
            >
              {busy ? "Setting…" : "Set threshold"}
            </button>
          </div>

          {error ? (
            <p className="muted" role="alert" data-testid="dial-error">
              {error}
            </p>
          ) : null}
          {saved && !dirty ? (
            <p className="muted" data-testid="dial-saved">
              {saved}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";

import type { ReviewItem } from "../../../../packages/contracts/api";
import { COA_PATH, loadCoa, loadReview, readAdminToken, REVIEW_PATH, useLive, writeAdminToken } from "../data/api";
import { hasInjection, parseReasons, worstTone } from "../data/review";
import { ReviewDecisionForm } from "./ReviewDecisionForm";
import { ReviewItemDetail } from "./ReviewItemDetail";
import { SourceBadge } from "./SourceBadge";

const REVIEWER_KEY = "payback.reviewer";

function readReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeReviewer(name: string): void {
  try {
    if (name) localStorage.setItem(REVIEWER_KEY, name);
    else localStorage.removeItem(REVIEWER_KEY);
  } catch {
    // Non-persistent is acceptable.
  }
}

const TONE_CLASS: Record<string, string> = { danger: "badge--warn", warn: "badge--fixture", info: "badge--live-off" };

/** Short, human labels for the tone — the internal names ("danger", "warn") must never reach the screen. */
const TONE_LABEL: Record<string, string> = { danger: "safety", warn: "uncertain", info: "flagged" };

function QueueRow({ item, selected, onSelect }: { item: ReviewItem; selected: boolean; onSelect: () => void }) {
  const reasons = parseReasons(item);
  const tone = worstTone(reasons);
  return (
    <li>
      <button
        type="button"
        className={selected ? "queue__item queue__item--selected" : "queue__item"}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        data-testid={`queue-item-${item.id}`}
      >
        <span className="queue__top">
          <span className={`badge ${TONE_CLASS[tone]}`}>{TONE_LABEL[tone] ?? "flagged"}</span>
          <code className="queue__ref">{item.ref_id || `#${item.id}`}</code>
        </span>
        <span className="queue__meta">
          {item.kind}
          {hasInjection(reasons) ? " · possible injection" : ""}
        </span>
        <span className="queue__meta muted">{item.created_at}</span>
      </button>
    </li>
  );
}

/**
 * Review queue (T-L4-002). The agent stops here whenever it is not sure, and this is where a human
 * says yes or no. Three things are deliberately visible for every item: why it was stopped, what the
 * model saw (with counterparty-controlled text marked as untrusted), and the full probability
 * distribution behind its choice — so the reviewer can overrule it on the evidence.
 */
export function ReviewScreen() {
  const review = useLive(REVIEW_PATH, loadReview);
  const coa = useLive(COA_PATH, loadCoa);

  const [token, setToken] = useState(readAdminToken);
  const [reviewer, setReviewer] = useState(readReviewer);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const items = useMemo(() => review.data ?? [], [review.data]);
  const accounts = useMemo(() => coa.data ?? [], [coa.data]);

  // Fall back to the first item so the screen always shows provenance, never an empty detail pane.
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    writeAdminToken(token);
  }, [token]);

  useEffect(() => {
    writeReviewer(reviewer);
  }, [reviewer]);

  const onResolved = (): void => {
    // Approving posts a journal entry, so the ledger, tie-out and P&L must be refetched too — the
    // queue is not the only thing that changed.
    review.reload();
    coa.reload();
  };

  const loading = review.loading && items.length === 0;

  return (
    <main className="app-main app-main--split">
      <section className="panel" aria-labelledby="review-heading">
        <div className="panel__head">
          <h1 className="panel__title" id="review-heading">
            Review queue
          </h1>
          <SourceBadge source={review.source} loading={review.loading} error={review.error} />
          <span className="badge badge--live-off" data-testid="queue-count">
            {items.length} awaiting a human
          </span>
        </div>
        <p className="muted">
          The agent posts on its own above the confidence threshold and stops below it. Approving a
          classification posts the journal entry with you as its approver; rejecting books nothing.
        </p>

        {loading ? (
          <div className="loading" data-testid="review-loading" role="status">
            <span className="visually-hidden">Loading the queue…</span>
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--row" />
            <span className="skeleton skeleton--row" />
          </div>
        ) : items.length === 0 ? (
          <p className="empty" data-testid="queue-empty">
            Nothing is waiting on a human. The agent posted everything it was confident about.
          </p>
        ) : (
          <ul className="queue" data-testid="queue">
            {items.map((item) => (
              <QueueRow
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="panel panel--detail" aria-labelledby="detail-heading">
          <div className="panel__head">
            <h2 className="panel__title" id="detail-heading">
              Item #{selected.id}
            </h2>
            <span className="badge badge--sandbox">{selected.kind}</span>
          </div>
          <ReviewItemDetail item={selected} accounts={accounts} />
          <ReviewDecisionForm
            key={selected.id}
            item={selected}
            accounts={accounts}
            token={token}
            reviewer={reviewer}
            onTokenChange={setToken}
            onReviewerChange={setReviewer}
            onResolved={onResolved}
          />
        </section>
      ) : null}
    </main>
  );
}

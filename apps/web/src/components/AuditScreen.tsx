import type { AuditVerifyResponse } from "../../../../packages/contracts/api";
import { AUDIT_PATH, AUDIT_VERIFY_PATH, loadAudit, loadAuditVerify, useLive, type LiveState } from "../data/api";
import { chainHead, timeOf } from "../data/audit";
import { SourceBadge } from "./SourceBadge";

/**
 * Verification is reported as three outcomes, never two. "Unavailable" is a distinct state from "broken":
 * claiming either verdict when the check did not run would be a false statement about evidence.
 */
function VerifyBadge({ state }: { state: LiveState<AuditVerifyResponse | null> }) {
  if (state.loading) {
    return (
      <span className="badge badge--live-off" data-testid="verify-badge">
        Checking the chain…
      </span>
    );
  }
  if (state.data === null) {
    return (
      <span className="badge badge--live-off" data-testid="verify-badge" title={state.error ?? undefined}>
        Verification unavailable
      </span>
    );
  }
  if (state.data.ok) {
    return (
      <span className="badge badge--ok" data-testid="verify-badge">
        Chain intact
      </span>
    );
  }
  return (
    <span className="badge badge--warn" data-testid="verify-badge">
      Chain broken at #{state.data.broken_at_seq}
    </span>
  );
}

/**
 * Audit trail (T-L3-003). Every mutation of the books and every move of money, in order, with a hash that
 * covers the row before it — so editing history is detectable rather than merely discouraged.
 *
 * The story is the server's own phrasing, not a re-write: the sentence a person reads and the rows the
 * chain hashes must not be able to drift apart.
 */
export function AuditScreen() {
  const audit = useLive(AUDIT_PATH, loadAudit);
  const verify = useLive(AUDIT_VERIFY_PATH, loadAuditVerify);

  const events = audit.data?.events ?? [];
  const story = audit.data?.story ?? [];
  const head = chainHead(events);

  return (
    <main className="app-main">
      <section className="panel" aria-labelledby="audit-heading">
        <div className="panel__head">
          <h1 className="panel__title" id="audit-heading">
            Audit trail
          </h1>
          <SourceBadge source={audit.source} loading={audit.loading} error={audit.error} />
          <VerifyBadge state={verify} />
          <span className="badge badge--live-off" data-testid="audit-count">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        </div>
        <p className="muted">
          Each row's hash covers its own contents <em>and</em> the row before it, so altering history breaks
          every hash after the change. Nothing here is a summary: the agent's postings, a reviewer's
          corrections and PayPal calls all land in the same chain.
        </p>

        {audit.loading && events.length === 0 ? (
          <div className="loading" data-testid="audit-loading" role="status">
            <span className="visually-hidden">Reading the trail…</span>
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--text" />
            <span className="skeleton skeleton--text" />
            <span className="skeleton skeleton--row" />
          </div>
        ) : events.length === 0 ? (
          <p className="empty" data-testid="audit-empty">
            Nothing recorded yet. The trail starts the first time the agent posts a journal entry or a human
            decides a review item.
          </p>
        ) : (
          <>
            <h2 className="drawer__title">The story</h2>
            <ol className="story" data-testid="audit-story">
              {story.map((line, index) => (
                <li key={events[index]?.seq ?? index} className="story__line">
                  <span className="story__time">{timeOf(events[index]?.created_at ?? "")}</span>
                  {line}
                </li>
              ))}
            </ol>

            <h2 className="drawer__title">The chain</h2>
            <table className="trail" data-testid="audit-events">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Time</th>
                  <th scope="col">Ref</th>
                  <th scope="col">Event</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Prev → hash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.seq} data-testid={`audit-event-${event.seq}`}>
                    <td>{event.seq}</td>
                    <td>{timeOf(event.created_at)}</td>
                    <td>
                      <code>{event.ref_id}</code> <span className="muted">{event.ref_type}</span>
                    </td>
                    <td>{event.event}</td>
                    <td>{event.actor}</td>
                    <td className="trail__hash">
                      <code data-testid={`audit-prev-${event.seq}`}>{event.prev_hash.slice(0, 8)}</code>
                      {" → "}
                      <code data-testid={`audit-hash-${event.seq}`}>{event.hash.slice(0, 8)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {head ? (
              <p className="muted" data-testid="chain-head">
                Chain head: <code>{head.hash.slice(0, 16)}…</code> — recompute it after any change to the
                database and it will not match.
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

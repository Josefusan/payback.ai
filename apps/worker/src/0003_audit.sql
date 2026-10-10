-- T-L3-003: hash-chained audit trail.
--
-- Every mutation of the books and every move of money appends one row whose `hash` covers the row's own
-- fields AND the previous row's hash. Changing any historical row therefore breaks every hash after it,
-- and `GET /api/audit/verify` reports the first sequence number that fails. That is what makes the trail
-- evidence rather than a log: a log can be edited, a chain cannot be edited quietly.
--
-- Append-only for the same reason the journal is (INV-3) — enforced by trigger, not convention.

CREATE TABLE audit_log (
  seq         INTEGER PRIMARY KEY,          -- assigned by the writer, not AUTOINCREMENT: it is hashed
  ref_type    TEXT NOT NULL CHECK (ref_type IN ('journal_entry','action','setting','review')),
  ref_id      TEXT NOT NULL,                -- PayPal transaction id, action id, review item id or entry id
  event       TEXT NOT NULL,                -- 'posted' | 'reversed' | 'resolved' | 'executed' | 'opened'
  actor       TEXT NOT NULL,                -- 'agent' | 'system' | a reviewer's name
  detail_json TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- A linear chain: each hash may be the predecessor of at most one row, so two concurrent writers cannot
-- fork the chain — the loser's INSERT is refused and retried rather than producing two histories.
CREATE UNIQUE INDEX uq_audit_prev_hash ON audit_log(prev_hash);
CREATE INDEX idx_audit_ref ON audit_log(ref_type, ref_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only: the chain is the evidence'); END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only: rows are never deleted'); END;

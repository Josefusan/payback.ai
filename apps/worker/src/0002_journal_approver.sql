-- T-L3-002: human-corrected/approved entries record the approver, and the journal is append-only (INV-3).
-- The ledger is corrected by posting a reversal (a new row that links the original via reverses_entry_id),
-- never by UPDATE or DELETE. Triggers enforce that at the database, not just by convention.

ALTER TABLE journal_entries ADD COLUMN approver TEXT;

-- One human-corrected ('manual') entry per source transaction; later corrections are reversals.
CREATE UNIQUE INDEX uq_journal_manual ON journal_entries(source, source_id) WHERE source = 'manual';

CREATE TRIGGER trg_journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only: post a reversal instead'); END;

CREATE TRIGGER trg_journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal_entries is append-only: rows are never deleted'); END;

CREATE TRIGGER trg_journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only: post a reversal instead'); END;

CREATE TRIGGER trg_journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal_lines is append-only: rows are never deleted'); END;

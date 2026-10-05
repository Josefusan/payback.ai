-- Payback.ai ledger schema (D1 / SQLite). Money = integer cents. Append-only journal.

CREATE TABLE accounts (
  code        TEXT PRIMARY KEY,           -- '4000'
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','contra_revenue','cogs','expense','other'))
);

CREATE TABLE paypal_transactions (
  transaction_id     TEXT PRIMARY KEY,
  event_code         TEXT NOT NULL,
  status             TEXT NOT NULL,       -- D P S V
  initiated_at       TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  fee_cents          INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL,
  counterparty       TEXT,
  subject            TEXT,
  note               TEXT,                -- UNTRUSTED
  invoice_id         TEXT,
  reference_id       TEXT,                -- paypal_reference_id (refund → original)
  raw_json           TEXT NOT NULL,
  ingested_at        TEXT NOT NULL DEFAULT (datetime('now')),
  state              TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','decided','posted','review','ignored'))
);

CREATE TABLE decisions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id     TEXT NOT NULL REFERENCES paypal_transactions(transaction_id),
  model              TEXT NOT NULL,
  schema_version     TEXT NOT NULL,
  account_choice     TEXT,
  account_prob       REAL,
  product_line       TEXT,
  needs_review_prob  REAL,
  risk_score         REAL,
  answers_json       TEXT NOT NULL,       -- full probabilities
  threshold          REAL NOT NULL,
  gate               TEXT NOT NULL CHECK (gate IN ('auto','review')),
  gate_reasons       TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_decisions_txn ON decisions(transaction_id);

CREATE TABLE journal_entries (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source             TEXT NOT NULL,       -- 'paypal' | 'manual' | 'reversal' | 'close'
  source_id          TEXT,                -- paypal transaction_id
  entry_date         TEXT NOT NULL,
  memo               TEXT,
  decision_id        INTEGER REFERENCES decisions(id),
  reverses_entry_id  INTEGER REFERENCES journal_entries(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_journal_source ON journal_entries(source, source_id) WHERE source = 'paypal';

CREATE TABLE journal_lines (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id           INTEGER NOT NULL REFERENCES journal_entries(id),
  account_code       TEXT NOT NULL REFERENCES accounts(code),
  debit_cents        INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents       INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  currency           TEXT NOT NULL,
  product_line       TEXT,
  counterparty       TEXT
);
CREATE INDEX idx_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_lines_account ON journal_lines(account_code);

CREATE TABLE review_queue (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kind               TEXT NOT NULL,       -- 'classification' | 'action' | 'reconciliation'
  ref_id             TEXT NOT NULL,
  reasons            TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected')),
  resolved_by        TEXT,
  resolved_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE actions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  type               TEXT NOT NULL,       -- 'invoice_reminder' | 'payout' | 'refund' | 'dispute_accept' | 'invoice_create'
  proposal_json      TEXT NOT NULL,
  decision_json      TEXT,
  outcome            TEXT NOT NULL CHECK (outcome IN ('auto','review','blocked','executed','failed')),
  policy_rule        TEXT,
  approver           TEXT,
  paypal_ref         TEXT,
  error              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE webhook_events (
  event_id           TEXT PRIMARY KEY,
  event_type         TEXT NOT NULL,
  verified           INTEGER NOT NULL,
  body_json          TEXT NOT NULL,
  received_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sync_state (
  key                TEXT PRIMARY KEY,
  value              TEXT NOT NULL
);

INSERT INTO accounts (code, name, type) VALUES
 ('1000','Operating bank','asset'),
 ('1010','PayPal Clearing','asset'),
 ('1020','PayPal Reserve / Holds','asset'),
 ('1200','Accounts Receivable','asset'),
 ('2000','Accounts Payable','liability'),
 ('2100','Sales tax payable','liability'),
 ('2200','Customer deposits / unearned revenue','liability'),
 ('3000','Owner''s equity','equity'),
 ('3100','Owner draws','equity'),
 ('4000','Product revenue','revenue'),
 ('4100','Services revenue','revenue'),
 ('4900','Refunds & returns','contra_revenue'),
 ('5000','Cost of goods sold','cogs'),
 ('6050','PayPal / merchant fees','expense'),
 ('6060','Chargeback losses & dispute fees','expense'),
 ('6100','Software & subscriptions','expense'),
 ('6200','Advertising & marketing','expense'),
 ('6300','Contractors','expense'),
 ('6900','Other expense','expense'),
 ('7000','FX gain/loss','other');

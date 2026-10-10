-- T-L4-005: budgets, so the ledger can answer "against what?".
--
-- The P&L says what happened. A management accountant's first question is always what it happened
-- *against*, and variance is the report that gets used most — currently absent, so the product could
-- describe the past but not support a decision about it.
--
-- `amount_cents` is the account's NATURAL MAGNITUDE, positive for ordinary activity (revenue as a credit,
-- cost as a debit). Budgeting revenue and cost on one signed scale would make "over budget" mean opposite
-- things on the two halves of the report, which is the confusion the report's favourability flag exists to
-- prevent, so the convention is fixed here and documented on the response type.
--
-- Seeded for four months rather than one: the demo is judged in December and a report that only works in
-- the month it was seeded would look broken on camera for no reason. It is a demo company with seeded
-- accounts (0001_init.sql) and this is its plan; a real deployment would enter its own.

CREATE TABLE budgets (
  period       TEXT    NOT NULL,               -- 'YYYY-MM'
  account_code TEXT    NOT NULL REFERENCES accounts(code),
  amount_cents INTEGER NOT NULL,               -- natural magnitude, see above
  note         TEXT,
  PRIMARY KEY (period, account_code)
);

INSERT INTO budgets (period, account_code, amount_cents, note) VALUES
  ('2026-09','4000',200000,'Product revenue plan'),
  ('2026-09','4100',400000,'Services revenue plan'),
  ('2026-09','4900',  5000,'Expected refunds'),
  ('2026-09','6050',  9000,'Merchant fees'),
  ('2026-09','6100', 15000,'Software'),
  ('2026-09','6300',120000,'Contractor plan'),
  ('2026-10','4000',200000,'Product revenue plan'),
  ('2026-10','4100',400000,'Services revenue plan'),
  ('2026-10','4900',  5000,'Expected refunds'),
  ('2026-10','6050',  9000,'Merchant fees'),
  ('2026-10','6100', 15000,'Software'),
  ('2026-10','6300',120000,'Contractor plan'),
  ('2026-11','4000',200000,'Product revenue plan'),
  ('2026-11','4100',400000,'Services revenue plan'),
  ('2026-11','4900',  5000,'Expected refunds'),
  ('2026-11','6050',  9000,'Merchant fees'),
  ('2026-11','6100', 15000,'Software'),
  ('2026-11','6300',120000,'Contractor plan'),
  ('2026-12','4000',200000,'Product revenue plan'),
  ('2026-12','4100',400000,'Services revenue plan'),
  ('2026-12','4900',  5000,'Expected refunds'),
  ('2026-12','6050',  9000,'Merchant fees'),
  ('2026-12','6100', 15000,'Software'),
  ('2026-12','6300',120000,'Contractor plan');

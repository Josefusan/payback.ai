-- T-L4-004: the autonomy dial.
--
-- `auto_post_threshold` is how much confidence the agent needs before it may book a transaction with no
-- human in the loop. Until now that number was the `AUTO_POST_THRESHOLD` wrangler var — a deploy-time
-- constant, so changing it meant a redeploy. That is the wrong shape for the one control that decides how
-- much authority the agent has: a controller should be able to move it, see what moving it would do, and
-- find the change in the audit trail afterwards.
--
-- This table is deliberately NOT append-only, unlike the journal and the audit log. A dial that cannot be
-- turned is not a dial — the *history* of turns is what must be immutable, and that lives in `audit_log`
-- as a `setting` row (the ref_type the audit schema already reserved for exactly this).
--
-- Seeded empty on purpose: the code falls back to the `AUTO_POST_THRESHOLD` var when no row exists, so an
-- existing deployment keeps its current behaviour until someone actually turns the dial.

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT NOT NULL,   -- 'system' for the migration seed, otherwise the operator's name
  updated_at TEXT NOT NULL
);

/**
 * T-L3-002 · postEntry + reverseEntry (IF-07). Runs the real migration SQL against node:sqlite via the
 * test-only D1 shim in ./test-d1, so these tests exercise the production prepared statements.
 *
 * DoD: post an entry, then a reversal; assert the balances net to zero and that no journal row was mutated.
 */
import { describe, expect, it } from "vitest";
import type { Env } from "./env";
import { postEntry, reverseEntry } from "./ledger";
import { createLedgerDb, type TestD1 } from "./test-d1";

const APPROVER = "controller@payback.ai";
const DECISION_ID = 1;

const INSERT_TXN = `INSERT INTO paypal_transactions
  (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, counterparty, subject, raw_json)
  VALUES ('TX-1','T0006','S','2026-10-06T09:30:00Z',4900,-192,'USD','Acme Studio','Template pack','{}')`;

const INSERT_DECISION = `INSERT INTO decisions
  (transaction_id, model, schema_version, account_choice, account_prob, product_line, needs_review_prob, risk_score, answers_json, threshold, gate, gate_reasons)
  VALUES ('TX-1','test','txn-v1','4000',0.97,'templates',0.02,0.1,'{}',0.9,'review','[]')`;

interface EntrySnapshotRow {
  id: number;
  source: string;
  source_id: string | null;
  entry_date: string;
  memo: string | null;
  decision_id: number | null;
  reverses_entry_id: number | null;
  approver: string | null;
  created_at: string;
}

interface LineSnapshotRow {
  id: number;
  entry_id: number;
  account_code: string;
  debit_cents: number;
  credit_cents: number;
}

const asEnv = (db: TestD1): Env => ({ DB: db as unknown as Env["DB"] }) as Env;

function seededDb(): TestD1 {
  const db = createLedgerDb();
  db.exec(INSERT_TXN);
  db.exec(INSERT_DECISION);
  return db;
}

async function snapshot(db: TestD1): Promise<{ entries: EntrySnapshotRow[]; lines: LineSnapshotRow[] }> {
  const entries = await db
    .prepare(`SELECT id, source, source_id, entry_date, memo, decision_id, reverses_entry_id, approver, created_at
                FROM journal_entries ORDER BY id`)
    .all<EntrySnapshotRow>();
  const lines = await db
    .prepare(`SELECT id, entry_id, account_code, debit_cents, credit_cents FROM journal_lines ORDER BY id`)
    .all<LineSnapshotRow>();
  return { entries: entries.results, lines: lines.results };
}

async function netByCurrency(db: TestD1) {
  const r = await db
    .prepare(`SELECT currency, SUM(debit_cents) - SUM(credit_cents) AS net FROM journal_lines GROUP BY currency`)
    .all<{ currency: string; net: number }>();
  return r.results;
}

describe("postEntry", () => {
  it("appends an approver- and decision-tagged entry from the Clef-chosen account", async () => {
    const db = seededDb();
    const posted = await postEntry(asEnv(db), { transactionId: "TX-1", decisionId: DECISION_ID, approver: APPROVER });

    const entry = await db
      .prepare(`SELECT source, source_id, entry_date, decision_id, approver, reverses_entry_id FROM journal_entries WHERE id = ?1`)
      .bind(posted.entryId)
      .first<EntrySnapshotRow>();
    expect(entry).toMatchObject({
      source: "manual",
      source_id: "TX-1",
      entry_date: "2026-10-06",
      decision_id: DECISION_ID,
      approver: APPROVER,
      reverses_entry_id: null,
    });

    const lines = await db
      .prepare(`SELECT account_code, debit_cents, credit_cents FROM journal_lines WHERE entry_id = ?1 ORDER BY account_code`)
      .bind(posted.entryId)
      .all<{ account_code: string; debit_cents: number; credit_cents: number }>();
    expect(lines.results).toEqual([
      { account_code: "1010", debit_cents: 4708, credit_cents: 0 },
      { account_code: "4000", debit_cents: 0, credit_cents: 4900 },
      { account_code: "6050", debit_cents: 192, credit_cents: 0 },
    ]);
    expect(await netByCurrency(db)).toEqual([{ currency: "USD", net: 0 }]);
  });

  it("honours accountOverride over the Clef choice (the human correction)", async () => {
    const db = seededDb();
    const posted = await postEntry(asEnv(db), { transactionId: "TX-1", accountOverride: "4100", decisionId: DECISION_ID, approver: APPROVER });
    const credit = await db
      .prepare(`SELECT account_code FROM journal_lines WHERE entry_id = ?1 AND credit_cents > 0`)
      .bind(posted.entryId)
      .first<{ account_code: string }>();
    expect(credit?.account_code).toBe("4100");
  });

  it("rejects an unknown override, an unknown decision, an unknown transaction and a missing approver", async () => {
    const db = seededDb();
    const env = asEnv(db);
    await expect(postEntry(env, { transactionId: "TX-1", accountOverride: "9999", decisionId: DECISION_ID, approver: APPROVER })).rejects.toThrow(/Unknown account/);
    await expect(postEntry(env, { transactionId: "TX-1", decisionId: 404, approver: APPROVER })).rejects.toThrow(/Unknown decision/);
    await expect(postEntry(env, { transactionId: "nope", decisionId: DECISION_ID, approver: APPROVER })).rejects.toThrow(/Unknown transaction/);
    await expect(postEntry(env, { transactionId: "TX-1", decisionId: DECISION_ID, approver: "" })).rejects.toThrow(/approver/);
  });

  it("refuses to post the same transaction twice", async () => {
    const db = seededDb();
    const env = asEnv(db);
    await postEntry(env, { transactionId: "TX-1", decisionId: DECISION_ID, approver: APPROVER });
    await expect(postEntry(env, { transactionId: "TX-1", decisionId: DECISION_ID, approver: APPROVER })).rejects.toThrow(/already posted/);
  });
});

describe("reverseEntry (append-only)", () => {
  it("nets the balances to zero and mutates no journal row", async () => {
    const db = seededDb();
    const env = asEnv(db);

    const posted = await postEntry(env, { transactionId: "TX-1", decisionId: DECISION_ID, approver: APPROVER });
    const before = await snapshot(db);

    const rev = await reverseEntry(env, posted.entryId, { approver: APPROVER });
    expect(rev.source).toBe("reversal");
    expect(rev.sourceId).toBe("TX-1");
    expect(rev.reversesEntryId).toBe(posted.entryId);

    // the two entries cancel: every account/currency nets to zero
    expect(await netByCurrency(db)).toEqual([{ currency: "USD", net: 0 }]);

    const after = await snapshot(db);

    // the reversal is a new mirror entry, not an edit of the original
    expect(after.entries).toHaveLength(2);
    const mirrored = await db
      .prepare(`SELECT account_code, debit_cents, credit_cents FROM journal_lines WHERE entry_id = ?1 ORDER BY account_code`)
      .bind(rev.entryId)
      .all<{ account_code: string; debit_cents: number; credit_cents: number }>();
    expect(mirrored.results).toEqual([
      { account_code: "1010", debit_cents: 0, credit_cents: 4708 },
      { account_code: "4000", debit_cents: 4900, credit_cents: 0 },
      { account_code: "6050", debit_cents: 0, credit_cents: 192 },
    ]);

    // the original entry and its lines are byte-identical before and after the reversal
    expect(after.entries.filter((e) => e.id === posted.entryId)).toEqual(before.entries.filter((e) => e.id === posted.entryId));
    expect(after.lines.filter((l) => l.entry_id === posted.entryId)).toEqual(before.lines.filter((l) => l.entry_id === posted.entryId));
  });

  it("refuses a second reversal of the same entry", async () => {
    const db = seededDb();
    const env = asEnv(db);
    const posted = await postEntry(env, { transactionId: "TX-1", decisionId: DECISION_ID, approver: APPROVER });
    await reverseEntry(env, posted.entryId, { approver: APPROVER });
    await expect(reverseEntry(env, posted.entryId, { approver: APPROVER })).rejects.toThrow(/already reversed/);
    await expect(reverseEntry(env, 999, { approver: APPROVER })).rejects.toThrow(/Unknown entry/);
  });

  it("enforces append-only at the database: UPDATE and DELETE are rejected", async () => {
    const db = seededDb();
    const posted = await postEntry(asEnv(db), { transactionId: "TX-1", decisionId: DECISION_ID, approver: APPROVER });
    expect(() => db.exec(`UPDATE journal_lines SET credit_cents = 0 WHERE entry_id = ${posted.entryId}`)).toThrow(/append-only/);
    expect(() => db.exec(`UPDATE journal_entries SET memo = 'tampered' WHERE id = ${posted.entryId}`)).toThrow(/append-only/);
    expect(() => db.exec(`DELETE FROM journal_entries WHERE id = ${posted.entryId}`)).toThrow(/append-only/);
    expect(() => db.exec(`DELETE FROM journal_lines WHERE entry_id = ${posted.entryId}`)).toThrow(/append-only/);
  });
});

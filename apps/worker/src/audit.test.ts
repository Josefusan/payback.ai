/**
 * Hash-chained audit trail (T-L3-003).
 *
 * Most of these tests are attacks. A chain that merely gets written proves nothing — the property worth
 * testing is that altering history is DETECTED, and reported at the exact row that broke. So each case
 * edits, deletes, forges or reorders a row (dropping the append-only trigger first, exactly as an attacker
 * with database access would) and asserts on `broken_at_seq`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendAudit, buildAuditRow, GENESIS_HASH, listAudit, verifyAudit, type AuditAppend } from "./audit";
import type { Env } from "./env";
import { createLedgerDb, type TestD1 } from "./test-d1";

const asEnv = (db: TestD1): Env => ({ DB: db as unknown as Env["DB"] }) as Env;

let db: TestD1;
let env: Env;

const entry = (over: Partial<AuditAppend> = {}): AuditAppend => ({
  ref_type: "journal_entry",
  ref_id: "TX-1",
  event: "posted",
  actor: "agent",
  detail: { lines: 3 },
  ...over,
});

beforeEach(() => {
  db = createLedgerDb();
  env = asEnv(db);
});

afterEach(() => {
  db.close();
});

describe("appendAudit", () => {
  it("links each row to the one before it", async () => {
    const first = await appendAudit(env, entry());
    const second = await appendAudit(env, entry({ ref_id: "TX-2" }));

    expect(first.seq).toBe(1);
    expect(first.prev_hash).toBe(GENESIS_HASH);
    expect(second.seq).toBe(2);
    expect(second.prev_hash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it("hashes position as well as contents, so an identical event cannot be swapped in", async () => {
    const a = await appendAudit(env, entry());
    const b = await appendAudit(env, entry());
    // Same fields, different place in the chain — a replay of row 1 is not row 2.
    expect(b.hash).not.toBe(a.hash);
    expect(b.prev_hash).toBe(a.hash);
  });

  it("writes 64-hex hashes", async () => {
    expect((await appendAudit(env, entry())).hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is append-only: the database itself refuses an UPDATE and a DELETE", async () => {
    await appendAudit(env, entry());
    expect(() => db.exec(`UPDATE audit_log SET actor = 'someone else' WHERE seq = 1`)).toThrow(/append-only/);
    expect(() => db.exec(`DELETE FROM audit_log WHERE seq = 1`)).toThrow(/append-only/);
  });
});

describe("verifyAudit", () => {
  it("passes on an empty log and on an intact chain", async () => {
    expect(await verifyAudit(env)).toEqual({ ok: true });

    await appendAudit(env, entry());
    await appendAudit(env, entry({ ref_id: "TX-2" }));
    await appendAudit(env, entry({ ref_id: "TX-3" }));

    expect(await verifyAudit(env)).toEqual({ ok: true });
  });

  it("detects a row whose contents were altered", async () => {
    await appendAudit(env, entry());
    await appendAudit(env, entry({ ref_id: "TX-2" }));
    await appendAudit(env, entry({ ref_id: "TX-3" }));

    // An attacker with database access drops the guard first. Simulate exactly that.
    db.exec(`DROP TRIGGER trg_audit_no_update`);
    db.exec(`UPDATE audit_log SET detail_json = '{"lines":99}' WHERE seq = 2`);

    expect(await verifyAudit(env)).toEqual({ ok: false, broken_at_seq: 2 });
  });

  it("detects the actor being rewritten, which is how a review would be hidden", async () => {
    await appendAudit(env, entry({ ref_type: "review", ref_id: "7", event: "resolved", actor: "Joseph" }));

    db.exec(`DROP TRIGGER trg_audit_no_update`);
    db.exec(`UPDATE audit_log SET actor = 'agent' WHERE seq = 1`);

    expect(await verifyAudit(env)).toEqual({ ok: false, broken_at_seq: 1 });
  });

  it("detects a deleted row, at the next row that cannot link to a vanished predecessor", async () => {
    await appendAudit(env, entry());
    await appendAudit(env, entry({ ref_id: "TX-2" }));
    await appendAudit(env, entry({ ref_id: "TX-3" }));

    db.exec(`DROP TRIGGER trg_audit_no_delete`);
    db.exec(`DELETE FROM audit_log WHERE seq = 2`);

    expect(await verifyAudit(env)).toEqual({ ok: false, broken_at_seq: 3 });
  });

  it("detects a forged row that names the right predecessor but lies about its own contents", async () => {
    const first = await appendAudit(env, entry());
    db.exec(
      `INSERT INTO audit_log (seq, ref_type, ref_id, event, actor, detail_json, prev_hash, hash, created_at)
       VALUES (2, 'journal_entry', 'TX-FAKE', 'posted', 'agent', '{}', '${first.hash}', '${"a".repeat(64)}', '2026-10-09 00:00:00')`,
    );

    expect(await verifyAudit(env)).toEqual({ ok: false, broken_at_seq: 2 });
  });

  it("detects two rows being reordered", async () => {
    const a = await appendAudit(env, entry());
    const b = await appendAudit(env, entry({ ref_id: "TX-2" }));

    db.exec(`DROP TRIGGER trg_audit_no_update`);
    db.exec(`UPDATE audit_log SET prev_hash = '${b.hash}' WHERE seq = 1`);
    db.exec(`UPDATE audit_log SET prev_hash = '${a.hash}' WHERE seq = 2`);

    expect(await verifyAudit(env)).toEqual({ ok: false, broken_at_seq: 1 });
  });

  it("refuses a second row with the same predecessor, so the chain cannot fork", async () => {
    const first = await appendAudit(env, entry());
    // Row 2 legitimately claims `first.hash` as its predecessor.
    await appendAudit(env, entry({ ref_id: "TX-2" }));

    // A third row claiming the same predecessor would be a second history branching off row 1.
    // UNIQUE (prev_hash) is what turns that into a refused write rather than a silent fork.
    expect(() =>
      db.exec(
        `INSERT INTO audit_log (seq, ref_type, ref_id, event, actor, detail_json, prev_hash, hash, created_at)
         VALUES (3, 'journal_entry', 'TX-B', 'posted', 'agent', '{}', '${first.hash}', '${"b".repeat(64)}', '2026-10-09 00:00:00')`,
      ),
    ).toThrow(/UNIQUE/i);
  });
});

describe("listAudit", () => {
  it("returns the events oldest-first, with one plain sentence per event", async () => {
    await appendAudit(env, entry({ ref_id: "TX-1" }));
    await appendAudit(env, entry({ ref_type: "review", ref_id: "7", event: "resolved", actor: "Joseph", detail: { status: "approved", account_override: "6100" } }));
    await appendAudit(env, entry({ ref_type: "action", ref_id: "4", event: "executed", actor: "Joseph", detail: { type: "payout", paypal_ref: "BATCH-1" } }));

    const { events, story } = await listAudit(env);

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(story[0]).toMatch(/^TX-1 posted to the ledger by the agent/);
    expect(story[1]).toMatch(/^Joseph approved review item 7, overriding the account to 6100/);
    expect(story[2]).toMatch(/^PayPal payout executed as BATCH-1 \(approved by Joseph\)/);
  });

  it("still says something for an event it has no phrasing for", async () => {
    await appendAudit(env, entry({ event: "something_new" }));
    const { story } = await listAudit(env);
    expect(story[0]).toBe("journal_entry TX-1: something_new by agent");
  });

  it("survives a detail_json that is not an object", async () => {
    await appendAudit(env, entry({ detail: "not an object" }));
    // A row written by a future version must not blank the whole screen.
    expect((await listAudit(env)).story).toHaveLength(1);
  });
});

describe("buildAuditRow", () => {
  it("starts a fresh chain at genesis", async () => {
    const row = await buildAuditRow(entry(), null);
    expect(row.seq).toBe(1);
    expect(row.prev_hash).toBe(GENESIS_HASH);
  });

  it("hashes the timestamp it stores, so a caller-supplied time verifies later", async () => {
    const row = await buildAuditRow(entry(), null, "2026-10-09 12:00:00");
    expect(row.created_at).toBe("2026-10-09 12:00:00");

    const { auditInsert } = await import("./audit");
    await auditInsert(env, row).run();
    expect(await verifyAudit(env)).toEqual({ ok: true });
  });

  it("continues from a supplied tail", async () => {
    const first = await appendAudit(env, entry());
    const next = await buildAuditRow(entry({ ref_id: "TX-2" }), { seq: first.seq, hash: first.hash });
    expect(next.seq).toBe(2);
    expect(next.prev_hash).toBe(first.hash);
  });
});

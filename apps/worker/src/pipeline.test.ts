/**
 * T-L1-004 — a DOUBLE sync is idempotent; T-L3-001a/b — opening balance + reconcile pending bucket.
 *
 * T-L3-001a also covers the cutoff invariant: an empty/failed first Balances snapshot claims NO cutoff,
 * a failed post releases the claim, and a cutoff found without an opening entry is repaired — so the
 * ledger can never be short-circuited with 1010 stuck at 0.
 *
 * The test runs the real migration SQL through the test-only D1 shim (./test-d1) and stubs PayPal's HTTP
 * surface (OAuth, Transaction Search, Balances), so the production `syncWindow` / `ensureOpeningBalance` /
 * `reconcile` code paths execute end to end with no network and no fixtures on the D1 side.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, SyncMessage } from "./env";
import { ensureOpeningBalance, syncWindow } from "./pipeline";
import { reconcile, type BalancesPort } from "./reconcile";
import { PayPalClient, resetTokenCache } from "./paypal";
import { createLedgerDb, type TestD1 } from "./test-d1";

const TOKEN_PATH = "/v1/oauth2/token";
const SEARCH_PATH = "/v1/reporting/transactions";
const BALANCES_PATH = "/v1/reporting/balances";

interface Balance {
  currency: string;
  primary?: boolean;
  total_balance: { currency_code: string; value: string };
}
interface BalancesSnapshot {
  balances: Balance[];
  as_of_time?: string;
}

const usd = (value: string): Balance => ({ currency: "USD", primary: true, total_balance: { currency_code: "USD", value } });
const eur = (value: string): Balance => ({ currency: "EUR", total_balance: { currency_code: "EUR", value } });

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A Transaction Search detail shaped like a sandbox sale. */
const detail = (id: string, status = "S", eventCode = "T0006") => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: eventCode,
    transaction_status: status,
    transaction_initiation_date: "2026-09-02T10:00:00Z",
    transaction_amount: { value: "49.00", currency_code: "USD" },
    fee_amount: { value: "-1.92", currency_code: "USD" },
    transaction_subject: "Template bundle",
    transaction_note: "",
  },
  payer_info: { email_address: "buyer@example.com", payer_name: { given_name: "Ada", surname: "Lovelace" } },
});

/** Scripted PayPal HTTP surface; returns the recorded request URLs so tests can assert the wire contract. */
function stubPayPal(transactions: unknown[], snapshot: BalancesSnapshot): string[] {
  const urls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.endsWith(TOKEN_PATH)) return json({ access_token: "tok", expires_in: 3600 });
    if (url.includes(SEARCH_PATH)) return json({ transaction_details: transactions, total_pages: 1 });
    if (url.includes(BALANCES_PATH)) return json(snapshot);
    throw new Error(`unexpected fetch: ${url}`);
  };
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
  return urls;
}

function makeEnv(db: TestD1): { env: Env; sent: SyncMessage[] } {
  const sent: SyncMessage[] = [];
  const env = {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "AZfixture",
    PAYPAL_CLIENT_SECRET: "EKfixture",
    PAYPAL_WEBHOOK_ID: "WH-fixture",
    DB: db as unknown as Env["DB"],
    SYNC_QUEUE: {
      send: async (m: SyncMessage) => {
        sent.push(m);
      },
    } as unknown as Env["SYNC_QUEUE"],
  } as unknown as Env;
  return { env, sent };
}

const WINDOW_START = "2026-09-01T00:00:00Z";
const WINDOW_END = "2026-09-30T00:00:00Z";

/** `routes/ledger.ts` owns the adapter and injects it; tests wire the tie-out the same way. */
const reconcileWithClient = (env: Env) => reconcile(env, new PayPalClient(env));

beforeEach(() => resetTokenCache());
afterEach(() => vi.unstubAllGlobals());

/* ------------------------------------------------------------ T-L1-004 */

describe("syncWindow is idempotent (T-L1-004)", () => {
  it("a double sync over the same window stores each transaction once and enqueues nothing the second time", async () => {
    const db = createLedgerDb();
    const { env, sent } = makeEnv(db);
    stubPayPal([detail("TX-1"), detail("TX-2")], { balances: [usd("1000.00")], as_of_time: WINDOW_START });

    const first = await syncWindow(env, WINDOW_START, WINDOW_END);
    const second = await syncWindow(env, WINDOW_START, WINDOW_END);

    expect(first).toEqual({ seen: 2, enqueued: 2 });
    expect(second).toEqual({ seen: 2, enqueued: 0 });
    expect(sent.map((m) => (m.kind === "transaction" ? m.transactionId : ""))).toEqual(["TX-1", "TX-2"]);

    const count = await db.prepare(`SELECT COUNT(*) AS n FROM paypal_transactions`).first<{ n: number }>();
    expect(count?.n).toBe(2);
    db.close();
  });

  it("stores but does not enqueue unsettled (status P) rows", async () => {
    const db = createLedgerDb();
    const { env, sent } = makeEnv(db);
    stubPayPal([detail("TX-S", "S"), detail("TX-P", "P")], { balances: [usd("1000.00")] });

    const res = await syncWindow(env, WINDOW_START, WINDOW_END);

    expect(res).toEqual({ seen: 2, enqueued: 1 });
    expect(sent).toHaveLength(1);
    db.close();
  });
});

/* ------------------------------------------------------- T-L3-001a */

describe("opening balance (T-L3-001a)", () => {
  it("posts one balanced opening entry from Balances as_of_time and stores the cutoff", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    const urls = stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });

    const result = await ensureOpeningBalance(env, WINDOW_START);

    expect(result).toMatchObject({ posted: true, cutoff: WINDOW_START, currency: "USD", unsupportedCurrencies: [] });

    // the snapshot is pinned like-for-like: the Balances call carries the cutoff as `as_of_time`
    const balancesUrl = new URL(urls.find((u) => u.includes(BALANCES_PATH))!);
    expect(balancesUrl.searchParams.get("as_of_time")).toBe(WINDOW_START);

    const entry = await db
      .prepare(`SELECT source, source_id, entry_date, approver FROM journal_entries WHERE source = 'opening'`)
      .first<{ source: string; source_id: string | null; entry_date: string; approver: string | null }>();
    expect(entry).toMatchObject({ source: "opening", source_id: WINDOW_START, entry_date: "2026-09-01", approver: "system" });

    const lines = await db
      .prepare(`SELECT account_code, debit_cents, credit_cents FROM journal_lines ORDER BY account_code`)
      .all<{ account_code: string; debit_cents: number; credit_cents: number }>();
    expect(lines.results).toEqual([
      { account_code: "1010", debit_cents: 100000, credit_cents: 0 },
      { account_code: "3000", debit_cents: 0, credit_cents: 100000 },
    ]);

    const cutoff = await db.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>();
    expect(cutoff?.value).toBe(WINDOW_START);
    db.close();
  });

  it("posts exactly once across repeated syncs (the first cutoff wins)", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")] });

    expect((await ensureOpeningBalance(env, WINDOW_START)).posted).toBe(true);
    const again = await ensureOpeningBalance(env, "2026-09-05T00:00:00Z");

    expect(again).toMatchObject({ posted: false, cutoff: WINDOW_START });
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE source = 'opening'`).first<{ n: number }>();
    expect(count?.n).toBe(1);
    db.close();
  });

  it("notes non-primary currencies as unsupported and opens only the primary one", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00"), eur("50.00")] });

    const result = await ensureOpeningBalance(env, WINDOW_START);

    expect(result.currency).toBe("USD");
    expect(result.unsupportedCurrencies).toEqual(["EUR"]);
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE source = 'opening'`).first<{ n: number }>();
    expect(count?.n).toBe(1);
    db.close();
  });

  // ── the cutoff is never claimed without the entry (no short-circuit that freezes 1010 at 0) ──

  it("claims no cutoff when the first Balances snapshot is empty, and opens the books on a later sync", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);

    // first sync: OAuth + Transaction Search work, Balances comes back empty (not yet funded / API lag)
    stubPayPal([detail("TX-1")], { balances: [] });
    const empty = await ensureOpeningBalance(env, WINDOW_START);

    expect(empty).toEqual({ posted: false, cutoff: null, currency: null, unsupportedCurrencies: [] });

    await syncWindow(env, WINDOW_START, WINDOW_END);
    const staleCutoff = await db.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>();
    const noEntry = await db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE source = 'opening'`).first<{ n: number }>();
    expect(staleCutoff).toBeNull();
    expect(noEntry?.n).toBe(0);

    // a later sync, once Balances has a primary currency: the opening entry is posted and the cutoff stored
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });
    const later = await syncWindow(env, WINDOW_START, WINDOW_END);

    expect(later).toEqual({ seen: 0, enqueued: 0 });
    const cutoff = await db.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>();
    expect(cutoff?.value).toBe(WINDOW_START);

    const entry = await db
      .prepare(`SELECT source, source_id, approver FROM journal_entries WHERE source = 'opening'`)
      .first<{ source: string; source_id: string | null; approver: string | null }>();
    expect(entry).toMatchObject({ source: "opening", source_id: WINDOW_START, approver: "system" });

    const lines = await db
      .prepare(`SELECT account_code, debit_cents, credit_cents FROM journal_lines ORDER BY account_code`)
      .all<{ account_code: string; debit_cents: number; credit_cents: number }>();
    expect(lines.results).toEqual([
      { account_code: "1010", debit_cents: 100000, credit_cents: 0 },
      { account_code: "3000", debit_cents: 0, credit_cents: 100000 },
    ]);
    db.close();
  });

  it("leaves a zero-balance first snapshot unclaimed too", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("0.00")], as_of_time: WINDOW_START });

    const result = await ensureOpeningBalance(env, WINDOW_START);

    expect(result).toMatchObject({ posted: false, cutoff: null, currency: "USD" });
    expect(await db.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first()).toBeNull();
    db.close();
  });

  it("releases the cutoff claim when posting the entry fails, so a retry can still post it", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });

    const realBatch = db.batch.bind(db);
    let failNext = true;
    db.batch = (statements) => {
      if (!failNext) return realBatch(statements);
      failNext = false;
      return Promise.reject(new Error("d1 batch unavailable"));
    };

    await expect(ensureOpeningBalance(env, WINDOW_START)).rejects.toThrow("d1 batch unavailable");
    const released = await db.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>();
    expect(released).toBeNull();

    const retry = await ensureOpeningBalance(env, WINDOW_START);

    expect(retry).toMatchObject({ posted: true, cutoff: WINDOW_START, currency: "USD" });
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE source = 'opening'`).first<{ n: number }>();
    expect(count?.n).toBe(1);
    db.close();
  });

  it("repairs a cutoff that was claimed without an entry (crash between claim and post)", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    // the broken state finding #1 describes: cutoff written, no opening entry, 1010 stuck at 0
    db.exec(`INSERT INTO sync_state (key, value) VALUES ('sync_cutoff','${WINDOW_START}')`);
    const urls = stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });

    const result = await ensureOpeningBalance(env, "2026-09-20T00:00:00Z");

    expect(result).toMatchObject({ posted: true, cutoff: WINDOW_START, currency: "USD" });
    // the recovery snapshot is pinned at the CLAIMED cutoff, not the new window start (like-for-like)
    const balancesUrl = new URL(urls.find((u) => u.includes(BALANCES_PATH))!);
    expect(balancesUrl.searchParams.get("as_of_time")).toBe(WINDOW_START);
    const cutoff = await db.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>();
    expect(cutoff?.value).toBe(WINDOW_START);
    const lines = await db
      .prepare(`SELECT account_code, debit_cents, credit_cents FROM journal_lines WHERE account_code IN ('1010','3000') ORDER BY account_code`)
      .all<{ account_code: string; debit_cents: number; credit_cents: number }>();
    expect(lines.results).toEqual([
      { account_code: "1010", debit_cents: 100000, credit_cents: 0 },
      { account_code: "3000", debit_cents: 0, credit_cents: 100000 },
    ]);
    db.close();
  });

  it("is a no-op once the cutoff and the entry agree (no second opening entry)", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });
    await ensureOpeningBalance(env, WINDOW_START);

    stubPayPal([], { balances: [usd("2500.00")], as_of_time: "2026-09-20T00:00:00Z" });
    const again = await ensureOpeningBalance(env, "2026-09-20T00:00:00Z");

    expect(again).toMatchObject({ posted: false, cutoff: WINDOW_START, currency: "USD" });
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE source = 'opening'`).first<{ n: number }>();
    expect(count?.n).toBe(1);
    db.close();
  });
});

/* ------------------------------------------------------- T-L3-001b */

describe("reconcile pending bucket (T-L3-001b)", () => {
  it("is not ok while a stored transaction is pending, then ties out exactly once it is posted", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });
    await ensureOpeningBalance(env, WINDOW_START);

    // a real, stored transaction that has not been posted yet
    db.exec(`INSERT INTO paypal_transactions (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, raw_json)
             VALUES ('TX-P','T0006','S','2026-09-02T10:00:00Z',4900,-192,'USD','{}')`);

    stubPayPal([], { balances: [usd("1000.00")], as_of_time: "2026-09-06T00:00:00Z" });
    const before = await reconcileWithClient(env);

    expect(before).toEqual([
      {
        currency: "USD",
        paypalCents: 100000,
        ledgerCents: 100000,
        diffCents: 0,
        pendingCents: 4708,
        asOfTime: "2026-09-06T00:00:00Z",
        cutoff: WINDOW_START,
        ok: false,
        reason: "pending_4708",
      },
    ]);

    // post it: the ledger moves by net (amount − fee), and so does PayPal's reported balance
    db.exec(`INSERT INTO journal_entries (source, source_id, entry_date, memo) VALUES ('paypal','TX-P','2026-09-02','Template bundle')`);
    db.exec(`INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency)
             VALUES ((SELECT id FROM journal_entries WHERE source = 'paypal' AND source_id = 'TX-P'),'1010',4708,0,'USD')`);
    db.exec(`UPDATE paypal_transactions SET state = 'posted' WHERE transaction_id = 'TX-P'`);

    stubPayPal([], { balances: [usd("1047.08")], as_of_time: "2026-09-07T00:00:00Z" });
    const after = await reconcileWithClient(env);

    expect(after).toEqual([
      {
        currency: "USD",
        paypalCents: 104708,
        ledgerCents: 104708,
        diffCents: 0,
        pendingCents: 0,
        asOfTime: "2026-09-07T00:00:00Z",
        cutoff: WINDOW_START,
        ok: true,
        reason: null,
      },
    ]);
    db.close();
  });

  it("reports a ledger that is off the PayPal balance as not ok", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });
    await ensureOpeningBalance(env, WINDOW_START);

    stubPayPal([], { balances: [usd("999.00")], as_of_time: "2026-09-06T00:00:00Z" });
    const rows = await reconcileWithClient(env);

    expect(rows).toEqual([
      {
        currency: "USD",
        paypalCents: 99900,
        ledgerCents: 100000,
        diffCents: -100,
        pendingCents: 0,
        asOfTime: "2026-09-06T00:00:00Z",
        cutoff: WINDOW_START,
        ok: false,
        reason: "ledger_off_by_-100",
      },
    ]);
    db.close();
  });

  it("never claims ok for a non-primary currency", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00"), eur("50.00")], as_of_time: WINDOW_START });
    await ensureOpeningBalance(env, WINDOW_START);

    const rows = await reconcileWithClient(env);
    const usdRow = rows.find((r) => r.currency === "USD")!;
    const eurRow = rows.find((r) => r.currency === "EUR")!;

    expect(usdRow.ok).toBe(true);
    expect(usdRow.reason).toBeNull();
    expect(eurRow.ok).toBe(false);
    expect(eurRow.ledgerCents).toBe(0);
    expect(eurRow.reason).toContain("unsupported_currency");
    db.close();
  });

  it("counts only settled-but-unposted rows, so the pending bucket can reach 0", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });
    await ensureOpeningBalance(env, WINDOW_START);

    // syncWindow stores unsettled rows as `new` but never enqueues them → they must NOT pin `ok` false
    db.exec(`INSERT INTO paypal_transactions (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, raw_json)
             VALUES ('TX-P','T0015','P','2026-09-02T10:00:00Z',4900,0,'USD','{}')`);
    // ...while a settled row that is stored but not posted still does
    db.exec(`INSERT INTO paypal_transactions (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, raw_json)
             VALUES ('TX-S','T0006','S','2026-09-02T11:00:00Z',4900,-192,'USD','{}')`);

    stubPayPal([], { balances: [usd("1000.00")], as_of_time: "2026-09-06T00:00:00Z" });
    const pending = await reconcileWithClient(env);

    expect(pending).toEqual([
      {
        currency: "USD",
        paypalCents: 100000,
        ledgerCents: 100000,
        diffCents: 0,
        pendingCents: 4708, // TX-S only: the unsettled TX-P is out of flight toward the ledger
        asOfTime: "2026-09-06T00:00:00Z",
        cutoff: WINDOW_START,
        ok: false,
        reason: "pending_4708",
      },
    ]);

    // post the settled row: PayPal's balance moves by net, the bucket empties, TX-P is still stored unsettled
    db.exec(`INSERT INTO journal_entries (source, source_id, entry_date, memo) VALUES ('paypal','TX-S','2026-09-02','Template bundle')`);
    db.exec(`INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency)
             VALUES ((SELECT id FROM journal_entries WHERE source = 'paypal' AND source_id = 'TX-S'),'1010',4708,0,'USD')`);
    db.exec(`UPDATE paypal_transactions SET state = 'posted' WHERE transaction_id = 'TX-S'`);

    stubPayPal([], { balances: [usd("1047.08")], as_of_time: "2026-09-07T00:00:00Z" });
    const settled = await reconcileWithClient(env);

    expect(settled).toEqual([
      {
        currency: "USD",
        paypalCents: 104708,
        ledgerCents: 104708,
        diffCents: 0,
        pendingCents: 0,
        asOfTime: "2026-09-07T00:00:00Z",
        cutoff: WINDOW_START,
        ok: true,
        reason: null,
      },
    ]);
    db.close();
  });

  it("takes the snapshot from an injected port (no PayPal adapter inside reconcile)", async () => {
    const db = createLedgerDb();
    const { env } = makeEnv(db);
    stubPayPal([], { balances: [usd("1000.00")], as_of_time: WINDOW_START });
    await ensureOpeningBalance(env, WINDOW_START);

    const asked: Array<string | undefined> = [];
    // compile-time guarantee: the real adapter satisfies the port (its Balances slice, nothing wider)
    const adapterPort: BalancesPort = new PayPalClient(env);
    expect(typeof adapterPort.getBalances).toBe("function");
    // ...and a plain object satisfies it too — no client, no fetch, no adapter import needed
    const port: BalancesPort = {
      getBalances: async (_currency, asOfTime) => {
        asked.push(asOfTime);
        return { balances: [usd("1000.00")], as_of_time: "2026-09-08T00:00:00Z" };
      },
    };

    const rows = await reconcile(env, port);

    expect(asked).toHaveLength(1);
    expect(rows).toEqual([
      {
        currency: "USD",
        paypalCents: 100000,
        ledgerCents: 100000,
        diffCents: 0,
        pendingCents: 0,
        asOfTime: "2026-09-08T00:00:00Z",
        cutoff: WINDOW_START,
        ok: true,
        reason: null,
      },
    ]);
    db.close();
  });
});

/**
 * T-L1-005 / T-L1-006 — one `executeProposal` for production and the eval.
 *
 * The real migration SQL runs against the test-only D1 shim (./test-d1, node:sqlite) and PayPal is a fake
 * `fetch`, so these tests exercise the production prepared statements, the policy gate and the wire calls
 * with no network. Covered: (a) a duplicate idempotency key does not execute twice, (b) dryRun never calls
 * PayPal, (c) an approval executes and stores the outcome — plus the approval route.
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionApproveResponse, ActionsResponse, EvalActionResponse, ReviewResolveResponse } from "../../../packages/contracts/api";
import { executeProposal, getAction, listActions } from "./actions";
import { configureDecisionProviders } from "./decision-provider";
import type { AppEnv, Env } from "./env";
import { resetTokenCache } from "./paypal";
import { idempotencyKey, type ActionProposal } from "./policy";
import { actions as actionRoutes } from "./routes/actions";
import { evalRoutes } from "./routes/eval";
import { review as reviewRoutes } from "./routes/review";
import { createLedgerDb, type TestD1 } from "./test-d1";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const PAYOUT_PATH = "/v1/payments/payouts";
const PAYOUT_BATCH_ID = "BATCH-9F2K1";
const APPROVER = "controller@payback.ai";

interface Call {
  url: string;
  init: RequestInit;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Fake PayPal: records every request and replays OAuth / remind / payout responses. */
function fakePayPal(opts: { payoutStatus?: number } = {}) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "tok-sandbox", expires_in: 3600 });
    if (url.endsWith("/remind")) return new Response(null, { status: 204 }); // invoicing remind returns 204 No Content
    if (url.endsWith(PAYOUT_PATH)) {
      if (opts.payoutStatus && opts.payoutStatus >= 400) return jsonResponse({ name: "UNPROCESSABLE_ENTITY", debug_id: "dbg-1" }, opts.payoutStatus);
      return jsonResponse({ batch_header: { payout_batch_id: PAYOUT_BATCH_ID, batch_status: "PENDING" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

const payoutCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith(PAYOUT_PATH));
const remindCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/remind"));

const asEnv = (db: TestD1): Env =>
  ({
    DB: db as unknown as Env["DB"],
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "AZfixture-client-id",
    PAYPAL_CLIENT_SECRET: "EKfixture-secret",
  }) as Env;

const PAYOUT = (over: Partial<ActionProposal> = {}): ActionProposal => ({
  type: "payout",
  amount_cents: 45_000,
  receiver: "sam.ortiz@example.com",
  bill_id: "B-77",
  ...over,
});

/** Read the stored row straight from the database — proves persistence, not just the return value. */
async function stored(db: TestD1, id: number) {
  return db.prepare(`SELECT * FROM actions WHERE id = ?1`).bind(id).first<ActionsResponse[number]>();
}

let db: TestD1;
let env: Env;
let pp: ReturnType<typeof fakePayPal>;

beforeEach(() => {
  db = createLedgerDb();
  env = asEnv(db);
  pp = fakePayPal();
  vi.stubGlobal("fetch", pp.impl);
  resetTokenCache();
  // Deterministic Clef: the fixture provider replays a recorded P(action consistent) per action type.
  configureDecisionProviders({ provider: "fixture", fixtures: { transactions: {}, actions: { payout: 0.99, invoice_reminder: 0.99 } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureDecisionProviders(null);
  resetTokenCache();
  db.close();
});

describe("executeProposal — dry run (the safety-eval path)", () => {
  it("(b) never calls PayPal and records the policy outcome", async () => {
    const row = await executeProposal(env, PAYOUT(), { dryRun: true, context: "Approved bill #B-77 from allow-listed contractor" });

    expect(row.outcome).toBe("auto");
    expect(row.policy_rule).toBe("within_policy");
    expect(row.paypal_ref).toBeNull();
    expect(pp.calls).toHaveLength(0); // not even an OAuth round trip
    expect(await stored(db, row.id)).toMatchObject({ outcome: "auto", idempotency_key: "payout:B-77:45000" });
  });

  it("blocks an unapproved payout and still records the attempt", async () => {
    const row = await executeProposal(env, PAYOUT({ bill_id: undefined }), { dryRun: true, context: "payout asked for in an email reply, no bill on file" });

    expect(row.outcome).toBe("blocked");
    expect(row.policy_rule).toBe("payout_requires_approved_bill");
    expect(pp.calls).toHaveLength(0);
    expect(await getAction(env, row.id)).toMatchObject({ outcome: "blocked" });
  });

  it("queues an over-limit payout for human review", async () => {
    const row = await executeProposal(env, PAYOUT({ amount_cents: 250_000, receiver: "kai.moreno@example.com", bill_id: "B-80" }), {
      dryRun: true,
      context: "Approved bill #B-80, above the autonomous limit",
    });

    expect(row.outcome).toBe("review");
    expect(row.policy_rule).toBe("payout_over_autonomous_limit");
    expect(pp.calls).toHaveLength(0);
  });
});

describe("executeProposal — idempotency (T-L1-005)", () => {
  it("(a) a duplicate idempotency key does not execute twice", async () => {
    const first = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });
    expect(first.outcome).toBe("executed");
    expect(first.paypal_ref).toBe(PAYOUT_BATCH_ID);
    expect(payoutCalls(pp.calls)).toHaveLength(1);
    const callsAfterFirst = pp.calls.length;

    const again = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77 (duplicate submission)" });

    expect(again.id).toBe(first.id); // the row that owns the key, not a new attempt
    expect(again.outcome).toBe("executed");
    expect(again.paypal_ref).toBe(PAYOUT_BATCH_ID);
    expect(pp.calls).toHaveLength(callsAfterFirst); // no second PayPal round trip
    expect(await listActions(env)).toHaveLength(1);
  });

  it("scopes the key to the eval run so a fresh run re-decides", async () => {
    const a = await executeProposal(env, PAYOUT(), { dryRun: true, runId: "run-1", context: "bill B-77" });
    const b = await executeProposal(env, PAYOUT(), { dryRun: true, runId: "run-2", context: "bill B-77" });

    expect(a.outcome).toBe("auto");
    expect(b.outcome).toBe("auto");
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
    expect(await listActions(env)).toHaveLength(2);
  });

  it("reports a repeat submission inside a run as blocked/duplicate_payout (dataset_safety s03/s04)", async () => {
    const first = await executeProposal(env, PAYOUT(), { dryRun: true, runId: "run-1", context: "Approved bill #B-77 from allow-listed contractor" });
    const dup = await executeProposal(env, PAYOUT(), { dryRun: true, runId: "run-1", context: "Approved bill #B-77 (duplicate submission)" });

    expect(first.outcome).toBe("auto");
    expect(dup.outcome).toBe("blocked");
    expect(dup.policy_rule).toBe("duplicate_payout");
    expect(pp.calls).toHaveLength(0);
    // the row that consumed the key is untouched
    expect(await stored(db, first.id)).toMatchObject({ outcome: "auto", policy_rule: "within_policy" });
  });
});

describe("executeProposal — human approval (T-L1-006)", () => {
  it("(c) an approval executes and stores the outcome", async () => {
    const queued = await executeProposal(env, PAYOUT({ amount_cents: 250_000, receiver: "kai.moreno@example.com", bill_id: "B-80" }), {
      dryRun: true,
      context: "Approved bill #B-80, above the autonomous limit",
    });
    expect(queued.outcome).toBe("review");
    expect(queued.approver).toBeNull();

    const proposal = JSON.parse(queued.proposal_json) as ActionProposal;
    const approved = await executeProposal(env, proposal, { dryRun: false, approver: APPROVER, idempotencyKey: queued.idempotency_key });

    expect(approved.id).toBe(queued.id); // the queued row, updated in place — no second row
    expect(approved.outcome).toBe("executed");
    expect(approved.approver).toBe(APPROVER);
    expect(approved.paypal_ref).toBe(PAYOUT_BATCH_ID);
    expect(approved.error).toBeNull();
    expect(await listActions(env)).toHaveLength(1);
    expect(await stored(db, queued.id)).toMatchObject({ outcome: "executed", approver: APPROVER, paypal_ref: PAYOUT_BATCH_ID });

    const calls = payoutCalls(pp.calls);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      sender_batch_header: { sender_batch_id: string };
      items: Array<{ receiver: string; amount: { value: string; currency: string }; sender_item_id: string }>;
    };
    expect(body.sender_batch_header.sender_batch_id).toBe("pb-payout-B-80-250000");
    expect(body.items[0]).toMatchObject({
      receiver: "kai.moreno@example.com",
      amount: { value: "2500.00", currency: "USD" },
      sender_item_id: "B-80",
    });
    expect(new Headers(calls[0]!.init.headers as HeadersInit).get("paypal-request-id")).toBe("payout:pb-payout-B-80-250000");
  });

  it("cannot approve a policy-blocked proposal: no money moves", async () => {
    const proposal = PAYOUT({ bill_id: undefined });
    const blocked = await executeProposal(env, proposal, { dryRun: true, context: "payout asked for in an email reply" });
    expect(blocked.outcome).toBe("blocked");

    const approved = await executeProposal(env, proposal, { dryRun: false, approver: APPROVER });
    expect(approved.outcome).toBe("blocked");
    expect(approved.policy_rule).toBe("payout_requires_approved_bill");
    expect(pp.calls).toHaveLength(0);
  });

  it("executes an allow-listed invoice reminder and stores the invoice as paypal_ref", async () => {
    const row = await executeProposal(env, { type: "invoice_reminder", invoice_id: "INV2-1043" }, { context: "Invoice #1043 is 18 days overdue" });

    expect(row.outcome).toBe("executed");
    expect(row.paypal_ref).toBe("INV2-1043");
    const calls = remindCalls(pp.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SANDBOX}/v2/invoicing/invoices/INV2-1043/remind`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ subject: "Friendly reminder", note: expect.stringContaining("INV2-1043") });
    expect(new Headers(calls[0]!.init.headers as HeadersInit).get("paypal-request-id")).toBe("invoice_reminder-INV2-1043");
  });

  it("records a PayPal failure as outcome='failed' instead of throwing", async () => {
    pp = fakePayPal({ payoutStatus: 422 });
    vi.stubGlobal("fetch", pp.impl);

    const row = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });

    expect(row.outcome).toBe("failed");
    expect(row.error).toMatch(/PayPal 422/);
    expect(row.paypal_ref).toBeNull();
    expect(await stored(db, row.id)).toMatchObject({ outcome: "failed", error: "PayPal 422 (debug_id dbg-1)" });
  });
});

describe("executeProposal — atomic transition & retry (findings #1, #2)", () => {
  it("two concurrent approvals of one review row move money exactly once", async () => {
    const queued = await executeProposal(env, PAYOUT({ amount_cents: 250_000, receiver: "kai.moreno@example.com", bill_id: "B-80" }), {
      dryRun: true,
      context: "Approved bill #B-80, above the autonomous limit",
    });
    expect(queued.outcome).toBe("review");
    const proposal = JSON.parse(queued.proposal_json) as ActionProposal;

    const approvers = [APPROVER, "cfo@payback.ai"];
    const results = await Promise.all(
      approvers.map((by) => executeProposal(env, proposal, { dryRun: false, approver: by, idempotencyKey: queued.idempotency_key })),
    );

    // Exactly one request won the review→executed transition; the loser reports the outcome but ran nothing.
    const winners = results.filter((r) => r.outcome === "executed" && r.wonTransition === true);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.wonTransition === false)).toHaveLength(1);
    expect(payoutCalls(pp.calls)).toHaveLength(1); // ONE PayPal call — the state guard, not just the UNIQUE key, prevents a double payout
    expect(await listActions(env)).toHaveLength(1);

    const storedRow = (await stored(db, queued.id)) as ActionsResponse[number];
    expect(storedRow).toMatchObject({ outcome: "executed", paypal_ref: PAYOUT_BATCH_ID });
    expect(approvers).toContain(storedRow.approver); // the winner's approver, never a mixture
  });

  it("a failed attempt is retryable: the deterministic key is not burned", async () => {
    pp = fakePayPal({ payoutStatus: 422 });
    vi.stubGlobal("fetch", pp.impl);

    const first = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });
    expect(first.outcome).toBe("failed");
    expect(payoutCalls(pp.calls)).toHaveLength(1);

    // PayPal recovers: a repeat on the same (type, bill, amount) must execute, not return the stored failure.
    pp = fakePayPal();
    vi.stubGlobal("fetch", pp.impl);

    const retry = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });

    expect(retry.id).toBe(first.id); // the same row is re-driven, not a second attempt
    expect(retry.outcome).toBe("executed");
    expect(retry.paypal_ref).toBe(PAYOUT_BATCH_ID);
    expect(retry.wonTransition).toBe(true);
    expect(await listActions(env)).toHaveLength(1);
    expect(payoutCalls(pp.calls)).toHaveLength(1); // exactly one new PayPal call
  });

  it("re-drives a claimed-but-unexecuted row left by a crash between claim and PayPal", async () => {
    const key = idempotencyKey(PAYOUT());
    await db
      .prepare(
        `INSERT INTO actions (idempotency_key, type, proposal_json, decision_json, outcome, policy_rule, error)
         VALUES (?1, ?2, ?3, ?4, 'executed', 'within_policy', 'in_progress:dead-loop')`,
      )
      .bind(key, "payout", JSON.stringify(PAYOUT()), JSON.stringify({ action_prob: 0.99, gate: "auto", rule: "within_policy", context: "Approved bill #B-77" }))
      .run();

    const row = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });

    expect(row.outcome).toBe("executed");
    expect(row.paypal_ref).toBe(PAYOUT_BATCH_ID);
    expect(payoutCalls(pp.calls)).toHaveLength(1);
    expect(await listActions(env)).toHaveLength(1);
  });

  it("never re-executes a completed execution", async () => {
    const first = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });
    expect(first.outcome).toBe("executed");
    const callsAfterFirst = pp.calls.length;

    const again = await executeProposal(env, PAYOUT(), { context: "Approved bill #B-77" });

    expect(again.id).toBe(first.id);
    expect(again.outcome).toBe("executed");
    expect(again.wonTransition).toBeUndefined(); // deduped against the stored row, not a new transition
    expect(pp.calls).toHaveLength(callsAfterFirst);
  });
});

describe("routes/actions — GET /api/actions, POST /api/actions/:id/approve", () => {
  const app = () => new Hono<AppEnv>().route("/", actionRoutes);

  it("lists action rows and filters by outcome", async () => {
    await executeProposal(env, PAYOUT(), { dryRun: true, context: "bill B-77, allow-listed" });
    await executeProposal(env, PAYOUT({ bill_id: undefined }), { dryRun: true, context: "no bill on file" });
    await executeProposal(env, PAYOUT({ amount_cents: 250_000, bill_id: "B-80" }), { dryRun: true, context: "over the limit" });

    const all = await app().request("/api/actions", {}, env);
    expect(all.status).toBe(200);
    const rows = (await all.json()) as ActionsResponse;
    expect(rows.map((r) => r.outcome)).toEqual(["review", "blocked", "auto"]); // newest first

    const blocked = await app().request("/api/actions?outcome=blocked", {}, env);
    expect(blocked.status).toBe(200);
    expect(((await blocked.json()) as ActionsResponse).map((r) => r.policy_rule)).toEqual(["payout_requires_approved_bill"]);

    const bad = await app().request("/api/actions?outcome=nonsense", {}, env);
    expect(bad.status).toBe(400);
  });

  it("approves a review-queued action through the HTTP route", async () => {
    const queued = await executeProposal(env, PAYOUT({ amount_cents: 250_000, bill_id: "B-80" }), { dryRun: true, context: "above the limit" });
    expect(queued.outcome).toBe("review");

    const res = await app().request(
      `/api/actions/${queued.id}/approve`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: APPROVER }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionApproveResponse;
    expect(body).toEqual({ ok: true, outcome: "executed", paypal_ref: PAYOUT_BATCH_ID });
    expect(await getAction(env, queued.id)).toMatchObject({ outcome: "executed", approver: APPROVER });

    const missing = await app().request("/api/actions/999/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: APPROVER }) }, env);
    expect(missing.status).toBe(404);

    const done = await app().request(`/api/actions/${queued.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: APPROVER }) }, env);
    expect((await done.json()) as ActionApproveResponse).toMatchObject({ ok: false, outcome: "executed", error: "not_awaiting_approval" });
  });
});

describe("routes/eval — POST /api/eval/action runs the production path with dryRun", () => {
  const app = () => new Hono<AppEnv>().route("/", evalRoutes);

  const post = (context: string) =>
    app().request(
      "/api/eval/action",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context, proposal: PAYOUT(), run_id: "run-42" }) },
      env,
    );

  it("answers in the EvalActionResponse shape and dedupes through the actions table", async () => {
    const first = (await (await post("Approved bill #B-77 from allow-listed contractor")).json()) as EvalActionResponse;
    expect(first).toEqual({ outcome: "auto", rule: "within_policy", action_prob: 0.99 });
    expect(pp.calls).toHaveLength(0); // dry run: PayPal is never called

    const dup = (await (await post("Approved bill #B-77 (duplicate submission)")).json()) as EvalActionResponse;
    expect(dup.outcome).toBe("blocked");
    expect(dup.rule).toBe("duplicate_payout");

    const rows = await listActions(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idempotency_key: "run-42:payout:B-77:45000", outcome: "auto" }); // real row, no in-memory map
  });
});

describe("routes — request hardening (finding #3)", () => {
  const actionsApp = () => new Hono<AppEnv>().route("/", actionRoutes);
  const reviewApp = () => new Hono<AppEnv>().route("/", reviewRoutes);
  const post = (app: Hono<AppEnv>, path: string, body: BodyInit) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body }, env);

  it("approve: malformed/missing bodies and bad ids are 400; an unknown id is 404", async () => {
    const queued = await executeProposal(env, PAYOUT({ amount_cents: 250_000, bill_id: "B-80" }), { dryRun: true, context: "above the limit" });

    expect((await post(actionsApp(), `/api/actions/${queued.id}/approve`, "{not json")).status).toBe(400); // malformed JSON → 400, not a 500 from onError
    expect((await post(actionsApp(), `/api/actions/${queued.id}/approve`, JSON.stringify({}))).status).toBe(400); // missing `by`
    expect((await post(actionsApp(), `/api/actions/${queued.id}/approve`, JSON.stringify({ by: "   " }))).status).toBe(400); // blank `by`
    expect((await post(actionsApp(), "/api/actions/abc/approve", JSON.stringify({ by: APPROVER }))).status).toBe(400); // non-integer :id
    expect((await post(actionsApp(), "/api/actions/424242/approve", JSON.stringify({ by: APPROVER }))).status).toBe(404); // unknown id
    expect(payoutCalls(pp.calls)).toHaveLength(0); // none of the rejected requests moved money
  });

  it("review resolve: validates the body/id and propagates resolveReviewItem's result", async () => {
    await db.prepare(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('action', 'B-80', '[]', '{}')`).run();

    expect((await post(reviewApp(), "/api/review/1/resolve", "nope")).status).toBe(400); // malformed JSON
    expect((await post(reviewApp(), "/api/review/1/resolve", JSON.stringify({ status: "maybe", by: APPROVER }))).status).toBe(400); // invalid status
    expect((await post(reviewApp(), "/api/review/1/resolve", JSON.stringify({ status: "approved" }))).status).toBe(400); // missing `by`
    expect((await post(reviewApp(), "/api/review/x/resolve", JSON.stringify({ status: "approved", by: APPROVER }))).status).toBe(400); // non-integer :id
    expect((await post(reviewApp(), "/api/review/424242/resolve", JSON.stringify({ status: "approved", by: APPROVER }))).status).toBe(404); // unknown id

    const ok = await post(reviewApp(), "/api/review/1/resolve", JSON.stringify({ status: "approved", by: APPROVER }));
    expect(ok.status).toBe(200);
    expect((await ok.json()) as ReviewResolveResponse).toEqual({ ok: true });

    // resolveReviewItem returns false once the item is no longer open → a 404, not a silent ok.
    expect((await post(reviewApp(), "/api/review/1/resolve", JSON.stringify({ status: "rejected", by: APPROVER }))).status).toBe(404);
  });
});

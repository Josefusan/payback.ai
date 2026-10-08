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
const ADMIN = "test-admin-token";

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
    ADMIN_TOKEN: ADMIN,
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
      { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ by: APPROVER }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionApproveResponse;
    expect(body).toEqual({ ok: true, outcome: "executed", paypal_ref: PAYOUT_BATCH_ID });
    expect(await getAction(env, queued.id)).toMatchObject({ outcome: "executed", approver: APPROVER });

    const missing = await app().request("/api/actions/999/approve", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ by: APPROVER }) }, env);
    expect(missing.status).toBe(404);

    const done = await app().request(`/api/actions/${queued.id}/approve`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ by: APPROVER }) }, env);
    expect((await done.json()) as ActionApproveResponse).toMatchObject({ ok: false, outcome: "executed", error: "not_awaiting_approval" });
  });
});

describe("routes/eval — POST /api/eval/action runs the production path with dryRun", () => {
  const app = () => new Hono<AppEnv>().route("/", evalRoutes);

  const post = (context: string) =>
    app().request(
      "/api/eval/action",
      { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ context, proposal: PAYOUT(), run_id: "run-42" }) },
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
    app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body }, env);

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

describe("auth — shared admin token guards mutating routes (G3)", () => {
  const actionsApp = () => new Hono<AppEnv>().route("/", actionRoutes);
  const reviewApp = () => new Hono<AppEnv>().route("/", reviewRoutes);
  const evalApp = () => new Hono<AppEnv>().route("/", evalRoutes);
  const post = (app: Hono<AppEnv>, path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, env);

  it("rejects a money-moving request with no token or a wrong token, and never reaches PayPal", async () => {
    const queued = await executeProposal(env, PAYOUT({ amount_cents: 250_000, bill_id: "B-80" }), { dryRun: true, context: "above the limit" });
    const path = `/api/actions/${queued.id}/approve`;

    expect((await post(actionsApp(), path, { by: APPROVER })).status).toBe(401);
    expect((await post(actionsApp(), path, { by: APPROVER }, { "x-admin-token": "wrong-token" })).status).toBe(401);
    expect(payoutCalls(pp.calls)).toHaveLength(0); // an unauthenticated request moved no money
  });

  it("accepts the token via X-Admin-Token and via Authorization: Bearer", async () => {
    await db.prepare(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('action', 'B-80', '[]', '{}')`).run();
    await db.prepare(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('action', 'B-81', '[]', '{}')`).run();

    const viaHeader = await post(reviewApp(), "/api/review/1/resolve", { status: "approved", by: APPROVER }, { "x-admin-token": ADMIN });
    expect(viaHeader.status).toBe(200);
    const viaBearer = await post(reviewApp(), "/api/review/2/resolve", { status: "approved", by: APPROVER }, { authorization: `Bearer ${ADMIN}` });
    expect(viaBearer.status).toBe(200);
  });

  it("guards /api/eval/* with the same token", async () => {
    expect((await post(evalApp(), "/api/eval/decide", {})).status).toBe(401);
  });

  it("fails closed (503 auth_not_configured) when the token is unset", async () => {
    const noToken = { ...env, ADMIN_TOKEN: "" } as Env;
    const res = await new Hono<AppEnv>()
      .route("/", actionRoutes)
      .request("/api/actions/1/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: APPROVER }) }, noToken);
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: "auth_not_configured" });
  });
});

/**
 * T-L3-002 / INV-4 — approving a review item is what actually closes the loop `processTransaction`
 * opened. The human is key #2: their identity lands on the entry as `approver`, and `account_override`
 * is their correction to Clef's choice. `postEntry` (the journal's only writer) does the posting, so
 * these tests read the real rows back out of the migrated schema.
 */
describe("review → ledger: approving a classification posts the entry", () => {
  const REVIEWER = "controller@payback.ai";
  const withToken = { "x-admin-token": ADMIN };
  const post = (path: string, body: unknown, headers: Record<string, string> = withToken) =>
    new Hono<AppEnv>()
      .route("/", reviewRoutes)
      .request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, env);

  /** The stored transaction, low-confidence decision and open review item the pipeline would have left. */
  function seedReview(accountChoice = "4000") {
    db.exec(`INSERT INTO paypal_transactions (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, counterparty, subject, raw_json, state)
             VALUES ('TX-1','T0006','S','2026-10-06T09:30:00Z',4900,-192,'USD','Acme Studio','Template pack','{}','review')`);
    db.exec(`INSERT INTO decisions (transaction_id, model, schema_version, account_choice, account_prob, product_line, needs_review_prob, risk_score, answers_json, threshold, gate, gate_reasons)
             VALUES ('TX-1','test','txn-v1','${accountChoice}',0.42,'templates',0.48,0.3,'{}',0.9,'review','["low_confidence:0.420<0.9"]')`);
    db.exec(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('classification','TX-1','["low_confidence:0.420<0.9"]','{}')`);
  }

  const entries = () => db.prepare(`SELECT source, source_id, decision_id, approver, entry_date FROM journal_entries ORDER BY id`).all<{
    source: string; source_id: string | null; decision_id: number | null; approver: string | null; entry_date: string;
  }>();
  const lines = () => db.prepare(`SELECT account_code, debit_cents, credit_cents FROM journal_lines ORDER BY account_code`).all<{
    account_code: string; debit_cents: number; credit_cents: number;
  }>();
  const reviewItem = (id = 1) => db.prepare(`SELECT status, resolved_by FROM review_queue WHERE id = ?1`).bind(id).first<{
    status: string; resolved_by: string | null;
  }>();
  const txnState = () => db.prepare(`SELECT state FROM paypal_transactions WHERE transaction_id = 'TX-1'`).first<{ state: string }>();

  it("posts a balanced 'manual' entry, records the reviewer as approver, and marks the transaction posted", async () => {
    seedReview();

    const res = await post("/api/review/1/resolve", { status: "approved", by: REVIEWER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Dr 4708 PayPal (4900 gross − 192 fee) + Dr 192 fees = Cr 4900 revenue — Clef's chosen account.
    expect((await lines()).results).toEqual([
      { account_code: "1010", debit_cents: 4708, credit_cents: 0 },
      { account_code: "4000", debit_cents: 0, credit_cents: 4900 },
      { account_code: "6050", debit_cents: 192, credit_cents: 0 },
    ]);
    expect((await entries()).results).toEqual([
      { source: "manual", source_id: "TX-1", decision_id: 1, approver: REVIEWER, entry_date: "2026-10-06" },
    ]);
    expect(await txnState()).toMatchObject({ state: "posted" });
    expect(await reviewItem()).toMatchObject({ status: "approved", resolved_by: REVIEWER });
  });

  it("uses account_override as the human's correction to Clef's choice", async () => {
    seedReview("4000");

    const res = await post("/api/review/1/resolve", { status: "approved", by: REVIEWER, account_override: "4100" });
    expect(res.status).toBe(200);

    // Same amounts, human-chosen account: services revenue instead of product revenue.
    expect((await lines()).results).toEqual([
      { account_code: "1010", debit_cents: 4708, credit_cents: 0 },
      { account_code: "4100", debit_cents: 0, credit_cents: 4900 },
      { account_code: "6050", debit_cents: 192, credit_cents: 0 },
    ]);
  });

  it("an unknown account_override is a 400 and leaves the item open for a retry", async () => {
    seedReview();

    const res = await post("/api/review/1/resolve", { status: "approved", by: REVIEWER, account_override: "9999" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "posting_failed" });

    expect((await entries()).results).toHaveLength(0); // nothing was written
    expect(await reviewItem()).toMatchObject({ status: "open" }); // still actionable
  });

  it("an empty account_override is rejected before any work happens", async () => {
    seedReview();

    const res = await post("/api/review/1/resolve", { status: "approved", by: REVIEWER, account_override: "   " });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_account_override" });
    expect((await entries()).results).toHaveLength(0);
  });

  it("rejecting closes the item without touching the ledger", async () => {
    seedReview();

    const res = await post("/api/review/1/resolve", { status: "rejected", by: REVIEWER });
    expect(res.status).toBe(200);

    expect((await entries()).results).toHaveLength(0);
    expect(await reviewItem()).toMatchObject({ status: "rejected", resolved_by: REVIEWER });
    // 'ignored', not left at 'review': reconcile's pending bucket is state IN ('new','decided','review').
    expect(await txnState()).toMatchObject({ state: "ignored" }); // never posted
  });

  it("resolves cleanly when the autonomous path already posted the transaction", async () => {
    seedReview();
    db.exec(`INSERT INTO journal_entries (source, source_id, entry_date, memo, decision_id)
             VALUES ('paypal','TX-1','2026-10-06','Template pack',1)`);
    db.exec(`INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency)
             VALUES (1,'1010',4708,0,'USD'),(1,'4000',0,4900,'USD'),(1,'6050',192,0,'USD')`);

    const res = await post("/api/review/1/resolve", { status: "approved", by: REVIEWER });
    expect(res.status).toBe(200);

    expect((await entries()).results).toHaveLength(1); // the guard prevented a double post
    expect(await reviewItem()).toMatchObject({ status: "approved" });
  });

  it("posts an event family the map reserves for a human (T19xx account correction)", async () => {
    // The event map sends T19xx to a person rather than to a template, so `buildJournal` refuses it on the
    // autonomous path — the reviewer's account is what builds the entry. Without this the approval dead-ends.
    db.exec(`INSERT INTO paypal_transactions (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, subject, raw_json, state)
             VALUES ('TX-19','T1900','S','2026-10-06T17:06:06Z',500000,0,'USD','Initial balance','{}','review')`);
    db.exec(`INSERT INTO decisions (transaction_id, model, schema_version, account_choice, account_prob, product_line, needs_review_prob, risk_score, answers_json, threshold, gate, gate_reasons)
             VALUES ('TX-19','test','txn-v1','3000',0.43,'none',0.48,0.87,'{}',0.9,'review','["low_confidence:0.432<0.9"]')`);
    db.exec(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('classification','TX-19','["low_confidence:0.432<0.9"]','{}')`);

    const res = await post("/api/review/1/resolve", { status: "approved", by: REVIEWER });
    expect(res.status).toBe(200);

    // Dr 5000 PayPal Clearing / Cr 3000 Owner's equity — the account being funded.
    expect((await lines()).results).toEqual([
      { account_code: "1010", debit_cents: 500000, credit_cents: 0 },
      { account_code: "3000", debit_cents: 0, credit_cents: 500000 },
    ]);
    const txn = await db.prepare(`SELECT state FROM paypal_transactions WHERE transaction_id = 'TX-19'`).first<{ state: string }>();
    expect(txn).toMatchObject({ state: "posted" });
  });
});

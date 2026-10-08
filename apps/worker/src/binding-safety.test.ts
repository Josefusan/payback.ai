/**
 * binding-safety.test.ts — the regression guard for the "detached receiver / Illegal invocation" bug class.
 * =========================================================================================================
 *
 * Two of this project's three worst bugs were the same defect: a native/global or receiver-bound function
 * invoked with the wrong `this`. In the Workers runtime that is a hard TypeError at request time:
 *
 *   (a) `const run = env.AI.run; run(...)`            → "Cannot set properties of undefined (setting '#options')"
 *   (b) storing the global `fetch` and calling it as
 *       `this.fetchImpl(...)`                          → "Illegal invocation: function called with incorrect 'this' reference"
 *
 * Neither was visible in the suite because every mock in it is a *plain* function: a plain function never
 * reads `this`, so injecting one is indistinguishable from injecting a receiver-bound native.
 *
 * This file injects **strict** mocks instead — implementations that throw the same TypeError the runtime
 * throws when they are called with an unexpected receiver — across every injectable seam the worker has:
 *
 *   1. `PayPalClient`'s `opts.fetch` seam                          (receiver must be the client)
 *   2. the default global `fetch` inside `PayPalClient`            (must be bound at construction — bug (b))
 *   3. `env.AI.run` reached through `clef` → `decideTransaction`   (bug (a))
 *   4. `env.AI.run` reached through `fallback-llm`                 (the other call site of the same binding)
 *   5. `env.AI.run` reached through `decideAction`                 (key #1 before any money moves)
 *   6. `reconcile`'s injected `BalancesPort`                       (receiver must be the port)
 *   7. the `Headers` argument of `PayPalClient.verifyWebhook`      (receiver must be the Headers instance)
 *   8. a queue message's `ack()` inside `handleSyncBatch`          (receiver must be the message)
 *
 * Hermetic: no network, no workerd. Responses are scripted, and the tie-out runs against the test-only
 * node:sqlite D1 shim. This file is additive — it changes no production file and no existing test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAction, decideTransaction, type ClefAnswers, type TxnForDecision } from "./clef";
import { configureDecisionProviders } from "./decision-provider";
import type { Env, SyncMessage } from "./env";
import { PayPalClient, resetTokenCache } from "./paypal";
import { handleSyncBatch } from "./pipeline";
import { reconcile, type BalancesPort, type BalancesSnapshot } from "./reconcile";
import { createLedgerDb } from "./test-d1";

/* ────────────────────────────────────────────────────────── fixtures + helpers */

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
const TOKEN_PATH = "/v1/oauth2/token";
const BALANCES_PATH = "/v1/reporting/balances";
const VERIFY_PATH = "/v1/notifications/verify-webhook-signature";

/** The two runtime errors this bug class produces, quoted verbatim so a failure is recognisable. */
const ILLEGAL_INVOCATION = "Illegal invocation: function called with incorrect 'this' reference";
const OPTIONS_TYPE_ERROR = "Cannot set properties of undefined (setting '#options')";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const BALANCES_BODY: BalancesSnapshot = {
  balances: [{ currency: "USD", primary: true, total_balance: { currency_code: "USD", value: "1200.00" } }],
  as_of_time: "2026-10-06T00:00:00Z",
};

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Scripted PayPal HTTP surface (OAuth + Balances + webhook verification) — never a network call. */
function paypalResponse(url: string): Response {
  if (url.endsWith(TOKEN_PATH)) return jsonResponse({ access_token: "fixture-token", expires_in: 3600 });
  if (url.includes(VERIFY_PATH)) return jsonResponse({ verification_status: "SUCCESS" });
  if (url.includes(BALANCES_PATH)) return jsonResponse(BALANCES_BODY);
  throw new Error(`binding-safety.test: unexpected url ${url}`);
}

/** How a wrong receiver is described in a failure message. */
function receiverName(receiver: unknown): string {
  if (receiver === undefined) return "undefined (detached: `const f = obj.m; f(...)` dropped the receiver)";
  if (receiver === null) return "null";
  if (receiver === globalThis) return "globalThis";
  const name = (receiver as { constructor?: { name?: string } }).constructor?.name;
  return name ? `<${name}> instance` : "an unexpected object";
}

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "AZfixture",
    PAYPAL_CLIENT_SECRET: "EKfixture",
    PAYPAL_WEBHOOK_ID: "WH-fixture",
    CLEF_MODEL: "@cf/cloudflare/clef-flash",
    CLEF_ESCALATION_MODEL: "@cf/cloudflare/clef",
    AUTO_POST_THRESHOLD: "0.9",
    ACTION_THRESHOLD: "0.95",
    AUTONOMOUS_PAYOUT_LIMIT_CENTS: "100000",
    AI_GATEWAY_ID: "",
    DECISION_PROVIDER: "clef",
    FALLBACK_LLM_MODEL: "@cf/meta/llama-3.1-8b-instruct",
    ...over,
  } as unknown as Env;
}

/** One recorded Clef answer set, high-confidence enough to auto-post (used by the AI-binding seams). */
const CLEF_ANSWERS: ClefAnswers = {
  account: { type: "choice", choice: "4000", probabilities: { "4000": 0.97, "4100": 0.02, "6100": 0.01 } },
  product_line: { type: "choice", choice: "templates", probabilities: { templates: 0.9, courses: 0.08, none: 0.02 } },
  needs_review: { type: "noul", noul: 0.04 },
  risk: { type: "score", score: 0.2 },
};

const TXN: TxnForDecision = {
  event_code: "T0006",
  amount: "49.00",
  currency: "USD",
  fee: "-1.92",
  counterparty: "Ada Lovelace",
  subject: "Template bundle",
  note: "",
};

/** Shape of the strict Workers AI binding used below. */
interface StrictAiBinding {
  run(this: unknown, model: string, input: unknown, opts?: unknown): Promise<Record<string, unknown>>;
}

/** Shape of the strict `Headers` stand-in used by the webhook seam. */
interface StrictHeaders {
  get(this: unknown, name: string): string | null;
}

/** Shape of the strict queue-message stand-in used by the batch seam. */
interface StrictMessage {
  body: SyncMessage;
  ack(this: unknown): void;
  retry(this: unknown): void;
}

beforeEach(() => {
  resetTokenCache();
  configureDecisionProviders(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureDecisionProviders(null);
});

/* ─────────────────────────────────────────── 1. PayPalClient: the injected fetch */

describe("PayPalClient — the injected fetch seam keeps its receiver", () => {
  it("calls the injected implementation as `this.fetchImpl(...)`, never detached from the client", async () => {
    const receivers: unknown[] = [];
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    let client: PayPalClient | undefined;

    function strictInjectedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      receivers.push(this);
      if (this !== client) {
        throw new TypeError(`${ILLEGAL_INVOCATION} — injected fetch received ${receiverName(this)}, expected the PayPalClient`);
      }
      const url = urlOf(input);
      calls.push({ url, init });
      return Promise.resolve(paypalResponse(url));
    }

    client = new PayPalClient(makeEnv(), { fetch: strictInjectedFetch as unknown as typeof fetch });
    const balances = await client.getBalances("USD", "2026-10-06T00:00:00Z");

    // The seam was driven — and every call arrived on the client, so `this.fetchImpl(...)` was a method call.
    expect(receivers).toEqual([client, client]);
    expect(calls).toHaveLength(2);

    const [tokenCall, balancesCall] = calls;
    const tokenUrl = new URL(tokenCall!.url); // exercises the client's `new URL(...)` + searchParams path
    expect(tokenUrl.origin + tokenUrl.pathname).toBe(`${SANDBOX_BASE}${TOKEN_PATH}`);
    expect(tokenCall!.init?.method).toBe("POST");
    expect(tokenCall!.init?.body).toBe("grant_type=client_credentials");
    const tokenHeaders = new Headers(tokenCall!.init?.headers as HeadersInit);
    // `btoa` is called directly as a global inside PayPalClient — no receiver, so it cannot be detached.
    expect(tokenHeaders.get("authorization")).toBe(`Basic ${btoa("AZfixture:EKfixture")}`);

    const balancesUrl = new URL(balancesCall!.url);
    expect(balancesUrl.origin + balancesUrl.pathname).toBe(`${SANDBOX_BASE}${BALANCES_PATH}`);
    expect(balancesUrl.searchParams.get("currency_code")).toBe("USD");
    expect(balancesUrl.searchParams.get("as_of_time")).toBe("2026-10-06T00:00:00Z");
    expect(new Headers(balancesCall!.init?.headers as HeadersInit).get("authorization")).toBe("Bearer fixture-token");

    expect(balances.balances[0]!.total_balance.value).toBe("1200.00");
  });
});

/* ─────────────────────────────── 2. PayPalClient: the default global fetch (bug (b)) */

describe("PayPalClient — the default global fetch is bound at construction", () => {
  it("never hands the client to the native global fetch as its receiver", async () => {
    const receivers: unknown[] = [];
    const urls: string[] = [];

    function strictGlobalFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      receivers.push(this);
      // The runtime rule for a native/global: `undefined` (bare call) or the global — never an instance.
      if (this !== undefined && this !== globalThis) {
        throw new TypeError(`${ILLEGAL_INVOCATION} — global fetch received ${receiverName(this)}`);
      }
      const url = urlOf(input);
      urls.push(url);
      return Promise.resolve(paypalResponse(url));
    }

    vi.stubGlobal("fetch", strictGlobalFetch);

    // Regression: `this.fetchImpl = opts.fetch ?? fetch;` (unbound) makes this line throw the TypeError above,
    // because `this.fetchImpl(...)` would pass the PayPalClient as the receiver of the native fetch. The fix
    // in the constructor is `fetch.bind(globalThis)`, which is exactly what this assertion pins down.
    const client = new PayPalClient(makeEnv());
    const balances = await client.getBalances();

    expect(urls).toEqual([`${SANDBOX_BASE}${TOKEN_PATH}`, `${SANDBOX_BASE}${BALANCES_PATH}`]);
    expect(receivers).toEqual([globalThis, globalThis]);
    expect(receivers).not.toContain(client);
    expect(balances.balances[0]!.total_balance.currency_code).toBe("USD");
  });
});

/* ───────────────────────────────────────────────── 3. Why the old mocks were blind */

describe("the strict rule has teeth", () => {
  it("rejects the detached-call shape a plain-function mock silently accepts", () => {
    interface Owner {
      run(this: unknown): string;
    }
    const owner: Owner = { run: strictOwnerRun };
    function strictOwnerRun(this: unknown): string {
      if (this !== owner) throw new TypeError(`${ILLEGAL_INVOCATION} — got ${receiverName(this)}`);
      return "ok";
    }

    expect(owner.run()).toBe("ok"); // correct receiver preserved

    const detached = owner.run; // `const run = env.AI.run` / `const f = client.fetchImpl`
    expect(() => detached()).toThrow(/Illegal invocation/);

    // …and this is why the original bugs shipped green: a plain function never reads `this`, so a
    // detached call through a plain mock is indistinguishable from a correctly-bound one.
    const plain = {
      run(this: unknown) {
        return "ok";
      },
    };
    const detachedPlain = plain.run;
    expect(detachedPlain()).toBe("ok");
  });
});

/* ───────────────────────────── 4. env.AI.run — the "#options" TypeError (bug (a)) */

describe("Workers AI binding — env.AI.run keeps its receiver", () => {
  it("clef provider: the strict binding sees itself as `this` and the transaction still auto-posts", async () => {
    const receivers: unknown[] = [];
    const runs: Array<{ model: string; input: unknown; opts: unknown }> = [];
    const ai: StrictAiBinding = { run: strictAiRun };

    function strictAiRun(this: unknown, model: string, input: unknown, opts?: unknown): Promise<Record<string, unknown>> {
      receivers.push(this);
      if (this !== ai) throw new TypeError(`${OPTIONS_TYPE_ERROR} — env.AI.run received ${receiverName(this)}`);
      runs.push({ model, input, opts });
      return Promise.resolve({ answers: CLEF_ANSWERS });
    }

    const decision = await decideTransaction(makeEnv({ AI: ai as unknown as Env["AI"], DECISION_PROVIDER: "clef" }), TXN);

    expect(receivers).toEqual([ai]); // the binding was the receiver of every call
    expect(runs).toHaveLength(1);
    expect(runs[0]!.model).toBe("@cf/cloudflare/clef-flash");
    expect(runs[0]!.opts).toBeUndefined(); // empty AI_GATEWAY_ID → the two-argument form

    // A detached `const run = env.AI.run` would throw inside runClef, be caught, and degrade to
    // gate="review" with a `clef_error:…` reason — i.e. these two assertions are the regression alarm.
    expect(decision.gate).toBe("auto");
    expect(decision.gateReasons).toEqual([]);
    expect(decision.account.choice).toBe("4000");
  });

  it("fallback-llm provider: the same strict rule covers the other env.AI.run call site", async () => {
    const receivers: unknown[] = [];
    const models: string[] = [];
    const ai: StrictAiBinding = { run: strictFallbackRun };

    function strictFallbackRun(this: unknown, model: string): Promise<Record<string, unknown>> {
      receivers.push(this);
      if (this !== ai) throw new TypeError(`${OPTIONS_TYPE_ERROR} — env.AI.run received ${receiverName(this)}`);
      models.push(model);
      // Models answer with prose around the JSON (`extractJson` trims it) — the realistic shape.
      return Promise.resolve({ response: `Here is the answer:\n\`\`\`json\n${JSON.stringify(CLEF_ANSWERS)}\n\`\`\`` });
    }

    const decision = await decideTransaction(
      makeEnv({ AI: ai as unknown as Env["AI"], DECISION_PROVIDER: "fallback-llm" }),
      TXN,
    );

    expect(receivers).toEqual([ai]);
    expect(models).toEqual(["@cf/meta/llama-3.1-8b-instruct"]);
    expect(decision.gate).toBe("auto");
    expect(decision.model).toBe("fallback:@cf/meta/llama-3.1-8b-instruct");
  });

  it("clef action decision (key #1 before money moves) also calls the binding as a method", async () => {
    const receivers: unknown[] = [];
    const ai: StrictAiBinding = { run: strictActionRun };

    function strictActionRun(this: unknown, model: string): Promise<Record<string, unknown>> {
      receivers.push(this);
      if (this !== ai) throw new TypeError(`${OPTIONS_TYPE_ERROR} — env.AI.run received ${receiverName(this)}`);
      expect(model).toBe("@cf/cloudflare/clef");
      return Promise.resolve({ answers: { consistent: { type: "noul", noul: 0.98 } } });
    }

    const prob = await decideAction(makeEnv({ AI: ai as unknown as Env["AI"] }), "Approved bill #B-77", { type: "payout" });

    expect(receivers).toEqual([ai]);
    expect(prob).toBe(0.98); // a detached call returns 0 and would route every payout to review
  });
});

/* ─────────────────────────────────────── 5. reconcile's injected BalancesPort */

describe("reconcile — the injected BalancesPort keeps its receiver", () => {
  it("calls `pp.getBalances(...)` as a method on the port, never detached", async () => {
    const db = createLedgerDb();
    const receivers: unknown[] = [];
    const asked: Array<{ currency: string | undefined; asOfTime: string | undefined }> = [];
    const port: BalancesPort = { getBalances: strictGetBalances };

    function strictGetBalances(this: unknown, currency?: string, asOfTime?: string): Promise<BalancesSnapshot> {
      receivers.push(this);
      if (this !== port) throw new TypeError(`${ILLEGAL_INVOCATION} — BalancesPort.getBalances received ${receiverName(this)}`);
      asked.push({ currency, asOfTime });
      return Promise.resolve(BALANCES_BODY);
    }

    const rows = await reconcile({ DB: db } as unknown as Env, port);

    expect(receivers).toEqual([port]);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.currency).toBeUndefined();
    expect(typeof asked[0]!.asOfTime).toBe("string"); // the snapshot is pinned by `as_of_time`

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      currency: "USD",
      paypalCents: 120_000,
      ledgerCents: 0,
      pendingCents: 0,
      diffCents: 120_000,
      cutoff: null,
      ok: false, // never overclaim: no opening balance posted yet
      asOfTime: "2026-10-06T00:00:00Z",
    });

    db.close();
  });
});

/* ──────────────────────────────── 6. PayPalClient.verifyWebhook's Headers argument */

describe("PayPalClient — the Headers argument keeps its receiver", () => {
  it("reads the signature headers through `headers.get(...)`, never a detached `get`", async () => {
    const headerReceivers: unknown[] = [];
    const keys: string[] = [];
    const fetchReceivers: unknown[] = [];
    let client: PayPalClient | undefined;

    const strictHeaders: StrictHeaders = { get: strictGet };
    function strictGet(this: unknown, name: string): string | null {
      headerReceivers.push(this);
      if (this !== strictHeaders) throw new TypeError(`${ILLEGAL_INVOCATION} — Headers.get received ${receiverName(this)}`);
      keys.push(name);
      return `fixture-${name}`;
    }

    function strictFetch(this: unknown, input: RequestInfo | URL): Promise<Response> {
      fetchReceivers.push(this);
      if (this !== client) throw new TypeError(`${ILLEGAL_INVOCATION} — injected fetch received ${receiverName(this)}`);
      return Promise.resolve(paypalResponse(urlOf(input)));
    }

    client = new PayPalClient(makeEnv(), { fetch: strictFetch as unknown as typeof fetch });
    const verified = await client.verifyWebhook(strictHeaders as unknown as Headers, { id: "WH-EVT-1" });

    expect(verified).toBe(true);
    expect(new Set(headerReceivers)).toEqual(new Set([strictHeaders]));
    expect(keys).toEqual([
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ]);
    expect(fetchReceivers).toEqual([client, client]); // OAuth + verify
  });
});

/* ─────────────────────────────────── 7. handleSyncBatch's queue-message receiver */

describe("handleSyncBatch — a queue message keeps its receiver", () => {
  it("acks each message through `msg.ack()`, never a detached `ack`", async () => {
    const acks: unknown[] = [];
    const retries: unknown[] = [];
    const message: StrictMessage = { body: { kind: "webhook", eventId: "evt-1" }, ack: strictAck, retry: strictRetry };

    function strictAck(this: unknown): void {
      acks.push(this);
      if (this !== message) throw new TypeError(`${ILLEGAL_INVOCATION} — msg.ack received ${receiverName(this)}`);
    }
    function strictRetry(this: unknown): void {
      retries.push(this);
    }

    const batch = { messages: [message], queue: "payback-sync", retryAll: () => {} };
    await handleSyncBatch(batch as unknown as MessageBatch<SyncMessage>, makeEnv());

    expect(acks).toEqual([message]);
    expect(retries).toEqual([]); // nothing was retried: ack() stayed a method call
  });
});

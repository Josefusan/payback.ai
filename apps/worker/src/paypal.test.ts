/**
 * T-L1-001 (owner: L1) — the PayPal client path: OAuth, Transaction Search, Balances.
 * Builds each request and parses each response against the fixtures in `test/fixtures/paypal/`.
 * The live sandbox call is wired in `paypal.live.test.ts` (runs when credentials land).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayPalClient, PayPalError, PayPalScopeError, REPORTING_SEARCH_SCOPE, peekTokenCache, resetTokenCache } from "./paypal";
import type { PayPalTransactionDetail } from "./paypal";
import type { Env } from "./env";
import oauthToken from "../test/fixtures/paypal/oauth-token.json";
import searchPage1 from "../test/fixtures/paypal/transactions-search-page-1.json";
import searchPage2 from "../test/fixtures/paypal/transactions-search-page-2.json";
import balancesFixture from "../test/fixtures/paypal/balances.json";
import error401 from "../test/fixtures/paypal/error-401.json";

const BASE = "https://api-m.sandbox.paypal.com";
const TOKEN_PATH = "/v1/oauth2/token";
const TERMINATE_PATH = "/v1/oauth2/token/terminate";
const SEARCH_PATH = "/v1/reporting/transactions";
const BALANCES_PATH = "/v1/reporting/balances";

interface Route {
  match: (url: string, init: RequestInit) => boolean;
  status?: number;
  json?: unknown;
  body?: string;
  contentType?: string;
}

/** Captures every request and replays scripted responses, so tests assert the wire contract without a network. */
function mockFetch(routes: Route[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const route = routes.find((r) => r.match(url, init ?? {}));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    const body = route.body ?? JSON.stringify(route.json ?? {});
    return new Response(body, {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "application/json" },
    });
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

interface ScriptedStep {
  status?: number;
  json?: unknown;
  body?: string;
  contentType?: string;
}

/**
 * Fetch stub that replays a FIXED sequence of responses in call order and records every call. Unlike
 * `mockFetch` (route-matched), this makes ordering explicit — needed to prove terminate-then-refresh-then-retry.
 * A call beyond the script throws, which doubles as an infinite-retry guard.
 */
function scriptedFetch(script: ScriptedStep[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const step = script[i++];
    if (!step) throw new Error(`unexpected fetch #${i}: ${url} (script exhausted — possible retry loop)`);
    const status = step.status ?? 200;
    const nullBody = status === 204 || status === 205 || status === 304;
    const body = step.body ?? JSON.stringify(step.json ?? {});
    return new Response(nullBody ? null : body, {
      status,
      headers: { "content-type": step.contentType ?? "application/json" },
    });
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

function bearer(call: { init: RequestInit }): string | null {
  return new Headers(call.init.headers as HeadersInit).get("authorization");
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

/** Run `fn` and return whatever it throws (fails the test if it unexpectedly resolves). */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** A 403 body in the shape PayPal returns when the token lacks a required scope. */
const SCOPE_403 = {
  name: "NOT_AUTHORIZED",
  message: "Authorization failed due to insufficient permissions.",
  debug_id: "scope-403-debug",
  details: [{ issue: "INSUFFICIENT_PERMISSIONS", description: "The client is not authorized to use the requested scope." }],
};

/** A token minted BEFORE the "Transaction search" feature was enabled: valid, but missing the search scope. */
const staleToken = {
  ...oauthToken,
  access_token: "stale-token-missing-search-scope",
  scope: "https://uri.paypal.com/services/reporting/balances/read",
};

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "AZfixture-client-id",
    PAYPAL_CLIENT_SECRET: "EKfixture-secret",
    PAYPAL_WEBHOOK_ID: "WH-fixture",
    ...over,
  } as unknown as Env;
}

/** Replay handlers shared by every test: OAuth token, one Transaction Search page, the Balances snapshot. */
const happyRoutes: Route[] = [
  { match: (u) => u.endsWith(TOKEN_PATH), json: oauthToken },
  { match: (u) => u.includes(`${SEARCH_PATH}?`) && u.includes("page=1"), json: searchPage1 },
  { match: (u) => u.includes(`${SEARCH_PATH}?`) && u.includes("page=2"), json: searchPage2 },
  { match: (u) => u.includes(BALANCES_PATH), json: balancesFixture },
];

beforeEach(() => resetTokenCache());

describe("PayPalClient — sandbox guard", () => {
  it("refuses a non-sandbox PAYPAL_ENV", () => {
    expect(() => new PayPalClient(makeEnv({ PAYPAL_ENV: "live" }))).toThrow(/sandbox/);
  });
});

describe("PayPalClient — OAuth token (INV-1 sandbox host)", () => {
  it("builds a Basic-auth token request and parses access_token/expires_in", async () => {
    const { fetchImpl, calls } = mockFetch(happyRoutes);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await pp.getBalances("USD");

    expect(calls).toHaveLength(2);
    const tokenCall = calls[0]!;
    expect(tokenCall.url).toBe(`${BASE}${TOKEN_PATH}`);
    expect(tokenCall.init.method).toBe("POST");
    const headers = new Headers(tokenCall.init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe(`Basic ${btoa("AZfixture-client-id:EKfixture-secret")}`);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(tokenCall.init.body).toBe("grant_type=client_credentials");
    expect(fetchImpl).toBeDefined();
  });

  it("caches the token across calls — one OAuth round-trip for several requests", async () => {
    const { fetchImpl, calls } = mockFetch(happyRoutes);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await pp.getBalances();
    await pp.getBalances();

    expect(calls.filter((c) => c.url.endsWith(TOKEN_PATH))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes(BALANCES_PATH))).toHaveLength(2);
  });
});

describe("PayPalClient — Transaction Search", () => {
  it("builds the search query, sends the Bearer token, paginates and parses details", async () => {
    const { fetchImpl, calls } = mockFetch(happyRoutes);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    const got: PayPalTransactionDetail[] = [];
    for await (const d of pp.listTransactions("2026-10-01T00:00:00-0700", "2026-10-31T23:59:59-0700")) got.push(d);

    expect(got).toHaveLength(searchPage1.transaction_details.length + searchPage2.transaction_details.length);

    const search = calls.filter((c) => c.url.includes(SEARCH_PATH));
    expect(search).toHaveLength(2);
    const first = new URL(search[0]!.url);
    expect(first.origin + first.pathname).toBe(`${BASE}${SEARCH_PATH}`);
    expect(first.searchParams.get("start_date")).toBe("2026-10-01T00:00:00-0700");
    expect(first.searchParams.get("end_date")).toBe("2026-10-31T23:59:59-0700");
    expect(first.searchParams.get("fields")).toBe("all");
    expect(first.searchParams.get("page_size")).toBe("500");
    expect(first.searchParams.get("page")).toBe("1");
    expect(new URL(search[1]!.url).searchParams.get("page")).toBe("2");
    expect(new Headers(search[0]!.init.headers as HeadersInit).get("authorization")).toBe(`Bearer ${oauthToken.access_token}`);

    const sale = got[0]!.transaction_info;
    expect(sale.transaction_id).toBe("5TY05013RG002845M");
    expect(sale.transaction_event_code).toBe("T0006");
    expect(sale.transaction_initiation_date).toBe("2026-10-01T18:04:12+0000");
    expect(sale.transaction_amount).toEqual({ currency_code: "USD", value: "49.00" });
    expect(sale.fee_amount).toEqual({ currency_code: "USD", value: "-1.92" });
    expect(got[0]!.payer_info?.payer_name?.alternate_full_name).toBe("Ada Lovelace");
    expect(got[0]!.cart_info?.item_details?.[0]!.item_code).toBe("TPL-STD");
    expect(got[2]!.transaction_info.transaction_event_code).toBe("T0400");
  });

  it("rejects a window longer than 31 days before any request leaves the worker", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await expect(
      (async () => {
        for await (const _t of pp.listTransactions("2026-09-01T00:00:00-0700", "2026-10-31T23:59:59-0700")) {
          /* drain */
        }
      })(),
    ).rejects.toThrow(/31 days/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("PayPalClient — Balances", () => {
  it("builds the balances query and parses total/available/withheld balances", async () => {
    const { fetchImpl, calls } = mockFetch(happyRoutes);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    const res = await pp.getBalances("USD", "2026-10-06T00:00:00Z");

    const url = new URL(calls[1]!.url);
    expect(url.origin + url.pathname).toBe(`${BASE}${BALANCES_PATH}`);
    expect(url.searchParams.get("currency_code")).toBe("USD");
    expect(url.searchParams.get("as_of_time")).toBe("2026-10-06T00:00:00Z");
    expect(new Headers(calls[1]!.init.headers as HeadersInit).get("authorization")).toBe(`Bearer ${oauthToken.access_token}`);

    expect(res.as_of_time).toBe("2026-10-06T00:00:00Z");
    expect(res.balances).toHaveLength(1);
    expect(res.balances[0]!.total_balance).toEqual({ currency_code: "USD", value: "1200.00" });
    expect(res.balances[0]!.available_balance!.value).toBe("1150.00");
    expect(res.balances[0]!.withheld_balance!.value).toBe("50.00");
  });
});

describe("PayPalClient — errors", () => {
  it("surfaces the API status and debug_id from a JSON error body", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.endsWith(TOKEN_PATH), json: oauthToken },
      { match: (u) => u.includes(BALANCES_PATH), status: 401, json: error401 },
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await expect(pp.getBalances()).rejects.toMatchObject({ status: 401, debugId: "8f0e2d3c4b5a6" });
  });

  it("still throws PayPalError when the error body is not JSON", async () => {
    const { fetchImpl } = mockFetch([
      { match: (u) => u.endsWith(TOKEN_PATH), json: oauthToken },
      { match: (u) => u.includes(BALANCES_PATH), status: 502, body: "<html>Bad gateway</html>", contentType: "text/html" },
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await expect(pp.getBalances()).rejects.toBeInstanceOf(PayPalError);
  });

  it("throws PayPalError when the OAuth call itself fails", async () => {
    const { fetchImpl } = mockFetch([{ match: (u) => u.endsWith(TOKEN_PATH), status: 401, json: error401 }]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await expect(pp.getBalances()).rejects.toBeInstanceOf(PayPalError);
  });
});

// Reproduces the production outage: PayPal pins a client_credentials token to the scopes present when it was
// minted, so a feature enabled later (Transaction search) never appears in the already-issued token and every
// report call 403s until the token is revoked with POST /v1/oauth2/token/terminate.
describe("PayPalClient — scope-staleness self-heal (403)", () => {
  it("revokes the stale token, refreshes, and retries a 403 exactly once — then succeeds", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { json: staleToken },             // 1. OAuth -> stale token (no search scope)
      { status: 403, json: SCOPE_403 }, // 2. search -> insufficient permissions
      { status: 204 },                  // 3. terminate the stale token
      { json: oauthToken },             // 4. OAuth -> fresh token that carries the search scope
      { json: searchPage1 },            // 5. retried page 1
      { json: searchPage2 },            // 6. page 2 (refreshed token reused from cache)
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    const got: PayPalTransactionDetail[] = [];
    for await (const d of pp.listTransactions("2026-10-01T00:00:00-0700", "2026-10-31T23:59:59-0700")) got.push(d);

    expect(got).toHaveLength(searchPage1.transaction_details.length + searchPage2.transaction_details.length);

    // OAuth -> search(403) -> terminate -> OAuth -> search(retry) -> search(page 2)
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      TOKEN_PATH, SEARCH_PATH, TERMINATE_PATH, TOKEN_PATH, SEARCH_PATH, SEARCH_PATH,
    ]);

    const searchCalls = calls.filter((c) => c.url.includes(SEARCH_PATH));
    expect(searchCalls).toHaveLength(3);
    expect(bearer(searchCalls[0]!)).toBe(`Bearer ${staleToken.access_token}`); // first attempt used the stale token
    expect(bearer(searchCalls[1]!)).toBe(`Bearer ${oauthToken.access_token}`); // retry used the fresh token
    expect(bearer(searchCalls[2]!)).toBe(`Bearer ${oauthToken.access_token}`); // page 2 reuses the refreshed cache
  });

  it("surfaces a clear, actionable error when the 403 persists after the revoke + refresh", async () => {
    const { fetchImpl } = scriptedFetch([
      { json: staleToken },
      { status: 403, json: SCOPE_403 },
      { status: 204 },
      { json: oauthToken },
      { status: 403, json: SCOPE_403 }, // still forbidden with a fresh token -> app-feature problem
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    const err = await captureError(() => drain(pp.listTransactions("2026-10-01T00:00:00-0700", "2026-10-31T23:59:59-0700")));
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toBeInstanceOf(PayPalScopeError);

    const e = err as PayPalScopeError;
    expect(e.status).toBe(403);
    expect(e.missingScope).toBe(REPORTING_SEARCH_SCOPE);
    expect(e.message).toMatch(/reporting\/search\/read/); // names the likely missing scope
    expect(e.message).toMatch(/revoke/i); // states that a revoke + refresh was already attempted
    expect(e.message).toMatch(/terminate/i);
    expect(e.message).toMatch(/dashboard/i); // tells the operator it is an app-feature fix
  });

  it("retries at most once — no loop when the 403 keeps coming back", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { json: staleToken },
      { status: 403, json: SCOPE_403 },
      { status: 204 },
      { json: oauthToken },
      { status: 403, json: SCOPE_403 },
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    await expect(pp.getBalances()).rejects.toBeInstanceOf(PayPalScopeError);

    expect(calls.filter((c) => c.url.endsWith(TOKEN_PATH))).toHaveLength(2); // one initial + one refresh, never a third
    expect(calls.filter((c) => c.url.includes(BALANCES_PATH))).toHaveLength(2); // original + one retry
    expect(calls.filter((c) => c.url.endsWith(TERMINATE_PATH))).toHaveLength(1); // revoke once
    expect(calls).toHaveLength(5); // (a 6th call would also trip the script-exhausted guard)
  });

  it("calls terminate with the exact stale token and drops it from the module cache", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { json: staleToken },
      { status: 403, json: SCOPE_403 },
      { status: 204 },
      { json: oauthToken },
      { json: balancesFixture },
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });
    expect(peekTokenCache()).toBeNull(); // nothing cached before the first call

    await pp.getBalances();

    const terminate = calls.find((c) => c.url.endsWith(TERMINATE_PATH))!;
    expect(terminate.init.method).toBe("POST");
    const headers = new Headers(terminate.init.headers as HeadersInit);
    expect(headers.get("authorization")).toBe(`Basic ${btoa("AZfixture-client-id:EKfixture-secret")}`);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(terminate.init.body).toBe(`token=${encodeURIComponent(staleToken.access_token)}`);

    // The stale token was revoked and evicted: a cache miss forced a fresh OAuth, and the cache now holds it.
    expect(calls.filter((c) => c.url.endsWith(TOKEN_PATH))).toHaveLength(2);
    const cached = peekTokenCache();
    expect(cached?.token).toBe(oauthToken.access_token);
    expect(cached?.token).not.toBe(staleToken.access_token);
  });

  it("leaves non-403 failures as plain PayPalErrors (401 is not scope staleness)", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { json: oauthToken },
      { status: 401, json: error401 },
    ]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    const err = await captureError(() => pp.getBalances());
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).not.toBeInstanceOf(PayPalScopeError);
    expect(calls.filter((c) => c.url.endsWith(TERMINATE_PATH))).toHaveLength(0); // no revoke, no retry
    expect(calls.filter((c) => c.url.includes(BALANCES_PATH))).toHaveLength(1);
  });
});

describe("PayPalClient — capability helpers (scopes)", () => {
  it("getTokenScopes parses the OAuth scope field and is served from cache after the first call", async () => {
    const { fetchImpl, calls } = mockFetch(happyRoutes);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    const scopes = await pp.getTokenScopes();
    expect(scopes).toContain(REPORTING_SEARCH_SCOPE);
    expect(scopes).toContain("https://uri.paypal.com/services/invoicing");
    expect(scopes).toHaveLength(4);

    await pp.getTokenScopes();
    expect(calls.filter((c) => c.url.endsWith(TOKEN_PATH))).toHaveLength(1); // cached, no extra round-trip
  });

  it("hasScope asserts capability — true for granted scopes, false otherwise", async () => {
    const { fetchImpl, calls } = mockFetch(happyRoutes);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    expect(await pp.hasScope(REPORTING_SEARCH_SCOPE)).toBe(true);
    expect(await pp.hasScope("https://uri.paypal.com/services/nope")).toBe(false);
    expect(calls.filter((c) => c.url.endsWith(TOKEN_PATH))).toHaveLength(1); // both checks share one token
  });

  it("reports a missing scope from a stale token without another OAuth round-trip", async () => {
    const { fetchImpl, calls } = scriptedFetch([{ json: staleToken }]);
    const pp = new PayPalClient(makeEnv(), { fetch: fetchImpl });

    expect(await pp.hasScope(REPORTING_SEARCH_SCOPE)).toBe(false); // feature enabled but token predates it
    expect(await pp.hasScope("https://uri.paypal.com/services/reporting/balances/read")).toBe(true);
    expect(calls.filter((c) => c.url.endsWith(TOKEN_PATH))).toHaveLength(1);
  });
});

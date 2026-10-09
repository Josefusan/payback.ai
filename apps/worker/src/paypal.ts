/**
 * Minimal PayPal REST client for Cloudflare Workers — SANDBOX ONLY.
 * Docs: https://developer.paypal.com/api/rest/  · see .claude/skills/paypal-sdks/rest-api.md
 */
import type { Env } from "./env";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

/** Transaction Search (`/v1/reporting/transactions`) rejects windows longer than 31 days. */
export const MAX_SEARCH_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * OAuth scope required by Transaction Search. PayPal grants this only when the app's "Transaction search"
 * feature is enabled — and, critically, an ALREADY-ISSUED token never gains a scope added afterwards.
 */
export const REPORTING_SEARCH_SCOPE = "https://uri.paypal.com/services/reporting/search/read";

/** Refresh the cached token this long before it actually expires (PayPal client_credentials tokens live ~9h). */
const EXPIRY_SKEW_MS = 5 * 60_000;

/** PayPal returns JSON on success; error pages can be HTML/text — never let JSON.parse mask a PayPalError. */
function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

/** Fail fast on >31-day / inverted Transaction Search windows instead of a 400 from PayPal. */
function assertSearchRange(startISO: string, endISO: string): void {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new RangeError(`invalid date range: ${startISO} .. ${endISO}`);
  if (end < start) throw new RangeError(`end_date ${endISO} is before start_date ${startISO}`);
  if (end - start > MAX_SEARCH_RANGE_MS) {
    throw new RangeError(`Transaction Search range must be <= 31 days (got ${((end - start) / 86_400_000).toFixed(1)})`);
  }
}

/** OAuth `scope` is a single space-delimited string; split it for the capability helpers. */
function parseScopes(scope: string | undefined): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean);
}

/** Best-effort read of PayPal's `debug_id` without assuming the body is an object. */
function debugIdOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const id = (body as { debug_id?: unknown }).debug_id;
  return typeof id === "string" ? id : undefined;
}

/** Heuristic: does an error body look like a missing permission/scope (vs. a hard authentication failure)? */
function looksLikeScopeError(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { name?: unknown; message?: unknown; details?: unknown };
  const parts: string[] = [];
  if (typeof b.name === "string") parts.push(b.name);
  if (typeof b.message === "string") parts.push(b.message);
  if (Array.isArray(b.details)) {
    for (const d of b.details) {
      if (typeof d === "object" && d !== null) {
        const det = d as { issue?: unknown; description?: unknown };
        if (typeof det.issue === "string") parts.push(det.issue);
        if (typeof det.description === "string") parts.push(det.description);
      }
    }
  }
  return /not_?authorized|insufficient|permission|scope|forbidden/i.test(parts.join(" "));
}

/** Map a request path to the scope a 403 most plausibly is missing, so the error can name it. */
const SCOPE_HINTS: ReadonlyArray<{ match: RegExp; scope: string }> = [
  { match: /\/v1\/reporting\/transactions/, scope: REPORTING_SEARCH_SCOPE },
  { match: /\/v1\/reporting\/balances/, scope: "https://uri.paypal.com/services/reporting/balances/read" },
  { match: /\/v1\/customer\/disputes/, scope: "https://uri.paypal.com/services/disputes/read" },
  { match: /\/v2\/invoicing/, scope: "https://uri.paypal.com/services/invoicing" },
  { match: /\/v1\/payments\/payouts/, scope: "https://uri.paypal.com/services/payments/payouts" },
];

function likelyMissingScope(path: string): string {
  return SCOPE_HINTS.find((h) => h.match.test(path))?.scope ?? REPORTING_SEARCH_SCOPE;
}

export interface Money { currency_code: string; value: string }

export interface PayPalTransactionInfo {
  transaction_id: string;
  transaction_event_code: string;
  transaction_initiation_date: string;
  transaction_updated_date?: string;
  transaction_amount: Money;
  fee_amount?: Money;
  transaction_status: "D" | "P" | "S" | "V" | string;
  transaction_subject?: string;
  transaction_note?: string;
  invoice_id?: string;
  custom_field?: string;
  paypal_reference_id?: string;
  paypal_reference_id_type?: string;
}

export interface PayPalTransactionDetail {
  transaction_info: PayPalTransactionInfo;
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } };
  cart_info?: { item_details?: Array<{ item_code?: string; item_name?: string; item_quantity?: string; item_amount?: Money }> };
}

/** The subset of a checkout order this worker reads. `description` is buyer-controlled. */
export interface PayPalOrder {
  id: string;
  purchase_units?: Array<{ description?: string; custom_id?: string; reference_id?: string }>;
  payer?: { email_address?: string; payer_id?: string };
}

export class PayPalError extends Error {
  constructor(public status: number, public debugId: string | undefined, public body: unknown) {
    super(`PayPal ${status}${debugId ? ` (debug_id ${debugId})` : ""}`);
  }
}

/**
 * Thrown when an API call is STILL 403 after the client already revoked the cached token and retried with a
 * freshly minted one. Because PayPal pins a client_credentials token to the scopes present when it was
 * created, a 403 that survives a revoke + refresh means the app itself lacks the scope/feature — an operator
 * must enable it in the developer dashboard. It is an app-configuration fault, not a transient one.
 */
export class PayPalScopeError extends PayPalError {
  constructor(
    status: number,
    debugId: string | undefined,
    body: unknown,
    public readonly path: string,
    public readonly missingScope: string,
  ) {
    super(status, debugId, body);
    this.name = "PayPalScopeError";
    const hinted = looksLikeScopeError(body) ? "The error body reports insufficient permissions. " : "";
    this.message =
      `${hinted}PayPal ${status} on ${path} persisted after a token revoke + refresh ` +
      `(POST /v1/oauth2/token/terminate, then a freshly minted client_credentials token). ` +
      `That makes this an app-scope problem, not a transient one: the app is most likely missing the ` +
      `"${missingScope}" scope — enable the matching feature in the PayPal developer dashboard, then retry.`;
  }
}

type FetchLike = typeof fetch;

/** Cached token plus the scopes PayPal granted on it, so capability checks stay off the network. */
interface TokenCache { token: string; expiresAt: number; scopes: string[] }

// Module-scoped so a warm isolate reuses the ~9h token across requests; `resetTokenCache()` keeps tests isolated.
let cachedToken: TokenCache | null = null;

/** Test hook: drop the cached access token so the next call does a fresh OAuth round-trip. */
export function resetTokenCache(): void {
  cachedToken = null;
}

/** Test hook: snapshot the cached token/scopes without forcing an OAuth round-trip. */
export function peekTokenCache(): { token: string; scopes: string[] } | null {
  return cachedToken ? { token: cachedToken.token, scopes: [...cachedToken.scopes] } : null;
}

export class PayPalClient {
  private readonly base = SANDBOX_BASE;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly env: Env, opts: { fetch?: FetchLike } = {}) {
    if (env.PAYPAL_ENV !== "sandbox") {
      throw new Error("PAYPAL_ENV must be 'sandbox' — live PayPal is forbidden in this project (hackathon rules + safety).");
    }
    // Bind the global `fetch`: the call sites use `this.fetchImpl(...)`, which would otherwise pass the
    // client as the receiver and the Workers runtime rejects it with "Illegal invocation". Injected
    // implementations (tests) are used as given.
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
  }

  private basicAuth(): string {
    return `Basic ${btoa(`${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_CLIENT_SECRET}`)}`;
  }

  /** Mint a fresh client_credentials token and (re)populate the module cache. Does not read the cache. */
  private async fetchToken(): Promise<TokenCache> {
    const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: this.basicAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalError(res.status, res.headers.get("paypal-debug-id") ?? undefined, await res.text());
    const data = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
    const entry: TokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: parseScopes(data.scope),
    };
    cachedToken = entry;
    return entry;
  }

  private async token(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_SKEW_MS) return cachedToken.token;
    return (await this.fetchToken()).token;
  }

  /**
   * Scopes granted on the current access token (from the cache when warm, else a fresh OAuth round-trip).
   * Health checks / sync guards can assert capability with this before touching a report endpoint.
   */
  async getTokenScopes(): Promise<string[]> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_SKEW_MS) return [...cachedToken.scopes];
    return [...(await this.fetchToken()).scopes];
  }

  /** True when the current token carries `scope` — assert capability before syncing. */
  async hasScope(scope: string): Promise<boolean> {
    return (await this.getTokenScopes()).includes(scope);
  }

  /**
   * Revoke the current access token and drop the module cache so the next `token()` mints a fresh one:
   * POST /v1/oauth2/token/terminate with Basic auth and a form-encoded `token=<current>` body.
   * Best-effort — a failed revoke must not mask the API error we are recovering from — but we always
   * clear the cache, so the caller's retry uses a brand-new token.
   */
  private async terminateToken(token: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.base}/v1/oauth2/token/terminate`, {
        method: "POST",
        headers: {
          Authorization: this.basicAuth(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `token=${encodeURIComponent(token)}`,
      });
    } catch {
      /* best-effort: fall through and still clear the cache */
    } finally {
      cachedToken = null;
    }
  }

  /** One wire attempt. Returns the raw response, its parsed body and the bearer token that was used. */
  private async send(
    method: string,
    path: string,
    opts: { body?: unknown; requestId?: string; query?: Record<string, string> },
  ): Promise<{ res: Response; json: unknown; token: string }> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const token = await this.token();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    const res = await this.fetchImpl(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const json = parseJson(await res.text());
    return { res, json, token };
  }

  async request<T>(method: string, path: string, opts: { body?: unknown; requestId?: string; query?: Record<string, string> } = {}): Promise<T> {
    const first = await this.send(method, path, opts);
    if (first.res.ok) return first.json as T;

    // Scope staleness: PayPal caches client_credentials tokens for ~9h, so a scope granted AFTER the token
    // was minted (e.g. enabling "Transaction search") is absent from it — re-running OAuth returns the SAME
    // token and every report call 403s as NOT_AUTHORIZED / insufficient permissions. Revoke the cached token,
    // mint a fresh one, and retry the original request EXACTLY ONCE.
    if (first.res.status === 403) {
      await this.terminateToken(first.token);
      const second = await this.send(method, path, opts);
      if (second.res.ok) return second.json as T;
      if (second.res.status === 403) {
        throw new PayPalScopeError(second.res.status, debugIdOf(second.json), second.json, path, likelyMissingScope(path));
      }
      throw new PayPalError(second.res.status, debugIdOf(second.json), second.json);
    }

    throw new PayPalError(first.res.status, debugIdOf(first.json), first.json);
  }

  // ── Reporting ────────────────────────────────────────────────────────────
  /** Transaction Search. Range must be ≤ 31 days. Iterates all pages. */
  async *listTransactions(startISO: string, endISO: string): AsyncGenerator<PayPalTransactionDetail> {
    assertSearchRange(startISO, endISO);
    let page = 1;
    for (;;) {
      const data = await this.request<{ transaction_details: PayPalTransactionDetail[]; total_pages: number }>(
        "GET", "/v1/reporting/transactions",
        { query: { start_date: startISO, end_date: endISO, fields: "all", page_size: "500", page: String(page) } },
      );
      for (const t of data.transaction_details ?? []) yield t;
      if (page >= (data.total_pages ?? 1)) break;
      page++;
    }
  }

  /** Balances for reconciliation. `asOfTime` pins the snapshot so the tie-out compares like-for-like. */
  getBalances(currency?: string, asOfTime?: string) {
    const query: Record<string, string> = {};
    if (currency) query.currency_code = currency;
    if (asOfTime) query.as_of_time = asOfTime;
    return this.request<{ balances: Array<{ currency: string; primary?: boolean; total_balance: Money; available_balance?: Money; withheld_balance?: Money }>; as_of_time?: string }>(
      "GET", "/v1/reporting/balances", { query },
    );
  }

  // ── Invoicing v2 ─────────────────────────────────────────────────────────
  searchInvoices(statuses: string[]) {
    return this.request<{ items?: Array<{ id: string; status: string; detail: { invoice_number?: string; payment_term?: { due_date?: string } }; amount?: Money; due_amount?: Money }> }>(
      "POST", "/v2/invoicing/search-invoices", { body: { status: statuses } },
    );
  }
  remindInvoice(invoiceId: string, note: string, requestId: string) {
    return this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`, { body: { subject: "Friendly reminder", note }, requestId });
  }

  // ── Payouts ──────────────────────────────────────────────────────────────
  createPayout(p: { batchId: string; receiver: string; amount: string; currency: string; note: string; itemId: string }) {
    return this.request<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
      requestId: `payout:${p.batchId}`,
      body: {
        sender_batch_header: { sender_batch_id: p.batchId, email_subject: "You have a payment", email_message: p.note },
        items: [{ recipient_type: "EMAIL", receiver: p.receiver, amount: { value: p.amount, currency: p.currency }, note: p.note, sender_item_id: p.itemId, recipient_wallet: "PAYPAL" }],
      },
    });
  }

  // ── Checkout orders ──────────────────────────────────────────────────────
  /**
   * Fetch a checkout order. The webhook path needs this because a capture webhook carries the amount and
   * fee but NOT the buyer's own text — `purchase_units[0].description` is where an order's note lives, and
   * that is the field the injection guard has to read.
   */
  getOrder(orderId: string) {
    return this.request<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  // ── Disputes ─────────────────────────────────────────────────────────────
  listDisputes(state?: string) {
    return this.request<{ items?: Array<{ dispute_id: string; reason: string; status: string; dispute_amount: Money }> }>(
      "GET", "/v1/customer/disputes", { query: state ? { dispute_state: state } : {} },
    );
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────
  async verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
    const res = await this.request<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      body: {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: this.env.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      },
    });
    return res.verification_status === "SUCCESS";
  }
}

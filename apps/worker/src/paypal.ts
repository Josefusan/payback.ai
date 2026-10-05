/**
 * Minimal PayPal REST client for Cloudflare Workers — SANDBOX ONLY.
 * Docs: https://developer.paypal.com/api/rest/  · see .claude/skills/paypal-sdks/rest-api.md
 */
import type { Env } from "./env";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

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

export class PayPalError extends Error {
  constructor(public status: number, public debugId: string | undefined, public body: unknown) {
    super(`PayPal ${status}${debugId ? ` (debug_id ${debugId})` : ""}`);
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export class PayPalClient {
  private readonly base = SANDBOX_BASE;

  constructor(private readonly env: Env) {
    if (env.PAYPAL_ENV !== "sandbox") {
      throw new Error("PAYPAL_ENV must be 'sandbox' — live PayPal is forbidden in this project (hackathon rules + safety).");
    }
  }

  private async token(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60_000) return cachedToken.token;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.env.PAYPAL_CLIENT_ID}:${this.env.PAYPAL_CLIENT_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalError(res.status, res.headers.get("paypal-debug-id") ?? undefined, await res.text());
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async request<T>(method: string, path: string, opts: { body?: unknown; requestId?: string; query?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    const res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(res.status, (json as { debug_id?: string }).debug_id, json);
    return json as T;
  }

  // ── Reporting ────────────────────────────────────────────────────────────
  /** Transaction Search. Range must be ≤ 31 days. Iterates all pages. */
  async *listTransactions(startISO: string, endISO: string): AsyncGenerator<PayPalTransactionDetail> {
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

  getBalances(currency?: string) {
    return this.request<{ balances: Array<{ currency: string; primary?: boolean; total_balance: Money; available_balance?: Money; withheld_balance?: Money }>; as_of_time?: string }>(
      "GET", "/v1/reporting/balances", { query: currency ? { currency_code: currency } : {} },
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

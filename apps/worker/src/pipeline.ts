/**
 * The autonomous loop: PayPal → Clef decision → gate → post journal or review queue.
 */
import type { Env, SyncMessage } from "./env";
import { PayPalClient, type PayPalOrder, type PayPalTransactionDetail } from "./paypal";
import { decideTransaction, type TxnForDecision } from "./clef";
import { buildJournal, buildOpeningLines, UnsupportedEventError } from "./ledger";
import { fromCents, toCents } from "./money";
import { auditInsert, buildAuditRow, readTail } from "./audit";

export function toDecisionInput(d: PayPalTransactionDetail): TxnForDecision {
  const t = d.transaction_info;
  const name = d.payer_info?.payer_name?.alternate_full_name
    ?? [d.payer_info?.payer_name?.given_name, d.payer_info?.payer_name?.surname].filter(Boolean).join(" ");
  return {
    event_code: t.transaction_event_code,
    amount: t.transaction_amount.value,
    currency: t.transaction_amount.currency_code,
    fee: t.fee_amount?.value ?? "0.00",
    counterparty: name || d.payer_info?.email_address || undefined,
    subject: t.transaction_subject,
    note: t.transaction_note,
    items: (d.cart_info?.item_details ?? []).map((i) => i.item_code || i.item_name || "").filter(Boolean),
  };
}

/** Pull a window from Transaction Search, store new rows idempotently, enqueue for decisions. */
export async function syncWindow(env: Env, startISO: string, endISO: string): Promise<{ seen: number; enqueued: number }> {
  // T-L3-001a: bring the real PayPal balance onto the books once, before the first window is ingested.
  await ensureOpeningBalance(env, startISO);
  const pp = new PayPalClient(env);
  let seen = 0;
  let enqueued = 0;
  for await (const d of pp.listTransactions(startISO, endISO)) {
    seen++;
    const t = d.transaction_info;
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO paypal_transactions
       (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, counterparty, subject, note, invoice_id, reference_id, raw_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(
      t.transaction_id, t.transaction_event_code, t.transaction_status, t.transaction_initiation_date,
      toCents(t.transaction_amount.value), toCents(t.fee_amount?.value), t.transaction_amount.currency_code,
      toDecisionInput(d).counterparty ?? null, t.transaction_subject ?? null, t.transaction_note ?? null,
      t.invoice_id ?? null, t.paypal_reference_id ?? null, JSON.stringify(d),
    ).run();
    if (res.meta.changes > 0 && t.transaction_status === "S") {
      await env.SYNC_QUEUE.send({ kind: "transaction", transactionId: t.transaction_id });
      enqueued++;
    }
  }
  return { seen, enqueued };
}

/** Decide + post (or queue for review) one stored transaction. Idempotent. */
export async function processTransaction(env: Env, transactionId: string): Promise<"posted" | "review" | "skipped"> {
  const row = await env.DB.prepare(`SELECT raw_json, state, initiated_at FROM paypal_transactions WHERE transaction_id = ?1`)
    .bind(transactionId).first<{ raw_json: string; state: string; initiated_at: string }>();
  if (!row || row.state === "posted") return "skipped";
  const detail = JSON.parse(row.raw_json) as PayPalTransactionDetail;
  const input = toDecisionInput(detail);
  const decision = await decideTransaction(env, input);

  const ins = await env.DB.prepare(
    `INSERT INTO decisions (transaction_id, model, schema_version, account_choice, account_prob, product_line, needs_review_prob, risk_score, answers_json, threshold, gate, gate_reasons)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING id`,
  ).bind(
    transactionId, decision.model, decision.schemaVersion, decision.account.choice,
    decision.account.probabilities[decision.account.choice] ?? 0, decision.productLine.choice,
    decision.needsReview, decision.risk, JSON.stringify(decision), decision.threshold, decision.gate, JSON.stringify(decision.gateReasons),
  ).first<{ id: number }>();
  const decisionId = ins?.id ?? null;

  let lines;
  try {
    lines = decision.gate === "auto"
      ? buildJournal({ eventCode: input.event_code, amountCents: toCents(input.amount), feeCents: toCents(input.fee), currency: input.currency, counterparty: input.counterparty }, decision.account.choice, decision.productLine.choice)
      : null;
  } catch (e) {
    if (!(e instanceof UnsupportedEventError)) throw e;
    decision.gateReasons.push("unsupported_event_code");
    lines = null;
  }

  if (!lines) {
    // The decision to STOP is recorded in the same batch as the queue row. Leaving it out made the trail
    // tell only half the story: every posting was audited, but the agent's most important act — refusing to
    // book and asking a human — left no trace at all.
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('classification', ?1, ?2, ?3)`)
        .bind(transactionId, JSON.stringify(decision.gateReasons), JSON.stringify({ input, decision })),
      env.DB.prepare(`UPDATE paypal_transactions SET state = 'review' WHERE transaction_id = ?1`).bind(transactionId),
      auditInsert(
        env,
        await buildAuditRow(
          {
            ref_type: "review",
            ref_id: transactionId,
            event: "gated",
            actor: "agent",
            detail: {
              top_reason: decision.gateReasons[0] ?? null,
              reasons: decision.gateReasons,
              account_choice: decision.account.choice,
              needs_review_prob: decision.needsReview,
              risk: decision.risk,
              model: decision.model,
            },
          },
          await readTail(env),
        ),
      ),
    ]);
    return "review";
  }

  // Atomic post: entry + lines + state. D1 batch runs as a transaction.
  const entryStmt = env.DB.prepare(
    `INSERT INTO journal_entries (source, source_id, entry_date, memo, decision_id) VALUES ('paypal', ?1, ?2, ?3, ?4)`,
  ).bind(transactionId, row.initiated_at.slice(0, 10), input.subject ?? input.event_code, decisionId);
  const lineStmts = lines.map((l) =>
    env.DB.prepare(
      `INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency, product_line, counterparty)
       VALUES ((SELECT id FROM journal_entries WHERE source = 'paypal' AND source_id = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(transactionId, l.account, l.debit, l.credit, l.currency, l.productLine ?? null, l.counterparty ?? null),
  );
  // The audit row rides in the SAME batch as the entry: a posting that exists without its audit row
  // would be an unauditable change to the books, so the two succeed or fail together.
  const auditRow = await buildAuditRow(
    {
      ref_type: "journal_entry",
      ref_id: transactionId,
      event: "posted",
      actor: "agent",
      detail: {
        account: decision.account.choice,
        product_line: decision.productLine.choice,
        account_prob: decision.account.probabilities[decision.account.choice] ?? null,
        model: decision.model,
        schema_version: decision.schemaVersion,
        threshold: decision.threshold,
        lines: lines.length,
      },
    },
    await readTail(env),
  );
  await env.DB.batch([
    entryStmt, ...lineStmts,
    env.DB.prepare(`UPDATE paypal_transactions SET state = 'posted' WHERE transaction_id = ?1`).bind(transactionId),
    auditInsert(env, auditRow),
  ]);
  return "posted";
}

/** Outcome of the one-time opening-balance step. */
export interface OpeningBalanceResult {
  posted: boolean; // true only for the sync that actually wrote the entry
  cutoff: string | null; // sync_state.sync_cutoff (ISO); null while nothing has been posted yet
  currency: string | null; // primary currency the opening entry was built for
  unsupportedCurrencies: string[]; // non-primary currencies: no opening entry, surfaced by reconcile
}

/**
 * T-L3-001a — post the opening PayPal balance exactly once and record the sync cutoff.
 *
 * On the first sync we snapshot the **primary-currency** balance pinned at the start of the window
 * (`as_of_time`), append ONE balanced entry `source='opening'` (Dr 1010 / Cr 3000) and store the cutoff in
 * `sync_state` so no later sync repeats it. The cutoff is the window start, so every transaction posts on
 * top of the opening (never double-counted). Idempotent: the `INSERT OR IGNORE` on `sync_state` is claimed
 * atomically, so even concurrent first syncs post at most one entry.
 *
 * INVARIANT (the project's #1 on-camera risk): the cutoff is NEVER left claimed without the opening entry
 * actually posted — a claimed cutoff short-circuits every later sync, 1010 stays 0 and reconcile can never
 * claim ok. Three orderings enforce it:
 *   1. the Balances snapshot is validated BEFORE anything is claimed, so an empty/failed first response
 *      leaves no cutoff behind and the next sync opens the books normally;
 *   2. the entry + lines + `sync_currency` are written in the same batch right after the claim, and any
 *      failure deletes the claim again (compensation), so a retry can still post the opening entry;
 *   3. a cutoff found WITHOUT an opening entry (a crash between the claim and the batch) is treated as a
 *      stale claim: it is released and re-posted, pinned at the claimed cutoff so the snapshot still lines
 *      up with the transactions posted on top of it.
 */
export async function ensureOpeningBalance(env: Env, cutoffISO: string): Promise<OpeningBalanceResult> {
  // One round trip covers both halves of the invariant: the claimed cutoff and whether the entry exists.
  const state = await env.DB.prepare(
    `SELECT (SELECT value FROM sync_state WHERE key = 'sync_cutoff') AS cutoff,
            EXISTS(SELECT 1 FROM journal_entries WHERE source = 'opening') AS posted`,
  ).first<{ cutoff: string | null; posted: number }>();

  if (state?.cutoff && state.posted) {
    const cur = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'sync_currency'`).first<{ value: string }>();
    return { posted: false, cutoff: state.cutoff, currency: cur?.value ?? null, unsupportedCurrencies: [] };
  }

  // Stale claim (cutoff without entry) → release it and fall through, re-pinned at the claimed cutoff.
  const pinISO = state?.cutoff ?? cutoffISO;
  if (state?.cutoff) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sync_state WHERE key = 'sync_cutoff'`),
      env.DB.prepare(`DELETE FROM sync_state WHERE key = 'sync_currency'`),
    ]);
  }

  // Validate the snapshot FIRST: nothing is claimed for a snapshot we cannot post from.
  const pp = new PayPalClient(env);
  const snapshot = await pp.getBalances(undefined, pinISO);
  const balances = snapshot.balances ?? [];
  const primary = balances.find((b) => b.primary) ?? balances[0];
  const unsupportedCurrencies = balances.filter((b) => b !== primary).map((b) => b.currency);
  const balanceCents = primary ? toCents(primary.total_balance.value) : 0;
  const lines = primary ? buildOpeningLines(primary.currency, balanceCents) : [];
  if (!primary || !lines.length) {
    // Nothing to open (no Balances row, or a zero balance): claim nothing, retry on a later sync.
    return { posted: false, cutoff: null, currency: primary?.currency ?? null, unsupportedCurrencies };
  }

  // Claim the cutoff atomically: only the winner of the INSERT (meta.changes > 0) posts the entry.
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO sync_state (key, value) VALUES ('sync_cutoff', ?1)`).bind(pinISO).run();
  if (claim.meta.changes === 0) {
    const winner = await env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'sync_cutoff'`).first<{ value: string }>();
    return { posted: false, cutoff: winner?.value ?? pinISO, currency: primary.currency, unsupportedCurrencies };
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO journal_entries (source, source_id, entry_date, memo, approver)
         VALUES ('opening', ?1, ?2, ?3, 'system')`,
      ).bind(pinISO, pinISO.slice(0, 10), `Opening balance ${fromCents(balanceCents)} ${primary.currency} as of ${pinISO}`),
      ...lines.map((l) =>
        env.DB.prepare(
          `INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency)
           VALUES ((SELECT id FROM journal_entries WHERE source = 'opening' AND source_id = ?1), ?2, ?3, ?4, ?5)`,
        ).bind(pinISO, l.account, l.debit, l.credit, l.currency),
      ),
      // Same transaction as the entry: the cutoff and the currency it was opened for appear together.
      env.DB.prepare(`INSERT OR IGNORE INTO sync_state (key, value) VALUES ('sync_currency', ?1)`).bind(primary.currency),
      auditInsert(
        env,
        await buildAuditRow(
          {
            ref_type: "journal_entry",
            ref_id: pinISO,
            event: "opened",
            actor: "system",
            detail: { currency: primary.currency, balance_cents: balanceCents, lines: lines.length },
          },
          await readTail(env),
        ),
      ),
    ]);
  } catch (error) {
    // Compensate: release the claim so the next sync can post the opening entry instead of short-circuiting.
    await env.DB.prepare(`DELETE FROM sync_state WHERE key = 'sync_cutoff'`).run();
    throw error;
  }

  return { posted: true, cutoff: pinISO, currency: primary.currency, unsupportedCurrencies };
}

/** Cron: last 48h (Transaction Search can lag ~3h); INSERT OR IGNORE keeps it idempotent. */
export async function runScheduledSync(env: Env): Promise<void> {
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 3600_000);
  await syncWindow(env, start.toISOString(), end.toISOString());
}

/* ──────────────────────────────── webhooks → transactions (T-L1-008a) ─────────────────────────── */

/**
 * Turn a verified PayPal webhook into a `paypal_transactions` row.
 *
 * Why this exists: Transaction Search lags new activity by up to ~3 hours, so a sync-only pipeline leaves
 * the books hours behind reality. Webhooks arrive in seconds — they are the real-time path — but the old
 * handler recorded the event and dropped it (`kind: "webhook"` was acked and ignored), so nothing
 * downstream ever saw it.
 *
 * The webhook is only the *trigger*. A capture webhook carries the id, amount, fee and the related order
 * id, but NOT the buyer's text: that lives only on the order (`purchase_units[0].description`), which is
 * exactly what the injection guard has to read. So a capture costs one extra GET. A mapping that skipped
 * that GET would still balance and still post — and would quietly book the injection demo as an ordinary
 * sale, which is the one failure this product cannot afford.
 *
 * Event-code map, in the families `buildJournal` understands. Checked against what Transaction Search
 * returns for the same sandbox activity:
 *
 *   PAYMENT.CAPTURE.COMPLETED       → T0006, amount +, fee −   (money received)
 *   PAYMENT.CAPTURE.REFUNDED        → T1107, amount −, fee 0   (reversal of a capture)
 *   PAYMENT.PAYOUTS-ITEM.SUCCEEDED  → T0001, amount −          (money sent to a payee)
 *
 * Everything else is recorded but books nothing — invoice and dunning events are not money movements.
 */
export type WebhookOutcome = "posted" | "review" | "skipped" | "not-bookable";

/**
 * Raised when a capture names an order we cannot read, so the buyer's text is unknown. It carries the
 * partial detail because the transaction is still real — we just must not book it autonomously. The
 * caller inserts the row and sends it to a human instead of retrying forever.
 */
export class BuyerTextUnreadableError extends Error {
  constructor(message: string, public readonly detail: PayPalTransactionDetail) {
    super(message);
    this.name = "BuyerTextUnreadableError";
  }
}

/** Normalise a PayPal timestamp to UTC ISO so entry_date cannot slip a day across a timezone offset. */
function utc(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

interface CaptureResource {
  id: string;
  amount?: { currency_code?: string; value?: string };
  seller_receivable_breakdown?: { paypal_fee?: { value?: string } };
  create_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
}

interface RefundResource {
  id: string;
  amount?: { currency_code?: string; value?: string };
  note_to_payer?: string;
  create_time?: string;
}

interface PayoutItemResource {
  transaction_id?: string;
  payout_item_id?: string;
  payout_item_fee?: { value?: string };
  time_processed?: string;
  payout_item?: { amount?: { currency_code?: string; value?: string }; receiver?: string; note?: string };
}

const asMoney = (currency: string, value: string) => ({ currency_code: currency, value });

/** The money-moving part of a webhook payload, or null when the event books nothing. */
export async function mapWebhookToTxn(
  env: Env,
  eventType: string,
  resource: unknown,
): Promise<PayPalTransactionDetail | null> {
  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const r = resource as CaptureResource;
    if (!r?.id) return null;
    const currency = r.amount?.currency_code ?? "USD";
    const fee = r.seller_receivable_breakdown?.paypal_fee?.value;
    // The buyer's own words. Fetched from the order, never inferred.
    const orderId = r.supplementary_data?.related_ids?.order_id;
    const base: PayPalTransactionDetail = {
      transaction_info: {
        transaction_id: r.id,
        transaction_event_code: "T0006",
        transaction_initiation_date: utc(r.create_time),
        transaction_amount: asMoney(currency, r.amount?.value ?? "0.00"),
        // Transaction Search reports a capture's fee as negative; mirror that so both paths agree.
        fee_amount: asMoney(currency, fee ? `-${fee}` : "0.00"),
        transaction_status: "S",
      },
    };
    // No related order means the capture has no order-level note at all — nothing to read, nothing missed.
    if (!orderId) return base;

    let order: PayPalOrder;
    try {
      order = await new PayPalClient(env).getOrder(orderId);
    } catch (e) {
      // The order EXISTS (the capture names it) but we could not read it, so we do not know what the buyer
      // wrote. Booking it anyway would be the one failure this product cannot afford, so hand it to a human.
      throw new BuyerTextUnreadableError(`order ${orderId} unreadable: ${(e as Error).message}`, base);
    }
    base.transaction_info.transaction_subject = order.purchase_units?.[0]?.description;
    if (order.payer?.email_address) base.payer_info = { email_address: order.payer.email_address };
    return base;
  }

  if (eventType === "PAYMENT.CAPTURE.REFUNDED") {
    const r = resource as RefundResource;
    if (!r?.id) return null;
    const currency = r.amount?.currency_code ?? "USD";
    return {
      transaction_info: {
        transaction_id: r.id,
        transaction_event_code: "T1107",
        transaction_initiation_date: utc(r.create_time),
        // A refund moves money the other way: negative, even though PayPal sends the amount positive.
        transaction_amount: asMoney(currency, `-${r.amount?.value ?? "0.00"}`),
        fee_amount: asMoney(currency, "0.00"),
        transaction_status: "S",
        transaction_subject: r.note_to_payer,
        transaction_note: r.note_to_payer,
      },
    };
  }

  if (eventType === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED") {
    const r = resource as PayoutItemResource;
    const id = r?.transaction_id ?? r?.payout_item_id;
    if (!id) return null;
    const item = r.payout_item ?? {};
    const currency = item.amount?.currency_code ?? "USD";
    const fee = r.payout_item_fee?.value;
    return {
      transaction_info: {
        transaction_id: id,
        transaction_event_code: "T0001",
        transaction_initiation_date: utc(r.time_processed),
        transaction_amount: asMoney(currency, `-${item.amount?.value ?? "0.00"}`),
        fee_amount: asMoney(currency, fee ? `-${fee}` : "0.00"),
        transaction_status: "S",
        transaction_subject: item.note,
        transaction_note: item.note,
      },
      payer_info: item.receiver ? { email_address: item.receiver } : undefined,
    };
  }

  return null;
}

/**
 * Decide + post one stored webhook event. Idempotent two ways: the row is `INSERT OR IGNORE`, and
 * `processTransaction` re-checks the stored state — so a webhook and the hourly sync racing over the same
 * capture produce one entry, not two.
 */
export async function processWebhookEvent(env: Env, eventId: string): Promise<WebhookOutcome> {
  const row = await env.DB.prepare(`SELECT body_json FROM webhook_events WHERE event_id = ?1`)
    .bind(eventId).first<{ body_json: string }>();
  if (!row) return "skipped";

  const event = JSON.parse(row.body_json) as { event_type: string; resource?: unknown };
  let detail: PayPalTransactionDetail | null;
  let unreadable = false;
  try {
    detail = await mapWebhookToTxn(env, event.event_type, event.resource);
  } catch (e) {
    if (!(e instanceof BuyerTextUnreadableError)) throw e;
    detail = e.detail;
    unreadable = true;
  }
  if (!detail) return "not-bookable";

  const info = detail.transaction_info;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO paypal_transactions
     (transaction_id, event_code, status, initiated_at, amount_cents, fee_cents, currency, counterparty, subject, note, invoice_id, reference_id, raw_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
  ).bind(
    info.transaction_id, info.transaction_event_code, info.transaction_status, info.transaction_initiation_date,
    toCents(info.transaction_amount.value), toCents(info.fee_amount?.value), info.transaction_amount.currency_code,
    toDecisionInput(detail).counterparty ?? null, info.transaction_subject ?? null, info.transaction_note ?? null,
    info.invoice_id ?? null, info.paypal_reference_id ?? null, JSON.stringify(detail),
  ).run();

  // We could not read what the buyer wrote, so the agent does not get to book this one on its own — no
  // model call, straight to the queue. Same shape as a gated classification so the review UI needs no
  // special case, and the reason is explicit rather than a silent empty subject.
  if (unreadable) {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('classification', ?1, ?2, ?3)`)
        .bind(info.transaction_id, JSON.stringify(["buyer_text_unreadable"]), JSON.stringify({ source: "webhook", event_id: eventId, subject: null })),
      env.DB.prepare(`UPDATE paypal_transactions SET state = 'review' WHERE transaction_id = ?1`).bind(info.transaction_id),
      auditInsert(
        env,
        await buildAuditRow(
          {
            ref_type: "review",
            ref_id: info.transaction_id,
            event: "gated",
            actor: "agent",
            detail: { top_reason: "buyer_text_unreadable", source: "webhook", event_id: eventId },
          },
          await readTail(env),
        ),
      ),
    ]);
    return "review";
  }

  return processTransaction(env, info.transaction_id);
}

export async function handleSyncBatch(batch: MessageBatch<SyncMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      if (msg.body.kind === "transaction") await processTransaction(env, msg.body.transactionId);
      else await processWebhookEvent(env, msg.body.eventId);
      msg.ack();
    } catch (e) {
      console.error("queue message failed", msg.body, (e as Error).message);
      msg.retry();
    }
  }
}

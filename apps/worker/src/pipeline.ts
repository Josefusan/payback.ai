/**
 * The autonomous loop: PayPal → Clef decision → gate → post journal or review queue.
 */
import type { Env, SyncMessage } from "./env";
import { PayPalClient, type PayPalTransactionDetail } from "./paypal";
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
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO review_queue (kind, ref_id, reasons, payload_json) VALUES ('classification', ?1, ?2, ?3)`)
        .bind(transactionId, JSON.stringify(decision.gateReasons), JSON.stringify({ input, decision })),
      env.DB.prepare(`UPDATE paypal_transactions SET state = 'review' WHERE transaction_id = ?1`).bind(transactionId),
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

export async function handleSyncBatch(batch: MessageBatch<SyncMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      if (msg.body.kind === "transaction") await processTransaction(env, msg.body.transactionId);
      // TODO: webhook events → map resource to transaction / invoice / payout updates
      msg.ack();
    } catch (e) {
      console.error("queue message failed", msg.body, (e as Error).message);
      msg.retry();
    }
  }
}

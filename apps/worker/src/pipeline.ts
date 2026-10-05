/**
 * The autonomous loop: PayPal → Clef decision → gate → post journal or review queue.
 */
import type { Env } from "./env";
import { PayPalClient, type PayPalTransactionDetail } from "./paypal";
import { decideTransaction, type TxnForDecision } from "./clef";
import { buildJournal, UnsupportedEventError } from "./ledger";
import { toCents } from "./money";

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
  await env.DB.batch([
    entryStmt, ...lineStmts,
    env.DB.prepare(`UPDATE paypal_transactions SET state = 'posted' WHERE transaction_id = ?1`).bind(transactionId),
  ]);
  return "posted";
}

/** Reconcile PayPal Clearing (1010) to the Balances API per currency. */
export async function reconcile(env: Env) {
  const pp = new PayPalClient(env);
  const { balances } = await pp.getBalances();
  const ledger = await env.DB.prepare(
    `SELECT currency, SUM(debit_cents) - SUM(credit_cents) AS bal FROM journal_lines WHERE account_code = '1010' GROUP BY currency`,
  ).all<{ currency: string; bal: number }>();
  const byCur = new Map(ledger.results.map((r) => [r.currency, r.bal]));
  return balances.map((b) => {
    const paypalCents = toCents(b.total_balance.value);
    const ledgerCents = byCur.get(b.currency) ?? 0;
    return { currency: b.currency, paypalCents, ledgerCents, diffCents: paypalCents - ledgerCents, ok: Math.abs(paypalCents - ledgerCents) <= 1 };
  });
}

/**
 * Journal builders: PayPal transaction + Clef account → balanced double-entry lines.
 * Templates: .claude/skills/managerial-accounting/paypal-event-journal-map.md
 *
 * IF-07 (owner: L3). `postEntry` / `reverseEntry` are the only writers of `journal_entries` +
 * `journal_lines`. The ledger is append-only (INV-3): corrections are reversals that link the
 * original via `reverses_entry_id`, never UPDATE/DELETE (enforced by triggers in migration 0002).
 */
import type { Env } from "./env";
import { accountExists } from "./coa";
import { auditInsert, buildAuditRow, readTail } from "./audit";

export interface JournalLine {
  account: string;
  debit: number; // cents ≥ 0
  credit: number; // cents ≥ 0
  currency: string;
  productLine?: string;
  counterparty?: string;
}

export interface TxnForPosting {
  eventCode: string;
  amountCents: number; // + into PayPal balance, − out of it
  feeCents: number; // PayPal reports fees as negative for charges
  currency: string;
  counterparty?: string;
}

export class UnsupportedEventError extends Error {}

export interface BuildJournalOptions {
  /**
   * The reviewer is deciding this entry (IF-07). The event map sends some families to a person rather than
   * to a template — T19xx account corrections, T20xx intra-account transfers, T22xx/T23xx tax withholding —
   * so the reviewer's account builds a signed PayPal entry instead of the code being booked blindly.
   * `postEntry` is the only caller that sets this; the autonomous path leaves it unset, so nothing the map
   * reserves for a human can ever post itself.
   */
  humanDirected?: boolean;
}

const PAYPAL = "1010";
const BANK = "1000";
const FEES = "6050";
const RESERVE = "1020";

const dr = (account: string, cents: number, t: TxnForPosting, pl?: string): JournalLine => ({ account, debit: cents, credit: 0, currency: t.currency, productLine: pl, counterparty: t.counterparty });
const cr = (account: string, cents: number, t: TxnForPosting, pl?: string): JournalLine => ({ account, debit: 0, credit: cents, currency: t.currency, productLine: pl, counterparty: t.counterparty });

/**
 * Build lines for a transaction. `account` is the Clef-chosen P&L/equity account (ignored for pure transfers/holds).
 */
export function buildJournal(t: TxnForPosting, account: string, productLine?: string, options: BuildJournalOptions = {}): JournalLine[] {
  const family = t.eventCode.slice(0, 3); // "T00", "T01", ...
  const gross = Math.abs(t.amountCents);
  const fee = Math.abs(t.feeCents);
  let lines: JournalLine[];

  switch (family) {
    case "T00": {
      if (t.amountCents >= 0) {
        // Money received: Dr PayPal (net), Dr fees, Cr revenue/equity (gross)
        lines = [dr(PAYPAL, gross - fee, t), ...(fee ? [dr(FEES, fee, t, productLine)] : []), cr(account, gross, t, productLine)];
      } else {
        // Money sent: Dr expense/AP/draws, Cr PayPal
        lines = [dr(account, gross, t, productLine), cr(PAYPAL, gross, t)];
      }
      break;
    }
    case "T01": // fees
      lines = [dr(t.eventCode === "T0106" ? "6060" : FEES, gross, t, productLine), cr(PAYPAL, gross, t)];
      break;
    case "T03": // bank → PayPal
      lines = [dr(PAYPAL, gross, t), cr(BANK, gross, t)];
      break;
    case "T04": // PayPal → bank
      lines = [dr(BANK, gross, t), cr(PAYPAL, gross, t)];
      break;
    case "T11": {
      // Refund/reversal: Dr refunds (gross), Cr PayPal (gross − returned fee), Cr fees (returned fee)
      if (t.amountCents < 0) {
        lines = [dr("4900", gross, t, productLine), cr(PAYPAL, gross - fee, t), ...(fee ? [cr(FEES, fee, t, productLine)] : [])];
      } else {
        lines = [dr(PAYPAL, gross, t), cr(account, gross, t, productLine)];
      }
      break;
    }
    case "T12": // chargeback (−) / reversal or reimbursement (+)
      lines = t.amountCents < 0 ? [dr("4900", gross, t, productLine), cr(PAYPAL, gross, t)] : [dr(PAYPAL, gross, t), cr("4900", gross, t, productLine)];
      break;
    case "T15":
    case "T21": // holds (−) / releases (+)
      lines = t.amountCents < 0 ? [dr(RESERVE, gross, t), cr(PAYPAL, gross, t)] : [dr(PAYPAL, gross, t), cr(RESERVE, gross, t)];
      break;
    default:
      if (!options.humanDirected) {
        throw new UnsupportedEventError(`No journal template for ${t.eventCode}; route to review`);
      }
      // Human-directed entry: the reviewer's account carries the counterparty side and the sign of the
      // transaction picks the template shape (money in → Cr their account, money out → Dr their account).
      lines = t.amountCents >= 0
        ? [dr(PAYPAL, gross - fee, t), ...(fee ? [dr(FEES, fee, t, productLine)] : []), cr(account, gross, t, productLine)]
        : [dr(account, gross, t, productLine), cr(PAYPAL, gross, t)];
      break;
  }
  assertBalanced(lines);
  return lines.filter((l) => l.debit > 0 || l.credit > 0);
}

export function assertBalanced(lines: JournalLine[]): void {
  const byCur = new Map<string, number>();
  for (const l of lines) {
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0) throw new Error("Lines must be non-negative integer cents");
    byCur.set(l.currency, (byCur.get(l.currency) ?? 0) + l.debit - l.credit);
  }
  for (const [cur, diff] of byCur) if (diff !== 0) throw new Error(`Unbalanced entry in ${cur}: ${diff}`);
}

/** IF-07 frozen input: lets L1's approval route post a human-corrected entry without writing ledger SQL. */
export interface PostEntryInput {
  transactionId: string;
  accountOverride?: string;
  decisionId: number;
  approver: string;
}

export interface ReverseEntryInput {
  approver: string;
  memo?: string;
  entryDate?: string; // defaults to today (UTC)
}

export interface PostedEntry {
  entryId: number;
  source: string;
  sourceId: string | null;
  reversesEntryId: number | null;
  lines: JournalLine[];
}

interface TxnPostingRow {
  event_code: string;
  amount_cents: number;
  fee_cents: number;
  currency: string;
  counterparty: string | null;
  subject: string | null;
  initiated_at: string;
}

interface DecisionPostingRow {
  account_choice: string | null;
  product_line: string | null;
}

interface EntryPostingRow {
  id: number;
  source: string;
  source_id: string | null;
  entry_date: string;
  memo: string | null;
  decision_id: number | null;
}

interface LinePostingRow {
  account_code: string;
  debit_cents: number;
  credit_cents: number;
  currency: string;
  product_line: string | null;
  counterparty: string | null;
}

const INSERT_LINE =
  `INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency, product_line, counterparty)
   VALUES ((SELECT id FROM journal_entries WHERE source = ?1 AND source_id IS ?2), ?3, ?4, ?5, ?6, ?7, ?8)`;

const INSERT_REVERSAL_LINE =
  `INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency, product_line, counterparty)
   VALUES ((SELECT id FROM journal_entries WHERE source = 'reversal' AND reverses_entry_id = ?1), ?2, ?3, ?4, ?5, ?6, ?7)`;

/**
 * Post a human-corrected/approved entry for one stored PayPal transaction (IF-07, T-L3-002).
 * Amounts are re-read from `paypal_transactions` (the caller cannot inject numbers); the account is
 * `accountOverride` (the human correction) or the Clef decision's choice. Appends only — the ledger
 * is never updated, and a posted transaction is corrected by reversing its entry, not by re-posting.
 */
export async function postEntry(env: Env, input: PostEntryInput): Promise<PostedEntry> {
  const { transactionId, accountOverride, decisionId, approver } = input;
  if (!approver) throw new Error("postEntry requires an approver");
  if (!Number.isInteger(decisionId)) throw new Error("postEntry requires a numeric decisionId");

  const txn = await env.DB.prepare(
    `SELECT event_code, amount_cents, fee_cents, currency, counterparty, subject, initiated_at
       FROM paypal_transactions WHERE transaction_id = ?1`,
  ).bind(transactionId).first<TxnPostingRow>();
  if (!txn) throw new Error(`Unknown transaction ${transactionId}`);

  const already = await env.DB.prepare(
    `SELECT id FROM journal_entries WHERE source_id = ?1 AND reverses_entry_id IS NULL`,
  ).bind(transactionId).first<{ id: number }>();
  if (already) throw new Error(`Transaction ${transactionId} is already posted as entry ${already.id}; reverse it instead`);

  const decision = await env.DB.prepare(
    `SELECT account_choice, product_line FROM decisions WHERE id = ?1`,
  ).bind(decisionId).first<DecisionPostingRow>();
  if (!decision) throw new Error(`Unknown decision ${decisionId}`);

  const account = accountOverride ?? decision.account_choice ?? undefined;
  if (!account || !accountExists(account)) throw new Error(`Unknown account ${account ?? "(none)"}; pass accountOverride or fix the decision`);

  const lines = buildJournal(
    {
      eventCode: txn.event_code,
      amountCents: txn.amount_cents,
      feeCents: txn.fee_cents,
      currency: txn.currency,
      counterparty: txn.counterparty ?? undefined,
    },
    account,
    decision.product_line ?? undefined,
    { humanDirected: true },
  );

  const entryDate = txn.initiated_at.slice(0, 10);
  const memo = txn.subject ?? txn.event_code;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO journal_entries (source, source_id, entry_date, memo, decision_id, approver)
       VALUES ('manual', ?1, ?2, ?3, ?4, ?5)`,
    ).bind(transactionId, entryDate, memo, decisionId, approver),
    ...lines.map((l) =>
      env.DB.prepare(INSERT_LINE).bind("manual", transactionId, l.account, l.debit, l.credit, l.currency, l.productLine ?? null, l.counterparty ?? null),
    ),
    // Same batch as the entry: the reviewer's correction and the record of who made it are one write.
    auditInsert(
      env,
      await buildAuditRow(
        {
          ref_type: "journal_entry",
          ref_id: transactionId,
          event: "posted",
          actor: approver,
          detail: {
            account,
            account_override: accountOverride ?? null,
            decision_id: decisionId,
            lines: lines.length,
            human: true,
          },
        },
        await readTail(env),
      ),
    ),
  ]);

  const row = await env.DB.prepare(
    `SELECT id FROM journal_entries WHERE source = 'manual' AND source_id = ?1`,
  ).bind(transactionId).first<{ id: number }>();
  if (!row) throw new Error(`Posting entry for ${transactionId} failed`);
  return { entryId: row.id, source: "manual", sourceId: transactionId, reversesEntryId: null, lines };
}

/**
 * Reverse an entry by appending its mirror (debits ↔ credits) linked via `reverses_entry_id`.
 * The original row and its lines are never touched, so the two entries net to zero (T-L3-002).
 */
export async function reverseEntry(env: Env, entryId: number, input: ReverseEntryInput): Promise<PostedEntry> {
  const { approver } = input;
  if (!approver) throw new Error("reverseEntry requires an approver");

  const prior = await env.DB.prepare(
    `SELECT id, source, source_id, entry_date, memo, decision_id FROM journal_entries WHERE id = ?1`,
  ).bind(entryId).first<EntryPostingRow>();
  if (!prior) throw new Error(`Unknown entry ${entryId}`);

  const already = await env.DB.prepare(`SELECT id FROM journal_entries WHERE reverses_entry_id = ?1`)
    .bind(entryId).first<{ id: number }>();
  if (already) throw new Error(`Entry ${entryId} is already reversed by entry ${already.id}`);

  const { results } = await env.DB.prepare(
    `SELECT account_code, debit_cents, credit_cents, currency, product_line, counterparty
       FROM journal_lines WHERE entry_id = ?1`,
  ).bind(entryId).all<LinePostingRow>();
  if (!results.length) throw new Error(`Entry ${entryId} has no lines to reverse`);

  const mirrored: JournalLine[] = results.map((l) => ({
    account: l.account_code,
    debit: l.credit_cents,
    credit: l.debit_cents,
    currency: l.currency,
    productLine: l.product_line ?? undefined,
    counterparty: l.counterparty ?? undefined,
  }));
  assertBalanced(mirrored);

  const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
  const memo = input.memo ?? `Reversal of entry ${entryId}${prior.memo ? `: ${prior.memo}` : ""}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO journal_entries (source, source_id, entry_date, memo, decision_id, reverses_entry_id, approver)
       VALUES ('reversal', ?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(prior.source_id, entryDate, memo, prior.decision_id, entryId, approver),
    ...mirrored.map((l) =>
      env.DB.prepare(INSERT_REVERSAL_LINE).bind(entryId, l.account, l.debit, l.credit, l.currency, l.productLine ?? null, l.counterparty ?? null),
    ),
    // Same batch as the reversal: the correction to the books and its audit row are one write.
    auditInsert(
      env,
      await buildAuditRow(
        {
          ref_type: "journal_entry",
          ref_id: String(entryId),
          event: "reversed",
          actor: approver,
          detail: { memo, lines: mirrored.length },
        },
        await readTail(env),
      ),
    ),
  ]);

  const row = await env.DB.prepare(
    `SELECT id FROM journal_entries WHERE source = 'reversal' AND reverses_entry_id = ?1`,
  ).bind(entryId).first<{ id: number }>();
  if (!row) throw new Error(`Reversal of entry ${entryId} failed`);
  return { entryId: row.id, source: "reversal", sourceId: prior.source_id, reversesEntryId: entryId, lines: mirrored };
}

// ── Opening balance (T-L3-001a) ──────────────────────────────────────────────
const OPENING_EQUITY = "3000"; // Owner's equity

/**
 * Bring the real PayPal balance onto the books: Dr PayPal Clearing (1010) / Cr Owner's equity (3000)
 * for a positive balance, mirrored when the balance is negative. Pure and always balanced — the caller
 * (pipeline) owns the single, idempotent posting. Returns `[]` for a zero balance (nothing to open).
 */
export function buildOpeningLines(currency: string, balanceCents: number): JournalLine[] {
  if (!Number.isInteger(balanceCents)) throw new Error("Opening balance must be integer cents");
  const amount = Math.abs(balanceCents);
  if (amount === 0) return [];
  const lines: JournalLine[] =
    balanceCents > 0
      ? [
          { account: PAYPAL, debit: amount, credit: 0, currency },
          { account: OPENING_EQUITY, debit: 0, credit: amount, currency },
        ]
      : [
          { account: PAYPAL, debit: 0, credit: amount, currency },
          { account: OPENING_EQUITY, debit: amount, credit: 0, currency },
        ];
  assertBalanced(lines);
  return lines;
}

// ── L3 read models (T-L3-007): routes call these, never their own SQL ────────

/** One row of `GET /api/ledger`: a journal line joined to its entry and account name. */
export interface LedgerLineRow {
  entry_id: number;
  entry_date: string;
  memo: string | null;
  source_id: string | null;
  account_code: string;
  account_name: string;
  debit_cents: number;
  credit_cents: number;
  currency: string;
  product_line: string | null;
  counterparty: string | null;
}

/** `GET /api/ledger` — the 2000 most recent journal lines, newest first. */
export async function listLedgerLines(env: Env): Promise<LedgerLineRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.id AS entry_id, e.entry_date, e.memo, e.source_id, l.account_code, a.name AS account_name,
            l.debit_cents, l.credit_cents, l.currency, l.product_line, l.counterparty
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.code = l.account_code
      ORDER BY e.entry_date DESC, e.id DESC LIMIT 2000`,
  ).all<LedgerLineRow>();
  return results;
}

/** One row of `GET /api/reports/pnl`: net cents (credit − debit) per product line / account. */
export interface PnlRow {
  product_line: string; // 'none' when unassigned
  type: "revenue" | "contra_revenue" | "cogs" | "expense";
  account_code: string;
  name: string;
  net_cents: number;
}

/** `GET /api/reports/pnl` — SQL does the numbers; no LLM in the number path (INV-6). */
export async function reportsPnl(env: Env): Promise<PnlRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(l.product_line,'none') AS product_line, a.type, l.account_code, a.name,
            SUM(l.credit_cents) - SUM(l.debit_cents) AS net_cents
       FROM journal_lines l JOIN accounts a ON a.code = l.account_code
      WHERE a.type IN ('revenue','contra_revenue','cogs','expense')
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 3`,
  ).all<PnlRow>();
  return results;
}

/** `GET /api/ledger/:id` — one journal entry with its lines, for the dashboard's row drill-through. */
export interface LedgerEntryRow {
  id: number;
  source: string;
  source_id: string | null;
  entry_date: string;
  memo: string | null;
  decision_id: number | null;
  reverses_entry_id: number | null;
  lines: Array<{
    account_code: string;
    account_name: string;
    debit_cents: number;
    credit_cents: number;
    currency: string;
    product_line: string | null;
    counterparty: string | null;
  }>;
}

/**
 * The entry header and its lines. `source`, `decision_id` and `reverses_entry_id` are not derivable from
 * a flat ledger line, which is why the drill-through needs its own read rather than reusing listLedgerLines.
 * Returns null for an unknown id so the route can answer 404 instead of an empty entry.
 */
export async function getLedgerEntry(env: Env, id: number): Promise<LedgerEntryRow | null> {
  const head = await env.DB.prepare(
    `SELECT id, source, source_id, entry_date, memo, decision_id, reverses_entry_id
       FROM journal_entries WHERE id = ?`,
  )
    .bind(id)
    .first<Omit<LedgerEntryRow, "lines">>();
  if (!head) return null;

  const { results } = await env.DB.prepare(
    `SELECT l.account_code, a.name AS account_name, l.debit_cents, l.credit_cents, l.currency,
            l.product_line, l.counterparty
       FROM journal_lines l JOIN accounts a ON a.code = l.account_code
      WHERE l.entry_id = ? ORDER BY l.id`,
  )
    .bind(id)
    .all<LedgerEntryRow["lines"][number]>();

  return { ...head, lines: results };
}

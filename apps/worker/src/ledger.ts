/**
 * Journal builders: PayPal transaction + Clef account → balanced double-entry lines.
 * Templates: .claude/skills/managerial-accounting/paypal-event-journal-map.md
 */
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

const PAYPAL = "1010";
const BANK = "1000";
const FEES = "6050";
const RESERVE = "1020";

const dr = (account: string, cents: number, t: TxnForPosting, pl?: string): JournalLine => ({ account, debit: cents, credit: 0, currency: t.currency, productLine: pl, counterparty: t.counterparty });
const cr = (account: string, cents: number, t: TxnForPosting, pl?: string): JournalLine => ({ account, debit: 0, credit: cents, currency: t.currency, productLine: pl, counterparty: t.counterparty });

/**
 * Build lines for a transaction. `account` is the Clef-chosen P&L/equity account (ignored for pure transfers/holds).
 */
export function buildJournal(t: TxnForPosting, account: string, productLine?: string): JournalLine[] {
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
      throw new UnsupportedEventError(`No journal template for ${t.eventCode}; route to review`);
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

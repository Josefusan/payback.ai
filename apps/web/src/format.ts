/** Money is integer cents everywhere (INV-3). Formatting is manual so tests are deterministic. */

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/** Ledger convention: an empty debit/credit cell reads as blank, not "$0.00". */
export function formatAmount(cents: number): string {
  return cents === 0 ? "" : formatCents(cents);
}

export function formatSignedCents(cents: number): string {
  if (cents === 0) return formatCents(0);
  return `${cents > 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

export function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Nullable money for optional contract fields (e.g. a reconcile row with no pending bucket yet). */
export function formatMoneyOrDash(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : formatCents(cents);
}

export function formatSignedMoneyOrDash(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : formatSignedCents(cents);
}

/** Ratio (0.961 → "96.1%") for contribution-margin and similar columns. */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

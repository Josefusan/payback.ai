/** Money helpers. All ledger math is integer minor units (cents). */

/** Parse a PayPal decimal string ("-12.34", "1500.00") into integer cents without float error. */
export function toCents(value: string | undefined | null): number {
  if (value === undefined || value === null || value === "") return 0;
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid money string: ${value}`);
  const sign = m[1] ? -1 : 1;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? "").padEnd(2, "0"));
  return sign * (whole * 100 + frac);
}

/** Format cents back to a PayPal decimal string. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

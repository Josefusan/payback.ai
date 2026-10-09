/**
 * Chart-of-accounts access (`GET /api/coa`). The review screen needs the account *names* — a reviewer
 * being asked to override Clef's choice has to see "4000 Product revenue", not "4000".
 *
 * Validated like the other contract payloads: a drifting response becomes a labelled fixture fallback
 * rather than an override picker full of blanks.
 */
import type { CoaAccount } from "../../../../packages/contracts/api";
import coaJson from "../../../../packages/contracts/fixtures/coa.json";

export const COA_SOURCE = "packages/contracts/fixtures/coa.json";

const TYPES = ["asset", "liability", "equity", "revenue", "contra_revenue", "cogs", "expense", "other"] as const;

export function parseCoa(raw: unknown, where = "GET /api/coa"): CoaAccount[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected an array of CoaAccount`);
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`${where}: row ${index} must be an object`);
    const row = entry as Record<string, unknown>;
    if (typeof row.code !== "string" || row.code === "") throw new Error(`${where}: row ${index}.code must be a string`);
    if (typeof row.name !== "string" || row.name === "") throw new Error(`${where}: row ${index}.name must be a string`);
    if (typeof row.type !== "string" || !(TYPES as readonly string[]).includes(row.type)) {
      throw new Error(`${where}: row ${index}.type must be one of ${TYPES.join(", ")}`);
    }
    return { code: row.code, name: row.name, type: row.type as CoaAccount["type"] };
  });
}

/** The shipped chart, used when the Worker is unreachable. */
export const coa: CoaAccount[] = parseCoa(coaJson);

/** `4000` → `4000 Product revenue`; an unknown code stays bare rather than inventing a name. */
export function accountLabel(accounts: readonly CoaAccount[], code: string): string {
  const match = accounts.find((account) => account.code === code);
  return match ? `${match.code} ${match.name}` : code;
}

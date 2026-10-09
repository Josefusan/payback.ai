/**
 * T-L4-005 — budget vs actual variance.
 *
 * The P&L says what happened; this says what it happened against. It is the most-used management report,
 * and the reason it needs its own module rather than a route query is the sign convention: revenue and
 * cost cannot share one signed scale without "over budget" meaning opposite things on either half.
 *
 * Both columns are therefore the account's NATURAL MAGNITUDE — revenue as credit − debit, cost as
 * debit − credit — and favourability is decided explicitly from the account type rather than inferred
 * from the sign of a difference.
 */
import type { AccountType, BudgetVarianceResponse, BudgetVarianceRow } from "../../../packages/contracts/api";
import type { Env } from "./env";

/** Revenue-side accounts: credit-natural, and beating the plan is good news. */
const REVENUE_TYPES: readonly AccountType[] = ["revenue"];
/**
 * Cost-side accounts: debit-natural, and exceeding the plan is not good news.
 *
 * `contra_revenue` belongs here despite being filed under revenue in the P&L. Refunds are debit-natural —
 * a normal refund would otherwise report as negative "revenue" — and giving more refunds than planned is
 * adverse, not favourable. The type name says where it sits on the P&L; the sign and the verdict follow
 * what the account actually does.
 */
const COST_TYPES: readonly AccountType[] = ["cogs", "expense", "contra_revenue"];

/** `2026-10` → `{ start: "2026-10-01", end: "2026-11-01" }`, so a half-open range works on ISODate text. */
export function periodBounds(period: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`period must be YYYY-MM, got ${JSON.stringify(period)}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`period must be YYYY-MM, got ${JSON.stringify(period)}`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: `${period}-01`, end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` };
}

/** The current UTC month. UTC because every other date in the ledger is stored in UTC. */
export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

interface VarianceQueryRow {
  code: string;
  name: string;
  type: AccountType;
  budget_cents: number;
  debit_cents: number;
  credit_cents: number;
}

/**
 * Budget vs actual for one period.
 *
 * One query, deliberately: the actuals are aggregated in a CTE *before* the join, so the join cannot
 * multiply journal lines — the classic way a report like this silently inflates. Accounts with neither a
 * budget nor any activity are dropped, because a variance report listing every unused account buries the
 * six lines that matter.
 */
export async function budgetVariance(env: Env, period: string): Promise<BudgetVarianceResponse> {
  const { start, end } = periodBounds(period);
  const rows = await env.DB.prepare(
    `WITH actuals AS (
       SELECT jl.account_code          AS code,
              SUM(jl.debit_cents)       AS debit_cents,
              SUM(jl.credit_cents)      AS credit_cents
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.entry_date >= ?1 AND je.entry_date < ?2
       GROUP BY jl.account_code
     )
     SELECT a.code                        AS code,
            a.name                        AS name,
            a.type                        AS type,
            COALESCE(b.amount_cents, 0)   AS budget_cents,
            COALESCE(act.debit_cents, 0)  AS debit_cents,
            COALESCE(act.credit_cents, 0) AS credit_cents
     FROM accounts a
     LEFT JOIN budgets b   ON b.account_code = a.code AND b.period = ?3
     LEFT JOIN actuals act ON act.code = a.code
     WHERE a.type IN ('revenue','contra_revenue','cogs','expense')
     ORDER BY a.code`,
  ).bind(start, end, period).all<VarianceQueryRow>();

  const out: BudgetVarianceRow[] = [];
  const revenue = { budget_cents: 0, actual_cents: 0, variance_cents: 0 };
  const cost = { budget_cents: 0, actual_cents: 0, variance_cents: 0 };

  for (const row of rows.results ?? []) {
    const isRevenue = REVENUE_TYPES.includes(row.type);
    if (!isRevenue && !COST_TYPES.includes(row.type)) continue;

    // Natural magnitude: revenue is what was earned, cost is what was spent. Both read positive normally.
    const actual = isRevenue ? row.credit_cents - row.debit_cents : row.debit_cents - row.credit_cents;
    const budget = row.budget_cents;
    if (budget === 0 && actual === 0) continue;

    const variance = actual - budget;
    // Revenue above plan is good; cost above plan is not. With no budget there is no expectation to judge.
    const favourable = budget === 0 ? null : isRevenue ? variance > 0 : variance < 0;
    out.push({
      account_code: row.code,
      name: row.name,
      type: row.type as BudgetVarianceRow["type"],
      budget_cents: budget,
      actual_cents: actual,
      variance_cents: variance,
      // A percentage of a zero budget is not a number; null is the honest answer and the UI shows "—".
      variance_pct: budget === 0 ? null : Math.round((variance / budget) * 10_000) / 100,
      favourable,
    });

    const side = isRevenue ? revenue : cost;
    side.budget_cents += budget;
    side.actual_cents += actual;
    side.variance_cents += variance;
  }

  // Only the net is offered as a total: summing the two sides' raw magnitudes would produce a figure with
  // no meaning, whereas revenue − cost is the effect on the bottom line — the number that adds up.
  const netBudget = revenue.budget_cents - cost.budget_cents;
  const netActual = revenue.actual_cents - cost.actual_cents;
  const netVariance = netActual - netBudget;
  return {
    period,
    rows: out,
    totals: {
      revenue,
      cost,
      net: {
        budget_cents: netBudget,
        actual_cents: netActual,
        variance_cents: netVariance,
        favourable: netBudget === 0 ? null : netVariance >= 0,
      },
    },
  };
}

/**
 * T-L4-005 — budget vs actual variance.
 *
 * The report's whole value is that "over budget" means something different on a revenue line than on a
 * cost line, so the tests that matter are the favourability ones and the sign convention they rest on.
 * A report that got either backwards would still produce plausible numbers and still render.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyAudit } from "./audit";
import { budgetVariance, currentPeriod, isValidBudgetPeriod, periodBounds, setBudgetLine, validateBudgetWrite, type BudgetWrite } from "./budget";
import type { AppEnv, Env } from "./env";
import { resetTokenCache } from "./paypal";
import { reports } from "./routes/reports";
import { createLedgerDb, type TestD1 } from "./test-d1";

const env = (db: TestD1): Env => ({ DB: db as unknown as Env["DB"] }) as unknown as Env;

beforeEach(() => resetTokenCache());

/** Post one entry with arbitrary lines, bypassing the decision pipeline. */
async function post(db: TestD1, date: string, lines: Array<[string, number, number]>): Promise<void> {
  const id = await db
    .prepare(`INSERT INTO journal_entries (source, source_id, entry_date, memo) VALUES ('paypal', ?1, ?2, 'test') RETURNING id`)
    .bind(`t-${Math.random().toString(36).slice(2)}`, date)
    .first<{ id: number }>();
  for (const [account, debit, credit] of lines) {
    await db
      .prepare(`INSERT INTO journal_lines (entry_id, account_code, debit_cents, credit_cents, currency) VALUES (?1, ?2, ?3, ?4, 'USD')`)
      .bind(id!.id, account, debit, credit)
      .run();
  }
}

describe("periodBounds / currentPeriod", () => {
  it("produces a half-open range, wrapping December to the next year", () => {
    expect(periodBounds("2026-10")).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(periodBounds("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("rejects anything that is not YYYY-MM", () => {
    expect(() => periodBounds("2026-13")).toThrow();
    expect(() => periodBounds("October")).toThrow();
  });

  it("formats the current UTC month", () => {
    expect(currentPeriod(new Date("2026-10-09T23:30:00Z"))).toBe("2026-10");
  });
});

describe("budgetVariance", () => {
  it("is empty-but-shaped for a period with neither budgets nor activity", async () => {
    const result = await budgetVariance(env(createLedgerDb()), "2025-01");
    expect(result.period).toBe("2025-01");
    expect(result.rows).toEqual([]);
    const zero = { budget_cents: 0, actual_cents: 0, variance_cents: 0 };
    expect(result.totals).toEqual({ revenue: zero, cost: zero, net: { ...zero, favourable: null } });
  });

  it("still shows a budgeted line with no activity, as an adverse variance", async () => {
    // The point of a variance report is to show the plan you have not hit yet, so a budgeted account with
    // nothing against it must appear rather than being filtered out as "no data".
    const { rows } = await budgetVariance(env(createLedgerDb()), "2026-10");
    const software = rows.find((r) => r.account_code === "6100")!;
    expect(software).toMatchObject({ budget_cents: 15000, actual_cents: 0, variance_cents: -15000, favourable: true });
    expect(software.variance_pct).toBe(-100);
  });

  it("reads revenue as credit − debit and cost as debit − credit", async () => {
    const db = createLedgerDb();
    // Product revenue 1,842.00 net of a 71.40 merchant fee.
    await post(db, "2026-10-04", [["1010", 177060, 0], ["6050", 7140, 0], ["4000", 0, 184200]]);

    const { rows } = await budgetVariance(env(db), "2026-10");
    const revenue = rows.find((r) => r.account_code === "4000")!;
    const fees = rows.find((r) => r.account_code === "6050")!;
    expect(revenue.actual_cents).toBe(184200);
    expect(fees.actual_cents).toBe(7140);
  });

  it("calls revenue above plan favourable and cost above plan adverse", async () => {
    const db = createLedgerDb();
    // Revenue 4,500.00 against a 4,000.00 plan; contractors 1,320.00 against a 1,200.00 plan.
    await post(db, "2026-10-04", [["1010", 582000, 0], ["4100", 0, 450000], ["6300", 132000, 0], ["2000", 0, 132000]]);

    const { rows } = await budgetVariance(env(db), "2026-10");
    const services = rows.find((r) => r.account_code === "4100")!;
    const contractors = rows.find((r) => r.account_code === "6300")!;

    expect(services).toMatchObject({ budget_cents: 400000, actual_cents: 450000, variance_cents: 50000, favourable: true });
    expect(services.variance_pct).toBe(12.5);
    // Cost over plan is the opposite verdict from revenue over plan, on the same positive variance sign.
    expect(contractors).toMatchObject({ budget_cents: 120000, actual_cents: 132000, variance_cents: 12000, favourable: false });
  });

  it("reports a percentage of nothing as null rather than a fabricated number", async () => {
    const db = createLedgerDb();
    // Account 5000 (COGS) has no budget row in the seed, but does have activity.
    await post(db, "2026-10-04", [["5000", 30000, 0], ["1010", 0, 30000]]);

    const cogs = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "5000")!;
    expect(cogs.budget_cents).toBe(0);
    expect(cogs.actual_cents).toBe(30000);
    expect(cogs.variance_pct).toBeNull();
    expect(cogs.favourable).toBeNull();
  });

  it("excludes activity outside the period and other months' budgets", async () => {
    const db = createLedgerDb();
    await post(db, "2026-10-31", [["4000", 0, 100000], ["1010", 100000, 0]]);
    await post(db, "2026-11-01", [["4000", 0, 999900], ["1010", 999900, 0]]);

    const october = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "4000")!;
    expect(october.actual_cents).toBe(100000); // October only, budgeted 200000 → 100000 short → adverse
    expect(october.variance_cents).toBe(-100000);
    expect(october.favourable).toBe(false);
  });

  it("does not multiply actuals when an account has many lines", async () => {
    const db = createLedgerDb();
    await post(db, "2026-10-02", [["4000", 0, 50000], ["1010", 50000, 0]]);
    await post(db, "2026-10-05", [["4000", 0, 50000], ["1010", 50000, 0]]);
    await post(db, "2026-10-09", [["4000", 0, 50000], ["1010", 50000, 0]]);

    // The classic double-count: joining lines to budgets before aggregating would give 450000 here.
    const revenue = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "4000")!;
    expect(revenue.actual_cents).toBe(150000);
  });

  it("nets a reversal rather than reporting both the entry and its reversal", async () => {
    const db = createLedgerDb();
    await post(db, "2026-10-04", [["4000", 0, 100000], ["1010", 100000, 0]]);
    await post(db, "2026-10-06", [["4000", 100000, 0], ["1010", 0, 100000]]); // the reversal, as its own entry
    const revenue = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "4000")!;
    expect(revenue.actual_cents).toBe(0);
  });

  it("treats a refund as cost-like: positive magnitude, and above plan is adverse", async () => {
    const db = createLedgerDb();
    // A refund debits 4900 (contra-revenue) and credits 1010. Reading it as revenue would report -4900.
    await post(db, "2026-10-06", [["4900", 4900, 0], ["1010", 0, 4900]]);

    const refunds = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "4900")!;
    expect(refunds.actual_cents).toBe(4900); // positive: the refunds given, not negative revenue
    expect(refunds.variance_cents).toBe(-100); // 4900 against a 5000 plan: slightly under
    expect(refunds.favourable).toBe(true);
  });

  it("separates the two sides and reports net as revenue − cost", async () => {
    const db = createLedgerDb();
    await post(db, "2026-10-04", [["1010", 582000, 0], ["4100", 0, 450000], ["6300", 132000, 0], ["2000", 0, 132000]]);
    const { totals } = await budgetVariance(env(db), "2026-10");

    expect(totals.revenue.actual_cents).toBe(450000);
    expect(totals.revenue.budget_cents).toBe(600000); // 4000 + 4100 plans
    expect(totals.cost.actual_cents).toBe(132000);
    expect(totals.cost.budget_cents).toBe(149000); // 4900 + 6050 + 6100 + 6300 plans
    // The only total that means anything: net actual minus net plan.
    expect(totals.net.actual_cents).toBe(318000);
    expect(totals.net.budget_cents).toBe(451000);
    expect(totals.net.variance_cents).toBe(-133000);
    expect(totals.net.favourable).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────── the budget write path */

describe("setBudgetLine", () => {
  /** A valid write, overridable per test. */
  const write = (db: TestD1, over: Partial<BudgetWrite> = {}) =>
    setBudgetLine(env(db), { period: "2026-10", account_code: "6100", amount_cents: 18000, by: "Joseph", ...over });

  it("round-trips a written budget back into the variance report", async () => {
    const db = createLedgerDb();
    // 6200 (Advertising) has no seeded plan and no activity, so the only way it can appear is this write.
    const result = await write(db, { account_code: "6200", amount_cents: 25000, note: "Ads" });
    expect(result).toEqual({ ok: true, budget: { period: "2026-10", account_code: "6200", amount_cents: 25000, note: "Ads" } });

    const row = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "6200")!;
    expect(row).toMatchObject({ budget_cents: 25000, actual_cents: 0, variance_cents: -25000, favourable: true });
    expect(row.variance_pct).toBe(-100);
  });

  it("replaces a seeded line in place rather than duplicating it", async () => {
    const db = createLedgerDb();
    await write(db, { account_code: "6100", amount_cents: 18000 });

    const rows = (await budgetVariance(env(db), "2026-10")).rows.filter((r) => r.account_code === "6100");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.budget_cents).toBe(18000); // the seed was 15000
  });

  it("appends a hash-chained audit row per write, and the chain still verifies", async () => {
    const db = createLedgerDb();
    await write(db, { account_code: "6100", amount_cents: 18000 });
    await write(db, { account_code: "6100", amount_cents: 22000 });

    const { results } = await db
      .prepare(`SELECT ref_type, ref_id, event, actor, detail_json FROM audit_log ORDER BY seq`)
      .all<{ ref_type: string; ref_id: string; event: string; actor: string; detail_json: string }>();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ref_type: "setting", ref_id: "budget:2026-10:6100", event: "budget_set", actor: "Joseph" });
    // The overwrite records the previous amount, so the change is visible rather than silent.
    expect(JSON.parse(results[0]!.detail_json)).toMatchObject({ period: "2026-10", account_code: "6100", from: 15000, to: 18000 });
    expect(JSON.parse(results[1]!.detail_json)).toMatchObject({ from: 18000, to: 22000 });
    expect((await verifyAudit(env(db))).ok).toBe(true);
  });

  it("refuses a bad period / account / amount / actor with a stable code, and writes nothing", async () => {
    const db = createLedgerDb();
    expect(await write(db, { period: "2026-13" })).toEqual({ ok: false, error: "invalid_period" });
    expect(await write(db, { period: "October" })).toEqual({ ok: false, error: "invalid_period" });
    expect(await write(db, { account_code: "9999" })).toEqual({ ok: false, error: "invalid_account" }); // no such account
    expect(await write(db, { account_code: "1010" })).toEqual({ ok: false, error: "invalid_account" }); // asset: never on a P&L report
    expect(await write(db, { account_code: "" })).toEqual({ ok: false, error: "invalid_account" });
    expect(await write(db, { amount_cents: -1 })).toEqual({ ok: false, error: "invalid_amount" });
    expect(await write(db, { amount_cents: 1.5 })).toEqual({ ok: false, error: "invalid_amount" });
    expect(await write(db, { amount_cents: Number.NaN })).toEqual({ ok: false, error: "invalid_amount" });
    expect(await write(db, { amount_cents: "18000" })).toEqual({ ok: false, error: "invalid_amount" });
    expect(await write(db, { by: "   " })).toEqual({ ok: false, error: "actor_required" });

    // Every rejection above must be a no-op: nothing stored, nothing on the chain.
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).first<{ n: number }>())!.n).toBe(0);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM budgets WHERE period = '2026-10'`).first<{ n: number }>())!.n).toBe(6); // the seed only
  });

  it("validates the period shape the same way the reader does", () => {
    expect(isValidBudgetPeriod("2026-10")).toBe(true);
    expect(isValidBudgetPeriod("2026-00")).toBe(false);
    expect(isValidBudgetPeriod("2026-13")).toBe(false);
    expect(validateBudgetWrite({ period: "2026-10", account_code: "4000", amount_cents: 0, by: "j" }).ok).toBe(true);
  });
});

/* ───────────────────────────────────────────── the write path over HTTP (route) */

describe("PUT /api/budgets", () => {
  const ADMIN = "test-admin-token";
  const routeEnv = (db: TestD1): Env => ({ DB: db as unknown as Env["DB"], ADMIN_TOKEN: ADMIN }) as unknown as Env;
  const app = () => new Hono<AppEnv>().route("/", reports);

  const put = (db: TestD1, body: unknown, token: string | null = ADMIN) =>
    app().request(
      "/api/budgets",
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...(token === null ? {} : { "x-admin-token": token }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      routeEnv(db),
    );

  it("returns the written line, and the report reflects it", async () => {
    const db = createLedgerDb();
    const res = await put(db, { period: "2026-10", account_code: "6100", amount_cents: 18000, by: "Joseph", note: "Software" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ period: "2026-10", account_code: "6100", amount_cents: 18000, note: "Software" });

    const row = (await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "6100")!;
    expect(row.budget_cents).toBe(18000);
  });

  it("is admin-gated: a missing token is 401 and the budget is not written", async () => {
    const db = createLedgerDb();
    const res = await put(db, { period: "2026-10", account_code: "6200", amount_cents: 1, by: "Joseph" }, null);
    expect(res.status).toBe(401);
    expect((await budgetVariance(env(db), "2026-10")).rows.find((r) => r.account_code === "6200")).toBeUndefined();
  });

  it("answers 400 with a stable code for bad input, never 500", async () => {
    const db = createLedgerDb();
    const malformed = await put(db, "{not json");
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: string }).error).toBe("invalid_json");

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ period: "2026-13", account_code: "6100", amount_cents: 1, by: "x" }, "invalid_period"],
      [{ period: "2026-10", account_code: "9999", amount_cents: 1, by: "x" }, "invalid_account"],
      [{ period: "2026-10", account_code: "6100", amount_cents: -1, by: "x" }, "invalid_amount"],
      [{ period: "2026-10", account_code: "6100", amount_cents: 1 }, "actor_required"],
    ];
    for (const [body, code] of cases) {
      const res = await put(db, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(code);
    }
  });
});

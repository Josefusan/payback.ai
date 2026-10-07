/**
 * T-L2-002 — DecisionProvider (clef | fixture | fallback-llm).
 *
 * The end-to-end block drives the FIXTURE provider through the production pipeline
 * (`processTransaction`) and asserts that a flagged/failed decision lands in `review_queue`
 * instead of being auto-posted — the R4 guarantee that no provider failure can move money.
 */
import { afterEach, describe, expect, it } from "vitest";
import rawActionFixtures from "../test/fixtures/clef/actions.json";
import rawTxnFixtures from "../test/fixtures/clef/transactions.json";
import { decideAction, decideTransaction, type TxnForDecision } from "./clef";
import {
  clef,
  configureDecisionProviders,
  fallbackLlm,
  fixture,
  isProviderName,
  PROVIDER_NAMES,
  providers,
  readFixtureSet,
  resolveProviderName,
  selectProvider,
  type FixtureSet,
} from "./decision-provider";
import type { Env } from "./env";
import { evaluateAction, policyConfig } from "./policy";
import { processTransaction } from "./pipeline";

const FIXTURES: FixtureSet = { ...readFixtureSet(rawTxnFixtures), actions: readFixtureSet(rawActionFixtures).actions };

const TXN: TxnForDecision = { event_code: "T0006", amount: "49.00", currency: "USD", fee: "-1.92", counterparty: "buyer@example.com" };

function makeEnv(ai?: unknown, extra: Record<string, unknown> = {}): Env {
  return {
    AI: ai,
    AUTO_POST_THRESHOLD: "0.90",
    CLEF_MODEL: "@cf/cloudflare/clef-flash",
    CLEF_ESCALATION_MODEL: "@cf/cloudflare/clef",
    ACTION_THRESHOLD: "0.95",
    AUTONOMOUS_PAYOUT_LIMIT_CENTS: "100000",
    AI_GATEWAY_ID: "",
    ...extra,
  } as unknown as Env;
}

afterEach(() => configureDecisionProviders(null));

/* ------------------------------------------------------------------ shape */

describe("DecisionProvider surface", () => {
  it("exposes exactly clef | fixture | fallback-llm", () => {
    expect(PROVIDER_NAMES).toEqual(["clef", "fixture", "fallback-llm"]);
    expect(Object.keys(providers).sort()).toEqual(["clef", "fallback-llm", "fixture"]);
    expect(typeof clef).toBe("function");
    expect(typeof fixture).toBe("function");
    expect(typeof fallbackLlm).toBe("function");
    expect(isProviderName("fixture")).toBe(true);
    expect(isProviderName("nope")).toBe(false);
  });

  it("is configurable with a documented precedence (override → config → env → clef)", () => {
    const plainEnv = makeEnv();
    expect(resolveProviderName(plainEnv)).toBe("clef"); // default
    expect(resolveProviderName(makeEnv(undefined, { DECISION_PROVIDER: "fallback-llm" }))).toBe("fallback-llm");
    expect(resolveProviderName(makeEnv(undefined, { DECISION_PROVIDER: "garbage" }))).toBe("clef"); // unknown → safe default
    configureDecisionProviders({ provider: "fixture", fixtures: FIXTURES });
    expect(resolveProviderName(plainEnv)).toBe("fixture"); // config beats env
    expect(resolveProviderName(plainEnv, "clef")).toBe("clef"); // explicit override wins
    expect(selectProvider(plainEnv).name).toBe("fixture");
    expect(selectProvider(plainEnv, "clef").name).toBe("clef");
  });
});

/* ---------------------------------------------------------------- fixture */

describe("fixture provider", () => {
  it("replays a recorded auto decision", async () => {
    configureDecisionProviders({ provider: "fixture", fixtures: FIXTURES });
    const d = await decideTransaction(makeEnv(), TXN);
    expect(d.gate).toBe("auto");
    expect(d.account.choice).toBe("4000");
    expect(d.model).toBe("fixture");
  });

  it("gates a recorded flagged decision to review", async () => {
    configureDecisionProviders({ provider: "fixture", fixtures: FIXTURES });
    const d = await decideTransaction(makeEnv(), { ...TXN, event_code: "T1107" });
    expect(d.gate).toBe("review");
    expect(d.gateReasons.join(",")).toContain("needs_review");
  });

  it("never throws and routes a missing / malformed fixture to review", async () => {
    const malformed: FixtureSet = {
      transactions: { T0006: { account: { type: "choice", choice: "9999", probabilities: { "9999": 1 } } as never } },
      actions: {},
    };
    const missing = await fixture({ fixtures: FIXTURES }).decideTransaction({ ...TXN, event_code: "NOPE" });
    expect(missing.gate).toBe("review");
    expect(missing.gateReasons).toContain("fixture_missing:NOPE");
    expect((await fixture({ fixtures: malformed }).decideTransaction(TXN)).gate).toBe("review");
  });

  it("replays recorded action probabilities and defaults to 0 (→ review) when absent", async () => {
    const provider = fixture({ fixtures: FIXTURES });
    expect(await provider.decideAction("ctx", { type: "invoice_reminder" })).toBeCloseTo(0.96);
    expect(await provider.decideAction("ctx", { type: "unknown_type" })).toBe(0);
  });
});

/* --------------------------------------------------------------- failure */

describe("failure handling (INV-4 / R4)", () => {
  const throwingAi = { run: () => { throw new Error("ai offline"); } };

  it("clef provider error → review decision, never throws", async () => {
    const d = await decideTransaction(makeEnv(throwingAi), TXN);
    expect(d.gate).toBe("review");
    expect(d.gateReasons.join(",")).toContain("clef_error:ai offline");
  });

  it("fallback-llm provider error → review decision, never throws", async () => {
    configureDecisionProviders({ provider: "fallback-llm" });
    const d = await decideTransaction(makeEnv(throwingAi), TXN);
    expect(d.gate).toBe("review");
    expect(d.gateReasons[0]).toMatch(/^fallback_error:/);
  });

  it("action provider failure → P=0 → policy routes to review, never auto", async () => {
    configureDecisionProviders({ provider: "fallback-llm" });
    const proposal = { type: "payout", amount_cents: 45_000, receiver: "sam.ortiz@example.com", bill_id: "B-99" } as const;
    const prob = await decideAction(makeEnv(throwingAi), JSON.stringify(proposal), proposal as unknown as Record<string, unknown>);
    expect(prob).toBe(0);
    expect(evaluateAction(proposal, prob, policyConfig(makeEnv()), () => false).outcome).toBe("review");
  });
});

/* ---------------------------------------------------------- fallback-llm */

describe("fallback-llm provider (Q2 — ready if Clef is unavailable)", () => {
  // A text model asked for the Clef answer schema; it answers with minified JSON (documented contract).
  const answeringAi = {
    run: async (_model: string, input: { messages: Array<{ role: string; content: string }> }) => {
      const last = input.messages[input.messages.length - 1]?.content ?? "";
      const isAction = last.includes('"consistent"');
      return {
        response: isAction
          ? '{"consistent":0.97}'
          : '{"account":{"type":"choice","choice":"4000","probabilities":{"4000":0.98}},"needs_review":{"type":"noul","noul":0.05},"risk":{"type":"score","score":1}}',
      };
    },
  };

  it("decodes a transaction answer into the Clef schema and gates like production", async () => {
    configureDecisionProviders({ provider: "fallback-llm" });
    const d = await decideTransaction(makeEnv(answeringAi), TXN);
    expect(d.gate).toBe("auto");
    expect(d.account.choice).toBe("4000");
    expect(d.model).toBe("fallback:@cf/meta/llama-3.1-8b-instruct");
  });

  it("decodes an action probability for the policy gate", async () => {
    configureDecisionProviders({ provider: "fallback-llm" });
    const prob = await decideAction(makeEnv(answeringAi), "Approved bill #B-77 from an allow-listed contractor", { type: "payout" });
    expect(prob).toBeCloseTo(0.97);
  });
});

/* ---------------------------------------------------- end-to-end pipeline */

interface RecordedStmt {
  sql: string;
  bindings: unknown[];
}

/** Minimal D1 recorder: enough of prepare/bind/first/run/all/batch to observe what the pipeline writes. */
class FakeD1 {
  readonly statements: RecordedStmt[] = [];
  constructor(private readonly rows: Map<string, Record<string, unknown>>) {}

  prepare(sql: string) {
    const stmt: RecordedStmt = { sql, bindings: [] };
    const self = this;
    const api = {
      stmt,
      bind(...bindings: unknown[]) {
        stmt.bindings = bindings;
        return api;
      },
      async first<T>(): Promise<T | null> {
        self.statements.push(stmt);
        if (sql.includes("FROM paypal_transactions")) return (self.rows.get(String(stmt.bindings[0])) ?? null) as T | null;
        if (sql.includes("RETURNING id")) return { id: 1 } as T;
        return null;
      },
      async run() {
        self.statements.push(stmt);
        return { success: true, meta: { changes: 1 } };
      },
      async all() {
        self.statements.push(stmt);
        return { results: [] };
      },
    };
    return api;
  }

  async batch(stmts: Array<{ stmt: RecordedStmt }>) {
    for (const s of stmts) this.statements.push(s.stmt);
  }
}

const paypalDetail = (id: string, eventCode: string, note = "") => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: eventCode,
    transaction_status: "S",
    transaction_initiation_date: "2026-10-05T10:00:00Z",
    transaction_amount: { value: "49.00", currency_code: "USD" },
    fee_amount: { value: "-1.92", currency_code: "USD" },
    transaction_subject: "Template bundle",
    transaction_note: note,
  },
  payer_info: { payer_name: { given_name: "Ada", surname: "Lovelace" }, email_address: "buyer@example.com" },
});

const seed = (id: string, eventCode: string) =>
  new Map<string, Record<string, unknown>>([
    [id, { raw_json: JSON.stringify(paypalDetail(id, eventCode)), state: "new", initiated_at: "2026-10-05T10:00:00Z" }],
  ]);

describe("pipeline end to end on the fixture provider", () => {
  it("a flagged decision lands in the review queue (not posted)", async () => {
    configureDecisionProviders({ provider: "fixture", fixtures: FIXTURES });
    const db = new FakeD1(seed("TXN-1107", "T1107"));
    const env = makeEnv(undefined, { DB: db, DECISION_PROVIDER: "fixture" });

    const outcome = await processTransaction(env, "TXN-1107");

    expect(outcome).toBe("review");
    const insert = db.statements.find((s) => s.sql.includes("INSERT INTO review_queue"));
    expect(insert).toBeTruthy();
    expect(insert!.bindings[0]).toBe("TXN-1107");
    expect(JSON.parse(String(insert!.bindings[1])).join(",")).toContain("needs_review");
    expect(db.statements.some((s) => s.sql.includes("UPDATE paypal_transactions SET state = 'review'"))).toBe(true);
    expect(db.statements.some((s) => s.sql.includes("state = 'posted'"))).toBe(false);
  });

  it("a failed decision (no recorded answers) still lands in the review queue", async () => {
    // Selection comes from env.DECISION_PROVIDER, proving the wrangler var configures the whole pipeline.
    configureDecisionProviders({ fixtures: FIXTURES });
    const db = new FakeD1(seed("TXN-UNKNOWN", "T9999"));
    const env = makeEnv(undefined, { DB: db, DECISION_PROVIDER: "fixture" });

    const outcome = await processTransaction(env, "TXN-UNKNOWN");

    expect(outcome).toBe("review");
    const insert = db.statements.find((s) => s.sql.includes("INSERT INTO review_queue"));
    expect(insert).toBeTruthy();
    expect(JSON.parse(String(insert!.bindings[1])).join(",")).toContain("fixture_missing");
    expect(db.statements.some((s) => s.sql.includes("state = 'posted'"))).toBe(false);
  });

  it("a recorded clean decision still auto-posts (no review row)", async () => {
    configureDecisionProviders({ provider: "fixture", fixtures: FIXTURES });
    const db = new FakeD1(seed("TXN-0006", "T0006"));
    const env = makeEnv(undefined, { DB: db, DECISION_PROVIDER: "fixture" });

    const outcome = await processTransaction(env, "TXN-0006");

    expect(outcome).toBe("posted");
    expect(db.statements.some((s) => s.sql.includes("INSERT INTO review_queue"))).toBe(false);
    expect(db.statements.some((s) => s.sql.includes("UPDATE paypal_transactions SET state = 'posted'"))).toBe(true);
  });
});

import { Hono } from "hono";
import type { Env, SyncMessage } from "./env";
import { PayPalClient } from "./paypal";
import { decideAction, decideTransaction, type TxnForDecision } from "./clef";
import { evaluateAction, idempotencyKey, DEFAULT_PAYEES, type ActionProposal, type PolicyConfig } from "./policy";
import { processTransaction, reconcile, syncWindow } from "./pipeline";

const app = new Hono<{ Bindings: Env }>();

const policyConfig = (env: Env): PolicyConfig => ({
  actionThreshold: Number(env.ACTION_THRESHOLD || "0.95"),
  payoutAutonomousLimitCents: Number(env.AUTONOMOUS_PAYOUT_LIMIT_CENTS || "100000"),
  refundAutonomousLimitCents: 10_000,
  refundHardCapCents: 100_000,
  payeeAllowList: DEFAULT_PAYEES,
});

app.get("/api/health", (c) => c.json({ ok: true, paypalEnv: c.env.PAYPAL_ENV, clefModel: c.env.CLEF_MODEL }));

// Manual sync of a window (≤ 31 days). TODO before hosting publicly: protect with an admin token.
app.post("/api/sync", async (c) => {
  const { start, end } = await c.req.json<{ start: string; end: string }>();
  return c.json(await syncWindow(c.env, start, end));
});

app.get("/api/ledger", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT e.id AS entry_id, e.entry_date, e.memo, e.source_id, l.account_code, a.name AS account_name,
            l.debit_cents, l.credit_cents, l.currency, l.product_line, l.counterparty
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.code = l.account_code
      ORDER BY e.entry_date DESC, e.id DESC LIMIT 2000`,
  ).all();
  return c.json(rows.results);
});

app.get("/api/review", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM review_queue WHERE status = 'open' ORDER BY created_at`).all();
  return c.json(rows.results);
});

app.post("/api/review/:id/resolve", async (c) => {
  const { status, by } = await c.req.json<{ status: "approved" | "rejected"; by: string }>();
  await c.env.DB.prepare(`UPDATE review_queue SET status = ?1, resolved_by = ?2, resolved_at = datetime('now') WHERE id = ?3 AND status = 'open'`)
    .bind(status, by, Number(c.req.param("id"))).run();
  // TODO(agentic-workflow-engineer): on approval, post the human-chosen account / execute the approved action with audit row.
  return c.json({ ok: true });
});

app.get("/api/reconcile", async (c) => c.json(await reconcile(c.env)));

app.get("/api/reports/pnl", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT COALESCE(l.product_line,'none') AS product_line, a.type, l.account_code, a.name,
            SUM(l.credit_cents) - SUM(l.debit_cents) AS net_cents
       FROM journal_lines l JOIN accounts a ON a.code = l.account_code
      WHERE a.type IN ('revenue','contra_revenue','cogs','expense')
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 3`,
  ).all();
  return c.json(rows.results);
});

// PayPal webhooks — verify signature before any side effect; dedupe by event id; process async.
app.post("/webhooks/paypal", async (c) => {
  const event = await c.req.json<{ id: string; event_type: string }>();
  const verified = await new PayPalClient(c.env).verifyWebhook(c.req.raw.headers, event).catch(() => false);
  if (!verified) return c.json({ error: "signature verification failed" }, 400);
  const res = await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (event_id, event_type, verified, body_json) VALUES (?1, ?2, 1, ?3)`)
    .bind(event.id, event.event_type, JSON.stringify(event)).run();
  if (res.meta.changes > 0) await c.env.SYNC_QUEUE.send({ kind: "webhook", eventId: event.id });
  return c.json({ ok: true });
});

// ── Eval endpoints: SAME code paths as production (used by evals/product_evals.py). Disable or protect when hosted. ──
app.post("/api/eval/decide", async (c) => {
  const { txn } = await c.req.json<{ txn: TxnForDecision }>();
  const d = await decideTransaction(c.env, txn);
  return c.json({ account: d.account, product_line: d.productLine, needs_review: { noul: d.needsReview }, risk: { score: d.risk }, gate: d.gate, reasons: d.gateReasons, model: d.model });
});

const evalSeen = new Map<string, Set<string>>(); // per eval run, simulates the actions table uniqueness
app.post("/api/eval/action", async (c) => {
  const { context, proposal, run_id } = await c.req.json<{ context: string; proposal: ActionProposal; run_id?: string }>();
  const seen = evalSeen.get(run_id ?? "default") ?? new Set<string>();
  evalSeen.set(run_id ?? "default", seen);
  const prob = await decideAction(c.env, context, proposal as unknown as Record<string, unknown>);
  const result = evaluateAction(proposal, prob, policyConfig(c.env), (k) => seen.has(k));
  if (result.outcome === "auto") seen.add(idempotencyKey(proposal));
  return c.json({ ...result, action_prob: prob });
});

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Incremental: last 48h (Transaction Search can lag ~3h); INSERT OR IGNORE keeps it idempotent.
    const end = new Date();
    const start = new Date(end.getTime() - 48 * 3600_000);
    ctx.waitUntil(syncWindow(env, start.toISOString(), end.toISOString()).then(() => undefined));
  },

  async queue(batch: MessageBatch<SyncMessage>, env: Env) {
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
  },
} satisfies ExportedHandler<Env, SyncMessage>;

/**
 * IF-01 — HTTP API contract for the Payback.ai Worker (owner: INT). v0, draft@G0, frozen@G2.
 * Every endpoint the dashboard (L4), Postman collection (L5) and evals call is listed in ENDPOINTS
 * with one fixture in ./fixtures/<fixture>.json, written to this shape and owned by the producing lane.
 * Money is integer cents. Changing a shape after G2 needs an INT task + a row in docs/decisions.md.
 */

export type Cents = number;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

// ── INT ──────────────────────────────────────────────────────────────
export interface HealthResponse { ok: true; paypalEnv: "sandbox"; clefModel: string }

// ── L1 PayPal & actions ──────────────────────────────────────────────
export interface SyncRequest { start: ISODateTime; end: ISODateTime }
export interface SyncResponse { seen: number; enqueued: number }

export interface WebhookResponse { ok: true }

export type ReviewKind = "classification" | "action" | "reconciliation";
export interface ReviewItem {
  id: number;
  kind: ReviewKind;
  ref_id: string; // PayPal transaction id or action id
  reasons: string; // JSON-encoded string[]
  payload_json: string; // JSON-encoded { input, decision }
  status: "open" | "approved" | "rejected";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}
export type ReviewResponse = ReviewItem[];
export interface ReviewResolveRequest { status: "approved" | "rejected"; by: string; account_override?: string }
export interface ReviewResolveResponse { ok: true }

export type ActionType = "payout" | "refund" | "invoice_reminder" | "invoice_create" | "dispute_accept";
export type ActionOutcome = "auto" | "review" | "blocked" | "executed" | "failed";
export interface ActionRow {
  id: number;
  idempotency_key: string;
  type: ActionType;
  proposal_json: string;
  decision_json: string | null;
  outcome: ActionOutcome;
  policy_rule: string | null;
  approver: string | null;
  paypal_ref: string | null; // invoice / payout batch id once executed
  error: string | null;
  created_at: string;
}
export type ActionsResponse = ActionRow[];
export interface ActionApproveRequest { by: string }
export interface ActionApproveResponse { ok: boolean; outcome: ActionOutcome; paypal_ref: string | null; error?: string }

// ── L2 decisions & evals ─────────────────────────────────────────────
export interface EvalDecideResponse {
  account: { choice: string; probabilities: Record<string, number> };
  product_line: { choice: string; probabilities: Record<string, number> };
  needs_review: { noul: number };
  risk: { score: number };
  gate: "auto" | "review";
  reasons: string[];
  model: string;
}
export interface EvalActionResponse { outcome: "auto" | "review" | "blocked"; rule: string; action_prob: number }

export interface SweepPoint { threshold: number; coverage: number; auto_precision: number; review_rate: number; n_labeled: number }
export type ConfidenceSweepResponse = SweepPoint[];
export interface ThresholdSetting { key: "auto_post_threshold"; value: number; updated_by: string; updated_at: string }
export interface ThresholdPutRequest { value: number; by: string }

// ── L3 ledger, reports, audit ────────────────────────────────────────
export interface LedgerLine {
  entry_id: number;
  entry_date: ISODate;
  memo: string | null;
  source_id: string | null; // PayPal transaction id
  account_code: string;
  account_name: string;
  debit_cents: Cents;
  credit_cents: Cents;
  currency: string;
  product_line: string | null;
  counterparty: string | null;
}
export type LedgerResponse = LedgerLine[];
export interface LedgerEntryResponse {
  id: number;
  source: "paypal" | "manual" | "reversal" | "close" | "opening";
  source_id: string | null;
  entry_date: ISODate;
  memo: string | null;
  decision_id: number | null;
  reverses_entry_id: number | null;
  lines: Omit<LedgerLine, "entry_id" | "entry_date" | "memo" | "source_id">[];
}

export interface ReconcileRow {
  currency: string;
  paypalCents: Cents; // Balances API total_balance
  ledgerCents: Cents; // journal_lines 1010 net (debit − credit)
  diffCents: Cents; // paypalCents − ledgerCents
  pendingCents: Cents; // Σ(amount + fee) of paypal_transactions not yet posted (new|decided|review)
  asOfTime: ISODateTime; // as_of_time of this Balances snapshot
  cutoff: ISODateTime | null; // sync_state.sync_cutoff (when the opening balance was posted)
  ok: boolean; // exact tie-out AND pendingCents === 0
  reason: string | null; // short reason when ok is false
}
export type ReconcileResponse = ReconcileRow[];

export interface PnlRow {
  product_line: string; // 'none' when unassigned
  type: "revenue" | "contra_revenue" | "cogs" | "expense";
  account_code: string;
  name: string;
  net_cents: Cents; // credit − debit
}
export type PnlResponse = PnlRow[];

export interface AuditEvent {
  seq: number;
  ref_type: "journal_entry" | "action" | "setting" | "review";
  ref_id: string;
  event: string;
  actor: string; // 'agent' | user id
  detail_json: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}
export interface AuditResponse { events: AuditEvent[]; story: string[] }
export interface AuditVerifyResponse { ok: boolean; broken_at_seq?: number }

export interface CloseRequest { period: string /* YYYY-MM */; by: string }
export interface CloseResponse { ok: boolean; period: string; entry_id: number | null; memo_md: string; checks: { name: string; ok: boolean }[] }

// ── Registry: one row per endpoint, consumed by the fixture test and the Postman collection ──
export type Lane = "INT" | "L1" | "L2" | "L3";
export interface Endpoint { method: "GET" | "POST" | "PUT"; path: string; lane: Lane; fixture: string; shape: "array" | "object" }

export const ENDPOINTS: readonly Endpoint[] = [
  { method: "GET", path: "/api/health", lane: "INT", fixture: "health", shape: "object" },
  { method: "POST", path: "/api/sync", lane: "L1", fixture: "sync", shape: "object" },
  { method: "POST", path: "/webhooks/paypal", lane: "L1", fixture: "webhooks-paypal", shape: "object" },
  { method: "GET", path: "/api/review", lane: "L1", fixture: "review", shape: "array" },
  { method: "POST", path: "/api/review/:id/resolve", lane: "L1", fixture: "review-resolve", shape: "object" },
  { method: "GET", path: "/api/actions", lane: "L1", fixture: "actions", shape: "array" },
  { method: "POST", path: "/api/actions/:id/approve", lane: "L1", fixture: "actions-approve", shape: "object" },
  { method: "POST", path: "/api/eval/decide", lane: "L2", fixture: "eval-decide", shape: "object" },
  { method: "POST", path: "/api/eval/action", lane: "L2", fixture: "eval-action", shape: "object" },
  { method: "GET", path: "/api/confidence/sweep", lane: "L2", fixture: "confidence-sweep", shape: "array" },
  { method: "GET", path: "/api/settings/auto_post_threshold", lane: "L2", fixture: "settings-threshold", shape: "object" },
  { method: "PUT", path: "/api/settings/auto_post_threshold", lane: "L2", fixture: "settings-threshold", shape: "object" },
  { method: "GET", path: "/api/ledger", lane: "L3", fixture: "ledger", shape: "array" },
  { method: "GET", path: "/api/ledger/:id", lane: "L3", fixture: "ledger-entry", shape: "object" },
  { method: "GET", path: "/api/reconcile", lane: "L3", fixture: "reconcile", shape: "array" },
  { method: "GET", path: "/api/reports/pnl", lane: "L3", fixture: "reports-pnl", shape: "array" },
  { method: "GET", path: "/api/audit", lane: "L3", fixture: "audit", shape: "object" },
  { method: "GET", path: "/api/audit/verify", lane: "L3", fixture: "audit-verify", shape: "object" },
  { method: "POST", path: "/api/close", lane: "L3", fixture: "close", shape: "object" },
];

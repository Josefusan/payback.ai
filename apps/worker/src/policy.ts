/**
 * Action policy — the second key for money movement. Pure function; unit-tested; mirrored by evals/dataset_safety.jsonl.
 * Outcome: "auto" (execute), "review" (human approval), "blocked" (never execute).
 */
import type { Env } from "./env";

export type ActionType = "payout" | "refund" | "invoice_reminder" | "invoice_create" | "dispute_accept";

export interface ActionProposal {
  type: ActionType;
  amount_cents?: number;
  receiver?: string;
  bill_id?: string;
  capture_id?: string;
  invoice_id?: string;
  dispute_id?: string;
  customer?: string;
}

export interface PolicyConfig {
  actionThreshold: number; // min Clef P(consistent) for autonomy
  payoutAutonomousLimitCents: number;
  refundAutonomousLimitCents: number;
  refundHardCapCents: number;
  payeeAllowList: string[];
}

export interface PolicyResult { outcome: "auto" | "review" | "blocked"; rule: string }

export const DEFAULT_PAYEES = ["sam.ortiz@example.com", "kai.moreno@example.com"]; // demo vendors; real list lives in DB

export function policyConfig(env: Env): PolicyConfig {
  return {
    actionThreshold: Number(env.ACTION_THRESHOLD || "0.95"),
    payoutAutonomousLimitCents: Number(env.AUTONOMOUS_PAYOUT_LIMIT_CENTS || "100000"),
    refundAutonomousLimitCents: 10_000,
    refundHardCapCents: 100_000,
    payeeAllowList: DEFAULT_PAYEES,
  };
}

export function idempotencyKey(p: ActionProposal): string {
  return [p.type, p.bill_id ?? p.capture_id ?? p.invoice_id ?? p.dispute_id ?? p.customer ?? "", p.amount_cents ?? ""].join(":");
}

export function evaluateAction(p: ActionProposal, actionProb: number, cfg: PolicyConfig, alreadySeen: (key: string) => boolean): PolicyResult {
  const key = idempotencyKey(p);
  const amount = p.amount_cents ?? 0;
  if (!Number.isInteger(amount) || amount < 0) return { outcome: "blocked", rule: "invalid_amount" };

  switch (p.type) {
    case "payout":
      if (!p.bill_id) return { outcome: "blocked", rule: "payout_requires_approved_bill" };
      if (alreadySeen(key)) return { outcome: "blocked", rule: "duplicate_payout" };
      if (!p.receiver || !cfg.payeeAllowList.includes(p.receiver.toLowerCase())) return { outcome: "review", rule: "payee_not_allow_listed" };
      if (amount > cfg.payoutAutonomousLimitCents) return { outcome: "review", rule: "payout_over_autonomous_limit" };
      break;
    case "refund":
      if (!p.capture_id) return { outcome: "blocked", rule: "refund_requires_capture" };
      if (amount > cfg.refundHardCapCents) return { outcome: "blocked", rule: "refund_over_hard_cap" };
      if (alreadySeen(key)) return { outcome: "blocked", rule: "duplicate_refund" };
      if (amount > cfg.refundAutonomousLimitCents) return { outcome: "review", rule: "refund_over_autonomous_limit" };
      break;
    case "invoice_reminder":
      if (!p.invoice_id) return { outcome: "blocked", rule: "reminder_requires_invoice" };
      break; // no money moves; still needs Clef consistency below
    case "invoice_create":
      return { outcome: "review", rule: "new_receivable_needs_human" };
    case "dispute_accept":
      return { outcome: "review", rule: "dispute_acceptance_needs_human" };
    default:
      return { outcome: "blocked", rule: "unknown_action" };
  }
  if (actionProb < cfg.actionThreshold) return { outcome: "review", rule: `low_action_confidence:${actionProb.toFixed(3)}` };
  return { outcome: "auto", rule: "within_policy" };
}

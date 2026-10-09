/**
 * Audit-trail access (`GET /api/audit`, `GET /api/audit/verify`).
 *
 * The server already phrases the history as sentences, and this layer deliberately does NOT re-word them —
 * the story a human reads and the rows the chain hashes must not be able to drift apart.
 */
import type { AuditEvent, AuditResponse, AuditVerifyResponse } from "../../../../packages/contracts/api";

const REF_TYPES = ["journal_entry", "action", "setting", "review"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseEvent(raw: unknown, where: string, index: number): AuditEvent {
  const row = asRecord(raw);
  if (!row) throw new Error(`${where}: events[${index}] must be an object`);
  const seq = row.seq;
  const refType = row.ref_type;
  if (typeof seq !== "number" || !Number.isFinite(seq)) throw new Error(`${where}: events[${index}].seq must be a number`);
  if (typeof refType !== "string" || !(REF_TYPES as readonly string[]).includes(refType)) {
    throw new Error(`${where}: events[${index}].ref_type must be one of ${REF_TYPES.join(", ")}`);
  }
  const str = (key: string): string => (typeof row[key] === "string" ? (row[key] as string) : "");
  return {
    seq,
    ref_type: refType as AuditEvent["ref_type"],
    ref_id: str("ref_id"),
    event: str("event"),
    actor: str("actor"),
    detail_json: str("detail_json"),
    prev_hash: str("prev_hash"),
    hash: str("hash"),
    created_at: str("created_at"),
  };
}

export function parseAudit(raw: unknown, where = "GET /api/audit"): AuditResponse {
  const row = asRecord(raw);
  if (!row) throw new Error(`${where}: expected an object with events and story`);
  if (!Array.isArray(row.events)) throw new Error(`${where}: events must be an array`);
  const story = Array.isArray(row.story) ? row.story.filter((line): line is string => typeof line === "string") : [];
  return { events: row.events.map((event, index) => parseEvent(event, where, index)), story };
}

export function parseAuditVerify(raw: unknown, where = "GET /api/audit/verify"): AuditVerifyResponse {
  const row = asRecord(raw);
  if (!row || typeof row.ok !== "boolean") throw new Error(`${where}: expected an object with a boolean ok`);
  const broken = row.broken_at_seq;
  return typeof broken === "number" && Number.isFinite(broken) ? { ok: row.ok, broken_at_seq: broken } : { ok: row.ok };
}

/** Tail of the chain, shown as a fingerprint so two runs can be compared at a glance. */
export function chainHead(events: readonly AuditEvent[]): AuditEvent | null {
  return events.length > 0 ? events[events.length - 1]! : null;
}

/** `2026-10-09 15:04:11` → `15:04:11`; the date is shown once, above the list. */
export function timeOf(stamp: string): string {
  const parts = stamp.split(" ");
  return parts.length > 1 ? parts[1]! : stamp;
}

export function dateOf(stamp: string): string {
  return stamp.split(" ")[0] ?? stamp;
}

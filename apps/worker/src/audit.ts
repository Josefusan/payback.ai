/**
 * Hash-chained audit trail (T-L3-003). Owner: L3.
 *
 * Every mutation of the books and every move of money appends one row whose `hash` covers that row's own
 * fields *and* the previous row's hash. Altering any historical row therefore invalidates every hash after
 * it, and `verifyAudit` reports the first sequence number that fails. That is the difference between a log
 * (editable) and evidence (not editable quietly) — which is the whole reason a controller would let an
 * agent near the books.
 *
 * Two design choices worth knowing:
 *
 * 1. **`seq` is assigned by this module, not by SQLite.** The sequence number is part of the hashed
 *    preimage, so it must be known before the row exists. A `UNIQUE (prev_hash)` index makes a forked
 *    chain impossible: two concurrent writers computing the same predecessor collide, and the loser
 *    retries rather than appending a second history.
 * 2. **`buildAuditRow` is pure and `auditInsert` only builds a statement**, so a caller that already has a
 *    `DB.batch([...])` can append the audit row *inside* the same transaction as the mutation it records.
 *    An audit entry that can be lost while the mutation survives is not an audit entry.
 */
import type { AuditEvent, AuditResponse, AuditVerifyResponse } from "../../../packages/contracts/api";
import type { Env } from "./env";

/** The predecessor of the first row. Any 64-hex constant works as long as it never changes. */
export const GENESIS_HASH = "0".repeat(64);

/** `GET /api/audit` returns at most this many rows, newest last so the story reads in order. */
export const AUDIT_PAGE = 500;

export interface AuditAppend {
  ref_type: AuditEvent["ref_type"];
  ref_id: string;
  event: string;
  actor: string;
  detail?: unknown;
}

/** A fully-formed row, hashed and ready to insert. */
export interface AuditRow {
  seq: number;
  ref_type: AuditEvent["ref_type"];
  ref_id: string;
  event: string;
  actor: string;
  detail_json: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The hash over one row. A unit separator joins the fields because it cannot occur in our data, so no
 * field boundary can be shifted by moving a character from one field to the next.
 */
async function chainHash(fields: {
  prevHash: string;
  seq: number;
  refType: string;
  refId: string;
  event: string;
  actor: string;
  detailJson: string;
  createdAt: string;
}): Promise<string> {
  const preimage = [
    fields.prevHash,
    String(fields.seq),
    fields.refType,
    fields.refId,
    fields.event,
    fields.actor,
    fields.detailJson,
    fields.createdAt,
  ].join("\u001f");
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(preimage)));
}

/** SQLite's own `datetime('now')` shape, so a row written here is indistinguishable from one written there. */
function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export interface AuditTail {
  seq: number;
  hash: string;
}

/** The current end of the chain, or null when the log is empty. */
export async function readTail(env: Env): Promise<AuditTail | null> {
  return env.DB.prepare(`SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1`).first<AuditTail>();
}

/**
 * Build the next row in the chain. Pure apart from the clock, so it is directly testable and can be
 * called before a `batch()` that has not run yet.
 */
export async function buildAuditRow(entry: AuditAppend, tail: AuditTail | null, createdAt = nowStamp()): Promise<AuditRow> {
  const seq = (tail?.seq ?? 0) + 1;
  const prevHash = tail?.hash ?? GENESIS_HASH;
  const detailJson = JSON.stringify(entry.detail ?? {});
  const hash = await chainHash({
    prevHash,
    seq,
    refType: entry.ref_type,
    refId: entry.ref_id,
    event: entry.event,
    actor: entry.actor,
    detailJson,
    createdAt,
  });
  return {
    seq,
    ref_type: entry.ref_type,
    ref_id: entry.ref_id,
    event: entry.event,
    actor: entry.actor,
    detail_json: detailJson,
    prev_hash: prevHash,
    hash,
    created_at: createdAt,
  };
}

/** The INSERT for a built row. Returns a statement, so a caller can put it in its own transaction. */
export function auditInsert(env: Env, row: AuditRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log (seq, ref_type, ref_id, event, actor, detail_json, prev_hash, hash, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(row.seq, row.ref_type, row.ref_id, row.event, row.actor, row.detail_json, row.prev_hash, row.hash, row.created_at);
}

/**
 * Append one row on its own. Retries when another writer won the race for the same predecessor — the
 * `UNIQUE (prev_hash)` index refuses the duplicate, and the retry links onto the winner's row.
 */
export async function appendAudit(env: Env, entry: AuditAppend, attempts = 3): Promise<AuditEvent> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const row = await buildAuditRow(entry, await readTail(env));
    try {
      await auditInsert(env, row).run();
      return toEvent(row);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("audit append failed");
}

/** Best-effort variant for a mutation whose own success must not be undone by an audit failure. */
export async function appendAuditQuietly(env: Env, entry: AuditAppend): Promise<void> {
  try {
    await appendAudit(env, entry);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "audit_append_failed", ref_type: entry.ref_type, ref_id: entry.ref_id, message: err instanceof Error ? err.message : String(err) }));
  }
}

function toEvent(row: AuditRow): AuditEvent {
  return {
    seq: row.seq,
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    event: row.event,
    actor: row.actor,
    detail_json: row.detail_json,
    prev_hash: row.prev_hash,
    hash: row.hash,
    created_at: row.created_at,
  };
}

function detailOf(event: AuditEvent): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(event.detail_json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** One sentence per event, phrased for a person reading the history rather than for a parser. */
function storyLine(event: AuditEvent): string {
  const d = detailOf(event);
  const num = (key: string): number | null => (typeof d[key] === "number" ? (d[key] as number) : null);
  const str = (key: string): string | null => (typeof d[key] === "string" && d[key] !== "" ? (d[key] as string) : null);

  switch (event.event) {
    case "posted": {
      const lines = num("lines");
      const account = str("account");
      const override = str("account_override");
      const by = event.actor === "agent" ? "the agent" : event.actor;
      return `${event.ref_id} posted to the ledger by ${by}${account ? ` on ${account}` : ""}${lines !== null ? `, ${lines} lines, balanced` : ""}${override ? ` (reviewer override to ${override})` : ""}`;
    }
    case "opened":
      return `Opening balance booked as of ${event.ref_id}, so later activity posts on top of it`;
    case "reversed":
      return `Entry ${event.ref_id} reversed by ${event.actor} (corrections are reversals, never edits)`;
    case "resolved": {
      const status = str("status") ?? "resolved";
      const override = str("account_override");
      return `${event.actor} ${status} review item ${event.ref_id}${override ? `, overriding the account to ${override}` : ""}`;
    }
    case "executed": {
      const type = str("type") ?? "action";
      const ref = str("paypal_ref");
      return `PayPal ${type} executed${ref ? ` as ${ref}` : ""} (approved by ${event.actor})`;
    }
    case "failed": {
      // The mirror of "executed", and the event a controller most wants: a human approved a money movement
      // and it was refused (by PayPal or by policy). The `error` says which.
      const type = str("type") ?? "action";
      const err = str("error");
      return `${type} ${event.ref_id} not executed (by ${event.actor})${err ? ` — ${err}` : ""}`;
    }
    case "gated": {
      // The decision NOT to act is the one a controller most wants to see, so it gets a sentence rather
      // than the generic fallback.
      const reason = str("top_reason");
      return `${event.ref_id} stopped and sent to a human${reason ? ` — ${reason}` : ""}`;
    }
    case "changed": {
      const from = num("from");
      const to = num("to");
      const asked = num("requested");
      const clamped = to !== null && asked !== null && asked !== to;
      return `Auto-post threshold changed from ${from ?? "unset"} to ${to ?? "?"} by ${event.actor}${clamped ? `, clamped from ${asked}` : ""}`;
    }
    default:
      return `${event.ref_type} ${event.ref_id}: ${event.event} by ${event.actor}`;
  }
}

/** `GET /api/audit` — the most recent events plus the same history told as sentences. */
export async function listAudit(env: Env): Promise<AuditResponse> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM (SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?1) ORDER BY seq`,
  )
    .bind(AUDIT_PAGE)
    .all<AuditEvent>();
  return { events: results, story: results.map(storyLine) };
}

/**
 * `GET /api/audit/verify` — recompute the chain and report the first row that does not fit.
 *
 * Checks both halves of the link, because they fail differently: a mismatched `prev_hash` means a row was
 * removed or reordered, while a mismatched `hash` means a row's own contents were altered.
 */
export async function verifyAudit(env: Env): Promise<AuditVerifyResponse> {
  const { results } = await env.DB.prepare(`SELECT * FROM audit_log ORDER BY seq`).all<AuditEvent>();
  let prevHash = GENESIS_HASH;
  for (const row of results) {
    if (row.prev_hash !== prevHash) return { ok: false, broken_at_seq: row.seq };
    const expected = await chainHash({
      prevHash: row.prev_hash,
      seq: row.seq,
      refType: row.ref_type,
      refId: row.ref_id,
      event: row.event,
      actor: row.actor,
      detailJson: row.detail_json,
      createdAt: row.created_at,
    });
    if (expected !== row.hash) return { ok: false, broken_at_seq: row.seq };
    prevHash = row.hash;
  }
  return { ok: true };
}

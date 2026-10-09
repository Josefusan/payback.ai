/**
 * Review-queue data layer. This screen exists to show **provenance**: what the model saw, what it
 * decided, and why a human is being asked — so a reviewer can disagree with evidence rather than on
 * vibes, and an auditor can reconstruct the decision later.
 *
 * `reasons` and `payload_json` are free-form JSON strings written by the decision path, so every parser
 * here is lenient: a malformed payload renders as "unavailable" and never blanks the queue. That is the
 * opposite of the fixture parsers, which fail loudly — the difference is deliberate. A contract fixture
 * drifting is a build bug worth catching; a historical review row being odd is a fact about the past.
 */
import type { ReviewItem } from "../../../../packages/contracts/api";

// ── lenient readers ──────────────────────────────────────────────────────────────────────────────
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── the queue ────────────────────────────────────────────────────────────────────────────────────
const KINDS = ["classification", "action", "reconciliation"] as const;
type ReviewKind = (typeof KINDS)[number];

/** `GET /api/review`. Fails loudly: a queue row missing its id or kind is a contract break, not noise. */
export function parseReviewItems(raw: unknown, where = "GET /api/review"): ReviewItem[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected an array of ReviewItem`);
  return raw.map((entry, index) => {
    const row = asRecord(entry);
    if (!row) throw new Error(`${where}: row ${index} must be an object`);
    const id = optionalNumber(row.id);
    const kind = optionalString(row.kind);
    if (id === null) throw new Error(`${where}: row ${index}.id must be a number`);
    if (kind === null || !(KINDS as readonly string[]).includes(kind)) {
      throw new Error(`${where}: row ${index}.kind must be one of ${KINDS.join(", ")}`);
    }
    return {
      id,
      kind: kind as ReviewKind,
      ref_id: optionalString(row.ref_id) ?? "",
      reasons: typeof row.reasons === "string" ? row.reasons : "[]",
      payload_json: typeof row.payload_json === "string" ? row.payload_json : "{}",
      status: "open",
      resolved_by: optionalString(row.resolved_by),
      resolved_at: optionalString(row.resolved_at),
      created_at: optionalString(row.created_at) ?? "",
    } satisfies ReviewItem;
  });
}

// ── reasons ──────────────────────────────────────────────────────────────────────────────────────
export type ReasonTone = "danger" | "warn" | "info";

export interface ReasonView {
  /** The reason exactly as the decision path recorded it — this is the audit trail. */
  raw: string;
  /** A human gloss. Never replaces `raw`. */
  label: string;
  tone: ReasonTone;
}

const REASON_GLOSSES: Array<{ match: RegExp; label: string; tone: ReasonTone }> = [
  {
    match: /possible_injection/i,
    label: "Prompt-injection risk — text inside this payment tried to instruct the agent",
    tone: "danger",
  },
  {
    match: /policy|over_cap|exceeds/i,
    label: "Blocked by a hard policy limit, regardless of what the model decided",
    tone: "danger",
  },
  {
    match: /low_confidence/i,
    label: "Clef was not confident enough to post this on its own",
    tone: "warn",
  },
  {
    match: /needs_review/i,
    label: "Clef itself asked for a human here",
    tone: "warn",
  },
  {
    match: /reconcil|mismatch/i,
    label: "The ledger does not tie out against PayPal for this period",
    tone: "warn",
  },
];

export function describeReason(raw: string): ReasonView {
  const gloss = REASON_GLOSSES.find((candidate) => candidate.match.test(raw));
  return gloss
    ? { raw, label: gloss.label, tone: gloss.tone }
    : { raw, label: "Flagged for review", tone: "info" };
}

export function parseReasons(item: Pick<ReviewItem, "reasons">): ReasonView[] {
  const parsed = parseJson(item.reasons);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string").map(describeReason);
}

/**
 * Whether this item was flagged for a possible prompt injection. Drives the loudest treatment on the
 * screen: the one thing a reviewer must not do is approve it without reading the untrusted text.
 */
export function hasInjection(reasons: readonly ReasonView[]): boolean {
  return reasons.some((reason) => /possible_injection/i.test(reason.raw));
}

export function worstTone(reasons: readonly ReasonView[]): ReasonTone {
  if (reasons.some((reason) => reason.tone === "danger")) return "danger";
  if (reasons.some((reason) => reason.tone === "warn")) return "warn";
  return "info";
}

// ── decision payload ─────────────────────────────────────────────────────────────────────────────
export interface ChoiceView {
  choice: string;
  /** Full distribution, descending. The probabilities are the claim — not just the argmax. */
  probabilities: Array<{ code: string; p: number }>;
}

export interface DecisionView {
  model: string | null;
  schemaVersion: string | null;
  threshold: number | null;
  account: ChoiceView | null;
  productLine: ChoiceView | null;
  needsReview: number | null;
  risk: number | null;
  /** P(contains_instructions) — the layer-2 detection score. */
  containsInstructions: number | null;
  gate: string | null;
}

export interface ReviewPayload {
  input: Record<string, unknown> | null;
  decision: DecisionView | null;
}

function choiceView(raw: unknown): ChoiceView | null {
  const record = asRecord(raw);
  if (!record) return null;
  const probabilities = asRecord(record.probabilities) ?? {};
  return {
    choice: optionalString(record.choice) ?? "—",
    probabilities: Object.entries(probabilities)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([code, p]) => ({ code, p }))
      .sort((a, b) => b.p - a.p || a.code.localeCompare(b.code)),
  };
}

/** Read a field under any of its names — the payload emits camelCase and snake_case across versions. */
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/** A score may arrive bare, or wrapped as `{ prob }` / `{ noul }` / `{ score }` depending on the question. */
function numberOrProb(value: unknown): number | null {
  const direct = optionalNumber(value);
  if (direct !== null) return direct;
  const record = asRecord(value);
  if (!record) return null;
  return optionalNumber(record.prob) ?? optionalNumber(record.probability) ?? optionalNumber(record.noul) ?? optionalNumber(record.score);
}

/** `possible_injection:0.966` → 0.966. `low_confidence:0.438<0.9` → 0.438. Null when unparseable. */
export function reasonScore(raw: string, name: string): number | null {
  const match = new RegExp(`^${name}:([0-9]*\\.?[0-9]+)`).exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function scoreFromReasons(reasons: readonly string[], name: string): number | null {
  for (const reason of reasons) {
    const value = reasonScore(reason, name);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Unwrap `payload_json` into what the model saw (`input`) and what it decided (`decision`).
 *
 * The decision payload is not internally consistent about naming — the live txn-v2 payload carries
 * `schemaVersion` alongside `productLine`, `needsReview` and `gateReasons`, and the injection score is
 * NOT a top-level question: it appears only inside `gateReasons` as `possible_injection:0.966`. So the
 * score is read from the decision if present, then from `gateReasons`, then from the item's own
 * `reasons` column — which is what the review queue itself recorded.
 */
export function parsePayload(item: Pick<ReviewItem, "payload_json"> & { reasons?: string }): ReviewPayload {
  const parsed = asRecord(parseJson(item.payload_json));
  if (!parsed) return { input: null, decision: null };

  const rawDecision = asRecord(parsed.decision);
  if (!rawDecision) return { input: asRecord(parsed.input), decision: null };

  const questions = asRecord(pick(rawDecision, "questions")) ?? {};
  const rawGate = pick(rawDecision, "gateReasons", "gate_reasons");
  const gateReasons = Array.isArray(rawGate) ? rawGate.filter((entry): entry is string => typeof entry === "string") : [];
  const itemReasons = parseJson(item.reasons ?? "[]");
  const reasonStrings = Array.isArray(itemReasons) ? itemReasons.filter((e): e is string => typeof e === "string") : [];

  const containsInstructions =
    numberOrProb(pick(rawDecision, "contains_instructions")) ??
    numberOrProb(pick(questions, "contains_instructions")) ??
    scoreFromReasons(gateReasons, "possible_injection") ??
    scoreFromReasons(reasonStrings, "possible_injection");

  return {
    input: asRecord(parsed.input),
    decision: {
      model: optionalString(pick(rawDecision, "model")),
      schemaVersion: optionalString(pick(rawDecision, "schemaVersion", "schema_version")),
      threshold: optionalNumber(pick(rawDecision, "threshold")),
      account: choiceView(pick(rawDecision, "account")),
      productLine: choiceView(pick(rawDecision, "product_line", "productLine")),
      needsReview: numberOrProb(pick(rawDecision, "needs_review", "needsReview")),
      risk: numberOrProb(pick(rawDecision, "risk", "risk_score")),
      containsInstructions,
      gate: optionalString(pick(rawDecision, "gate")),
    },
  };
}

// ── what the model saw ───────────────────────────────────────────────────────────────────────────
export interface InputRow {
  label: string;
  value: string;
  /** Text a counterparty controls. Rendered as quoted, untrusted material — never as a fact. */
  untrusted?: boolean;
}

const INPUT_FIELDS: Array<{ key: string; label: string; untrusted?: boolean }> = [
  { key: "event_code", label: "PayPal event" },
  { key: "amount", label: "Amount" },
  { key: "fee", label: "PayPal fee" },
  { key: "currency", label: "Currency" },
  { key: "counterparty", label: "Counterparty" },
  { key: "subject", label: "Order subject", untrusted: true },
  { key: "items", label: "Items", untrusted: true },
  { key: "note", label: "Customer note", untrusted: true },
];

/** Known fields first, in a fixed order, then anything else the payload carried. */
export function inputRows(input: Record<string, unknown> | null): InputRow[] {
  if (!input) return [];
  const rows: InputRow[] = [];
  for (const field of INPUT_FIELDS) {
    const text = renderValue(input[field.key]);
    if (text === null) continue;
    rows.push(field.untrusted ? { label: field.label, value: text, untrusted: true } : { label: field.label, value: text });
  }
  for (const [key, value] of Object.entries(input)) {
    if (INPUT_FIELDS.some((field) => field.key === key)) continue;
    const text = renderValue(value);
    if (text === null) continue;
    rows.push({ label: key, value: text });
  }
  return rows;
}

function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.trim() === "" ? null : text;
}

/** `0.451` → `45.1%`. Probabilities are shown as percentages because that is how they are claimed. */
export function formatProbability(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

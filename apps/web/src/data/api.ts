/**
 * Live data layer (gate G2). The dashboard reads the deployed Worker's API instead of the IF-01
 * fixtures, which were always a stand-in for exactly these shapes.
 *
 * Two deliberate rules:
 *
 * 1. Fixtures are used ONLY when the live read fails (unreachable, non-2xx, or a shape mismatch). A
 *    successful but EMPTY response is shown as empty. Falling back on an empty payload would paint
 *    invented revenue onto the screen; for a bookkeeping product that is worse than showing nothing.
 * 2. Only a successful LIVE read is cached. A failed read is not, so navigating away and back retries
 *    rather than pinning the fallback. The cache also means a screen does not flash "Loading…" every
 *    time the user switches tabs.
 *
 * Every payload is validated with the same parsers the fixtures use, so a Worker response that drifts
 * from `packages/contracts/api.ts` surfaces as a labelled fallback rather than a blank or wrong screen.
 */
import { useCallback, useEffect, useState } from "react";

import type { AuditResponse, AuditVerifyResponse, CoaAccount, LedgerEntryResponse, LedgerLine, PnlRow, ReviewItem } from "../../../../packages/contracts/api";
import { parseAudit, parseAuditVerify } from "./audit";
import { coa as FIXTURE_COA, parseCoa } from "./coa";
import {
  ledgerEntry as FIXTURE_ENTRY,
  ledgerLines as FIXTURE_LINES,
  parseLedgerEntry,
  parseLedgerLines,
} from "./fixtures";
import {
  parsePnlRows,
  parseReconcileRows,
  pnlRows as FIXTURE_PNL,
  reconcileRows as FIXTURE_RECONCILE,
  type ReconcileView,
} from "./reports";
import { parseReviewItems } from "./review";
import reviewJson from "../../../../packages/contracts/fixtures/review.json";

/** Where the number on screen came from. Rendered as a badge, never implied. */
export type DataSource = "live" | "fixture";

export interface Loaded<T> {
  data: T;
  source: DataSource;
  /** Why the fallback was used. Null on a clean live read. */
  error: string | null;
}

export const LEDGER_PATH = "/api/ledger";
export const RECONCILE_PATH = "/api/reconcile";
export const PNL_PATH = "/api/reports/pnl";
export const REVIEW_PATH = "/api/review";
export const COA_PATH = "/api/coa";
export const AUDIT_PATH = "/api/audit";
export const AUDIT_VERIFY_PATH = "/api/audit/verify";

/** The shipped review fixture, used when the Worker is unreachable. */
const FIXTURE_REVIEW: ReviewItem[] = parseReviewItems(reviewJson);

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

/** Successful live reads, keyed by path. Never holds a fallback — see rule 2 above. */
const cache = new Map<string, Loaded<unknown>>();

/** Drop every cached read, so the next mount refetches. */
export function clearCache(): void {
  cache.clear();
}

async function loaded<T>(
  path: string,
  parse: (raw: unknown, where: string) => T,
  fallback: T,
): Promise<Loaded<T>> {
  try {
    const result: Loaded<T> = { data: parse(await getJson(path), `GET ${path}`), source: "live", error: null };
    cache.set(path, result);
    return result;
  } catch (err) {
    return { data: fallback, source: "fixture", error: message(err) };
  }
}

export const loadLedger = (): Promise<Loaded<LedgerLine[]>> => loaded(LEDGER_PATH, parseLedgerLines, FIXTURE_LINES);

export const loadReconcile = (): Promise<Loaded<ReconcileView[]>> =>
  loaded(RECONCILE_PATH, parseReconcileRows, FIXTURE_RECONCILE);

export const loadPnl = (): Promise<Loaded<PnlRow[]>> => loaded(PNL_PATH, parsePnlRows, FIXTURE_PNL);

export const loadReview = (): Promise<Loaded<ReviewItem[]>> =>
  loaded(REVIEW_PATH, parseReviewItems, FIXTURE_REVIEW);

export const loadCoa = (): Promise<Loaded<CoaAccount[]>> => loaded(COA_PATH, parseCoa, FIXTURE_COA);

/**
 * The audit trail deliberately has NO fixture fallback, unlike every other screen.
 *
 * A recorded fixture is fine for a ledger — it is data the user can see is stale. A trail is *evidence*:
 * rendering a fabricated chain, even behind a badge, would be the one lie this product cannot tell. If the
 * read fails the trail is empty and the badge says why.
 */
export async function loadAudit(): Promise<Loaded<AuditResponse>> {
  try {
    return { data: parseAudit(await getJson(AUDIT_PATH), `GET ${AUDIT_PATH}`), source: "live", error: null };
  } catch (err) {
    return { data: { events: [], story: [] }, source: "fixture", error: message(err) };
  }
}

/**
 * Verification is three-valued, not two: `ok`, `broken`, or **unavailable**. Returning `{ok: true}` on a
 * failed read would assert the chain is intact when nothing was checked; returning `{ok: false}` would
 * assert tampering. Neither is known, so the caller gets null and must say so.
 */
export async function loadAuditVerify(): Promise<Loaded<AuditVerifyResponse | null>> {
  try {
    return { data: parseAuditVerify(await getJson(AUDIT_VERIFY_PATH), `GET ${AUDIT_VERIFY_PATH}`), source: "live", error: null };
  } catch (err) {
    return { data: null, source: "fixture", error: message(err) };
  }
}

// ── review decisions (the only mutating call the dashboard makes) ────────────────────────────────

export interface ReviewResolution {
  status: "approved" | "rejected";
  by: string;
  /** The reviewer's correction to Clef's account. Omitted to accept the model's choice. */
  account_override?: string;
}

const TOKEN_KEY = "payback.adminToken";

/** The admin token lives in localStorage only — never in the bundle, never in a query string. */
export function readAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    // Storage can be blocked (private mode, embedded webview). The screen still works, unauthenticated.
    return "";
  }
}

export function writeAdminToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Non-persistent is acceptable; the reviewer re-enters it.
  }
}

/**
 * A failed API call, carrying the server's stable error code alongside any free-form detail.
 *
 * The code must be preserved: the worker answers `{ error: "posting_failed", detail: "<db message>" }`,
 * and treating the detail as the message would lose the one part the UI can actually act on.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ApiError";
  }
}

/**
 * Resolve one review item. Approving a classification writes a journal entry, so every cached read that
 * could contain the result is dropped — otherwise the ledger would keep asserting the old tie-out.
 */
export async function resolveReviewItem(id: number, body: ReviewResolution, token: string): Promise<void> {
  const res = await fetch(`${REVIEW_PATH}/${id}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
    throw new ApiError(parsed?.error ?? `http_${res.status}`, parsed?.detail);
  }
  cache.delete(REVIEW_PATH);
  cache.delete(LEDGER_PATH);
  cache.delete(RECONCILE_PATH);
  cache.delete(PNL_PATH);
}

/**
 * One journal entry for the drill-through drawer. Unlike the list loaders this does NOT fall back to
 * "the" fixture entry: that would show entry #1's lines under entry #7's header. Only a fixture whose
 * id actually matches is reused, otherwise the drawer reports that it has nothing.
 */
export async function loadEntry(id: number): Promise<LedgerEntryResponse | null> {
  try {
    return parseLedgerEntry(await getJson(`${LEDGER_PATH}/${id}`), `GET ${LEDGER_PATH}/${id}`);
  } catch {
    return FIXTURE_ENTRY.id === id ? FIXTURE_ENTRY : null;
  }
}

export interface LiveState<T> {
  data: T | null;
  source: DataSource | null;
  error: string | null;
  loading: boolean;
  /** Re-run the read. The new state arrives on the next render; existing data stays until it does. */
  reload: () => void;
}

function seed<T>(key: string): Omit<LiveState<T>, "reload"> {
  const cached = cache.get(key) as Loaded<T> | undefined;
  return cached
    ? { data: cached.data, source: cached.source, error: cached.error, loading: false }
    : { data: null, source: null, error: null, loading: true };
}

/** Load on mount, seeded from the cache when a previous live read succeeded. `reload` re-runs it. */
export function useLive<T>(key: string, load: () => Promise<Loaded<T>>): LiveState<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<LiveState<T>, "reload">>(() => seed<T>(key));

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      // Keep the previous data on screen while a reload lands, so a decision does not blank the queue.
      setState((current) => ({
        ...current,
        data: result.data,
        source: result.source,
        error: result.error,
        loading: false,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [key, load, nonce]);

  const reload = useCallback(() => setNonce((count) => count + 1), []);
  return { ...state, reload };
}

/** Badge text for a load result. Honest about degraded mode rather than hiding it. */
export function sourceLabel(source: DataSource | null, loading: boolean): string {
  if (loading) return "Loading…";
  if (source === "live") return "Live Worker API";
  if (source === "fixture") return "Fixtures — API unreachable";
  return "—";
}

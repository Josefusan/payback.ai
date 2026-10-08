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
import { useEffect, useState } from "react";

import type { LedgerEntryResponse, LedgerLine, PnlRow } from "../../../../packages/contracts/api";
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
}

/** Load once on mount, seeded from the cache when a previous live read succeeded. */
export function useLive<T>(key: string, load: () => Promise<Loaded<T>>): LiveState<T> {
  const cached = cache.get(key) as Loaded<T> | undefined;
  const [state, setState] = useState<LiveState<T>>(() =>
    cached
      ? { data: cached.data, source: cached.source, error: cached.error, loading: false }
      : { data: null, source: null, error: null, loading: true },
  );

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      setState({ data: result.data, source: result.source, error: result.error, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return state;
}

/** Badge text for a load result. Honest about degraded mode rather than hiding it. */
export function sourceLabel(source: DataSource | null, loading: boolean): string {
  if (loading) return "Loading…";
  if (source === "live") return "Live Worker API";
  if (source === "fixture") return "Fixtures — API unreachable";
  return "—";
}

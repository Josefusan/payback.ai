/**
 * Live data layer (gate G2). The rule with teeth is the third one: a live read that succeeds but
 * returns NOTHING must render nothing. If it fell back to the fixtures the dashboard would show
 * invented revenue, which for a bookkeeping product is worse than an empty screen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { LEDGER_PATH, loadEntry, loadLedger, loadPnl, loadReconcile, PNL_PATH, RECONCILE_PATH } from "./api";
import { ledgerEntry, ledgerLines } from "./fixtures";
import { pnlRows, reconcileRows } from "./reports";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const routeTo = (table: Record<string, () => Response>): void => {
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    const handler = table[path];
    if (!handler) return Promise.resolve(json({ error: "not_found" }, 404));
    try {
      return Promise.resolve(handler());
    } catch (err) {
      return Promise.reject(err);
    }
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLedger", () => {
  it("reads the Worker and reports the data as live", async () => {
    routeTo({ [LEDGER_PATH]: () => json(ledgerLines) });

    const result = await loadLedger();

    expect(result.source).toBe("live");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(ledgerLines.length);
  });

  it("falls back to the fixtures when the Worker answers with an error", async () => {
    routeTo({ [LEDGER_PATH]: () => json({ error: "boom" }, 500) });

    const result = await loadLedger();

    expect(result.source).toBe("fixture");
    expect(result.error).toContain("500");
    expect(result.data).toEqual(ledgerLines);
  });

  it("falls back when the network is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));

    const result = await loadLedger();

    expect(result.source).toBe("fixture");
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("keeps an empty live ledger empty instead of substituting fixtures", async () => {
    routeTo({ [LEDGER_PATH]: () => json([]) });

    const result = await loadLedger();

    expect(result.source).toBe("live");
    expect(result.data).toEqual([]);
  });

  it("falls back when the payload does not match the contract", async () => {
    routeTo({ [LEDGER_PATH]: () => json({ ledger: "not an array" }) });

    const result = await loadLedger();

    expect(result.source).toBe("fixture");
    expect(result.error).toContain("expected an array of LedgerLine");
  });
});

describe("loadReconcile and loadPnl", () => {
  it("report live rows", async () => {
    routeTo({ [RECONCILE_PATH]: () => json(reconcileRows), [PNL_PATH]: () => json(pnlRows) });

    expect((await loadReconcile()).source).toBe("live");
    expect((await loadPnl()).source).toBe("live");
  });

  it("keep an empty P&L empty — no revenue is invented", async () => {
    routeTo({ [PNL_PATH]: () => json([]) });

    const result = await loadPnl();

    expect(result.source).toBe("live");
    expect(result.data).toEqual([]);
  });
});

describe("loadEntry (drill-through)", () => {
  it("returns the entry the Worker serves", async () => {
    routeTo({ [`${LEDGER_PATH}/1`]: () => json(ledgerEntry) });

    const entry = await loadEntry(1);

    expect(entry?.id).toBe(ledgerEntry.id);
  });

  it("returns null for an unknown entry rather than the one matching fixture", async () => {
    routeTo({ [`${LEDGER_PATH}/7`]: () => json({ error: "not_found" }, 404) });

    // Only a fixture whose id actually matches may be reused; showing entry #1 under #7's header
    // would be a fabricated statement, which is exactly what the drawer refuses to do.
    expect(await loadEntry(7)).toBeNull();
  });

  it("uses the fixture only when the requested id is the fixture's own", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    expect((await loadEntry(ledgerEntry.id))?.id).toBe(ledgerEntry.id);
    expect(await loadEntry(ledgerEntry.id + 1)).toBeNull();
  });
});

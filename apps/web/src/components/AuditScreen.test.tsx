/**
 * Audit screen (T-L3-003). The load-bearing case is the third one: when the verification read fails the
 * screen must say so, not silently claim the chain is intact or broken. Both of those are assertions about
 * evidence, and neither is known.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "../../../../packages/contracts/api";
import { AuditScreen } from "./AuditScreen";

const event = (seq: number, over: Partial<AuditEvent> = {}): AuditEvent => ({
  seq,
  ref_type: "journal_entry",
  ref_id: "TX-1",
  event: "posted",
  actor: "agent",
  detail_json: '{"lines":3}',
  prev_hash: "0".repeat(64),
  hash: `${seq}`.repeat(64).slice(0, 64),
  created_at: `2026-10-09 15:0${seq}:00`,
  ...over,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mockApi(audit: Response, verify: Response): void {
  vi.stubGlobal("fetch", (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/audit") return Promise.resolve(audit);
    if (url === "/api/audit/verify") return Promise.resolve(verify);
    return Promise.resolve(json({ error: "not_found" }, 404));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuditScreen", () => {
  it("renders the server's own story beside the chain it hashes", async () => {
    mockApi(
      json({
        events: [event(1), event(2, { ref_type: "review", event: "resolved", actor: "Joseph" })],
        story: ["TX-1 posted to the ledger by the agent, 3 lines, balanced", "Joseph approved review item 7"],
      }),
      json({ ok: true }),
    );

    render(<AuditScreen />);

    expect(await screen.findByTestId("audit-story")).toHaveTextContent("Joseph approved review item 7");
    expect(screen.getByTestId("audit-count")).toHaveTextContent("2 events");
    expect(screen.getByTestId("audit-event-2")).toHaveTextContent("Joseph");
    // The links are shown, so a reader can see the chain rather than take it on trust.
    expect(screen.getByTestId("audit-prev-2")).toBeInTheDocument();
    expect(screen.getByTestId("audit-hash-2")).toBeInTheDocument();
    expect(screen.getByTestId("chain-head")).toBeInTheDocument();
  });

  it("reports an intact chain as intact", async () => {
    mockApi(json({ events: [event(1)], story: ["one"] }), json({ ok: true }));
    render(<AuditScreen />);
    expect(await screen.findByTestId("verify-badge")).toHaveTextContent("Chain intact");
  });

  it("reports a broken chain at the offending row", async () => {
    mockApi(json({ events: [event(1), event(2)], story: ["one", "two"] }), json({ ok: false, broken_at_seq: 2 }));
    render(<AuditScreen />);
    expect(await screen.findByTestId("verify-badge")).toHaveTextContent("Chain broken at #2");
  });

  it("says 'unavailable' — never 'intact' — when the verification read fails", async () => {
    mockApi(json({ events: [event(1)], story: ["one"] }), json({ error: "boom" }, 500));

    render(<AuditScreen />);

    const badge = await screen.findByTestId("verify-badge");
    expect(badge).toHaveTextContent("Verification unavailable");
    expect(badge).not.toHaveTextContent("Chain intact");
    expect(badge).not.toHaveTextContent("broken");
  });

  it("shows an empty trail rather than a fabricated one when the read fails", async () => {
    mockApi(json({ error: "offline" }, 500), json({ error: "offline" }, 500));

    render(<AuditScreen />);

    // No fixture fallback exists for this screen on purpose: a made-up chain would be a false claim.
    expect(await screen.findByTestId("audit-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-story")).not.toBeInTheDocument();
  });
});

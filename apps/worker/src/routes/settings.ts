// Owner: L4 — T-L4-004. The route holds no SQL; src/settings.ts owns the statements and the audit row.
import { Hono, type Context } from "hono";
import type { ConfidenceSweepResponse, ThresholdSetting } from "../../../../packages/contracts/api";
import { isAdminSecret, requireAdmin } from "../auth";
import type { AppEnv } from "../env";
import { confidenceSweep, getThresholdSetting, setThreshold } from "../settings";

export const settings = new Hono<AppEnv>();

/** Read a JSON object body, reporting 400 rather than letting a malformed body reach the 500 handler. */
async function readJson<T>(c: Context<AppEnv>): Promise<{ ok: true; body: T } | { ok: false }> {
  try {
    const body = await c.req.json<T>();
    if (body === null || typeof body !== "object") return { ok: false };
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

// Reading the dial is harmless and the dashboard polls it, so it is open like the ledger and audit reads.
settings.get("/api/settings/auto_post_threshold", async (c) => {
  const body: ThresholdSetting = await getThresholdSetting(c.env);
  return c.json(body);
});

// Turning the dial changes how much the agent may do without a person, so it is admin-gated (G3) — the
// same gate as resolving a review item or approving an action.
settings.use("/api/settings/auto_post_threshold", requireAdmin);
settings.put("/api/settings/auto_post_threshold", async (c) => {
  const parsed = await readJson<{ value?: unknown; by?: unknown }>(c);
  if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

  const { value, by } = parsed.body;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return c.json({ error: "invalid_value", detail: "value must be a finite number" }, 400);
  }
  if (typeof by !== "string" || by.trim() === "") return c.json({ error: "actor_required" }, 400);
  // Never let the shared secret become an audit actor — see isAdminSecret.
  if (isAdminSecret(c.env, by)) {
    return c.json({ error: "invalid_actor", detail: "actor must be a name, not the admin token" }, 400);
  }

  // Out-of-range values are clamped, not rejected: the response reports what was actually set, and the
  // audit row records both the request and the clamp, so a clamped turn is visible rather than silent.
  const body: ThresholdSetting = await setThreshold(c.env, value, by.trim());
  return c.json(body);
});

// The sweep answers "what would change if I move it", which is what a threshold decision needs.
settings.get("/api/confidence/sweep", async (c) => {
  const body: ConfidenceSweepResponse = await confidenceSweep(c.env);
  return c.json(body);
});

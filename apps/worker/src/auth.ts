// Shared admin-token guard for mutating endpoints (G3, pre-hosting hardening). Owner: INT.
//
// Every money-moving or ingest endpoint is gated on one shared secret, `env.ADMIN_TOKEN`
// (set with `wrangler secret put ADMIN_TOKEN`; any long random string). The guard FAILS CLOSED:
// if the secret is not configured the endpoint answers 503 rather than allowing the request.
// Present the token in `X-Admin-Token: <token>` or `Authorization: Bearer <token>`.
//
// Read-only GET routes stay open so the judges' dashboard keeps working; only the endpoints that
// can move money or mutate state are guarded.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

export const ADMIN_TOKEN_HEADER = "x-admin-token";

/** Length-safe constant-time comparison, so a near-miss token cannot be distinguished by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i]! ^ bBytes[i]!;
  return diff === 0;
}

/** The token presented by the caller: `X-Admin-Token` first, then `Authorization: Bearer …`. */
export function presentedToken(headers: Headers): string | null {
  const direct = headers.get(ADMIN_TOKEN_HEADER);
  if (direct && direct.trim()) return direct.trim();
  const authorization = headers.get("authorization");
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;
  return match ? match[1]!.trim() : null;
}

/**
 * Gate a route on the shared admin token. Fail closed: unset `ADMIN_TOKEN` → 503 `auth_not_configured`,
 * missing or incorrect token → 401 `unauthorized`. The presented value is never echoed or logged.
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected: unknown = c.env.ADMIN_TOKEN;
  if (typeof expected !== "string" || expected.trim() === "") {
    return c.json({ error: "auth_not_configured" }, 503);
  }
  const presented = presentedToken(c.req.raw.headers);
  if (presented === null || !timingSafeEqual(presented, expected.trim())) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

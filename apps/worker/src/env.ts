// IF-02 (owner: INT). Sole writer of this file and wrangler.jsonc. Lanes request a binding/var as an INT task;
// INT applies env.ts + wrangler.jsonc + .dev.vars.example in one commit and logs it in docs/decisions.md.
export interface Env {
  AI: Ai;
  DB: D1Database;
  SYNC_QUEUE: Queue<SyncMessage>;

  PAYPAL_ENV: string; // must be "sandbox"
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_WEBHOOK_ID: string;

  CLEF_MODEL: string; // @cf/cloudflare/clef-flash
  CLEF_ESCALATION_MODEL: string; // @cf/cloudflare/clef
  AUTO_POST_THRESHOLD: string;
  ACTION_THRESHOLD: string;
  AUTONOMOUS_PAYOUT_LIMIT_CENTS: string;
  AI_GATEWAY_ID: string;

  DECISION_PROVIDER: string; // "clef" | "fixture" | "fallback-llm" (default "clef"; prod = clef)
  FALLBACK_LLM_MODEL: string; // Workers AI text model for the fallback-llm provider
}

export type SyncMessage =
  | { kind: "transaction"; transactionId: string }
  | { kind: "webhook"; eventId: string };

/** Hono generic shared by every route module (`new Hono<AppEnv>()`). */
export type AppEnv = { Bindings: Env };

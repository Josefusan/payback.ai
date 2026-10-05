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
}

export type SyncMessage =
  | { kind: "transaction"; transactionId: string }
  | { kind: "webhook"; eventId: string };

// Mount file (owner: INT). Routes, SQL and handlers live in their lane's module — add a mount line, nothing else.
import { Hono } from "hono";
import type { AppEnv, Env, SyncMessage } from "./env";
import { handleSyncBatch, runScheduledSync } from "./pipeline";
import { health } from "./routes/health";
import { sync } from "./routes/sync";
import { webhooks } from "./routes/webhooks";
import { review } from "./routes/review";
import { actions } from "./routes/actions";
import { ledger } from "./routes/ledger";
import { reports } from "./routes/reports";
import { audit } from "./routes/audit";
import { evalRoutes } from "./routes/eval";

const app = new Hono<AppEnv>();

app.route("/", health);
app.route("/", sync); // L1
app.route("/", webhooks); // L1
app.route("/", review); // L1
app.route("/", actions); // L1
app.route("/", ledger); // L3
app.route("/", reports); // L3
app.route("/", audit); // L3
app.route("/", evalRoutes); // L2

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runScheduledSync(env)),
  queue: (batch: MessageBatch<SyncMessage>, env: Env) => handleSyncBatch(batch, env),
} satisfies ExportedHandler<Env, SyncMessage>;

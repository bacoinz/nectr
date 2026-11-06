import { Hono } from "hono";
import { purge } from "./cron";
import { apiError, HttpError } from "./lib/errors";
import { securityHeaders } from "./lib/headers";
import { vapidOf } from "./lib/push";
import { admin } from "./routes/admin";
import { share } from "./routes/share";

// Only /api/* and /s/* reach the Worker (see run_worker_first in wrangler.jsonc);
// everything else is served from static assets.
const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/api/health", (c) => c.json({ ok: true }));
// The public half of the notification key (null until scripts/push-key.mjs has run).
app.get("/api/push/key", async (c) => c.json({ key: (await vapidOf(c.env))?.publicKey ?? null }));
app.route("/api/admin", admin);
app.route("/s", share);

app.notFound((c) => apiError(c, 404, "not_found", "Recurso não encontrado."));

app.onError((err, c) => {
  if (err instanceof HttpError) return apiError(c, err.status, err.code, err.message);
  console.error(err);
  return apiError(c, 500, "internal", "Ocorreu um erro inesperado. Tenta outra vez.");
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purge(env).then((r) => console.log("purge", r)));
  },
} satisfies ExportedHandler<Env>;

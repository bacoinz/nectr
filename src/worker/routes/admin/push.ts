import { Hono } from "hono";
import { apiError } from "../../lib/errors";
import { jsonBody } from "../../lib/input";
import { parseSubscription, removeSubscription, saveSubscription, sendTest } from "../../lib/notify";
import type { AdminEnv } from ".";

// The owner's devices that get a notification when a guest comments.

export const push = new Hono<AdminEnv>();

const origin = (url: string) => new URL(url).origin;

push.post("/push", async (c) => {
  await saveSubscription(c.env.DB, "owner", parseSubscription(await jsonBody(c)), null);
  return c.body(null, 204);
});

push.delete("/push", async (c) => {
  const b = await jsonBody(c);
  if (typeof b.endpoint === "string") await removeSubscription(c.env.DB, "owner", b.endpoint);
  return c.body(null, 204);
});

push.post("/push/test", async (c) => {
  const b = await jsonBody(c);
  if (typeof b.endpoint !== "string" || !(await sendTest(c.env, origin(c.req.url), b.endpoint))) {
    return apiError(c, 409, "push_failed", "O aviso de teste não seguiu. Desativa e volta a ativar os avisos neste dispositivo.");
  }
  return c.body(null, 204);
});

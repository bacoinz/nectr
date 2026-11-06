import { Hono } from "hono";
import { getOwner, type Owner } from "../../auth/owner";
import { apiError } from "../../lib/errors";
import { comments } from "./comments";
import { items } from "./items";
import { library } from "./library";
import { links } from "./links";
import { media } from "./media";
import { push } from "./push";
import { artists } from "./artists";
import { uploads } from "./uploads";

export type AdminEnv = { Bindings: Env; Variables: { owner: Owner } };

export const admin = new Hono<AdminEnv>();

admin.use("*", async (c, next) => {
  const owner = await getOwner(c.req.raw, c.env);
  if (!owner) {
    return apiError(c, 401, "unauthorized", "Sessão inválida ou expirada. Recarrega a página para voltar a entrar.");
  }
  c.set("owner", owner);
  await next();
});

admin.route("/", library);
admin.route("/", artists);
admin.route("/", items);
admin.route("/", uploads);
admin.route("/", media);
admin.route("/", links);
admin.route("/", comments);
admin.route("/", push);

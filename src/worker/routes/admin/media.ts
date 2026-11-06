import { Hono } from "hono";
import { getVersion } from "../../lib/db";
import { notFound } from "../../lib/errors";
import { id } from "../../lib/input";
import { serveObject } from "../../lib/r2";
import type { AdminEnv } from ".";
import { downloadName } from "../../lib/names";

export const media = new Hono<AdminEnv>();

export const AUDIO_TYPES = { wav: "audio/wav", mp3: "audio/mpeg" } as const;

media.get("/audio/:versionId", async (c) => {
  const v = await getVersion(c.env.DB, id(c.req.param("versionId"), "Versão"));
  if (v.status !== "ready") throw notFound("Versão não encontrada.");
  return serveObject(c, c.env.BUCKET, v.r2_key, { contentType: AUDIO_TYPES[v.format] });
});

media.get("/download/:versionId", async (c) => {
  const v = await getVersion(c.env.DB, id(c.req.param("versionId"), "Versão"));
  if (v.status !== "ready") throw notFound("Versão não encontrada.");
  return serveObject(c, c.env.BUCKET, v.r2_key, {
    contentType: AUDIO_TYPES[v.format],
    downloadName: await downloadName(c.env.DB, v),
    cacheControl: "private, no-store",
  });
});

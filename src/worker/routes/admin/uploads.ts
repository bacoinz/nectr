import { Hono } from "hono";
import { parseLoudness } from "../../lib/loudness";
import type { UploadResponse } from "../../../shared/api-types";
import { probeAudio } from "../../../shared/audio/probe";
import { LIMITS } from "../../../shared/constants";
import { isPeaks } from "../../../shared/peaks";
import { getFolder, getArtist, getTrack, getVersion, nextPosition, versionDTO, type VersionRow } from "../../lib/db";
import { badRequest, conflict, HttpError, notFound } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { id, int, jsonBody, optNullableId, text } from "../../lib/input";
import { createUploadTarget, r2Source } from "../../lib/r2";
import type { AdminEnv } from ".";
import { later, notifyGuestsOfVersion } from "../../lib/notify";

export const uploads = new Hono<AdminEnv>();

/** "03_Maré alta (mix final).wav" → "Maré alta (mix final)" */
export function titleFromFilename(name: string): string {
  // A leading track number needs a separator ("03 - ", "03_", "03."), so "1979" or "22 Acacia" survive.
  const base = name.replace(/\.[^.]+$/, "").replace(/^\s*\d{1,3}\s*[-_.)]\s*/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return (base || name).slice(0, LIMITS.nameMax);
}

/**
 * Step 1: reserve a pending version (and a new track when needed) and hand
 * back where to PUT the file. The browser already validated the header.
 */
uploads.post("/uploads", async (c) => {
  const db = c.env.DB;
  const b = await jsonBody(c);
  const p = await getArtist(db, id(b.artistId, "Artista"));
  const filename = text(b.filename, "Nome do ficheiro", 255, 1);
  const size = int(b.size, "Tamanho", 1, Number.MAX_SAFE_INTEGER);
  if (size > LIMITS.maxUploadBytes) throw badRequest("O ficheiro tem mais de 200 MB.");
  const ext = /\.(wav|wave|mp3)$/i.exec(filename)?.[1]?.toLowerCase();
  if (!ext) throw badRequest("Formato não suportado. Usa WAV (16 ou 24 bit) ou MP3.");
  const format = ext === "mp3" ? "mp3" : "wav";

  const at = now();
  const stmts: D1PreparedStatement[] = [];
  let trackId: string;
  if (b.trackId !== undefined) {
    const t = await getTrack(db, id(b.trackId, "Faixa"));
    if (t.artist_id !== p.id) throw notFound("Faixa não encontrada.");
    trackId = t.id;
  } else {
    const folderId = optNullableId(b.folderId, "Pasta") ?? null;
    if (folderId) await getFolder(db, folderId, p.id);
    trackId = newId();
    stmts.push(
      db.prepare("INSERT INTO tracks (id, artist_id, folder_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(trackId, p.id, folderId, titleFromFilename(filename), await nextPosition(db, "tracks", p.id, folderId), at, at),
    );
  }
  const n = await db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM versions WHERE track_id = ?").bind(trackId).first<{ n: number }>();
  const number = n?.n ?? 1;
  const versionId = newId();
  const key = `audio/${trackId}/${versionId}.${format}`;
  stmts.push(
    db.prepare("INSERT INTO versions (id, track_id, number, status, r2_key, original_filename, format, size_bytes, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)")
      .bind(versionId, trackId, number, key, filename, format, size, at),
  );
  await db.batch(stmts);
  const body: UploadResponse = { trackId, versionId, number, upload: await createUploadTarget(c.env, key, versionId) };
  return c.json(body, 201);
});

async function pendingVersion(db: D1Database, versionId: string): Promise<VersionRow> {
  const v = await getVersion(db, versionId);
  if (v.status !== "pending") throw conflict("Esta versão já foi carregada.");
  return v;
}

/** Local development only: stands in for the presigned R2 URL (see createUploadTarget). */
uploads.put("/dev-upload/:versionId", async (c) => {
  if (c.env.ENVIRONMENT !== "development") throw notFound();
  const v = await pendingVersion(c.env.DB, id(c.req.param("versionId"), "Versão"));
  await c.env.BUCKET.put(v.r2_key, await c.req.arrayBuffer());
  return c.body(null, 204);
});

/** Removes a pending upload, and its track if the upload had created it. */
async function discard(env: Env, v: VersionRow) {
  await env.BUCKET.delete(v.r2_key);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(v.id),
    env.DB.prepare("DELETE FROM tracks WHERE id = ? AND NOT EXISTS (SELECT 1 FROM versions WHERE track_id = ?)").bind(v.track_id, v.track_id),
  ]);
}

/**
 * Step 2: after the PUT, read the object back from R2 and validate it with
 * the same header parser the browser used. Invalid files are deleted.
 */
uploads.post("/versions/:id/finalize", async (c) => {
  const v = await pendingVersion(c.env.DB, id(c.req.param("id"), "Versão"));
  const b = await jsonBody(c);
  if (!isPeaks(b.peaks)) throw badRequest("A análise da forma de onda está em falta ou é inválida.");
  const loud = b.loudness === undefined ? null : parseLoudness(b.loudness);
  const head = await c.env.BUCKET.head(v.r2_key);
  if (!head) throw conflict("O ficheiro ainda não chegou ao armazenamento. Tenta outra vez.");

  const probe = await probeAudio(r2Source(c.env.BUCKET, v.r2_key, head.size), head.size);
  if (!probe.ok) {
    await discard(c.env, v);
    throw new HttpError(422, probe.code, probe.message);
  }
  const i = probe.info;
  const at = now();
  const t = await c.env.DB.prepare("SELECT artist_id FROM tracks WHERE id = ?").bind(v.track_id).first<{ artist_id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE versions SET status = 'ready', format = ?, size_bytes = ?, duration_s = ?, sample_rate = ?, bit_depth = ?, channels = ?, bitrate_kbps = ?, peaks = ?,
         lufs_integrated = ?, lufs_range = ?, true_peak_dbtp = ?
       WHERE id = ?`,
    ).bind(i.format, head.size, i.durationS, i.sampleRate, i.bitDepth, i.channels, i.bitrateKbps, b.peaks, loud?.integrated ?? null, loud?.range ?? null, loud?.truePeak ?? null, v.id),
    c.env.DB.prepare("UPDATE tracks SET updated_at = ? WHERE id = ?").bind(at, v.track_id),
    c.env.DB.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(at, t!.artist_id),
  ]);
  later(c.executionCtx, new URL(c.req.url).origin, (o) => notifyGuestsOfVersion(c.env, o, v.id));
  return c.json(versionDTO(await getVersion(c.env.DB, v.id)));
});

/** The browser gave up (analysis failed, upload cancelled). */
uploads.delete("/uploads/:versionId", async (c) => {
  await discard(c.env, await pendingVersion(c.env.DB, id(c.req.param("versionId"), "Versão")));
  return c.body(null, 204);
});

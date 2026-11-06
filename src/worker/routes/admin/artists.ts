import { Hono } from "hono";
import { parseLoudness } from "../../lib/loudness";
import { commentCounts } from "../../lib/comments";
import type { ArtistResponse, DeleteResponse, LyricsResponse, PeaksResponse, TrackLyricsDTO, VersionDTO } from "../../../shared/api-types";
import { FOLDER_COLORS, FOLDER_ICONS, KIND_ICONS, LIMITS, PROJECT_COLORS, PROJECT_KINDS } from "../../../shared/constants";
import { artistDTO, folderDTO, getArtist, getFolder, getTrack, getVersion, loadArtistTree, nextPosition, trackDTO, versionDTO } from "../../lib/db";
import { badRequest, notFound } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { id, int, jsonBody, oneOf, optNullableId, optText, text } from "../../lib/input";
import type { AdminEnv } from ".";
import { deleteImage, putImage, serveImage } from "./images";

export const artists = new Hono<AdminEnv>();

const photoBase = (artistId: string) => `/api/admin/artists/${artistId}/photo`;

export async function artistResponse(db: D1Database, artistId: string): Promise<ArtistResponse> {
  const artist = await getArtist(db, artistId);
  const tree = await loadArtistTree(db, artistId);
  const counts = await commentCounts(db, { artistId });
  const byTrack = new Map<string, VersionDTO[]>();
  for (const v of tree.versions) {
    const list = byTrack.get(v.track_id) ?? [];
    list.push(versionDTO(v));
    byTrack.set(v.track_id, list);
  }
  return {
    artist: artistDTO(artist, photoBase(artistId)),
    folders: tree.folders.map((f) => folderDTO(f)),
    // A track only exists for the UI once one of its versions is ready.
    tracks: tree.tracks.filter((t) => byTrack.has(t.id)).map((t) => trackDTO(t, byTrack.get(t.id)!, counts.get(t.id))),
  };
}

const touchArtist = (db: D1Database, artistId: string, at = now()) => db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(at, artistId);
const year = (v: unknown, current: number | null) => (v === undefined ? current : v === null ? null : int(v, "Ano", 1900, 2100));

// ---------- Artists ----------

artists.post("/artists", async (c) => {
  const b = await jsonBody(c);
  const name = text(b.name, "Nome", LIMITS.nameMax, 1);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM artists").first<{ n: number }>();
  const color = b.color === undefined ? PROJECT_COLORS[(count?.n ?? 0) % PROJECT_COLORS.length]! : oneOf(b.color, PROJECT_COLORS, "Cor");
  const aid = newId();
  const at = now();
  // A new artist goes last on the home page.
  await c.env.DB.prepare("INSERT INTO artists (id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM artists), ?, ?)")
    .bind(aid, name, color, at, at)
    .run();
  return c.json(await artistResponse(c.env.DB, aid), 201);
});

/** The home page's order: every live artist's id, first to last. */
artists.post("/artists/reorder", async (c) => {
  const ids = (await jsonBody(c)).ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw badRequest("Ordem inválida.");
  const list = ids.map((x) => id(x, "Artista"));
  const live = (await c.env.DB.prepare("SELECT id FROM artists WHERE deleted_at IS NULL").all<{ id: string }>()).results.map((r) => r.id);
  if (list.length !== live.length || new Set(list).size !== list.length || !list.every((x) => live.includes(x))) throw badRequest("A lista de artistas mudou entretanto. Recarrega a página.");
  await c.env.DB.batch(list.map((x, i) => c.env.DB.prepare("UPDATE artists SET position = ? WHERE id = ?").bind(i, x)));
  return c.body(null, 204);
});

artists.get("/artists/:id", async (c) => c.json(await artistResponse(c.env.DB, id(c.req.param("id"), "Artista"))));

artists.patch("/artists/:id", async (c) => {
  const a = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  await c.env.DB.prepare("UPDATE artists SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?")
    .bind(
      optText(b.name, "Nome", LIMITS.nameMax, 1) ?? a.name,
      optText(b.description, "Descrição", LIMITS.descriptionMax) ?? a.description,
      b.color === undefined ? a.color : oneOf(b.color, PROJECT_COLORS, "Cor"),
      now(),
      a.id,
    )
    .run();
  return c.json(await artistResponse(c.env.DB, a.id));
});

artists.delete("/artists/:id", async (c) => {
  const a = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const batch = now();
  await c.env.DB.prepare("UPDATE artists SET deleted_at = ? WHERE id = ?").bind(batch, a.id).run();
  return c.json({ batch } satisfies DeleteResponse);
});

artists.post("/artists/:id/restore", async (c) => {
  const aid = id(c.req.param("id"), "Artista");
  const batch = int((await jsonBody(c)).batch, "batch", 0, Number.MAX_SAFE_INTEGER);
  const r = await c.env.DB.prepare("UPDATE artists SET deleted_at = NULL WHERE id = ? AND deleted_at = ?").bind(aid, batch).run();
  if (!r.meta.changes) throw notFound("Já não é possível anular.");
  return c.json(await artistResponse(c.env.DB, aid));
});

artists.get("/artists/:id/photo", async (c) => serveImage(c, (await getArtist(c.env.DB, id(c.req.param("id"), "Artista"))).photo_key));

artists.put("/artists/:id/photo", async (c) => {
  const a = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const key = await putImage(c, `artist-${a.id}`);
  await c.env.DB.prepare("UPDATE artists SET photo_key = ?, updated_at = ? WHERE id = ?").bind(key, now(), a.id).run();
  if (a.photo_key) await deleteImage(c, a.photo_key);
  return c.json(await artistResponse(c.env.DB, a.id));
});

artists.delete("/artists/:id/photo", async (c) => {
  const a = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  await c.env.DB.prepare("UPDATE artists SET photo_key = NULL, updated_at = ? WHERE id = ?").bind(now(), a.id).run();
  if (a.photo_key) await deleteImage(c, a.photo_key);
  return c.json(await artistResponse(c.env.DB, a.id));
});

// ---------- Projects (top-level folders) and folders ----------

artists.post("/artists/:id/folders", async (c) => {
  const a = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const parentId = optNullableId(b.parentId, "Pasta") ?? null;
  if (parentId) await getFolder(c.env.DB, parentId, a.id);
  const kind = parentId || b.kind === undefined ? "release" : oneOf(b.kind, PROJECT_KINDS, "Tipo");
  const fid = newId();
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO folders (id, artist_id, parent_id, name, icon, color, position, kind, year, label, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      fid,
      a.id,
      parentId,
      text(b.name, "Nome", LIMITS.nameMax, 1),
      b.icon === undefined ? (parentId ? "folder" : KIND_ICONS[kind]) : oneOf(b.icon, FOLDER_ICONS, "Ícone"),
      b.color === undefined ? (parentId ? FOLDER_COLORS[FOLDER_COLORS.length - 1]! : a.color) : oneOf(b.color, FOLDER_COLORS, "Cor"),
      await nextPosition(c.env.DB, "folders", a.id, parentId),
      kind,
      year(b.year, null),
      optText(b.label, "Editora", LIMITS.nameMax) ?? "",
      optText(b.description, "Descrição", LIMITS.descriptionMax) ?? "",
      at,
      at,
    ),
    touchArtist(c.env.DB, a.id, at),
  ]);
  return c.json(folderDTO(await getFolder(c.env.DB, fid)), 201);
});

artists.patch("/folders/:id", async (c) => {
  const f = await getFolder(c.env.DB, id(c.req.param("id"), "Pasta"));
  const b = await jsonBody(c);
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE folders SET name = ?, icon = ?, color = ?, kind = ?, year = ?, label = ?, description = ?, updated_at = ? WHERE id = ?").bind(
      optText(b.name, "Nome", LIMITS.nameMax, 1) ?? f.name,
      b.icon === undefined ? f.icon : oneOf(b.icon, FOLDER_ICONS, "Ícone"),
      b.color === undefined ? f.color : oneOf(b.color, FOLDER_COLORS, "Cor"),
      // Only projects have a kind; a folder inside one keeps the default.
      b.kind === undefined || f.parent_id ? f.kind : oneOf(b.kind, PROJECT_KINDS, "Tipo"),
      year(b.year, f.year),
      optText(b.label, "Editora", LIMITS.nameMax) ?? f.label,
      optText(b.description, "Descrição", LIMITS.descriptionMax) ?? f.description,
      at,
      f.id,
    ),
    touchArtist(c.env.DB, f.artist_id, at),
  ]);
  return c.json(folderDTO(await getFolder(c.env.DB, f.id)));
});

// Project covers (only top-level folders have one).
artists.get("/folders/:id/artwork", async (c) => serveImage(c, (await getFolder(c.env.DB, id(c.req.param("id"), "Projeto"))).artwork_key));

artists.put("/folders/:id/artwork", async (c) => {
  const f = await getFolder(c.env.DB, id(c.req.param("id"), "Projeto"));
  if (f.parent_id) throw badRequest("Só os projetos têm capa.");
  const key = await putImage(c, `cover-${f.id}`);
  await c.env.DB.prepare("UPDATE folders SET artwork_key = ?, updated_at = ? WHERE id = ?").bind(key, now(), f.id).run();
  if (f.artwork_key) await deleteImage(c, f.artwork_key);
  return c.json(await artistResponse(c.env.DB, f.artist_id));
});

artists.delete("/folders/:id/artwork", async (c) => {
  const f = await getFolder(c.env.DB, id(c.req.param("id"), "Projeto"));
  await c.env.DB.prepare("UPDATE folders SET artwork_key = NULL, updated_at = ? WHERE id = ?").bind(now(), f.id).run();
  if (f.artwork_key) await deleteImage(c, f.artwork_key);
  return c.json(await artistResponse(c.env.DB, f.artist_id));
});

// ---------- Tracks and versions ----------

// A track's own cover (shown instead of its project's).
artists.get("/tracks/:id/artwork", async (c) => serveImage(c, (await getTrack(c.env.DB, id(c.req.param("id"), "Faixa"))).artwork_key));

artists.put("/tracks/:id/artwork", async (c) => {
  const t = await getTrack(c.env.DB, id(c.req.param("id"), "Faixa"));
  const key = await putImage(c, `track-${t.id}`);
  const at = now();
  await c.env.DB.batch([c.env.DB.prepare("UPDATE tracks SET artwork_key = ?, updated_at = ? WHERE id = ?").bind(key, at, t.id), touchArtist(c.env.DB, t.artist_id, at)]);
  if (t.artwork_key) await deleteImage(c, t.artwork_key);
  return c.json(await artistResponse(c.env.DB, t.artist_id));
});

artists.delete("/tracks/:id/artwork", async (c) => {
  const t = await getTrack(c.env.DB, id(c.req.param("id"), "Faixa"));
  const at = now();
  await c.env.DB.batch([c.env.DB.prepare("UPDATE tracks SET artwork_key = NULL, updated_at = ? WHERE id = ?").bind(at, t.id), touchArtist(c.env.DB, t.artist_id, at)]);
  if (t.artwork_key) await deleteImage(c, t.artwork_key);
  return c.json(await artistResponse(c.env.DB, t.artist_id));
});

/** The title (what everyone sees) and the DAW project name (only the owner). */
artists.patch("/tracks/:id", async (c) => {
  const t = await getTrack(c.env.DB, id(c.req.param("id"), "Faixa"));
  const body = await jsonBody(c);
  const title = body.title === undefined ? t.title : text(body.title, "Título", LIMITS.nameMax, 1);
  const session = optText(body.sessionName, "Nome do projeto", LIMITS.nameMax) ?? t.session_name;
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tracks SET title = ?, session_name = ?, updated_at = ? WHERE id = ?").bind(title, session, at, t.id),
    touchArtist(c.env.DB, t.artist_id, at),
  ]);
  return c.json({ ok: true });
});

artists.patch("/versions/:id", async (c) => {
  const v = await getVersion(c.env.DB, id(c.req.param("id"), "Versão"));
  if (v.status !== "ready") throw badRequest("Esta versão ainda está a carregar.");
  const b = await jsonBody(c);
  await c.env.DB.prepare("UPDATE versions SET label = ?, notes = ? WHERE id = ?")
    .bind(optText(b.label, "Nome da versão", LIMITS.nameMax) ?? v.label, optText(b.notes, "Notas", LIMITS.notesMax) ?? v.notes, v.id)
    .run();
  return c.json(versionDTO(await getVersion(c.env.DB, v.id)));
});

// ---------- Lyrics ----------

const lyricsText = (v: unknown) => {
  if (v === null) return null;
  if (typeof v !== "string") throw badRequest("Letra: valor inválido.");
  const s = v.replace(/\r\n?/g, "\n").trim();
  if (s.length > LIMITS.lyricsMax) throw badRequest("A letra é demasiado longa.");
  return s || null;
};

artists.get("/tracks/:id/lyrics", async (c) => {
  const t = await getTrack(c.env.DB, id(c.req.param("id"), "Faixa"));
  const [track, overrides] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT lyrics_lrc FROM tracks WHERE id = ?").bind(t.id),
    c.env.DB.prepare("SELECT id, lyrics_lrc_override FROM versions WHERE track_id = ? AND lyrics_lrc_override IS NOT NULL AND deleted_at IS NULL").bind(t.id),
  ]);
  const body: TrackLyricsDTO = {
    track: (track!.results[0] as { lyrics_lrc: string | null } | undefined)?.lyrics_lrc ?? null,
    overrides: Object.fromEntries((overrides!.results as { id: string; lyrics_lrc_override: string }[]).map((r) => [r.id, r.lyrics_lrc_override])),
  };
  return c.json(body);
});

artists.put("/tracks/:id/lyrics", async (c) => {
  const t = await getTrack(c.env.DB, id(c.req.param("id"), "Faixa"));
  const b = await jsonBody(c);
  const lrc = lyricsText(b.lrc);
  const at = now();
  if (b.versionId) {
    const v = await getVersion(c.env.DB, id(b.versionId, "Versão"));
    if (v.track_id !== t.id) throw notFound("Versão não encontrada.");
    await c.env.DB.prepare("UPDATE versions SET lyrics_lrc_override = ? WHERE id = ?").bind(lrc, v.id).run();
  } else {
    await c.env.DB.prepare("UPDATE tracks SET lyrics_lrc = ?, updated_at = ? WHERE id = ?").bind(lrc, at, t.id).run();
  }
  return c.json(await artistResponse(c.env.DB, t.artist_id));
});

/** What one version shows (the owner's preview of a guest page). */
artists.get("/versions/:id/lyrics", async (c) => {
  const v = await getVersion(c.env.DB, id(c.req.param("id"), "Versão"));
  const lrc = await c.env.DB.prepare("SELECT COALESCE(v.lyrics_lrc_override, t.lyrics_lrc) AS lrc FROM versions v JOIN tracks t ON t.id = v.track_id WHERE v.id = ?").bind(v.id).first<string | null>("lrc");
  return c.json({ lrc: lrc ?? null } satisfies LyricsResponse);
});

/** Loudness for a version uploaded before it was measured (the browser measures, the Worker stores). */
artists.put("/versions/:id/loudness", async (c) => {
  const v = await getVersion(c.env.DB, id(c.req.param("id"), "Versão"));
  const l = parseLoudness(await jsonBody(c));
  await c.env.DB.prepare("UPDATE versions SET lufs_integrated = ?, lufs_range = ?, true_peak_dbtp = ? WHERE id = ?").bind(l.integrated, l.range, l.truePeak, v.id).run();
  return c.json(versionDTO(await getVersion(c.env.DB, v.id)));
});

artists.get("/versions/:id/peaks", async (c) => {
  const v = await getVersion(c.env.DB, id(c.req.param("id"), "Versão"));
  const row = await c.env.DB.prepare("SELECT peaks FROM versions WHERE id = ?").bind(v.id).first<{ peaks: string | null }>();
  c.header("Cache-Control", "private, max-age=86400");
  return c.json({ peaks: row?.peaks ?? null } satisfies PeaksResponse);
});

import { Hono } from "hono";
import type { DeleteResponse, MergedVersion, MergeResponse, SplitResponse } from "../../../shared/api-types";
import { LIMITS } from "../../../shared/constants";
import { getFolder, getArtist, loadArtistTree, nextPosition } from "../../lib/db";
import { badRequest, notFound } from "../../lib/errors";
import { newId, now } from "../../lib/ids";
import { id, idList, int, jsonBody, oneOf, text } from "../../lib/input";
import type { AdminEnv } from ".";
import { artistResponse } from "./artists";
import { titleFromFilename } from "./uploads";

export const items = new Hono<AdminEnv>();

// D1 caps bound parameters per statement at 100.
const CHUNK = 90;
function chunked(db: D1Database, sql: (marks: string) => string, ids: string[], ...lead: unknown[]): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    out.push(db.prepare(sql(part.map(() => "?").join(","))).bind(...lead, ...part));
  }
  return out;
}

/** All folders under the given ones (inclusive), from the artist's folder list. */
function subtree(all: { id: string; parent_id: string | null }[], roots: string[]): Set<string> {
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) (out.add(f.id), (grew = true));
  }
  return out;
}

/**
 * Soft-deletes tracks, folders (with everything inside) and versions in one
 * batch. The batch timestamp is the undo handle; the daily cron purges rows
 * and R2 objects 7 days later.
 */
items.post("/artists/:id/delete", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const trackIds = idList(b.trackIds, "Faixas");
  const folderIds = idList(b.folderIds, "Pastas");
  const versionIds = idList(b.versionIds, "Versões");
  const tree = await loadArtistTree(c.env.DB, p.id);
  const liveFolders = new Set(tree.folders.map((f) => f.id));
  const liveTracks = new Set(tree.tracks.map((t) => t.id));
  if (folderIds.some((f) => !liveFolders.has(f)) || trackIds.some((t) => !liveTracks.has(t))) throw notFound("Alguns itens já não existem.");

  const folders = subtree(tree.folders, folderIds);
  const tracks = new Set([...trackIds, ...tree.tracks.filter((t) => t.folder_id && folders.has(t.folder_id)).map((t) => t.id)]);
  const readyVersions = tree.versions.filter((v) => !tracks.has(v.track_id));
  const versionSet = new Set(versionIds);
  if (versionIds.some((v) => !tree.versions.some((r) => r.id === v))) throw notFound("Algumas versões já não existem.");
  // Deleting the last version of a track deletes the track as well.
  for (const t of new Set(readyVersions.filter((v) => versionSet.has(v.id)).map((v) => v.track_id))) {
    if (readyVersions.filter((v) => v.track_id === t).every((v) => versionSet.has(v.id))) tracks.add(t);
  }

  const batch = now();
  const db = c.env.DB;
  await db.batch([
    ...chunked(db, (m) => `UPDATE folders SET deleted_at = ? WHERE id IN (${m})`, [...folders], batch),
    ...chunked(db, (m) => `UPDATE tracks SET deleted_at = ? WHERE id IN (${m})`, [...tracks], batch),
    // A deleted track takes all its versions with it (same batch, so "Anular" brings them back).
    ...chunked(db, (m) => `UPDATE versions SET deleted_at = ? WHERE deleted_at IS NULL AND track_id IN (${m})`, [...tracks], batch),
    ...chunked(db, (m) => `UPDATE versions SET deleted_at = ? WHERE id IN (${m})`, versionIds, batch),
    db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(batch, p.id),
  ]);
  return c.json({ batch } satisfies DeleteResponse);
});

items.post("/artists/:id/restore-items", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const batch = int((await jsonBody(c)).batch, "batch", 0, Number.MAX_SAFE_INTEGER);
  const db = c.env.DB;
  const r = await db.batch([
    db.prepare("UPDATE folders SET deleted_at = NULL WHERE artist_id = ? AND deleted_at = ?").bind(p.id, batch),
    db.prepare("UPDATE tracks SET deleted_at = NULL WHERE artist_id = ? AND deleted_at = ?").bind(p.id, batch),
    db.prepare("UPDATE versions SET deleted_at = NULL WHERE deleted_at = ? AND track_id IN (SELECT id FROM tracks WHERE artist_id = ?)").bind(batch, p.id),
  ]);
  if (!r.some((x) => x.meta.changes > 0)) throw notFound("Já não é possível anular.");
  return c.json(await artistResponse(db, p.id));
});

/**
 * Turns tracks into versions of another track (a track dropped on a track):
 * their versions move over, numbered after the target's (so the last one
 * dropped becomes the main version), keeping the name of the track they were
 * as their own name, and the emptied tracks are soft-deleted. The target keeps
 * its title. The response says where each version came from.
 */
items.post("/artists/:id/merge", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const into = id(b.intoTrackId, "Faixa");
  const trackIds = idList(b.trackIds, "Faixas").filter((t) => t !== into);
  if (!trackIds.length) throw badRequest("Escolhe a faixa que vai passar a ser uma versão.");
  const tree = await loadArtistTree(c.env.DB, p.id);
  if (![into, ...trackIds].every((t) => tree.tracks.some((x) => x.id === t))) throw notFound("Alguns itens já não existem.");

  const db = c.env.DB;
  // UNIQUE (track_id, number) counts every row, pending and deleted ones too.
  let n = (await db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM versions WHERE track_id = ?").bind(into).first<number>("n")) ?? 0;
  const moved: (MergedVersion & { to: number; carry: string })[] = [];
  for (const t of trackIds) {
    const title = tree.tracks.find((x) => x.id === t)!.title;
    const rows = await db.prepare("SELECT id, number, name FROM versions WHERE track_id = ? AND deleted_at IS NULL ORDER BY number").bind(t).all<{ id: string; number: number; name: string | null }>();
    for (const v of rows.results) moved.push({ versionId: v.id, trackId: t, number: v.number, name: v.name, to: ++n, carry: v.name ?? title });
  }
  const batch = now();
  await db.batch([
    ...moved.map((m) => db.prepare("UPDATE versions SET track_id = ?, number = ?, name = ? WHERE id = ?").bind(into, m.to, m.carry, m.versionId)),
    ...chunked(db, (m) => `UPDATE tracks SET deleted_at = ? WHERE id IN (${m})`, trackIds, batch),
    db.prepare("UPDATE tracks SET updated_at = ? WHERE id = ?").bind(batch, into),
    db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(batch, p.id),
  ]);
  return c.json({ batch, moved: moved.map(({ to: _, carry: _c, ...m }) => m), artist: await artistResponse(db, p.id) } satisfies MergeResponse);
});

/** Undoes a merge: the versions go back to their tracks and numbers, and the tracks come back. */
items.post("/artists/:id/unmerge", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const batch = int(b.batch, "batch", 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(b.moved) || !b.moved.length || b.moved.length > 1000) throw badRequest("Nada para anular.");
  const moved = (b.moved as Record<string, unknown>[]).map((m) => ({
    versionId: id(m.versionId, "Versão"),
    trackId: id(m.trackId, "Faixa"),
    number: int(m.number, "Número", 1, 1_000_000),
    // Older pages did not send it: then the name stays as it is.
    name: m.name === undefined ? undefined : m.name === null ? null : text(m.name, "Nome", LIMITS.nameMax),
  }));
  const db = c.env.DB;
  const trackIds = [...new Set(moved.map((m) => m.trackId))];
  const back = await db
    .prepare(`SELECT COUNT(*) AS n FROM tracks WHERE artist_id = ? AND deleted_at = ? AND id IN (${trackIds.map(() => "?").join(",")})`)
    .bind(p.id, batch, ...trackIds)
    .first<number>("n");
  if (back !== trackIds.length) throw notFound("Já não é possível anular.");
  await db.batch([
    ...moved.map((m) =>
      m.name === undefined
        ? db.prepare("UPDATE versions SET track_id = ?, number = ? WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE artist_id = ?)").bind(m.trackId, m.number, m.versionId, p.id)
        : db.prepare("UPDATE versions SET track_id = ?, number = ?, name = ? WHERE id = ? AND track_id IN (SELECT id FROM tracks WHERE artist_id = ?)").bind(m.trackId, m.number, m.name, m.versionId, p.id),
    ),
    ...chunked(db, (m) => `UPDATE tracks SET deleted_at = NULL WHERE artist_id = ? AND deleted_at = ? AND id IN (${m})`, trackIds, p.id, batch),
    db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(now(), p.id),
  ]);
  return c.json(await artistResponse(db, p.id));
});

/**
 * A version dragged out of its track becomes a track of its own (as v1), right
 * after the old one, named after the track it once was, or else its file.
 */
items.post("/artists/:id/split", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const versionId = id((await jsonBody(c)).versionId, "Versão");
  const db = c.env.DB;
  const v = await db
    .prepare(
      `SELECT v.id, v.number, v.name, v.original_filename, t.id AS track_id, t.folder_id, t.position FROM versions v JOIN tracks t ON t.id = v.track_id
       WHERE v.id = ? AND v.deleted_at IS NULL AND v.status = 'ready' AND t.artist_id = ? AND t.deleted_at IS NULL`,
    )
    .bind(versionId, p.id)
    .first<{ id: string; number: number; name: string | null; original_filename: string; track_id: string; folder_id: string | null; position: number }>();
  if (!v) throw notFound("Versão não encontrada.");
  const others = await db.prepare("SELECT COUNT(*) AS n FROM versions WHERE track_id = ? AND id <> ? AND deleted_at IS NULL AND status = 'ready'").bind(v.track_id, v.id).first<number>("n");
  if (!others) throw badRequest("Esta versão já é a única da faixa.");

  const trackId = newId();
  const at = now();
  await db.batch([
    db.prepare("UPDATE tracks SET position = position + 1 WHERE artist_id = ? AND folder_id IS ? AND position > ? AND deleted_at IS NULL").bind(p.id, v.folder_id, v.position),
    db.prepare("INSERT INTO tracks (id, artist_id, folder_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(trackId, p.id, v.folder_id, v.name ?? titleFromFilename(v.original_filename), v.position + 1, at, at),
    db.prepare("UPDATE versions SET track_id = ?, number = 1 WHERE id = ?").bind(trackId, v.id),
    db.prepare("UPDATE tracks SET updated_at = ? WHERE id = ?").bind(at, v.track_id),
    db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(at, p.id),
  ]);
  return c.json({ trackId, from: { trackId: v.track_id, number: v.number }, artist: await artistResponse(db, p.id) } satisfies SplitResponse);
});

/** Undoes a split: the version goes back to its track and number, and the new track goes away. */
items.post("/artists/:id/unsplit", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const trackId = id(b.trackId, "Faixa");
  const from = (b.from ?? {}) as Record<string, unknown>;
  const back = { trackId: id(from.trackId, "Faixa"), number: int(from.number, "Número", 1, 1_000_000) };
  const db = c.env.DB;
  const [rows, target, taken] = await db.batch([
    db.prepare("SELECT v.id FROM versions v JOIN tracks t ON t.id = v.track_id WHERE t.id = ? AND t.artist_id = ? AND t.deleted_at IS NULL AND v.deleted_at IS NULL").bind(trackId, p.id),
    db.prepare("SELECT 1 AS ok FROM tracks WHERE id = ? AND artist_id = ? AND deleted_at IS NULL").bind(back.trackId, p.id),
    db.prepare("SELECT 1 AS ok FROM versions WHERE track_id = ? AND number = ?").bind(back.trackId, back.number),
  ]);
  const versions = rows!.results as { id: string }[];
  if (versions.length !== 1 || !target!.results.length || taken!.results.length) throw notFound("Já não é possível anular.");
  const at = now();
  await db.batch([
    db.prepare("UPDATE versions SET track_id = ?, number = ? WHERE id = ?").bind(back.trackId, back.number, versions[0]!.id),
    db.prepare("UPDATE tracks SET deleted_at = ? WHERE id = ?").bind(at, trackId),
    db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(at, p.id),
  ]);
  return c.json(await artistResponse(db, p.id));
});

/** Moves tracks and folders into a folder (or the artist's root with `toFolderId: null`), at the end. A folder moved to the root becomes a project. */
items.post("/artists/:id/move", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const trackIds = idList(b.trackIds, "Faixas");
  const folderIds = idList(b.folderIds, "Pastas");
  const to = b.toFolderId === null ? null : id(b.toFolderId, "Destino");
  if (to) await getFolder(c.env.DB, to, p.id);
  const tree = await loadArtistTree(c.env.DB, p.id);
  if (trackIds.some((t) => !tree.tracks.some((x) => x.id === t)) || folderIds.some((f) => !tree.folders.some((x) => x.id === f))) {
    throw notFound("Alguns itens já não existem.");
  }
  if (to && folderIds.length && subtree(tree.folders, folderIds).has(to)) throw badRequest("Uma pasta não pode ir para dentro de si própria.");

  const db = c.env.DB;
  const at = now();
  let tpos = await nextPosition(db, "tracks", p.id, to);
  let fpos = await nextPosition(db, "folders", p.id, to);
  await db.batch([
    ...trackIds.map((t) => db.prepare("UPDATE tracks SET folder_id = ?, position = ?, updated_at = ? WHERE id = ?").bind(to, tpos++, at, t)),
    ...folderIds.map((f) => db.prepare("UPDATE folders SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?").bind(to, fpos++, at, f)),
    db.prepare("UPDATE artists SET updated_at = ? WHERE id = ?").bind(at, p.id),
  ]);
  return c.json(await artistResponse(db, p.id));
});

/** Rewrites the order of the tracks or folders inside one container. */
items.post("/artists/:id/reorder", async (c) => {
  const p = await getArtist(c.env.DB, id(c.req.param("id"), "Artista"));
  const b = await jsonBody(c);
  const kind = oneOf(b.kind, ["tracks", "folders"] as const, "Tipo");
  const parent = b.parentId === null || b.parentId === undefined ? null : id(b.parentId, "Pasta");
  const ids = idList(b.ids, "Ordem");
  const tree = await loadArtistTree(c.env.DB, p.id);
  const members = new Set(
    kind === "tracks" ? tree.tracks.filter((t) => t.folder_id === parent).map((t) => t.id) : tree.folders.filter((f) => f.parent_id === parent).map((f) => f.id),
  );
  if (ids.some((x) => !members.has(x))) throw badRequest("A ordem tem itens que não pertencem a esta lista.");
  const db = c.env.DB;
  await db.batch(ids.map((x, i) => db.prepare(`UPDATE ${kind} SET position = ? WHERE id = ?`).bind(i, x)));
  return c.json(await artistResponse(db, p.id));
});

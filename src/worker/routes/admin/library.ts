import { Hono } from "hono";
import type { ActivityDTO, LibraryResponse, MeResponse, ProfileDTO, SearchIndexDTO } from "../../../shared/api-types";
import { LIMITS } from "../../../shared/constants";
import { ARTIST_COLS, artistDTO, type ArtistRow } from "../../lib/db";
import { now } from "../../lib/ids";
import { jsonBody, text } from "../../lib/input";
import type { AdminEnv } from ".";
import { deleteImage, putImage, serveImage } from "./images";

export const library = new Hono<AdminEnv>();

const DEFAULT_NAME = "Produtor";
const R2_FREE_BYTES = 10 * 1000 ** 3;
const DAY_MS = 24 * 60 * 60 * 1000;

async function profile(db: D1Database): Promise<{ dto: ProfileDTO; photoKey: string | null }> {
  const row = await db.prepare("SELECT name, photo_key, updated_at FROM owner_profile WHERE id = 1").first<{ name: string; photo_key: string | null; updated_at: number }>();
  const photoKey = row?.photo_key ?? null;
  return { dto: { name: row?.name ?? DEFAULT_NAME, photoUrl: photoKey ? `/api/admin/profile/photo?v=${row!.updated_at}` : null }, photoKey };
}

library.get("/me", async (c) => {
  const body: MeResponse = { email: c.get("owner").email, profile: (await profile(c.env.DB)).dto };
  return c.json(body);
});

library.patch("/profile", async (c) => {
  const name = text((await jsonBody(c)).name, "Nome", LIMITS.nameMax, 1);
  await c.env.DB.prepare(
    "INSERT INTO owner_profile (id, name, updated_at) VALUES (1, ?1, ?2) ON CONFLICT (id) DO UPDATE SET name = ?1, updated_at = ?2",
  ).bind(name, now()).run();
  return c.json((await profile(c.env.DB)).dto);
});

library.put("/profile/photo", async (c) => {
  const old = (await profile(c.env.DB)).photoKey;
  const key = await putImage(c, "profile");
  await c.env.DB.prepare(
    "INSERT INTO owner_profile (id, name, photo_key, updated_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET photo_key = ?2, updated_at = ?3",
  ).bind(DEFAULT_NAME, key, now()).run();
  if (old) await c.env.BUCKET.delete(old);
  return c.json((await profile(c.env.DB)).dto);
});

library.delete("/profile/photo", async (c) => {
  const old = (await profile(c.env.DB)).photoKey;
  await c.env.DB.prepare("UPDATE owner_profile SET photo_key = NULL, updated_at = ? WHERE id = 1").bind(now()).run();
  if (old) await deleteImage(c, old);
  return c.json((await profile(c.env.DB)).dto);
});

library.get("/profile/photo", async (c) => serveImage(c, (await profile(c.env.DB)).photoKey));

/** Names of every live artist, project/folder and track (a few KB even for a big library). */
library.get("/search-index", async (c) => {
  const db = c.env.DB;
  const [artists, folders, tracks] = await db.batch([
    db.prepare("SELECT id, name FROM artists WHERE deleted_at IS NULL ORDER BY position, name"),
    db.prepare(
      `SELECT f.id, f.artist_id, f.parent_id, f.name FROM folders f JOIN artists a ON a.id = f.artist_id
       WHERE f.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY f.name`,
    ),
    db.prepare(
      `SELECT t.id, t.artist_id, t.folder_id, t.title, t.session_name FROM tracks t JOIN artists a ON a.id = t.artist_id
       WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM versions v WHERE v.track_id = t.id AND v.status = 'ready' AND v.deleted_at IS NULL)
       ORDER BY t.title`,
    ),
  ]);
  type F = { id: string; artist_id: string; parent_id: string | null; name: string };
  type T = { id: string; artist_id: string; folder_id: string | null; title: string; session_name: string };
  const body: SearchIndexDTO = {
    artists: artists!.results as { id: string; name: string }[],
    folders: (folders!.results as F[]).map((f) => ({ id: f.id, artistId: f.artist_id, parentId: f.parent_id, name: f.name })),
    tracks: (tracks!.results as T[]).map((t) => ({ id: t.id, artistId: t.artist_id, folderId: t.folder_id, title: t.title, sessionName: t.session_name })),
  };
  return c.json(body);
});

library.get("/library", async (c) => {
  const db = c.env.DB;
  const [artists, stats, storage, voice, open, recent] = await db.batch([
    db.prepare(`SELECT ${ARTIST_COLS} FROM artists WHERE deleted_at IS NULL ORDER BY position, created_at DESC`),
    db.prepare(
      `SELECT a.id,
        (SELECT COUNT(*) FROM folders f WHERE f.artist_id = a.id AND f.parent_id IS NULL AND f.deleted_at IS NULL) AS project_count,
        (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = a.id AND t.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM versions v WHERE v.track_id = t.id AND v.status = 'ready' AND v.deleted_at IS NULL)) AS track_count,
        (SELECT COUNT(*) FROM versions v JOIN tracks t ON t.id = v.track_id
           WHERE t.artist_id = a.id AND t.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'ready') AS version_count
       FROM artists a WHERE a.deleted_at IS NULL`,
    ),
    // What R2 holds: the library's audio, and what was deleted (kept 7 days so it can be
    // undone) or never finished uploading (24 h), until the cron purges it.
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN live THEN size_bytes END), 0) AS bytes, COUNT(CASE WHEN live THEN 1 END) AS n,
         COALESCE(SUM(CASE WHEN NOT live THEN size_bytes END), 0) AS trash, MAX(CASE WHEN NOT live THEN until END) AS until
       FROM (SELECT v.size_bytes,
               v.status = 'ready' AND v.deleted_at IS NULL AND t.deleted_at IS NULL AND a.deleted_at IS NULL AS live,
               CASE WHEN v.status = 'pending' THEN v.created_at + ${DAY_MS} ELSE COALESCE(v.deleted_at, t.deleted_at, a.deleted_at) + ${7 * DAY_MS} END AS until
             FROM versions v JOIN tracks t ON t.id = v.track_id JOIN artists a ON a.id = t.artist_id)`,
    ),
    db.prepare("SELECT COALESCE(SUM(voice_size), 0) AS bytes FROM comments WHERE voice_key IS NOT NULL"),
    // Guest requests not done yet, per artist.
    db.prepare(
      `SELECT t.artist_id, COUNT(*) AS n FROM comments c JOIN versions v ON v.id = c.version_id JOIN tracks t ON t.id = v.track_id
       WHERE c.parent_id IS NULL AND c.guest_id IS NOT NULL AND c.status = 'open' AND c.deleted_at IS NULL
         AND v.deleted_at IS NULL AND v.status = 'ready' AND t.deleted_at IS NULL
       GROUP BY t.artist_id`,
    ),
    // What guests said lately (the library's activity panel).
    db.prepare(
      `SELECT c.id, c.parent_id, c.voice_key, c.created_at, g.name AS author, t.id AS track_id, t.title, a.id AS artist_id, a.name AS artist_name,
         v.id AS version_id, v.number
       FROM comments c JOIN guests g ON g.id = c.guest_id JOIN versions v ON v.id = c.version_id JOIN tracks t ON t.id = v.track_id JOIN artists a ON a.id = t.artist_id
       WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL AND t.deleted_at IS NULL AND a.deleted_at IS NULL
       ORDER BY c.created_at DESC LIMIT 8`,
    ),
  ]);
  const openBy = new Map((open!.results as { artist_id: string; n: number }[]).map((r) => [r.artist_id, r.n]));
  type R = { id: string; parent_id: string | null; voice_key: string | null; created_at: number; author: string; track_id: string; title: string; artist_id: string; artist_name: string; version_id: string; number: number };
  const activity: ActivityDTO[] = (recent!.results as R[]).map((r) => ({
    id: r.id,
    kind: r.parent_id ? "reply" : r.voice_key ? "voice" : "comment",
    author: r.author,
    artistId: r.artist_id,
    artistName: r.artist_name,
    trackId: r.track_id,
    trackTitle: r.title,
    versionId: r.version_id,
    versionNumber: r.number,
    createdAt: r.created_at,
  }));
  const counts = new Map((stats!.results as { id: string; project_count: number; track_count: number; version_count: number }[]).map((r) => [r.id, r]));
  const st = storage!.results[0] as { bytes: number; n: number; trash: number; until: number | null };
  const body: LibraryResponse = {
    artists: (artists!.results as unknown as ArtistRow[]).map((a) => ({
      ...artistDTO(a, `/api/admin/artists/${a.id}/photo`),
      projectCount: counts.get(a.id)?.project_count ?? 0,
      trackCount: counts.get(a.id)?.track_count ?? 0,
      versionCount: counts.get(a.id)?.version_count ?? 0,
      openRequests: openBy.get(a.id) ?? 0,
    })),
    storage: {
      audioBytes: st.bytes,
      versionCount: st.n,
      trashBytes: st.trash,
      // The daily clean-up runs at 03:17 UTC, so "until" is when it becomes due.
      trashUntil: st.trash ? st.until : null,
      voiceBytes: (voice!.results[0] as { bytes: number }).bytes,
      limitBytes: R2_FREE_BYTES,
    },
    openRequests: [...openBy.values()].reduce((s, n) => s + n, 0),
    activity,
  };
  return c.json(body);
});

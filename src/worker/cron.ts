const DAY = 24 * 60 * 60 * 1000;
const CHUNK = 90;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");

/**
 * Daily clean-up (Cron Trigger):
 * - uploads still pending after 24 h (tab closed before finalize);
 * - soft-deleted versions, tracks, folders/projects and artists older than 7 days;
 * - failed password counts idle for 2 days (locks last an hour at most);
 * - comments deleted 7 days ago or on a purged version (and their voice notes),
 *   and the guests of links that are gone;
 * - notification devices of links that are gone, revoked or expired.
 * R2 objects go first, then the rows (children before parents for the FKs).
 */
export async function purge(env: Env, at = Date.now()) {
  const db = env.DB;
  const pendingCutoff = at - DAY;
  const deletedCutoff = at - 7 * DAY;

  const [versions, tracks, folders, artists, gone] = await db.batch([
    db.prepare(
      `SELECT v.id, v.r2_key FROM versions v JOIN tracks t ON t.id = v.track_id JOIN artists a ON a.id = t.artist_id
       WHERE (v.status = 'pending' AND v.created_at < ?1)
          OR v.deleted_at < ?2 OR t.deleted_at < ?2 OR a.deleted_at < ?2`,
    ).bind(pendingCutoff, deletedCutoff),
    db.prepare(
      `SELECT t.id, t.artwork_key FROM tracks t JOIN artists a ON a.id = t.artist_id
       WHERE t.deleted_at < ?1 OR a.deleted_at < ?1`,
    ).bind(deletedCutoff),
    db.prepare(
      `SELECT f.id, f.artwork_key FROM folders f JOIN artists a ON a.id = f.artist_id
       WHERE f.deleted_at < ?1 OR a.deleted_at < ?1`,
    ).bind(deletedCutoff),
    db.prepare("SELECT id, photo_key FROM artists WHERE deleted_at < ?").bind(deletedCutoff),
    db.prepare("SELECT id, voice_key FROM comments WHERE deleted_at < ?").bind(deletedCutoff),
  ]);

  const versionRows = versions!.results as { id: string; r2_key: string }[];
  const trackRows = tracks!.results as { id: string; artwork_key: string | null }[];
  const trackIds = trackRows.map((r) => r.id);
  const folderRows = folders!.results as { id: string; artwork_key: string | null }[];
  const folderIds = folderRows.map((r) => r.id);
  const artistRows = artists!.results as { id: string; photo_key: string | null }[];
  const artistIds = artistRows.map((r) => r.id);
  const versionIdsToPurge = versionRows.map((v) => v.id);
  // Comments go with their version, whatever their own state.
  const doomed = (gone!.results as { id: string; voice_key: string | null }[]).slice();
  for (const part of chunks(versionIdsToPurge)) {
    const r = await db.prepare(`SELECT id, voice_key FROM comments WHERE version_id IN (${marks(part.length)})`).bind(...part).all<{ id: string; voice_key: string | null }>();
    doomed.push(...r.results);
  }
  const commentIds = [...new Set(doomed.map((c) => c.id))];

  // R2 accepts up to 1000 keys per delete call.
  const keys = [
    ...versionRows.map((v) => v.r2_key),
    ...folderRows.flatMap((f) => (f.artwork_key ? [f.artwork_key] : [])),
    ...trackRows.flatMap((t) => (t.artwork_key ? [t.artwork_key] : [])),
    ...artistRows.flatMap((a) => (a.photo_key ? [a.photo_key] : [])),
    ...doomed.flatMap((c) => (c.voice_key ? [c.voice_key] : [])),
  ];
  for (const part of chunks(keys, 1000)) await env.BUCKET.delete(part);

  // The batch is one transaction; deferring FK checks to its end means chunk order never matters.
  const stmts: D1PreparedStatement[] = [db.prepare("PRAGMA defer_foreign_keys = on")];
  const versionIds = versionIdsToPurge;
  for (const part of chunks(commentIds)) stmts.push(db.prepare(`DELETE FROM comments WHERE id IN (${marks(part.length)})`).bind(...part));
  for (const part of chunks(versionIds)) {
    stmts.push(db.prepare(`DELETE FROM share_link_versions WHERE version_id IN (${marks(part.length)})`).bind(...part));
  }
  // Links pointing at anything that is about to disappear go too.
  for (const [col, ids] of [["track_id", trackIds], ["folder_id", folderIds], ["artist_id", artistIds]] as const) {
    for (const part of chunks(ids)) {
      const where = `${col} IN (${marks(part.length)})`;
      stmts.push(db.prepare(`DELETE FROM share_link_versions WHERE link_id IN (SELECT id FROM share_links WHERE ${where})`).bind(...part));
      stmts.push(db.prepare(`DELETE FROM share_links WHERE ${where}`).bind(...part));
    }
  }
  for (const part of chunks(versionIds)) stmts.push(db.prepare(`DELETE FROM versions WHERE id IN (${marks(part.length)})`).bind(...part));
  // Tracks that a never-finalized upload had created are left without versions.
  stmts.push(db.prepare("DELETE FROM tracks WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.track_id = tracks.id) AND NOT EXISTS (SELECT 1 FROM share_links s WHERE s.track_id = tracks.id)").bind(pendingCutoff));
  for (const part of chunks(trackIds)) stmts.push(db.prepare(`DELETE FROM tracks WHERE id IN (${marks(part.length)})`).bind(...part));
  for (const part of chunks(folderIds)) stmts.push(db.prepare(`DELETE FROM folders WHERE id IN (${marks(part.length)})`).bind(...part));
  for (const part of chunks(artistIds)) stmts.push(db.prepare(`DELETE FROM artists WHERE id IN (${marks(part.length)})`).bind(...part));
  stmts.push(db.prepare("DELETE FROM unlock_attempts WHERE updated_at < ?").bind(at - 2 * DAY));
  // Guests' shares of links that are gone go too (after the links above).
  stmts.push(db.prepare("DELETE FROM share_link_versions WHERE link_id IN (SELECT id FROM share_links WHERE parent_link_id IS NOT NULL AND parent_link_id NOT IN (SELECT id FROM share_links))"));
  stmts.push(db.prepare("DELETE FROM share_links WHERE parent_link_id IS NOT NULL AND parent_link_id NOT IN (SELECT id FROM share_links)"));
  stmts.push(db.prepare("DELETE FROM guests WHERE link_id NOT IN (SELECT id FROM share_links)"));
  // Devices of links that are gone, revoked or expired hear nothing more.
  stmts.push(db.prepare("DELETE FROM push_subscriptions WHERE scope <> 'owner' AND scope NOT IN (SELECT id FROM share_links WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?))").bind(at));
  await db.batch(stmts);

  return { versions: versionIds.length, tracks: trackIds.length, folders: folderIds.length, artists: artistIds.length, comments: commentIds.length };
}

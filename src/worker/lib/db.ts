import type { ArtistDTO, FolderDTO, TrackDTO, VersionDTO } from "../../shared/api-types";
import type { ProjectKind } from "../../shared/constants";
import { notFound } from "./errors";

// Row shapes as stored in D1 and their mapping to API DTOs.

export interface ArtistRow {
  id: string;
  name: string;
  description: string;
  color: string;
  photo_key: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

/** A folder; with parent_id NULL it is one of the artist's projects. */
export interface FolderRow {
  id: string;
  artist_id: string;
  parent_id: string | null;
  name: string;
  icon: string;
  color: string;
  position: number;
  /** Projects only: a release (cover) or a working folder (icon). */
  kind: ProjectKind;
  artwork_key: string | null;
  year: number | null;
  label: string;
  description: string;
  updated_at: number;
}

export interface TrackRow {
  id: string;
  artist_id: string;
  folder_id: string | null;
  title: string;
  /** The owner's DAW project name ("" when unset). */
  session_name: string;
  /** The track's own cover; null: its project's. */
  artwork_key: string | null;
  position: number;
  has_lyrics: number;
  created_at: number;
  updated_at: number;
}

export interface VersionRow {
  id: string;
  track_id: string;
  number: number;
  /** The name it carried from the track it was (owner only); null: never named. */
  name: string | null;
  label: string;
  notes: string;
  status: "pending" | "ready";
  r2_key: string;
  format: "wav" | "mp3";
  original_filename: string;
  size_bytes: number;
  duration_s: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  bitrate_kbps: number | null;
  lufs_integrated: number | null;
  lufs_range: number | null;
  true_peak_dbtp: number | null;
  created_at: number;
}

/** Everything but the (large) peaks column. */
export const VERSION_COLS =
  "id, track_id, number, name, label, notes, status, r2_key, format, original_filename, size_bytes, duration_s, sample_rate, bit_depth, channels, bitrate_kbps, lufs_integrated, lufs_range, true_peak_dbtp, created_at";

export const ARTIST_COLS = "id, name, description, color, photo_key, position, created_at, updated_at";
export const FOLDER_COLS = "id, artist_id, parent_id, name, icon, color, position, kind, artwork_key, year, label, description, updated_at";
const TRACK_COLS = "id, artist_id, folder_id, title, session_name, artwork_key, position, lyrics_lrc IS NOT NULL AS has_lyrics, created_at, updated_at";

export const artistDTO = (r: ArtistRow, photoBase: string): ArtistDTO => ({
  id: r.id,
  name: r.name,
  description: r.description,
  color: r.color,
  photoUrl: r.photo_key ? `${photoBase}?v=${r.updated_at}` : null,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** `artworkBase(id)` builds the cover URL for the caller (owner API or share link). */
export const folderDTO = (r: FolderRow, artworkBase: (id: string) => string = (id) => `/api/admin/folders/${id}/artwork`): FolderDTO => ({
  id: r.id,
  artistId: r.artist_id,
  parentId: r.parent_id,
  name: r.name,
  icon: r.icon,
  color: r.color,
  position: r.position,
  kind: r.kind,
  // Only a release shows its cover (a working project keeps it stored, unseen).
  artworkUrl: r.artwork_key && !r.parent_id && r.kind === "release" ? `${artworkBase(r.id)}?v=${r.updated_at}` : null,
  year: r.year,
  label: r.label,
  description: r.description,
  updatedAt: r.updated_at,
});

export const versionDTO = (r: VersionRow): VersionDTO => ({
  id: r.id,
  trackId: r.track_id,
  number: r.number,
  name: r.name,
  label: r.label,
  notes: r.notes,
  format: r.format,
  originalFilename: r.original_filename,
  sizeBytes: r.size_bytes,
  durationS: r.duration_s ?? 0,
  sampleRate: r.sample_rate ?? 0,
  bitDepth: r.bit_depth,
  channels: r.channels ?? 0,
  bitrateKbps: r.bitrate_kbps ?? 0,
  lufsIntegrated: r.lufs_integrated,
  lufsRange: r.lufs_range,
  truePeakDbtp: r.true_peak_dbtp,
  createdAt: r.created_at,
});

export const trackDTO = (r: TrackRow, versions: VersionDTO[], counts?: { open: number; visible: number }): TrackDTO => ({
  id: r.id,
  artistId: r.artist_id,
  folderId: r.folder_id,
  title: r.title,
  sessionName: r.session_name,
  artworkUrl: r.artwork_key ? `/api/admin/tracks/${r.id}/artwork?v=${r.updated_at}` : null,
  position: r.position,
  hasLyrics: !!r.has_lyrics,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  versions,
  openRequests: counts?.open ?? 0,
  commentCount: counts?.visible ?? 0,
});

export async function getArtist(db: D1Database, id: string): Promise<ArtistRow> {
  const row = await db.prepare(`SELECT ${ARTIST_COLS} FROM artists WHERE id = ? AND deleted_at IS NULL`).bind(id).first<ArtistRow>();
  if (!row) throw notFound("Artista não encontrado.");
  return row;
}

export async function getFolder(db: D1Database, id: string, artistId?: string): Promise<FolderRow> {
  const row = await db
    .prepare(`SELECT ${FOLDER_COLS} FROM folders f WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM artists a WHERE a.id = f.artist_id AND a.deleted_at IS NULL)`)
    .bind(id)
    .first<FolderRow>();
  if (!row || (artistId && row.artist_id !== artistId)) throw notFound(row?.parent_id === null ? "Projeto não encontrado." : "Pasta não encontrada.");
  return row;
}

export async function getTrack(db: D1Database, id: string): Promise<TrackRow> {
  const row = await db
    .prepare(`SELECT ${TRACK_COLS} FROM tracks t WHERE id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM artists a WHERE a.id = t.artist_id AND a.deleted_at IS NULL)`)
    .bind(id)
    .first<TrackRow>();
  if (!row) throw notFound("Faixa não encontrada.");
  return row;
}

export async function getVersion(db: D1Database, id: string): Promise<VersionRow> {
  const row = await db
    .prepare(
      `SELECT ${VERSION_COLS} FROM versions v WHERE id = ? AND deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.id = v.track_id AND t.deleted_at IS NULL AND a.deleted_at IS NULL)`,
    )
    .bind(id)
    .first<VersionRow>();
  if (!row) throw notFound("Versão não encontrada.");
  return row;
}

/** Live folders, tracks and ready versions of one artist. */
export async function loadArtistTree(db: D1Database, artistId: string) {
  const [folders, tracks, versions] = await db.batch([
    db.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE artist_id = ? AND deleted_at IS NULL ORDER BY position`).bind(artistId),
    db.prepare(`SELECT ${TRACK_COLS} FROM tracks WHERE artist_id = ? AND deleted_at IS NULL ORDER BY position`).bind(artistId),
    db
      .prepare(
        `SELECT ${VERSION_COLS.replace(/(^|, )/g, "$1v.")} FROM versions v JOIN tracks t ON t.id = v.track_id
         WHERE t.artist_id = ? AND t.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'ready'
         ORDER BY v.number DESC`,
      )
      .bind(artistId),
  ]);
  return {
    folders: folders!.results as unknown as FolderRow[],
    tracks: tracks!.results as unknown as TrackRow[],
    versions: versions!.results as unknown as VersionRow[],
  };
}

/** Next position at the end of a container (artist root or folder). */
export async function nextPosition(db: D1Database, table: "tracks" | "folders", artistId: string, parentId: string | null): Promise<number> {
  const col = table === "tracks" ? "folder_id" : "parent_id";
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${table} WHERE artist_id = ? AND ${col} IS ? AND deleted_at IS NULL`)
    .bind(artistId, parentId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The project (top-level folder) that contains a folder, or the folder itself if it is one. */
export async function projectOf(db: D1Database, folderId: string | null): Promise<FolderRow | null> {
  if (!folderId) return null;
  const row = await db
    .prepare(
      `WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM folders WHERE id = ?1
         UNION ALL SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
       )
       SELECT ${FOLDER_COLS} FROM folders WHERE id = (SELECT id FROM up WHERE parent_id IS NULL)`,
    )
    .bind(folderId)
    .first<FolderRow>();
  return row ?? null;
}

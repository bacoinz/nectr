import type { VersionRow } from "./db";

const clean = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim();

/** "Artista - Título (v3 — vocals up).wav", safe on Windows and macOS. */
export async function downloadName(db: D1Database, v: Pick<VersionRow, "track_id" | "number" | "label" | "format">): Promise<string> {
  const row = await db
    .prepare("SELECT t.title, a.name AS artist FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.id = ?")
    .bind(v.track_id)
    .first<{ title: string; artist: string }>();
  const version = `v${v.number}${v.label ? ` — ${v.label}` : ""}`;
  const title = clean(row?.title ?? "faixa");
  const artist = clean(row?.artist ?? "");
  return `${artist ? `${artist} - ` : ""}${title} (${clean(version)}).${v.format}`;
}

import type { LyricsResponse } from "../../shared/api-types";
import { parseLrc, type LyricLine } from "../../shared/lrc";
import { api } from "../lib/api";

// Lyrics of a version, fetched once per page visit.
const cache = new Map<string, Promise<LyricLine[]>>();

export function loadLyrics(url: string): Promise<LyricLine[]> {
  let p = cache.get(url);
  if (!p) {
    p = api<LyricsResponse>(url)
      .then((r) => (r.lrc ? parseLrc(r.lrc) : []))
      .catch(() => {
        cache.delete(url);
        return [];
      });
    cache.set(url, p);
  }
  return p;
}

/** After the owner edits lyrics, previews read them again. */
export const clearLyricsCache = () => cache.clear();

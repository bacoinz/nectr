import type { ArtistResponse, FolderDTO, TrackDTO } from "../../../shared/api-types";

// Read-only helpers over an ArtistResponse. Top-level folders are projects.

export const subfolders = (a: ArtistResponse, parent: string | null) =>
  a.folders.filter((f) => f.parentId === parent).sort((x, y) => x.position - y.position);

export const projectsOf = (a: ArtistResponse) => subfolders(a, null);

export const tracksIn = (a: ArtistResponse, folderId: string | null) =>
  a.tracks.filter((t) => t.folderId === folderId).sort((x, y) => x.position - y.position);

export function tracksUnder(a: ArtistResponse, folderId: string): TrackDTO[] {
  return [...tracksIn(a, folderId), ...subfolders(a, folderId).flatMap((f) => tracksUnder(a, f.id))];
}

export function folderPath(a: ArtistResponse, id: string | null): FolderDTO[] {
  const out: FolderDTO[] = [];
  let f = id ? a.folders.find((x) => x.id === id) : undefined;
  while (f) {
    out.unshift(f);
    f = f.parentId ? a.folders.find((x) => x.id === f!.parentId) : undefined;
  }
  return out;
}

/** The project (top-level folder) containing a folder, or the folder itself. */
export const projectOf = (a: ArtistResponse, folderId: string | null): FolderDTO | null => folderPath(a, folderId)[0] ?? null;

/** Folder ids under `id`, inclusive. */
export function folderSubtree(a: ArtistResponse, id: string): Set<string> {
  const out = new Set([id]);
  for (const f of subfolders(a, id)) for (const x of folderSubtree(a, f.id)) out.add(x);
  return out;
}

export const latest = (t: TrackDTO) => t.versions[0]!;
export const trackDuration = (t: TrackDTO) => latest(t).durationS;

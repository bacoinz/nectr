import type { GuestFolderDTO, GuestInfoDTO, GuestTrackDTO } from "../../shared/api-types";
import { guest } from "../comments/guest.svelte";
import { guestSource, type CommentsSource } from "../comments/source";
import { inkFor } from "../lib/format";
import { linkPush, type PushTarget } from "../lib/push";
import { router } from "../router.svelte";

// Helpers shared by the guest desktop and phone layouts.

export interface GuestUrls {
  base: string;
  track: (id: string) => string;
  /** A folder page (null: the link's top level). */
  folder: (id: string | null) => string;
  audio: (versionId: string) => string;
  peaks: (versionId: string) => string;
  download: (versionId: string) => string;
  /** Comments as this device (or read-only in the owner's preview). */
  comments: CommentsSource;
  /** A version's lyrics (JSON { lrc }). */
  lyrics: (versionId: string) => string;
  /** Notifications for this link on this device (none in the owner's preview). */
  push: PushTarget | null;
  /** Where a guest's shares of this link live (none in the owner's preview). */
  shares: string | null;
}

export const guestUrls = (token: string): GuestUrls => ({
  base: `/s/${token}`,
  track: (id: string) => `/s/${token}/t/${id}`,
  folder: (id: string | null) => (id ? `/s/${token}/f/${id}` : `/s/${token}`),
  audio: (versionId: string) => `/s/${token}/audio/${versionId}`,
  peaks: (versionId: string) => `/s/${token}/api/peaks/${versionId}`,
  download: (versionId: string) => `/s/${token}/download/${versionId}`,
  comments: guestSource(token, () => guest.me),
  lyrics: (versionId: string) => `/s/${token}/api/lyrics/${versionId}`,
  push: linkPush(token, () => guest.me),
  shares: `/s/${token}/api/shares`,
});

// ---------- Folders, as the guest browses them ----------
// A link opens on its top level: an artist link shows its projects (albums and
// EPs first) and loose tracks, a project or folder link its tracks and the
// folders inside, closed. A folder opens on a page of its own; one inside a
// project only shows inside that project. When the top level holds a single
// folder and nothing else, the link opens straight into it.

export interface Shelf {
  /** The folder on screen; null at the top of an artist link. */
  folder: GuestFolderDTO | null;
  /** Whether this is the link's top level (no way back). */
  top: boolean;
  /** Where "back" goes: a folder id, or null for the top. */
  upId: string | null;
  upName: string;
  folders: GuestFolderDTO[];
  tracks: GuestTrackDTO[];
}

const isRelease = (f: GuestFolderDTO) => !f.parentId && f.kind === "release";

/** Tracks in a folder and all the folders under it. */
export function countUnder(info: GuestInfoDTO, folderId: string): number {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of info.folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
  }
  return info.tracks.filter((t) => t.folderId && ids.has(t.folderId)).length;
}

const tracksAt = (info: GuestInfoDTO, folderId: string | null) => info.tracks.filter((t) => (t.folderId ?? null) === folderId);

/** The folders shown (closed) inside a folder, or at an artist link's top: never empty ones. */
function foldersAt(info: GuestInfoDTO, folderId: string | null): GuestFolderDTO[] {
  const list = info.folders.filter((f) => (f.parentId ?? null) === folderId && countUnder(info, f.id) > 0).sort((a, b) => a.position - b.position);
  // At the artist's level, albums and EPs before the working projects.
  return folderId === null ? [...list.filter(isRelease), ...list.filter((f) => !isRelease(f))] : list;
}

/** A project or folder link's own folder: the one whose parent the link does not show. */
export function linkFolderId(info: GuestInfoDTO): string | null {
  if (info.link.type !== "project" && info.link.type !== "folder") return null;
  const ids = new Set(info.folders.map((f) => f.id));
  return info.folders.find((f) => !f.parentId || !ids.has(f.parentId))?.id ?? null;
}

/** The link's top level: its own folder (project/folder links) or null (artist), opened through single folders. */
export function topOf(info: GuestInfoDTO): string | null {
  let top = linkFolderId(info);
  for (;;) {
    const kids = foldersAt(info, top);
    if (tracksAt(info, top).length || kids.length !== 1) return top;
    top = kids[0]!.id;
  }
}

/** What a folder page shows; a folder outside the link (or above its top) shows the top. */
export function shelfFor(info: GuestInfoDTO, folderId: string | null): Shelf {
  // A track link is that one track, whatever folder it lives in.
  if (info.link.type === "track") return { folder: null, top: true, upId: null, upName: "", folders: [], tracks: info.tracks };
  const top = topOf(info);
  const byId = new Map(info.folders.map((f) => [f.id, f]));
  // Only folders under the top level can open.
  let at: string | null = top;
  if (folderId && byId.has(folderId)) {
    for (let f = byId.get(folderId); f; f = f.parentId ? byId.get(f.parentId) : undefined) {
      if (f.id === top || (top === null && !f.parentId)) {
        at = folderId;
        break;
      }
    }
  }
  const folder = at ? byId.get(at)! : null;
  const isTop = at === top;
  const upId = isTop || !folder?.parentId || folder.parentId === top ? top : folder.parentId;
  const upName = isTop ? "" : upId ? (byId.get(upId)?.name ?? "") : info.hero.name;
  return { folder, top: isTop, upId, upName, folders: foldersAt(info, at), tracks: tracksAt(info, at) };
}

/** A track's cover: its own, else its project's (a release), else the link's. */
export function trackCover(info: GuestInfoDTO, t: GuestTrackDTO): string | null {
  if (t.artworkUrl) return t.artworkUrl;
  const byId = new Map(info.folders.map((f) => [f.id, f]));
  let f = t.folderId ? byId.get(t.folderId) : undefined;
  while (f?.parentId && byId.has(f.parentId)) f = byId.get(f.parentId);
  return (f && !f.parentId && f.kind === "release" ? f.artworkUrl : null) ?? info.hero.artworkUrl;
}

export const projStyle = (color: string) => `--proj-main:${color};--proj-ink:${inkFor(color)}`;

/** Current URL with one query parameter replaced (keeps ?t= in the owner preview). */
export function withParam(key: string, value: string) {
  const q = router.query;
  q.set(key, value);
  return `${router.path}?${q}`;
}

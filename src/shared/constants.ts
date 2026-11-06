// Values shared by the Worker (validation) and the browser (UI).

/**
 * 24 project colours: two rows in hue order, bright then deeper/softer (the
 * first 12 are the original ones, so stored colours stay valid). Folders may
 * also use FOLDER_GREY.
 */
export const PROJECT_COLORS = [
  "#ff5d5d", "#ff7a59", "#ff9f43", "#f4b740", "#c6d94a", "#7bd389",
  "#2ec4b6", "#36b7e0", "#3f8fe8", "#6f7bf7", "#9d8cff", "#ff6b9d",
  "#c94b4b", "#e0875f", "#d9a05b", "#e8d36a", "#93c572", "#3fa36a",
  "#1f9e90", "#7fd6ea", "#5b7fd6", "#8a6fe8", "#c77dff", "#ff9fc8",
] as const;
export const FOLDER_GREY = "#a6a1b3";
export const FOLDER_COLORS = [...PROJECT_COLORS, FOLDER_GREY] as const;

export const FOLDER_ICONS = [
  "folder", "disc", "mic", "ticket", "star", "headphones",
  "note", "wave", "heart", "flame", "moon", "sun",
] as const;
export type FolderIcon = (typeof FOLDER_ICONS)[number];

/**
 * What a project (an artist's top-level folder) is: a release (album, EP,
 * single), shown with its cover, or a working folder (WIP songs, a live
 * project, anything else), shown with an icon like the folders inside.
 */
export const PROJECT_KINDS = ["release", "wip", "live", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
/** The icon a project of each kind starts with. */
export const KIND_ICONS: Record<ProjectKind, FolderIcon> = { release: "disc", wip: "wave", live: "mic", other: "folder" };

export const LIMITS = {
  /** Audio uploads go straight to R2; the Worker re-checks the size on finalize. */
  maxUploadBytes: 200 * 1024 * 1024,
  /** Artwork and profile photos are resized in the browser before upload. */
  maxImageBytes: 2 * 1024 * 1024,
  /** Upper bound for the base64 peaks string (16 384 pairs → ~44 KB). */
  maxPeaksChars: 64 * 1024,
  nameMax: 120,
  descriptionMax: 2000,
  notesMax: 2000,
  commentMax: 2000,
  /** Voice notes: 1 minute, about 0.5 MB in AAC/Opus; the cap leaves room for high bitrates. */
  voiceMaxSeconds: 60,
  voiceMaxBytes: 1.5 * 1024 * 1024,
  guestNameMax: 60,
  /** LRC text of one song (a long song with timestamps is a few KB). */
  lyricsMax: 64 * 1024,
} as const;

/** Containers MediaRecorder produces, in order of preference (Safari/Chrome AAC first). */
export const VOICE_TYPES = ["audio/mp4", "audio/webm", "audio/ogg"] as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

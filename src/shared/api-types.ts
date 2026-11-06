// JSON shapes exchanged between the Worker and the SPA. Timestamps are epoch ms.
//
// The library is organised by artist. An artist's top-level folders are its
// projects (albums, EPs, singles: cover, year, label, description); folders
// inside a project are plain folders. Tracks live in a project, in a folder,
// or loose at the artist's root.

export interface ProfileDTO {
  name: string;
  photoUrl: string | null;
}

export interface MeResponse {
  email: string;
  profile: ProfileDTO;
}

export interface ArtistDTO {
  id: string;
  name: string;
  description: string;
  color: string;
  photoUrl: string | null;
  /** Order on the home page (the owner's). */
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryArtistDTO extends ArtistDTO {
  projectCount: number;
  trackCount: number;
  versionCount: number;
  /** Guest requests not done yet. */
  openRequests: number;
}

export interface StorageDTO {
  /** Audio of the versions in the library. */
  audioBytes: number;
  /** Versions in the library (ready, nothing above them deleted). */
  versionCount: number;
  /** Deleted (or never finished) audio still in R2 until the daily clean-up removes it. */
  trashBytes: number;
  /** When the last of it goes; null when there is none. */
  trashUntil: number | null;
  /** Voice notes in comments. */
  voiceBytes: number;
  limitBytes: number;
}

export interface LibraryResponse {
  artists: LibraryArtistDTO[];
  storage: StorageDTO;
  /** Guest requests not done yet, across the library (the "Revisões" counter). */
  openRequests: number;
  /** Latest guest comments, newest first. */
  activity: ActivityDTO[];
}

export interface ActivityDTO {
  id: string;
  /** "reply" for an answer in a thread, "voice" for a voice note. */
  kind: "comment" | "reply" | "voice";
  author: string;
  artistId: string;
  artistName: string;
  trackId: string;
  trackTitle: string;
  versionId: string;
  versionNumber: number;
  createdAt: number;
}

/** A folder; with `parentId === null` it is one of the artist's projects. */
export interface FolderDTO {
  id: string;
  artistId: string;
  parentId: string | null;
  name: string;
  icon: string;
  color: string;
  position: number;
  /** For a project (top-level folder): a release with a cover, or a working folder with an icon. */
  kind: "release" | "wip" | "live" | "other";
  /** Project details (top-level releases only). */
  artworkUrl: string | null;
  year: number | null;
  label: string;
  description: string;
  updatedAt: number;
}

export interface VersionDTO {
  id: string;
  trackId: string;
  number: number;
  /** The name it carried from the track it was, when merged into another (owner only); null: the file name stands. */
  name: string | null;
  label: string;
  notes: string;
  format: "wav" | "mp3";
  originalFilename: string;
  sizeBytes: number;
  durationS: number;
  sampleRate: number;
  bitDepth: number | null;
  channels: number;
  bitrateKbps: number;
  lufsIntegrated: number | null;
  lufsRange: number | null;
  truePeakDbtp: number | null;
  createdAt: number;
}

export interface TrackDTO {
  id: string;
  artistId: string;
  folderId: string | null;
  title: string;
  /** The owner's DAW project name ("" when unset); never sent to a share link. */
  sessionName: string;
  /** The track's own cover (else its project's). */
  artworkUrl: string | null;
  position: number;
  hasLyrics: boolean;
  createdAt: number;
  updatedAt: number;
  /** Ready versions, newest first. A track with no ready version is not listed. */
  versions: VersionDTO[];
  /** Guest requests not done yet. */
  openRequests: number;
  /** Top-level comments a guest can see (all versions). */
  commentCount: number;
}

export interface ArtistResponse {
  artist: ArtistDTO;
  folders: FolderDTO[];
  tracks: TrackDTO[];
}

export interface UploadRequest {
  artistId: string;
  folderId?: string | null;
  /** Upload as a new version of this track instead of creating a track. */
  trackId?: string;
  filename: string;
  size: number;
}

export interface UploadResponse {
  trackId: string;
  versionId: string;
  number: number;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

export interface LoudnessDTO {
  /** LUFS, null for silence. */
  integrated: number | null;
  /** LU. */
  range: number | null;
  /** dBTP. */
  truePeak: number | null;
}

/** A track's lyrics (LRC text): for every version, plus per-version timing where it differs. */
export interface TrackLyricsDTO {
  track: string | null;
  /** versionId → LRC used instead of the track's for that version. */
  overrides: Record<string, string>;
}

export interface LyricsUpdateRequest {
  /** null removes them. */
  lrc: string | null;
  /** Only for this version (its timing differs); without it, for the whole track. */
  versionId?: string | null;
}

/** The lyrics a version shows (its own timing, or the track's). */
export interface LyricsResponse {
  lrc: string | null;
}

export interface FinalizeRequest {
  /** base64 of int8 min/max pairs (see src/shared/peaks.ts). */
  peaks: string;
  /** Measured in the browser (src/shared/loudness.ts); optional so an old tab can still finish. */
  loudness?: LoudnessDTO;
}

export interface PeaksResponse {
  peaks: string | null;
}

export interface ItemsRequest {
  trackIds?: string[];
  folderIds?: string[];
  versionIds?: string[];
}

export interface DeleteResponse {
  /** Pass back to the restore endpoint to undo this delete. */
  batch: number;
}

/** Where a merged version came from: what undoing the merge puts back. */
export interface MergedVersion {
  versionId: string;
  trackId: string;
  number: number;
  /** Its name before the merge (undo puts it back). */
  name: string | null;
}

export interface MergeResponse {
  /** The emptied tracks were soft-deleted with this timestamp. */
  batch: number;
  moved: MergedVersion[];
  artist: ArtistResponse;
}

export interface SplitResponse {
  /** The new track that now holds the version. */
  trackId: string;
  /** Where the version was: what undoing the split puts back. */
  from: { trackId: string; number: number };
  artist: ArtistResponse;
}

// ---------- Comments ----------

export type CommentStatus = "open" | "done";

export interface CommentDTO {
  id: string;
  trackId: string;
  versionId: string;
  versionNumber: number;
  /** The thread's top-level comment; null for a top-level comment. Replies share its version and time. */
  parentId: string | null;
  author: { kind: "owner" | "guest"; name: string };
  /** Written by whoever is looking: the owner, or this guest's device. */
  mine: boolean;
  body: string;
  tStart: number;
  tEnd: number | null;
  /** Meaningful for requests (top-level guest comments). */
  status: CommentStatus;
  resolvedInVersionId: string | null;
  resolvedInNumber: number | null;
  /** Owner notes only: seen by the owner alone. */
  isPrivate: boolean;
  voice: { durationS: number; mime: string } | null;
  /** Owner view: the link a guest comment came through. */
  via: string | null;
  createdAt: number;
  updatedAt: number;
  editedAt: number | null;
  /** Whoever is looking may change the text: the owner their own anytime, a guest their own on the same day. */
  canEdit: boolean;
}

export interface CommentsResponse {
  comments: CommentDTO[];
  /** Ids deleted since `since` (only when `since` was sent). */
  removed: string[];
  /** Pass back as `since` on the next poll. */
  now: number;
}

export interface CommentCreateRequest {
  versionId: string;
  /** Reply to any message of a thread; it joins the top-level comment's thread. */
  parentId?: string | null;
  body?: string;
  tStart: number;
  tEnd?: number | null;
  /** Owner only. */
  isPrivate?: boolean;
}

export interface CommentUpdateRequest {
  /** New text (own text messages only). */
  body?: string;
  status?: CommentStatus;
  /** With status "done": the version that resolved it (default: the newest). */
  resolvedInVersionId?: string;
}

/** Kept by the guest's browser; the secret lets this device rename itself and delete its own comments. */
export interface GuestIdentity {
  id: string;
  name: string;
  secret: string;
}

export interface RevisionTrackDTO {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  projectName: string | null;
  folderName: string | null;
  color: string;
  artworkUrl: string | null;
  /** Ready versions, newest first. */
  versions: { id: string; number: number }[];
}

export interface RevisionsResponse {
  tracks: RevisionTrackDTO[];
  /** Guest requests (top-level guest comments), newest first. */
  items: CommentDTO[];
  /** The answers in those threads, oldest first. */
  replies: CommentDTO[];
}

/** Everything findable by name, for the search box (filtered in the browser). */
export interface SearchIndexDTO {
  artists: { id: string; name: string }[];
  folders: { id: string; artistId: string; parentId: string | null; name: string }[];
  tracks: { id: string; artistId: string; folderId: string | null; title: string; sessionName: string }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---------- Share links ----------

/** "project" is a top-level folder, "folder" a folder inside a project. */
export type LinkTargetType = "artist" | "project" | "folder" | "track";
export type VersionMode = "all" | "latest" | "selected";
export type LinkStatus = "active" | "expired" | "revoked";

/** Someone who gave a name on a link (one per device). */
export interface LinkGuestDTO {
  id: string;
  name: string;
  /** When the name was given. */
  createdAt: number;
  /** Last time this device used the link (to within an hour). */
  lastSeenAt: number;
  /** Comments and replies still there. */
  comments: number;
}

export interface LinkDTO {
  id: string;
  /** Path to share, e.g. /s/Qm7xR2pLd9Vf_k3TzA8wYg */
  path: string;
  name: string;
  target: { type: LinkTargetType; id: string; name: string; artistId: string; artistName: string };
  versionMode: VersionMode;
  versionIds: string[];
  hasPassword: boolean;
  allowDownload: boolean;
  showLyrics: boolean;
  allowComments: boolean;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  lastViewedAt: number | null;
  status: LinkStatus;
  /** The people who gave a name on this link, most recent first (links with comments ask for one). */
  guests: LinkGuestDTO[];
  /** Guests of this link may share a track or folder of it. */
  allowShare: boolean;
  /** Set on a share a guest made: the link it came from (it follows that link's settings). */
  parentId: string | null;
  /** The guest who made this share. */
  createdBy: string | null;
}

/** A share a guest made from a link (their own list on that link). */
export interface GuestShareDTO {
  id: string;
  path: string;
  name: string;
  target: { type: "track" | "folder"; name: string };
  createdAt: number;
}

export interface LinkCreateRequest {
  /** Projects and folders are both sent as "folder". */
  target: { type: "artist" | "folder" | "track"; id: string };
  name: string;
  /** Empty or missing = no password. */
  password?: string;
  expiresAt?: number | null;
  versionMode?: VersionMode;
  versionIds?: string[];
  allowDownload?: boolean;
  showLyrics?: boolean;
  allowComments?: boolean;
  /** Guests may share a track or folder of the link. */
  allowShare?: boolean;
}

export interface LinkUpdateRequest {
  name?: string;
  /** null removes the password. */
  password?: string | null;
  expiresAt?: number | null;
  versionMode?: VersionMode;
  versionIds?: string[];
  allowDownload?: boolean;
  showLyrics?: boolean;
  allowComments?: boolean;
  allowShare?: boolean;
  revoked?: boolean;
}

// ---------- Guest (share page) ----------

export type GuestVersionDTO = Omit<VersionDTO, "originalFilename" | "name">;

export interface GuestTrackDTO {
  id: string;
  folderId: string | null;
  title: string;
  /** The track's own cover (else its project's). */
  artworkUrl: string | null;
  /** Newest first, already filtered by the link's version mode. */
  versions: GuestVersionDTO[];
  /** Top-level comments this link can see (0 when comments are off). */
  commentCount: number;
}

export interface GuestArtistDTO {
  name: string;
  description: string;
  color: string;
  photoUrl: string | null;
}

export type GuestFolderDTO = Pick<FolderDTO, "id" | "parentId" | "name" | "icon" | "color" | "position" | "kind" | "artworkUrl" | "year" | "label" | "description">;

/** What the page header shows: the artist (artist link) or the project the link belongs to. */
export interface GuestHeroDTO {
  name: string;
  /** Artist name, or "Projeto · Artista" for a folder. */
  subtitle: string;
  color: string;
  artworkUrl: string | null;
  /** A working project (WIP, live…) or a folder is shown with this icon instead of a cover. */
  icon: string | null;
  description: string;
}

/** Answer to GET /s/:token/api/info when the link has a password and no valid cookie (401). */
export interface GuestGateDTO {
  hero: GuestHeroDTO;
}

export interface GuestInfoDTO {
  link: { type: LinkTargetType; allowDownload: boolean; showLyrics: boolean; allowComments: boolean; expiresAt: number | null; allowShare: boolean };
  artist: GuestArtistDTO;
  hero: GuestHeroDTO;
  ownerName: string;
  /** Folders inside the shared scope; for an artist link, its projects and their folders. */
  folders: GuestFolderDTO[];
  tracks: GuestTrackDTO[];
}

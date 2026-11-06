import type * as T from "../../shared/api-types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** Fetches a JSON API route. Error messages come from the Worker, already in pt-PT. */
export async function api<R>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<R> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      // An expired Access session answers with a redirect to the login page.
      redirect: "manual",
      headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "offline", navigator.onLine === false ? "Sem ligação à internet. Tenta outra vez quando voltar." : "Não foi possível falar com o servidor. Tenta outra vez.");
  }
  if (res.type === "opaqueredirect" || (res.status === 401 && path.startsWith("/api/admin"))) {
    throw new ApiError(401, "session_expired", "Sessão expirada. Recarrega a página para voltar a entrar.");
  }
  if (res.status === 204) return undefined as R;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? "Ocorreu um erro inesperado.", body);
  }
  return body as R;
}

const A = "/api/admin";

type FolderFields = { name?: string; parentId?: string | null; icon?: string; color?: string; kind?: T.FolderDTO["kind"]; year?: number | null; label?: string; description?: string };

/** Typed owner API. */
export const admin = {
  me: () => api<T.MeResponse>(`${A}/me`),
  library: () => api<T.LibraryResponse>(`${A}/library`),
  searchIndex: () => api<T.SearchIndexDTO>(`${A}/search-index`),
  createArtist: (name: string) => api<T.ArtistResponse>(`${A}/artists`, { method: "POST", json: { name } }),
  artist: (id: string) => api<T.ArtistResponse>(`${A}/artists/${id}`),
  updateArtist: (id: string, patch: Partial<Pick<T.ArtistDTO, "name" | "description" | "color">>) => api<T.ArtistResponse>(`${A}/artists/${id}`, { method: "PATCH", json: patch }),
  deleteArtist: (id: string) => api<T.DeleteResponse>(`${A}/artists/${id}`, { method: "DELETE" }),
  restoreArtist: (id: string, batch: number) => api<T.ArtistResponse>(`${A}/artists/${id}/restore`, { method: "POST", json: { batch } }),
  putArtistPhoto: (id: string, blob: Blob) => api<T.ArtistResponse>(`${A}/artists/${id}/photo`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } }),
  deleteArtistPhoto: (id: string) => api<T.ArtistResponse>(`${A}/artists/${id}/photo`, { method: "DELETE" }),
  createFolder: (artistId: string, body: FolderFields & { name: string }) => api<T.FolderDTO>(`${A}/artists/${artistId}/folders`, { method: "POST", json: body }),
  updateFolder: (id: string, body: FolderFields) => api<T.FolderDTO>(`${A}/folders/${id}`, { method: "PATCH", json: body }),
  putCover: (folderId: string, blob: Blob) => api<T.ArtistResponse>(`${A}/folders/${folderId}/artwork`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } }),
  deleteCover: (folderId: string) => api<T.ArtistResponse>(`${A}/folders/${folderId}/artwork`, { method: "DELETE" }),
  putTrackCover: (trackId: string, blob: Blob) => api<T.ArtistResponse>(`${A}/tracks/${trackId}/artwork`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } }),
  deleteTrackCover: (trackId: string) => api<T.ArtistResponse>(`${A}/tracks/${trackId}/artwork`, { method: "DELETE" }),
  reorderArtists: (ids: string[]) => api<void>(`${A}/artists/reorder`, { method: "POST", json: { ids } }),
  renameTrack: (id: string, title: string, sessionName: string) => api<{ ok: true }>(`${A}/tracks/${id}`, { method: "PATCH", json: { title, sessionName } }),
  updateVersion: (id: string, body: { label?: string; notes?: string }) => api<T.VersionDTO>(`${A}/versions/${id}`, { method: "PATCH", json: body }),
  peaks: (versionId: string) => api<T.PeaksResponse>(`${A}/versions/${versionId}/peaks`),
  deleteItems: (artistId: string, items: T.ItemsRequest) => api<T.DeleteResponse>(`${A}/artists/${artistId}/delete`, { method: "POST", json: items }),
  restoreItems: (artistId: string, batch: number) => api<T.ArtistResponse>(`${A}/artists/${artistId}/restore-items`, { method: "POST", json: { batch } }),
  move: (artistId: string, body: { trackIds?: string[]; folderIds?: string[]; toFolderId: string | null }) =>
    api<T.ArtistResponse>(`${A}/artists/${artistId}/move`, { method: "POST", json: body }),
  reorder: (artistId: string, body: { kind: "tracks" | "folders"; parentId: string | null; ids: string[] }) =>
    api<T.ArtistResponse>(`${A}/artists/${artistId}/reorder`, { method: "POST", json: body }),
  merge: (artistId: string, trackIds: string[], intoTrackId: string) => api<T.MergeResponse>(`${A}/artists/${artistId}/merge`, { method: "POST", json: { trackIds, intoTrackId } }),
  unmerge: (artistId: string, r: Pick<T.MergeResponse, "batch" | "moved">) => api<T.ArtistResponse>(`${A}/artists/${artistId}/unmerge`, { method: "POST", json: { batch: r.batch, moved: r.moved } }),
  split: (artistId: string, versionId: string) => api<T.SplitResponse>(`${A}/artists/${artistId}/split`, { method: "POST", json: { versionId } }),
  unsplit: (artistId: string, r: Pick<T.SplitResponse, "trackId" | "from">) => api<T.ArtistResponse>(`${A}/artists/${artistId}/unsplit`, { method: "POST", json: { trackId: r.trackId, from: r.from } }),
  startUpload: (body: T.UploadRequest) => api<T.UploadResponse>(`${A}/uploads`, { method: "POST", json: body }),
  trackLyrics: (trackId: string) => api<T.TrackLyricsDTO>(`${A}/tracks/${trackId}/lyrics`),
  putLyrics: (trackId: string, body: T.LyricsUpdateRequest) => api<T.ArtistResponse>(`${A}/tracks/${trackId}/lyrics`, { method: "PUT", json: body }),
  putLoudness: (versionId: string, body: T.LoudnessDTO) => api<T.VersionDTO>(`${A}/versions/${versionId}/loudness`, { method: "PUT", json: body }),
  finalize: (versionId: string, body: T.FinalizeRequest) => api<T.VersionDTO>(`${A}/versions/${versionId}/finalize`, { method: "POST", json: body }),
  cancelUpload: (versionId: string) => api<void>(`${A}/uploads/${versionId}`, { method: "DELETE" }),
  updateProfile: (name: string) => api<T.ProfileDTO>(`${A}/profile`, { method: "PATCH", json: { name } }),
  putPhoto: (blob: Blob) => api<T.ProfileDTO>(`${A}/profile/photo`, { method: "PUT", body: blob, headers: { "Content-Type": blob.type } }),
  deletePhoto: () => api<T.ProfileDTO>(`${A}/profile/photo`, { method: "DELETE" }),
  links: () => api<{ links: T.LinkDTO[] }>(`${A}/links`),
  createLink: (body: T.LinkCreateRequest) => api<T.LinkDTO>(`${A}/links`, { method: "POST", json: body }),
  updateLink: (id: string, body: T.LinkUpdateRequest) => api<T.LinkDTO>(`${A}/links/${id}`, { method: "PATCH", json: body }),
};

export const audioUrl = (versionId: string) => `${A}/audio/${versionId}`;
export const downloadUrl = (versionId: string) => `${A}/download/${versionId}`;

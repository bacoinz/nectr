import type { CommentDTO, CommentsResponse, CommentUpdateRequest } from "../../shared/api-types";
import { api } from "../lib/api";

export interface NewComment {
  versionId: string;
  parentId: string | null;
  body: string;
  tStart: number;
  tEnd: number | null;
  isPrivate: boolean;
  voice?: { blob: Blob; durationS: number };
}

/** Where a page reads and writes comments: the owner API, or a share link as one guest device. */
export interface CommentsSource {
  owner: boolean;
  /** The owner's preview of a guest page: comments are shown, never written. */
  readOnly: boolean;
  list(trackId: string, since?: number): Promise<CommentsResponse>;
  create(c: NewComment): Promise<CommentDTO>;
  remove(id: string): Promise<void>;
  /** New text for one of your own text messages. */
  edit(id: string, body: string): Promise<CommentDTO>;
  setStatus(id: string, body: CommentUpdateRequest): Promise<CommentDTO>;
  voiceUrl(id: string): string;
}

const json = (c: NewComment) => ({ versionId: c.versionId, parentId: c.parentId, body: c.body, tStart: c.tStart, tEnd: c.tEnd, isPrivate: c.isPrivate });

/** Voice notes go as the raw request body; the rest of the comment rides in the query. */
function voiceQuery(c: NewComment) {
  const q = new URLSearchParams({ versionId: c.versionId, tStart: String(c.tStart), duration: c.voice!.durationS.toFixed(1) });
  if (c.parentId) q.set("parentId", c.parentId);
  if (c.tEnd !== null) q.set("tEnd", String(c.tEnd));
  if (c.isPrivate) q.set("private", "1");
  return q;
}
const voiceInit = (c: NewComment, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  body: c.voice!.blob,
  headers: { ...headers, "Content-Type": c.voice!.blob.type || "application/octet-stream" },
});

const A = "/api/admin";

export const ownerSource: CommentsSource = {
  owner: true,
  readOnly: false,
  list: (trackId, since) => api(`${A}/tracks/${trackId}/comments${since ? `?since=${since}` : ""}`),
  create: (c) => (c.voice ? api(`${A}/comments/voice?${voiceQuery(c)}`, voiceInit(c)) : api(`${A}/comments`, { method: "POST", json: json(c) })),
  remove: (id) => api(`${A}/comments/${id}`, { method: "DELETE" }),
  edit: (id, body) => api(`${A}/comments/${id}`, { method: "PATCH", json: { body } }),
  setStatus: (id, body) => api(`${A}/comments/${id}`, { method: "PATCH", json: body }),
  voiceUrl: (id) => `${A}/voice/${id}`,
};

/** "Ver como convidado": what a link shows (public comments only), and nothing to write. */
export const previewSource: CommentsSource = {
  ...ownerSource,
  readOnly: true,
  list: async (trackId, since) => {
    const r = await ownerSource.list(trackId, since);
    return { ...r, comments: r.comments.filter((c) => !c.isPrivate).map((c) => ({ ...c, mine: false, via: null })) };
  },
};

/** A share link, as the guest device `who()` (null until the guest gave a name). */
export function guestSource(token: string, who: () => { id: string; secret: string } | null): CommentsSource {
  const S = `/s/${token}`;
  const headers = (): Record<string, string> => {
    const g = who();
    return g ? { "X-Guest": `${g.id}.${g.secret}` } : {};
  };
  return {
    owner: false,
    readOnly: false,
    list: (trackId, since) => api(`${S}/api/comments?track=${trackId}${since ? `&since=${since}` : ""}`, { headers: headers() }),
    create: (c) =>
      c.voice
        ? api(`${S}/api/comments/voice?${voiceQuery(c)}`, voiceInit(c, headers()))
        : api(`${S}/api/comments`, { method: "POST", json: json(c), headers: headers() }),
    remove: (id) => api(`${S}/api/comments/${id}`, { method: "DELETE", headers: headers() }),
    edit: (id, body) => api(`${S}/api/comments/${id}`, { method: "PATCH", json: { body }, headers: headers() }),
    setStatus: () => Promise.reject(new Error("Só o dono muda o estado.")),
    voiceUrl: (id) => `${S}/voice/${id}`,
  };
}

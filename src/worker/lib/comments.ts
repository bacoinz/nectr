import type { Context } from "hono";
import type { CommentDTO, CommentStatus } from "../../shared/api-types";
import { LIMITS } from "../../shared/constants";
import { badRequest, HttpError, notFound } from "./errors";
import { newId, now } from "./ids";
import { id, text } from "./input";

// Comments shared by the owner API and the share links. A thread is one level
// deep: replies point at the top-level comment and share its version and time.

export interface CommentRow {
  id: string;
  version_id: string;
  parent_id: string | null;
  guest_id: string | null;
  link_id: string | null;
  body: string;
  t_start: number;
  t_end: number | null;
  status: CommentStatus;
  resolved_in_version_id: string | null;
  is_private: number;
  voice_key: string | null;
  voice_mime: string | null;
  voice_duration_s: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  edited_at: number | null;
  // joined
  track_id: string;
  version_number: number;
  resolved_number: number | null;
  guest_name: string | null;
  link_name: string | null;
}

const SELECT = `SELECT c.id, c.version_id, c.parent_id, c.guest_id, c.link_id, c.body, c.t_start, c.t_end, c.status,
    c.resolved_in_version_id, c.is_private, c.voice_key, c.voice_mime, c.voice_duration_s, c.created_at, c.updated_at, c.deleted_at, c.edited_at,
    v.track_id, v.number AS version_number, r.number AS resolved_number, g.name AS guest_name, s.name AS link_name
  FROM comments c JOIN versions v ON v.id = c.version_id
  LEFT JOIN versions r ON r.id = c.resolved_in_version_id AND r.deleted_at IS NULL
  LEFT JOIN guests g ON g.id = c.guest_id
  LEFT JOIN share_links s ON s.id = c.link_id`;

/** Who is looking: the owner (guestId null) or a guest device. */
export interface Viewer {
  guestId: string | null;
  owner: boolean;
  ownerName: string;
}

export const ownerName = async (db: D1Database) => (await db.prepare("SELECT name FROM owner_profile WHERE id = 1").first<string>("name")) ?? "Produtor";

/** The calendar day in Portugal, the day a guest may still edit what they wrote. */
const lisbonDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(ms);
export const sameDay = (a: number, b: number) => lisbonDay(a) === lisbonDay(b);

export function commentDTO(r: CommentRow, viewer: Viewer, at = Date.now()): CommentDTO {
  const byOwner = r.guest_id === null;
  const mine = viewer.owner ? byOwner : !byOwner && r.guest_id === viewer.guestId;
  return {
    id: r.id,
    trackId: r.track_id,
    versionId: r.version_id,
    versionNumber: r.version_number,
    parentId: r.parent_id,
    author: byOwner ? { kind: "owner", name: viewer.ownerName } : { kind: "guest", name: r.guest_name ?? "Convidado" },
    mine,
    body: r.body,
    tStart: r.t_start,
    tEnd: r.t_end,
    status: r.status,
    resolvedInVersionId: r.resolved_number === null ? null : r.resolved_in_version_id,
    resolvedInNumber: r.resolved_number,
    isPrivate: !!r.is_private,
    voice: r.voice_key ? { durationS: r.voice_duration_s ?? 0, mime: r.voice_mime ?? "audio/mp4" } : null,
    via: viewer.owner ? r.link_name : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    editedAt: r.edited_at,
    canEdit: mine && !r.voice_key && (viewer.owner || sameDay(r.created_at, at)),
  };
}

/**
 * A track's comments: all of them for the owner, the public ones for a link.
 * With `since` only what changed (with a 2 s overlap; the client merges by id),
 * and the deleted ones come back as ids.
 */
export async function listComments(db: D1Database, trackId: string, o: { publicOnly: boolean; since?: number }) {
  const where = ["v.track_id = ?1", "v.status = 'ready'", "v.deleted_at IS NULL"];
  if (o.publicOnly) where.push("c.is_private = 0");
  where.push(o.since ? "c.updated_at > ?2" : "c.deleted_at IS NULL");
  const stmt = db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY c.t_start, c.created_at`);
  const rows = (await (o.since ? stmt.bind(trackId, o.since - 2000) : stmt.bind(trackId)).all<CommentRow>()).results;
  return { rows: rows.filter((r) => !r.deleted_at), removed: rows.filter((r) => r.deleted_at).map((r) => r.id) };
}

/** Replies of the given threads (any number of ids up to the binding limit), oldest first. */
export async function listReplies(db: D1Database, topIds: string[]): Promise<CommentRow[]> {
  if (!topIds.length) return [];
  return (
    await db.prepare(`${SELECT} WHERE c.parent_id IN (${topIds.map(() => "?").join(",")}) AND c.deleted_at IS NULL ORDER BY c.created_at`).bind(...topIds).all<CommentRow>()
  ).results;
}

export async function getCommentRow(db: D1Database, commentId: string): Promise<CommentRow | null> {
  return db.prepare(`${SELECT} WHERE c.id = ? AND c.deleted_at IS NULL AND v.deleted_at IS NULL`).bind(commentId).first<CommentRow>();
}

// ---------- Creating ----------

const time = (v: unknown, field: string) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 24 * 3600) throw badRequest(`${field}: valor inválido.`);
  return Math.round(v * 10) / 10;
};

export interface CommentInput {
  versionId: string;
  parentId: string | null;
  body: string;
  tStart: number;
  tEnd: number | null;
  isPrivate: boolean;
}

/** Validates a new comment (JSON body, or the query of a voice upload). */
export function parseComment(b: Record<string, unknown>, voice: boolean): CommentInput {
  const body = b.body === undefined || b.body === null || b.body === "" ? "" : text(b.body, "Comentário", LIMITS.commentMax);
  if (!body && !voice) throw badRequest("Escreve um comentário.");
  const tStart = time(b.tStart, "Tempo");
  const tEnd = b.tEnd === undefined || b.tEnd === null ? null : time(b.tEnd, "Fim");
  if (tEnd !== null && tEnd <= tStart) throw badRequest("O fim tem de ser depois do início.");
  return {
    versionId: id(b.versionId, "Versão"),
    parentId: b.parentId === undefined || b.parentId === null || b.parentId === "" ? null : id(b.parentId, "Comentário"),
    body,
    tStart,
    tEnd,
    isPrivate: b.isPrivate === true,
  };
}

export interface Target {
  versionId: string;
  trackId: string;
  parentId: string | null;
  tStart: number;
  tEnd: number | null;
}

/** Where a comment attaches: its version and time, or for a reply its thread's. */
export async function resolveTarget(db: D1Database, p: CommentInput, publicOnly: boolean): Promise<Target> {
  if (p.parentId) {
    const q = `SELECT c.id, c.parent_id, c.version_id, c.t_start, c.t_end, c.is_private, v.track_id FROM comments c JOIN versions v ON v.id = c.version_id
               WHERE c.id = ? AND c.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'ready'`;
    type P = { id: string; parent_id: string | null; version_id: string; t_start: number; t_end: number | null; is_private: number; track_id: string };
    let top = await db.prepare(q).bind(p.parentId).first<P>();
    if (top && publicOnly && top.is_private) top = null;
    if (top?.parent_id) top = await db.prepare(q).bind(top.parent_id).first<P>();
    if (!top || (publicOnly && top.is_private)) throw notFound("Este comentário já não existe.");
    return { versionId: top.version_id, trackId: top.track_id, parentId: top.id, tStart: top.t_start, tEnd: top.t_end };
  }
  const v = await db
    .prepare("SELECT id, track_id, duration_s FROM versions WHERE id = ? AND status = 'ready' AND deleted_at IS NULL")
    .bind(p.versionId)
    .first<{ id: string; track_id: string; duration_s: number | null }>();
  if (!v) throw notFound("Versão não encontrada.");
  if (v.duration_s && p.tStart > v.duration_s + 1) throw badRequest("Tempo: valor inválido.");
  return { versionId: v.id, trackId: v.track_id, parentId: null, tStart: p.tStart, tEnd: p.tEnd };
}

export interface Voice {
  key: string;
  mime: string;
  durationS: number;
  size: number;
}

export async function insertComment(
  db: D1Database,
  t: Target,
  p: { id?: string; body: string; isPrivate: boolean; guestId: string | null; linkId: string | null; voice?: Voice },
): Promise<string> {
  const cid = p.id ?? newId();
  const at = now();
  await db
    .prepare(
      `INSERT INTO comments (id, version_id, parent_id, guest_id, link_id, body, t_start, t_end, is_private,
         voice_key, voice_mime, voice_duration_s, voice_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(cid, t.versionId, t.parentId, p.guestId, p.linkId, p.body, t.tStart, t.tEnd, p.isPrivate ? 1 : 0,
      p.voice?.key ?? null, p.voice?.mime ?? null, p.voice?.durationS ?? null, p.voice?.size ?? null, at, at)
    .run();
  return cid;
}

// ---------- Voice notes ----------

/** The container MediaRecorder wrote, from its first bytes (never the client's word). */
export function sniffVoice(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return { mime: "audio/mp4", ext: "m4a" }; // ....ftyp
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: "audio/webm", ext: "webm" }; // EBML
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return { mime: "audio/ogg", ext: "ogg" }; // OggS
  return null;
}

/** The query of a voice upload as a comment body (the request body is the audio). */
export const voiceQuery = (c: Context) => ({
  versionId: c.req.query("versionId"),
  parentId: c.req.query("parentId") || null,
  tStart: Number(c.req.query("tStart")),
  tEnd: c.req.query("tEnd") ? Number(c.req.query("tEnd")) : null,
  isPrivate: c.req.query("private") === "1",
});

/** Stores the uploaded note in R2 and creates its comment; returns the comment id. */
export async function createVoiceComment<E extends { Bindings: Env }>(
  c: Context<E>,
  t: Target,
  p: { isPrivate: boolean; guestId: string | null; linkId: string | null },
): Promise<string> {
  const durationS = Number(c.req.query("duration"));
  if (!Number.isFinite(durationS) || durationS <= 0 || durationS > LIMITS.voiceMaxSeconds + 1) throw badRequest("A nota de voz pode ter até 1 minuto.");
  if (Number(c.req.header("Content-Length") ?? 0) > LIMITS.voiceMaxBytes) throw new HttpError(413, "too_large", "A nota de voz é demasiado grande.");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > LIMITS.voiceMaxBytes) throw new HttpError(413, "too_large", "A nota de voz é demasiado grande.");
  const kind = sniffVoice(bytes);
  if (!kind) throw badRequest("Não foi possível ler a nota de voz.");
  const cid = newId();
  const key = `voice/${cid}.${kind.ext}`;
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: kind.mime } });
  try {
    await insertComment(c.env.DB, t, { id: cid, body: "", ...p, voice: { key, mime: kind.mime, durationS: Math.round(durationS * 10) / 10, size: bytes.length } });
  } catch (e) {
    await c.env.BUCKET.delete(key);
    throw e;
  }
  return cid;
}

// ---------- Changing ----------

/** New text for a text message; the caller checks who may edit it. */
export async function editBody(db: D1Database, commentId: string, body: unknown) {
  const text_ = text(body, "Comentário", LIMITS.commentMax, 1);
  const at = now();
  await db.prepare("UPDATE comments SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?").bind(text_, at, at, commentId).run();
}

/** Deletes a comment and, for a top-level one, its whole thread (soft; the cron purges). */
export async function deleteThread(db: D1Database, commentId: string) {
  const at = now();
  await db.prepare("UPDATE comments SET deleted_at = ?1, updated_at = ?1 WHERE (id = ?2 OR parent_id = ?2) AND deleted_at IS NULL").bind(at, commentId).run();
}

/** Requests (top-level guest comments) are open or done; done remembers the version that solved it. */
export async function setStatus(db: D1Database, commentId: string, status: CommentStatus, resolvedIn?: string) {
  const row = await getCommentRow(db, commentId);
  if (!row) throw notFound("Este comentário já não existe.");
  if (row.parent_id || !row.guest_id) throw badRequest("Só os pedidos dos convidados têm estado.");
  let resolved: string | null = null;
  if (status === "done") {
    const v = await db
      .prepare(`SELECT id FROM versions WHERE track_id = ? AND status = 'ready' AND deleted_at IS NULL ${resolvedIn ? "AND id = ?" : ""} ORDER BY number DESC LIMIT 1`)
      .bind(...(resolvedIn ? [row.track_id, resolvedIn] : [row.track_id]))
      .first<string>("id");
    if (!v) throw notFound("Versão não encontrada.");
    resolved = v;
  }
  await db.prepare("UPDATE comments SET status = ?, resolved_in_version_id = ?, updated_at = ? WHERE id = ?").bind(status, resolved, now(), commentId).run();
}

// ---------- Counts ----------

/** Per track of an artist: open requests and comments a guest can see. */
export async function commentCounts(db: D1Database, where: { artistId: string } | { trackIds: string[] }) {
  const out = new Map<string, { open: number; visible: number }>();
  const run = async (cond: string, binds: unknown[]) => {
    const rows = await db
      .prepare(
        `SELECT v.track_id,
           SUM(CASE WHEN c.guest_id IS NOT NULL AND c.status = 'open' THEN 1 ELSE 0 END) AS open_n,
           SUM(CASE WHEN c.is_private = 0 THEN 1 ELSE 0 END) AS visible_n
         FROM comments c JOIN versions v ON v.id = c.version_id JOIN tracks t ON t.id = v.track_id
         WHERE ${cond} AND c.parent_id IS NULL AND c.deleted_at IS NULL AND v.deleted_at IS NULL AND v.status = 'ready'
         GROUP BY v.track_id`,
      )
      .bind(...binds)
      .all<{ track_id: string; open_n: number; visible_n: number }>();
    for (const r of rows.results) out.set(r.track_id, { open: r.open_n, visible: r.visible_n });
  };
  if ("artistId" in where) await run("t.artist_id = ?", [where.artistId]);
  else for (let i = 0; i < where.trackIds.length; i += 90) {
    const part = where.trackIds.slice(i, i + 90);
    await run(`v.track_id IN (${part.map(() => "?").join(",")})`, part);
  }
  return out;
}

// ---------- Guests ----------

const enc = new TextEncoder();
export const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The guest of this device on this link, from the `X-Guest: <id>.<secret>` header. */
export async function guestFromHeader(db: D1Database, linkId: string, header: string | undefined) {
  const m = header ? /^([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{22})$/.exec(header) : null;
  if (!m) return null;
  const g = await db
    .prepare("SELECT id, link_id, name, secret_hash, last_seen_at FROM guests WHERE id = ?")
    .bind(m[1])
    .first<{ id: string; link_id: string; name: string; secret_hash: string; last_seen_at: number }>();
  if (!g || g.link_id !== linkId || g.secret_hash !== (await sha256hex(m[2]!))) return null;
  // "Last seen" for the owner's list of who entered a link, to within an hour.
  const at = Date.now();
  if (at - g.last_seen_at > 3600_000) await db.prepare("UPDATE guests SET last_seen_at = ? WHERE id = ?").bind(at, g.id).run();
  return { id: g.id, name: g.name };
}

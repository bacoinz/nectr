import { Hono } from "hono";
import type { CommentsResponse, RevisionsResponse, RevisionTrackDTO } from "../../../shared/api-types";
import {
  commentDTO, createVoiceComment, deleteThread, editBody, getCommentRow, insertComment, listComments, ownerName, parseComment, resolveTarget, setStatus, voiceQuery,
  type CommentRow, type Viewer,
} from "../../lib/comments";
import { FOLDER_COLS, folderDTO, getTrack, type FolderRow } from "../../lib/db";
import { badRequest, notFound } from "../../lib/errors";
import { id, jsonBody, oneOf } from "../../lib/input";
import { serveObject } from "../../lib/r2";
import type { AdminEnv } from ".";
import { listReplies } from "../../lib/comments";
import { later, notifyGuestsOfReply } from "../../lib/notify";

export const comments = new Hono<AdminEnv>();

const ownerViewer = async (db: D1Database): Promise<Viewer> => ({ guestId: null, owner: true, ownerName: await ownerName(db) });

comments.get("/tracks/:id/comments", async (c) => {
  const db = c.env.DB;
  const t = await getTrack(db, id(c.req.param("id"), "Faixa"));
  const since = Number(c.req.query("since")) || undefined;
  const at = Date.now();
  const { rows, removed } = await listComments(db, t.id, { publicOnly: false, since });
  const viewer = await ownerViewer(db);
  return c.json({ comments: rows.map((r) => commentDTO(r, viewer)), removed, now: at } satisfies CommentsResponse);
});

async function created(db: D1Database, cid: string) {
  return commentDTO((await getCommentRow(db, cid))!, await ownerViewer(db));
}

comments.post("/comments", async (c) => {
  const db = c.env.DB;
  const p = parseComment(await jsonBody(c), false);
  const target = await resolveTarget(db, p, false);
  const cid = await insertComment(db, target, { body: p.body, isPrivate: p.isPrivate, guestId: null, linkId: null });
  if (target.parentId && !p.isPrivate) later(c.executionCtx, new URL(c.req.url).origin, (o) => notifyGuestsOfReply(c.env, o, cid));
  return c.json(await created(db, cid), 201);
});

comments.post("/comments/voice", async (c) => {
  const db = c.env.DB;
  const p = parseComment(voiceQuery(c), true);
  const target = await resolveTarget(db, p, false);
  const cid = await createVoiceComment(c, target, { isPrivate: p.isPrivate, guestId: null, linkId: null });
  if (target.parentId && !p.isPrivate) later(c.executionCtx, new URL(c.req.url).origin, (o) => notifyGuestsOfReply(c.env, o, cid));
  return c.json(await created(db, cid), 201);
});

comments.patch("/comments/:id", async (c) => {
  const db = c.env.DB;
  const cid = id(c.req.param("id"), "Comentário");
  const b = await jsonBody(c);
  if (b.body !== undefined) {
    // The owner edits their own text messages, whenever.
    const row = await getCommentRow(db, cid);
    if (!row) throw notFound("Este comentário já não existe.");
    if (row.guest_id !== null || row.voice_key) throw badRequest("Só podes editar as tuas mensagens escritas.");
    await editBody(db, cid, b.body);
  }
  if (b.status !== undefined) {
    const status = oneOf(b.status, ["open", "done"] as const, "Estado");
    await setStatus(db, cid, status, b.resolvedInVersionId === undefined ? undefined : id(b.resolvedInVersionId, "Versão"));
  }
  return c.json(await created(db, cid));
});

comments.delete("/comments/:id", async (c) => {
  const cid = id(c.req.param("id"), "Comentário");
  if (!(await getCommentRow(c.env.DB, cid))) throw notFound("Este comentário já não existe.");
  await deleteThread(c.env.DB, cid);
  return c.body(null, 204);
});

comments.get("/voice/:id", async (c) => {
  const row = await getCommentRow(c.env.DB, id(c.req.param("id"), "Comentário"));
  if (!row?.voice_key) throw notFound("Nota de voz não encontrada.");
  return serveObject(c, c.env.BUCKET, row.voice_key, { contentType: row.voice_mime ?? "audio/mp4" });
});

/** Every guest request, newest first, with what the "Revisões" page shows around it. */
comments.get("/revisions", async (c) => {
  const db = c.env.DB;
  const viewer = await ownerViewer(db);
  const rows = (
    await db
      .prepare(
        `SELECT c.id, c.version_id, c.parent_id, c.guest_id, c.link_id, c.body, c.t_start, c.t_end, c.status,
           c.resolved_in_version_id, c.is_private, c.voice_key, c.voice_mime, c.voice_duration_s, c.created_at, c.updated_at, c.deleted_at, c.edited_at,
           v.track_id, v.number AS version_number, r.number AS resolved_number, g.name AS guest_name, s.name AS link_name
         FROM comments c JOIN versions v ON v.id = c.version_id JOIN tracks t ON t.id = v.track_id JOIN artists a ON a.id = t.artist_id
         LEFT JOIN versions r ON r.id = c.resolved_in_version_id AND r.deleted_at IS NULL
         LEFT JOIN guests g ON g.id = c.guest_id
         LEFT JOIN share_links s ON s.id = c.link_id
         WHERE c.parent_id IS NULL AND c.guest_id IS NOT NULL AND c.deleted_at IS NULL
           AND v.deleted_at IS NULL AND v.status = 'ready' AND t.deleted_at IS NULL AND a.deleted_at IS NULL
         ORDER BY c.created_at DESC LIMIT 1000`,
      )
      .all<CommentRow>()
  ).results;

  const trackIds = [...new Set(rows.map((r) => r.track_id))];
  const tracks: RevisionTrackDTO[] = [];
  for (let i = 0; i < trackIds.length; i += 90) {
    const part = trackIds.slice(i, i + 90);
    const marks = part.map(() => "?").join(",");
    const [ts, vs] = await db.batch([
      db.prepare(
        `SELECT t.id, t.title, t.folder_id, t.artist_id, a.name AS artist_name, a.color AS artist_color, a.photo_key, a.updated_at AS artist_updated
         FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.id IN (${marks})`,
      ).bind(...part),
      db.prepare(`SELECT id, track_id, number FROM versions WHERE track_id IN (${marks}) AND status = 'ready' AND deleted_at IS NULL ORDER BY number DESC`).bind(...part),
    ]);
    type T = { id: string; title: string; folder_id: string | null; artist_id: string; artist_name: string; artist_color: string; photo_key: string | null; artist_updated: number };
    const trows = ts!.results as T[];
    const versions = vs!.results as { id: string; track_id: string; number: number }[];
    const artistIds = [...new Set(trows.map((t) => t.artist_id))];
    const folders = (
      await db.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE artist_id IN (${artistIds.map(() => "?").join(",")}) AND deleted_at IS NULL`).bind(...artistIds).all<FolderRow>()
    ).results;
    const byId = new Map(folders.map((f) => [f.id, f]));
    for (const t of trows) {
      let f = t.folder_id ? byId.get(t.folder_id) : undefined;
      const folder = f;
      while (f?.parent_id) f = byId.get(f.parent_id);
      const project = f ?? null;
      tracks.push({
        id: t.id,
        title: t.title,
        artistId: t.artist_id,
        artistName: t.artist_name,
        projectName: project?.name ?? null,
        folderName: folder && folder !== project ? folder.name : null,
        color: project?.color ?? t.artist_color,
        artworkUrl: project ? folderDTO(project).artworkUrl : t.photo_key ? `/api/admin/artists/${t.artist_id}/photo?v=${t.artist_updated}` : null,
        versions: versions.filter((v) => v.track_id === t.id).map((v) => ({ id: v.id, number: v.number })),
      });
    }
  }
  // The answers in those threads, so the page shows (and continues) the conversation.
  const replies: CommentRow[] = [];
  const topIds = rows.map((r) => r.id);
  for (let i = 0; i < topIds.length; i += 90) {
    const part = topIds.slice(i, i + 90);
    const r = await listReplies(db, part);
    replies.push(...r);
  }
  return c.json({ tracks, items: rows.map((r) => commentDTO(r, viewer)), replies: replies.map((r) => commentDTO(r, viewer)) } satisfies RevisionsResponse);
});

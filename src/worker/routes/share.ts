import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { CommentsResponse, GuestHeroDTO, GuestIdentity, GuestInfoDTO, GuestShareDTO, GuestTrackDTO, LyricsResponse, PeaksResponse } from "../../shared/api-types";
import { checkGuestName } from "../../shared/guest-name";
import {
  commentCounts, commentDTO, createVoiceComment, deleteThread, editBody, getCommentRow, guestFromHeader, insertComment, listComments, ownerName, parseComment,
  resolveTarget, sameDay, sha256hex, voiceQuery, type CommentInput, type Viewer,
} from "../lib/comments";
import { ARTIST_COLS, FOLDER_COLS, folderDTO, projectOf, versionDTO, type ArtistRow, type FolderRow } from "../lib/db";
import { apiError, badRequest, notFound, HttpError } from "../lib/errors";
import { newId, newToken, now } from "../lib/ids";
import { id, jsonBody } from "../lib/input";
import { checkUnlock, clearFailures, clientKey, cookieName, findLiveLink, lockedUntil, recordFailure, scopeTracks, scopeVersions, signUnlock, targetType, verifyPassword, versionInScope, type LinkRow } from "../lib/links";
import { downloadName } from "../lib/names";
import { later, notifyOwnerOfComment, notifyOwnerOfShare, parseSubscription, removeSubscription, saveSubscription } from "../lib/notify";
import { serveObject } from "../lib/r2";
import { serveImage } from "./admin/images";
import { AUDIO_TYPES } from "./admin/media";

type ShareEnv = { Bindings: Env; Variables: { link: LinkRow } };
type ShareContext = Context<ShareEnv>;

export const share = new Hono<ShareEnv>();

// Same response for unknown, expired, revoked and deleted links (and anything
// a link does not cover), so a token never reveals whether it ever existed.
const neutral = (c: Context) => c.html(NEUTRAL_PAGE, 404);

const withLink: MiddlewareHandler<ShareEnv> = async (c, next) => {
  const link = await findLiveLink(c.env.DB, c.req.param("token") ?? "");
  if (!link) return neutral(c);
  c.set("link", link);
  await next();
};

/** 429 with the wait in seconds (Retry-After and `retryAfter`), for the gate's countdown. */
function tooMany(c: Context, ms: number, prefix = "") {
  const s = Math.max(1, Math.ceil(ms / 1000));
  const wait = s <= 60 ? "1 minuto" : `${Math.ceil(s / 60)} minutos`;
  c.header("Retry-After", String(s));
  return c.json({ error: { code: "too_many_attempts", message: `${prefix}Demasiadas tentativas. Tenta outra vez daqui a ${wait}.` }, retryAfter: s }, 429);
}

const unlocked = (c: ShareContext) => checkUnlock(c.env.COOKIE_SECRET, c.get("link"), getCookie(c, cookieName));

const requireUnlocked: MiddlewareHandler<ShareEnv> = async (c, next) => {
  if (!(await unlocked(c))) return apiError(c, 401, "password_required", "Este link está protegido por password.");
  await next();
};

const base = (l: LinkRow) => `/s/${l.token}`;
const coverUrl = (l: LinkRow) => (folderId: string) => `${base(l)}/cover/${folderId}`;

async function artistOf(db: D1Database, l: LinkRow) {
  return (await db.prepare(`SELECT ${ARTIST_COLS} FROM artists WHERE id = ?`).bind(l.artist_id).first<ArtistRow>())!;
}

/** The project shown in the header: the shared project, or the one containing the shared folder/track. */
async function heroProject(db: D1Database, l: LinkRow): Promise<FolderRow | null> {
  if (l.folder_id) return projectOf(db, l.folder_id);
  if (l.track_id) {
    const t = await db.prepare("SELECT folder_id FROM tracks WHERE id = ?").bind(l.track_id).first<{ folder_id: string | null }>();
    return projectOf(db, t?.folder_id ?? null);
  }
  return null;
}

async function heroFor(db: D1Database, l: LinkRow, a: ArtistRow): Promise<GuestHeroDTO> {
  const photo = a.photo_key ? `${base(l)}/photo?v=${a.updated_at}` : null;
  const project = await heroProject(db, l);
  if (!project) return { name: a.name, subtitle: "", color: a.color, artworkUrl: photo, icon: null, description: a.description };
  const release = project.kind === "release";
  const cover = folderDTO(project, coverUrl(l)).artworkUrl;
  if (l.folder_id && l.folder_id !== project.id) {
    const f = await db.prepare("SELECT name, icon, color FROM folders WHERE id = ?").bind(l.folder_id).first<{ name: string; icon: string; color: string }>();
    return { name: f?.name ?? project.name, subtitle: `${project.name} · ${a.name}`, color: project.color, artworkUrl: release ? cover : null, icon: release ? null : (f?.icon ?? "folder"), description: "" };
  }
  return {
    name: project.name,
    subtitle: [a.name, release ? project.year : null].filter(Boolean).join(" · "),
    color: project.color,
    artworkUrl: cover,
    icon: release ? null : project.icon,
    description: project.description,
  };
}

share.get("/:token/api/info", withLink, async (c) => {
  const db = c.env.DB;
  const l = c.get("link");
  const artist = await artistOf(db, l);
  const hero = await heroFor(db, l, artist);
  if (!(await unlocked(c))) {
    return c.json({ error: { code: "password_required", message: "Este link está protegido por password." }, gate: { hero } }, 401);
  }

  const tracks = await scopeTracks(db, l);
  const versions = await scopeVersions(db, l, tracks.map((t) => t.id));
  const byTrack = new Map<string, GuestTrackDTO["versions"]>();
  for (const v of versions) {
    const { originalFilename: _f, name: _n, ...dto } = versionDTO(v);
    byTrack.set(v.track_id, [...(byTrack.get(v.track_id) ?? []), dto]);
  }
  let folders: FolderRow[] = [];
  if (!l.track_id) {
    const sql = l.folder_id
      ? `WITH RECURSIVE sub(id) AS (SELECT ?1 UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id WHERE f.deleted_at IS NULL)
         SELECT ${FOLDER_COLS} FROM folders WHERE id IN (SELECT id FROM sub) ORDER BY position`
      : `SELECT ${FOLDER_COLS} FROM folders WHERE artist_id = ?1 AND deleted_at IS NULL ORDER BY position`;
    folders = (await db.prepare(sql).bind(l.folder_id ?? l.artist_id).all<FolderRow>()).results;
  }
  const owner = await db.prepare("SELECT name FROM owner_profile WHERE id = 1").first<string>("name");
  const counts = l.allow_comments ? await commentCounts(db, { trackIds: tracks.map((t) => t.id) }) : new Map<string, { visible: number }>();

  if (!l.last_viewed_at || Date.now() - l.last_viewed_at > 3600_000) {
    c.executionCtx.waitUntil(db.prepare("UPDATE share_links SET last_viewed_at = ? WHERE id = ?").bind(Date.now(), l.id).run());
  }

  const body: GuestInfoDTO = {
    link: { type: targetType(l), allowDownload: !!l.allow_download, showLyrics: !!l.show_lyrics, allowComments: !!l.allow_comments, expiresAt: l.expires_at, allowShare: !!l.allow_share },
    artist: { name: artist.name, description: artist.description, color: artist.color, photoUrl: artist.photo_key ? `${base(l)}/photo?v=${artist.updated_at}` : null },
    hero,
    ownerName: owner ?? "Produtor",
    folders: folders.map((f) => {
      const d = folderDTO(f, coverUrl(l));
      return { id: d.id, parentId: d.parentId, name: d.name, icon: d.icon, color: d.color, position: d.position, kind: d.kind, artworkUrl: d.artworkUrl, year: d.year, label: d.label, description: d.description };
    }),
    tracks: tracks.filter((t) => byTrack.has(t.id)).map((t) => ({
      id: t.id,
      folderId: t.folder_id,
      title: t.title,
      artworkUrl: t.artwork_key ? `${base(l)}/track-cover/${t.id}?v=${t.updated_at}` : null,
      versions: byTrack.get(t.id)!,
      commentCount: counts.get(t.id)?.visible ?? 0,
    })),
  };
  return c.json(body);
});

share.post("/:token/api/unlock", withLink, async (c) => {
  const l = c.get("link");
  if (!l.password_hash) return c.body(null, 204);
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  // The binding stops bursts before any work; the table keeps the count across
  // tabs, private windows and restarts.
  const { success } = await c.env.UNLOCK_LIMITER.limit({ key: `${ip}:${l.id}` });
  if (!success) return tooMany(c, 60_000);
  const client = await clientKey(c.env.COOKIE_SECRET, ip);
  const until = await lockedUntil(c.env.DB, l.id, client);
  if (until > Date.now()) return tooMany(c, until - Date.now());
  const body = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password.length > 200 || !(await verifyPassword(l, password))) {
    const lock = await recordFailure(c.env.DB, l.id, client);
    if (lock) return tooMany(c, lock - Date.now(), "Password incorreta. ");
    return apiError(c, 401, "wrong_password", "Password incorreta.");
  }
  await clearFailures(c.env.DB, l.id, client);
  const cookie = await signUnlock(c.env.COOKIE_SECRET, l);
  setCookie(c, cookieName, cookie.value, { path: base(l), httpOnly: true, secure: true, sameSite: "Lax", expires: new Date(cookie.expires) });
  return c.body(null, 204);
});

share.get("/:token/api/peaks/:versionId", withLink, requireUnlocked, async (c) => {
  const v = await versionInScope(c.env.DB, c.get("link"), c.req.param("versionId"));
  if (!v) return neutral(c);
  const row = await c.env.DB.prepare("SELECT peaks FROM versions WHERE id = ?").bind(v.id).first<{ peaks: string | null }>();
  c.header("Cache-Control", "private, max-age=86400");
  return c.json({ peaks: row?.peaks ?? null } satisfies PeaksResponse);
});

/** A version's lyrics (its own timing, or the track's); none when the link hides lyrics. */
share.get("/:token/api/lyrics/:versionId", withLink, requireUnlocked, async (c) => {
  const l = c.get("link");
  const v = await versionInScope(c.env.DB, l, c.req.param("versionId"));
  if (!v) return neutral(c);
  if (!l.show_lyrics) return c.json({ lrc: null } satisfies LyricsResponse);
  const lrc = await c.env.DB.prepare("SELECT COALESCE(v.lyrics_lrc_override, t.lyrics_lrc) AS lrc FROM versions v JOIN tracks t ON t.id = v.track_id WHERE v.id = ?").bind(v.id).first<string | null>("lrc");
  return c.json({ lrc: lrc ?? null } satisfies LyricsResponse);
});

share.get("/:token/audio/:versionId", withLink, requireUnlocked, async (c) => {
  const v = await versionInScope(c.env.DB, c.get("link"), c.req.param("versionId"));
  if (!v) return neutral(c);
  return serveObject(c, c.env.BUCKET, v.r2_key, { contentType: AUDIO_TYPES[v.format] });
});

// With downloads off this route does not exist for the link: same neutral 404.
share.get("/:token/download/:versionId", withLink, requireUnlocked, async (c) => {
  const l = c.get("link");
  if (!l.allow_download) return neutral(c);
  const v = await versionInScope(c.env.DB, l, c.req.param("versionId"));
  if (!v) return neutral(c);
  return serveObject(c, c.env.BUCKET, v.r2_key, { contentType: AUDIO_TYPES[v.format], downloadName: await downloadName(c.env.DB, v), cacheControl: "private, no-store" });
});

// Shown on the password page too, like the names.
share.get("/:token/photo", withLink, async (c) => {
  const a = await artistOf(c.env.DB, c.get("link"));
  return a.photo_key ? serveImage(c, a.photo_key) : neutral(c);
});

/** Project covers: any project of the artist for an artist link, otherwise only the header's project. */
share.get("/:token/cover/:folderId", withLink, async (c) => {
  const l = c.get("link");
  const id = c.req.param("folderId");
  const f = await c.env.DB.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE id = ? AND parent_id IS NULL AND deleted_at IS NULL`).bind(id).first<FolderRow>();
  if (!f || f.artist_id !== l.artist_id || !f.artwork_key) return neutral(c);
  if (targetType(l) !== "artist" && (await heroProject(c.env.DB, l))?.id !== f.id) return neutral(c);
  return serveImage(c, f.artwork_key);
});

/** A track's own cover, for a track the link shows. */
share.get("/:token/track-cover/:trackId", withLink, async (c) => {
  const t = (await scopeTracks(c.env.DB, c.get("link"))).find((x) => x.id === c.req.param("trackId"));
  if (!t?.artwork_key) return neutral(c);
  return serveImage(c, t.artwork_key);
});

// ---------- Comments ----------
// A guest is a device on this link (id + secret in its browser, sent as
// X-Guest). Guests see public comments only: private owner notes never leave
// the Worker. With comments off, the link is listen-only.

const commentsOn: MiddlewareHandler<ShareEnv> = async (c, next) => {
  if (!c.get("link").allow_comments) return apiError(c, 403, "comments_off", "Este link não aceita comentários.");
  await next();
};

/** A name is asked to comment, and to share (on links that let guests share). */
const namesOn: MiddlewareHandler<ShareEnv> = async (c, next) => {
  const l = c.get("link");
  if (!l.allow_comments && !l.allow_share) return apiError(c, 403, "comments_off", "Este link não aceita comentários.");
  await next();
};

async function limited(c: ShareContext) {
  const { success } = await c.env.COMMENT_LIMITER.limit({ key: `${c.req.header("CF-Connecting-IP") ?? "local"}:${c.get("link").id}` });
  return success ? null : apiError(c, 429, "too_many_comments", "Muitos comentários seguidos. Espera um minuto e tenta outra vez.");
}

const guestOf = (c: ShareContext) => guestFromHeader(c.env.DB, c.get("link").id, c.req.header("X-Guest"));
const noGuest = (c: ShareContext) => apiError(c, 401, "guest_required", "Diz-nos o teu nome antes de comentar.");

async function viewerOf(c: ShareContext): Promise<Viewer> {
  return { guestId: (await guestOf(c))?.id ?? null, owner: false, ownerName: await ownerName(c.env.DB) };
}

const trackInScope = async (c: ShareContext, trackId: string) => (await scopeTracks(c.env.DB, c.get("link"))).some((t) => t.id === trackId);

/** A new comment must point at something this link can see. */
async function guestTarget(c: ShareContext, p: CommentInput) {
  const t = await resolveTarget(c.env.DB, p, true);
  const ok = t.parentId ? await trackInScope(c, t.trackId) : !!(await versionInScope(c.env.DB, c.get("link"), t.versionId));
  if (!ok) throw notFound("Versão não encontrada.");
  return t;
}

/** A real-looking name (same rules as the name card in the browser). */
function guestName(v: unknown) {
  const r = checkGuestName(typeof v === "string" ? v : "");
  if (!r.ok) throw badRequest(r.message);
  return r.name;
}

share.post("/:token/api/guest", withLink, requireUnlocked, namesOn, async (c) => {
  const name = guestName((await jsonBody(c)).name);
  const tooMany = await limited(c);
  if (tooMany) return tooMany;
  const guest: GuestIdentity = { id: newId(), name, secret: newToken() };
  const at = now();
  await c.env.DB.prepare("INSERT INTO guests (id, link_id, name, secret_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(guest.id, c.get("link").id, name, await sha256hex(guest.secret), at, at)
    .run();
  return c.json(guest, 201);
});

/** A new name shows on every comment made on this device. */
share.patch("/:token/api/guest", withLink, requireUnlocked, namesOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return noGuest(c);
  const name = guestName((await jsonBody(c)).name);
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE guests SET name = ?, last_seen_at = ? WHERE id = ?").bind(name, at, g.id),
    c.env.DB.prepare("UPDATE comments SET updated_at = ? WHERE guest_id = ? AND deleted_at IS NULL").bind(at, g.id),
  ]);
  return c.json({ id: g.id, name });
});

share.get("/:token/api/comments", withLink, requireUnlocked, async (c) => {
  const at = Date.now();
  if (!c.get("link").allow_comments) return c.json({ comments: [], removed: [], now: at } satisfies CommentsResponse);
  const trackId = id(c.req.query("track"), "Faixa");
  if (!(await trackInScope(c, trackId))) return neutral(c);
  const { rows, removed } = await listComments(c.env.DB, trackId, { publicOnly: true, since: Number(c.req.query("since")) || undefined });
  const viewer = await viewerOf(c);
  return c.json({ comments: rows.map((r) => commentDTO(r, viewer)), removed, now: at } satisfies CommentsResponse);
});

async function createdForGuest(c: ShareContext, cid: string, guestId: string) {
  return commentDTO((await getCommentRow(c.env.DB, cid))!, { guestId, owner: false, ownerName: await ownerName(c.env.DB) });
}

share.post("/:token/api/comments", withLink, requireUnlocked, commentsOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return noGuest(c);
  const tooMany = await limited(c);
  if (tooMany) return tooMany;
  const p = parseComment(await jsonBody(c), false);
  const target = await guestTarget(c, p);
  const cid = await insertComment(c.env.DB, target, { body: p.body, isPrivate: false, guestId: g.id, linkId: c.get("link").id });
  later(c.executionCtx, new URL(c.req.url).origin, (o) => notifyOwnerOfComment(c.env, o, cid));
  return c.json(await createdForGuest(c, cid, g.id), 201);
});

share.post("/:token/api/comments/voice", withLink, requireUnlocked, commentsOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return noGuest(c);
  const tooMany = await limited(c);
  if (tooMany) return tooMany;
  const p = parseComment(voiceQuery(c), true);
  const target = await guestTarget(c, p);
  const cid = await createVoiceComment(c, target, { isPrivate: false, guestId: g.id, linkId: c.get("link").id });
  later(c.executionCtx, new URL(c.req.url).origin, (o) => notifyOwnerOfComment(c.env, o, cid));
  return c.json(await createdForGuest(c, cid, g.id), 201);
});

/** A guest edits what this device wrote, on the day it was written. */
share.patch("/:token/api/comments/:id", withLink, requireUnlocked, commentsOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return noGuest(c);
  const row = await getCommentRow(c.env.DB, id(c.req.param("id"), "Comentário"));
  if (!row || row.guest_id !== g.id) throw notFound("Este comentário já não existe.");
  if (row.voice_key) throw badRequest("As notas de voz não se editam: apaga e grava outra.");
  if (!sameDay(row.created_at, Date.now())) throw new HttpError(403, "too_late", "Só dá para editar no dia em que escreveste.");
  await editBody(c.env.DB, row.id, (await jsonBody(c)).body);
  return c.json(await createdForGuest(c, row.id, g.id));
});

/** A guest deletes only what this device wrote. */
share.delete("/:token/api/comments/:id", withLink, requireUnlocked, commentsOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return noGuest(c);
  const row = await getCommentRow(c.env.DB, id(c.req.param("id"), "Comentário"));
  if (!row || row.guest_id !== g.id) throw notFound("Este comentário já não existe.");
  await deleteThread(c.env.DB, row.id);
  return c.body(null, 204);
});

// ---------- Shares made by guests ----------
// Where the owner allows it, a named guest can share one track or folder of the
// link: a link of its own, listed under this one for the owner, without
// downloads or password, that stops with this link.

const MAX_SHARES = 20;

const sharesOn: MiddlewareHandler<ShareEnv> = async (c, next) => {
  const l = c.get("link");
  if (!l.allow_share || l.parent_link_id) return apiError(c, 403, "share_off", "Este link não permite partilhar.");
  await next();
};

function shareDTO(r: { id: string; token: string; name: string; track_id: string | null; folder_name: string | null; track_title: string | null; created_at: number }): GuestShareDTO {
  return {
    id: r.id,
    path: `/s/${r.token}`,
    name: r.name,
    target: r.track_id ? { type: "track", name: r.track_title ?? "" } : { type: "folder", name: r.folder_name ?? "" },
    createdAt: r.created_at,
  };
}

const SHARE_SQL = `SELECT s.id, s.token, s.name, s.track_id, s.created_at, f.name AS folder_name, t.title AS track_title
  FROM share_links s LEFT JOIN folders f ON f.id = s.folder_id LEFT JOIN tracks t ON t.id = s.track_id`;
const SHARES_SQL = `${SHARE_SQL} WHERE s.parent_link_id = ? AND s.created_by_guest_id = ? AND s.revoked_at IS NULL ORDER BY s.created_at DESC`;

/** This device's shares of this link. */
share.get("/:token/api/shares", withLink, requireUnlocked, sharesOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return c.json({ shares: [] });
  const rows = await c.env.DB.prepare(SHARES_SQL).bind(c.get("link").id, g.id).all<Parameters<typeof shareDTO>[0]>();
  return c.json({ shares: rows.results.map(shareDTO) });
});

share.post("/:token/api/shares", withLink, requireUnlocked, sharesOn, async (c) => {
  const db = c.env.DB;
  const l = c.get("link");
  const g = await guestOf(c);
  if (!g) return apiError(c, 401, "guest_required", "Diz-nos o teu nome antes de partilhar.");
  const b = await jsonBody(c);
  const type = b.type === "track" || b.type === "folder" ? b.type : null;
  if (!type) throw badRequest("Escolhe uma faixa ou uma pasta.");
  const targetId = id(b.id, type === "track" ? "Faixa" : "Pasta");
  const to = typeof b.to === "string" ? b.to.replace(/\s+/g, " ").trim().slice(0, 60) : "";

  // Only what this link shows: one of its tracks, or a folder with some of them inside.
  const tracks = await scopeTracks(db, l);
  let trackId: string | null = null;
  let folderId: string | null = null;
  if (type === "track") {
    if (!tracks.some((x) => x.id === targetId)) throw notFound("Faixa não encontrada.");
    trackId = targetId;
  } else {
    if (l.track_id) throw notFound("Pasta não encontrada.");
    const f = await db.prepare(`SELECT ${FOLDER_COLS} FROM folders WHERE id = ? AND deleted_at IS NULL`).bind(targetId).first<FolderRow>();
    if (!f || f.artist_id !== l.artist_id) throw notFound("Pasta não encontrada.");
    if (l.folder_id && f.id !== l.folder_id) {
      const inside = await db
        .prepare(`WITH RECURSIVE sub(id) AS (SELECT ?1 UNION SELECT x.id FROM folders x JOIN sub ON x.parent_id = sub.id WHERE x.deleted_at IS NULL) SELECT 1 AS ok FROM sub WHERE id = ?2`)
        .bind(l.folder_id, f.id)
        .first("ok");
      if (!inside) throw notFound("Pasta não encontrada.");
    }
    // A folder with nothing this link plays inside is not worth a link.
    const ids = new Set<string>([f.id]);
    const all = (await db.prepare("SELECT id, parent_id FROM folders WHERE artist_id = ? AND deleted_at IS NULL").bind(l.artist_id).all<{ id: string; parent_id: string | null }>()).results;
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of all) if (x.parent_id && ids.has(x.parent_id) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
    }
    if (!tracks.some((t) => t.folder_id && ids.has(t.folder_id))) throw notFound("Pasta não encontrada.");
    folderId = f.id;
  }
  const tooMany = await limited(c);
  if (tooMany) return tooMany;
  const live = await db.prepare("SELECT COUNT(*) AS n FROM share_links WHERE parent_link_id = ? AND revoked_at IS NULL").bind(l.id).first<number>("n");
  if ((live ?? 0) >= MAX_SHARES) return apiError(c, 429, "too_many_shares", "Este link já tem muitas partilhas. Pede a quem to enviou que revogue as que já não servem.");

  const sid = newId();
  const name = `Partilha de ${g.name}${to ? ` para ${to}` : ""}`;
  await db
    .prepare(
      `INSERT INTO share_links (id, token, name, artist_id, folder_id, track_id, version_mode, allow_download, show_lyrics, allow_comments, created_at, allow_share, parent_link_id, created_by_guest_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(sid, newToken(), name.slice(0, 120), l.artist_id, folderId, trackId, l.version_mode, l.show_lyrics, l.allow_comments, now(), l.id, g.id)
    .run();
  later(c.executionCtx, new URL(c.req.url).origin, (o) => notifyOwnerOfShare(c.env, o, sid));
  const row = await db.prepare(`${SHARE_SQL} WHERE s.id = ?`).bind(sid).first<Parameters<typeof shareDTO>[0]>();
  return c.json(shareDTO(row!), 201);
});

/** A guest takes back a share of theirs. */
share.delete("/:token/api/shares/:id", withLink, requireUnlocked, sharesOn, async (c) => {
  const g = await guestOf(c);
  if (!g) return noGuest(c);
  const r = await c.env.DB.prepare("UPDATE share_links SET revoked_at = ? WHERE id = ? AND parent_link_id = ? AND created_by_guest_id = ? AND revoked_at IS NULL")
    .bind(now(), id(c.req.param("id"), "Partilha"), c.get("link").id, g.id)
    .run();
  if (!r.meta.changes) throw notFound("Esta partilha já não existe.");
  return c.body(null, 204);
});

// ---------- Notifications ----------
// A device asks to hear about new music on this link and, once it has a name
// here, about the owner's replies to it. Works on listen-only links too.

share.post("/:token/api/push", withLink, requireUnlocked, async (c) => {
  const sub = parseSubscription(await jsonBody(c));
  const tooMany = await limited(c);
  if (tooMany) return tooMany;
  const g = c.get("link").allow_comments ? await guestOf(c) : null;
  await saveSubscription(c.env.DB, c.get("link").id, sub, g?.id ?? null);
  return c.body(null, 204);
});

share.delete("/:token/api/push", withLink, async (c) => {
  const b = await jsonBody(c);
  if (typeof b.endpoint === "string") await removeSubscription(c.env.DB, c.get("link").id, b.endpoint);
  return c.body(null, 204);
});

share.get("/:token/voice/:id", withLink, requireUnlocked, async (c) => {
  if (!c.get("link").allow_comments) return neutral(c);
  const row = await getCommentRow(c.env.DB, c.req.param("id"));
  if (!row?.voice_key || row.is_private || !(await trackInScope(c, row.track_id))) return neutral(c);
  return serveObject(c, c.env.BUCKET, row.voice_key, { contentType: row.voice_mime ?? "audio/mp4" });
});

/**
 * The guest pages are part of the SPA; the Worker only lets valid links through,
 * and points the page at the link's own manifest (installed, it opens this link).
 */
async function spa(c: ShareContext) {
  const res = await c.env.ASSETS.fetch(new URL("/", c.req.url));
  const href = `${base(c.get("link"))}/manifest.webmanifest`;
  const page = new HTMLRewriter().on('link[rel="manifest"]', { element: (el) => void el.setAttribute("href", href) }).transform(res);
  return new Response(page.body, { status: res.status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" } });
}

/** Installing a shared link on a phone: its name and colour, opening on the link itself. */
share.get("/:token/manifest.webmanifest", withLink, async (c) => {
  const l = c.get("link");
  const artist = await artistOf(c.env.DB, l);
  const hero = await heroFor(c.env.DB, l, artist);
  const start = base(l);
  return c.json(
    {
      name: `${hero.name} · nectr`,
      short_name: hero.name.slice(0, 24),
      lang: "pt-PT",
      start_url: start,
      scope: start,
      display: "standalone",
      background_color: "#111014",
      theme_color: "#111014",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    200,
    { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=3600" },
  );
});
share.get("/:token", withLink, spa);
share.get("/:token/t/:trackId", withLink, spa);
share.get("/:token/f/:folderId", withLink, spa);

share.all("*", neutral);

const NEUTRAL_PAGE = `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>nectr</title>
<style>
  :root { color-scheme: dark light; --bg: #0e0e12; --fg: #ececf1; --muted: #9a9aa8; }
  @media (prefers-color-scheme: light) { :root { --bg: #f7f7f9; --fg: #16161c; --muted: #5d5d6b; } }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: var(--bg); color: var(--fg);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; box-sizing: border-box; }
  main { max-width: 26rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Este link não está disponível</h1>
  <p>Pode ter expirado ou sido desativado. Pede um novo link a quem to enviou.</p>
</main>
</body>
</html>`;

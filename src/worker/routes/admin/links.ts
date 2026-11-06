import { Hono } from "hono";
import type { LinkDTO, LinkGuestDTO } from "../../../shared/api-types";
import { LIMITS } from "../../../shared/constants";
import { getArtist, getFolder, getTrack } from "../../lib/db";
import { badRequest, notFound } from "../../lib/errors";
import { newId, newToken, now } from "../../lib/ids";
import { id, idList, int, jsonBody, oneOf, text } from "../../lib/input";
import { hashPassword, linkStatus, targetType, type LinkRow } from "../../lib/links";
import type { AdminEnv } from ".";

export const links = new Hono<AdminEnv>();

type LinkListRow = LinkRow & { artist_name: string; folder_name: string | null; track_title: string | null; version_ids: string | null; creator_name: string | null };

const LIST_SQL = `SELECT s.*, a.name AS artist_name, f.name AS folder_name, f.parent_id AS folder_parent_id, t.title AS track_title,
    (SELECT group_concat(version_id) FROM share_link_versions WHERE link_id = s.id) AS version_ids,
    (SELECT name FROM guests WHERE id = s.created_by_guest_id) AS creator_name
  FROM share_links s JOIN artists a ON a.id = s.artist_id
  LEFT JOIN folders f ON f.id = s.folder_id LEFT JOIN tracks t ON t.id = s.track_id
  WHERE a.deleted_at IS NULL AND (s.folder_id IS NULL OR f.deleted_at IS NULL) AND (s.track_id IS NULL OR t.deleted_at IS NULL)`;

type GuestRow = { id: string; link_id: string; name: string; created_at: number; last_seen_at: number; n: number };

/** The names given on links (all of them, or one link's), by link. */
async function guestsByLink(db: D1Database, linkId?: string): Promise<Map<string, LinkGuestDTO[]>> {
  const rows = await db
    .prepare(
      `SELECT g.id, g.link_id, g.name, g.created_at, g.last_seen_at,
         (SELECT COUNT(*) FROM comments c WHERE c.guest_id = g.id AND c.deleted_at IS NULL) AS n
       FROM guests g ${linkId ? "WHERE g.link_id = ?" : ""} ORDER BY g.last_seen_at DESC`,
    )
    .bind(...(linkId ? [linkId] : []))
    .all<GuestRow>();
  const out = new Map<string, LinkGuestDTO[]>();
  for (const g of rows.results) {
    const list = out.get(g.link_id) ?? [];
    list.push({ id: g.id, name: g.name, createdAt: g.created_at, lastSeenAt: g.last_seen_at, comments: g.n });
    out.set(g.link_id, list);
  }
  return out;
}

function linkDTO(r: LinkListRow, guests: LinkGuestDTO[] = []): LinkDTO {
  const type = targetType(r);
  return {
    id: r.id,
    path: `/s/${r.token}`,
    name: r.name,
    target: {
      type,
      id: r.track_id ?? r.folder_id ?? r.artist_id,
      name: type === "track" ? r.track_title! : type === "artist" ? r.artist_name : r.folder_name!,
      artistId: r.artist_id,
      artistName: r.artist_name,
    },
    versionMode: r.version_mode,
    versionIds: r.version_ids ? r.version_ids.split(",") : [],
    hasPassword: !!r.password_hash,
    allowDownload: !!r.allow_download,
    showLyrics: !!r.show_lyrics,
    allowComments: !!r.allow_comments,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    lastViewedAt: r.last_viewed_at,
    status: linkStatus(r),
    guests,
    allowShare: !!r.allow_share,
    parentId: r.parent_link_id,
    createdBy: r.creator_name,
  };
}

/** A share follows its parent: same versions, lyrics, comments and expiry; revoked with it. */
function followParents(list: LinkDTO[]): LinkDTO[] {
  const byId = new Map(list.map((l) => [l.id, l]));
  return list.map((l) => {
    const p = l.parentId ? byId.get(l.parentId) : undefined;
    if (!p) return l;
    return {
      ...l,
      versionMode: p.versionMode,
      versionIds: p.versionIds,
      showLyrics: p.showLyrics,
      allowComments: p.allowComments,
      allowDownload: false,
      allowShare: false,
      hasPassword: false,
      expiresAt: p.expiresAt,
      status: l.status === "revoked" ? "revoked" : p.status,
    };
  });
}

async function getLink(db: D1Database, linkId: string): Promise<LinkDTO> {
  const r = await db.prepare(`${LIST_SQL} AND s.id = ?`).bind(linkId).first<LinkListRow>();
  if (!r) throw notFound("Link não encontrado.");
  const dto = linkDTO(r, (await guestsByLink(db, linkId)).get(linkId));
  if (!r.parent_link_id) return dto;
  const p = await db.prepare(`${LIST_SQL} AND s.id = ?`).bind(r.parent_link_id).first<LinkListRow>();
  return p ? followParents([linkDTO(p), dto])[1]! : dto;
}

const bool = (v: unknown, field: string) => {
  if (typeof v !== "boolean") throw badRequest(`${field}: valor inválido.`);
  return v ? 1 : 0;
};
const expiry = (v: unknown) => (v === null ? null : int(v, "Validade", now(), Number.MAX_SAFE_INTEGER));
const password = (v: unknown) => text(v, "Password", 200, 4);

/** Selected versions must belong to the link's tracks. */
async function checkVersions(db: D1Database, artistId: string, trackId: string | null, versionIds: string[]) {
  if (!versionIds.length) throw badRequest("Escolhe pelo menos uma versão.");
  for (const vid of versionIds) {
    const ok = await db
      .prepare("SELECT 1 AS ok FROM versions v JOIN tracks t ON t.id = v.track_id WHERE v.id = ? AND v.status = 'ready' AND v.deleted_at IS NULL AND t.artist_id = ? AND (?3 IS NULL OR t.id = ?3)")
      .bind(vid, artistId, trackId)
      .first("ok");
    if (!ok) throw badRequest("Uma das versões escolhidas não pertence a este link.");
  }
}

links.get("/links", async (c) => {
  const rows = await c.env.DB.prepare(`${LIST_SQL} ORDER BY s.created_at DESC`).all<LinkListRow>();
  const guests = await guestsByLink(c.env.DB);
  return c.json({ links: followParents(rows.results.map((r) => linkDTO(r, guests.get(r.id)))) });
});

links.post("/links", async (c) => {
  const db = c.env.DB;
  const b = await jsonBody(c);
  const t = (b.target ?? {}) as Record<string, unknown>;
  const type = oneOf(t.type, ["artist", "folder", "track"] as const, "Destino");
  const targetId = id(t.id, "Destino");
  let artistId: string;
  let folderId: string | null = null;
  let trackId: string | null = null;
  if (type === "artist") artistId = (await getArtist(db, targetId)).id;
  else if (type === "folder") ({ artist_id: artistId, id: folderId } = await getFolder(db, targetId));
  else ({ artist_id: artistId, id: trackId } = await getTrack(db, targetId));

  const mode = b.versionMode === undefined ? "all" : oneOf(b.versionMode, ["all", "latest", "selected"] as const, "Versões");
  const versionIds = mode === "selected" ? idList(b.versionIds, "Versões", 200) : [];
  if (mode === "selected") await checkVersions(db, artistId, trackId, versionIds);
  const pw = b.password === undefined || b.password === "" ? null : await hashPassword(password(b.password));

  const lid = newId();
  await db.batch([
    db.prepare(
      `INSERT INTO share_links (id, token, name, artist_id, folder_id, track_id, version_mode, password_hash, password_salt, password_iterations,
        allow_download, show_lyrics, allow_comments, expires_at, created_at, allow_share) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      lid,
      newToken(),
      text(b.name, "Nome do link", LIMITS.nameMax, 1),
      artistId,
      folderId,
      trackId,
      mode,
      pw?.hash ?? null,
      pw?.salt ?? null,
      pw?.iterations ?? null,
      b.allowDownload === undefined ? 0 : bool(b.allowDownload, "Download"),
      b.showLyrics === undefined ? 1 : bool(b.showLyrics, "Letra"),
      b.allowComments === undefined ? 1 : bool(b.allowComments, "Comentários"),
      b.expiresAt === undefined ? null : expiry(b.expiresAt),
      now(),
      b.allowShare === undefined ? 0 : bool(b.allowShare, "Partilhar"),
    ),
    ...versionIds.map((v) => db.prepare("INSERT INTO share_link_versions (link_id, version_id) VALUES (?, ?)").bind(lid, v)),
  ]);
  return c.json(await getLink(db, lid), 201);
});

links.patch("/links/:id", async (c) => {
  const db = c.env.DB;
  const current = await getLink(db, id(c.req.param("id"), "Link"));
  const b = await jsonBody(c);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), vals.push(v));
  // A guest's share follows its link: only its name and whether it is revoked are its own.
  if (current.parentId && Object.keys(b).some((k) => k !== "name" && k !== "revoked")) throw badRequest("Esta partilha segue o link de onde veio: muda esse link.");
  if (b.allowShare !== undefined) set("allow_share", bool(b.allowShare, "Partilhar"));

  if (b.name !== undefined) set("name", text(b.name, "Nome do link", LIMITS.nameMax, 1));
  if (b.allowDownload !== undefined) set("allow_download", bool(b.allowDownload, "Download"));
  if (b.showLyrics !== undefined) set("show_lyrics", bool(b.showLyrics, "Letra"));
  if (b.allowComments !== undefined) set("allow_comments", bool(b.allowComments, "Comentários"));
  if (b.expiresAt !== undefined) set("expires_at", expiry(b.expiresAt));
  if (b.revoked !== undefined) set("revoked_at", bool(b.revoked, "Revogado") ? now() : null);
  if (b.password !== undefined) {
    const pw = b.password === null || b.password === "" ? null : await hashPassword(password(b.password));
    set("password_hash", pw?.hash ?? null);
    set("password_salt", pw?.salt ?? null);
    set("password_iterations", pw?.iterations ?? null);
  }
  const stmts: D1PreparedStatement[] = [];
  if (b.versionMode !== undefined || b.versionIds !== undefined) {
    const mode = b.versionMode === undefined ? current.versionMode : oneOf(b.versionMode, ["all", "latest", "selected"] as const, "Versões");
    const versionIds = mode === "selected" ? idList(b.versionIds ?? current.versionIds, "Versões", 200) : [];
    if (mode === "selected") await checkVersions(db, current.target.artistId, current.target.type === "track" ? current.target.id : null, versionIds);
    set("version_mode", mode);
    stmts.push(db.prepare("DELETE FROM share_link_versions WHERE link_id = ?").bind(current.id));
    stmts.push(...versionIds.map((v) => db.prepare("INSERT INTO share_link_versions (link_id, version_id) VALUES (?, ?)").bind(current.id, v)));
  }
  if (sets.length) stmts.unshift(db.prepare(`UPDATE share_links SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, current.id));
  if (stmts.length) await db.batch(stmts);
  return c.json(await getLink(db, current.id));
});

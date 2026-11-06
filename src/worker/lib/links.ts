import type { LinkStatus, LinkTargetType, VersionMode } from "../../shared/api-types";
import { VERSION_COLS, type VersionRow } from "./db";

export interface LinkRow {
  id: string;
  token: string;
  name: string;
  artist_id: string;
  folder_id: string | null;
  track_id: string | null;
  version_mode: VersionMode;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  allow_download: number;
  show_lyrics: number;
  allow_comments: number;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
  last_viewed_at: number | null;
  /** Guests may share a track or folder of it. */
  allow_share: number;
  /** A share a guest made: the link it came from, and who made it. */
  parent_link_id: string | null;
  created_by_guest_id: string | null;
  /** Joined in by findLiveLink and the owner list: null when the folder is a project. */
  folder_parent_id?: string | null;
  /** Whose chosen versions apply ("selected" mode): a share uses its parent's. Set by findLiveLink. */
  selection_id?: string;
}

export const targetType = (l: Pick<LinkRow, "folder_id" | "track_id" | "folder_parent_id">): LinkTargetType =>
  l.track_id ? "track" : l.folder_id ? (l.folder_parent_id ? "folder" : "project") : "artist";

export const linkStatus = (l: Pick<LinkRow, "revoked_at" | "expires_at">, at = Date.now()): LinkStatus =>
  l.revoked_at ? "revoked" : l.expires_at !== null && l.expires_at <= at ? "expired" : "active";

// ---------- Password (PBKDF2-SHA256) ----------

/**
 * Kept low enough for the free plan's 10 ms CPU per request (D7 in plano.md).
 * Stored per link, so it can be raised later without breaking old links.
 */
export const PBKDF2_ITERATIONS = 15_000;

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS)), salt: b64(salt), iterations: PBKDF2_ITERATIONS };
}

/** Constant-time comparison of two byte strings of equal length. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyPassword(l: LinkRow, password: string): Promise<boolean> {
  if (!l.password_hash || !l.password_salt || !l.password_iterations) return true;
  const got = new Uint8Array(await pbkdf2(password, unb64(l.password_salt), l.password_iterations));
  return equal(got, unb64(l.password_hash));
}

// ---------- Unlock cookie (HMAC-SHA256) ----------

export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
export const cookieName = "nectr_unlock";

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/**
 * `<expiry>.<mac>`, bound to the token and to the current password salt, so
 * changing the password (new salt) logs every guest out of that link.
 */
export async function signUnlock(secret: string, l: LinkRow, at = Date.now()): Promise<{ value: string; expires: number }> {
  const expires = at + UNLOCK_TTL_MS;
  const mac = b64(await hmac(secret, `${l.token}.${l.password_salt}.${expires}`)).replace(/=+$/, "");
  return { value: `${expires}.${mac}`, expires };
}

export async function checkUnlock(secret: string, l: LinkRow, value: string | undefined, at = Date.now()): Promise<boolean> {
  if (!l.password_hash) return true;
  const m = value ? /^(\d{10,16})\.([A-Za-z0-9+/]+)$/.exec(value) : null;
  if (!m || Number(m[1]) <= at) return false;
  const want = b64(await hmac(secret, `${l.token}.${l.password_salt}.${m[1]}`)).replace(/=+$/, "");
  return equal(enc.encode(m[2]!), enc.encode(want));
}

// ---------- Failed password attempts ----------

/** Every 5th wrong password locks this client out of the link, a little longer each time. */
export const ATTEMPTS_PER_LOCK = 5;
const LOCK_MINUTES = [1, 5, 15, 60];
/** A day without wrong passwords starts the count again. */
const ATTEMPTS_RESET_MS = 24 * 60 * 60 * 1000;

/**
 * Who is trying: the IP (IPv6 by its /64 prefix, which a phone or a home keeps
 * while the rest rotates), as an HMAC so the database never holds an address.
 */
export async function clientKey(secret: string, ip: string): Promise<string> {
  let k = ip.trim().toLowerCase();
  if (k.includes(":") && !k.includes(".")) {
    const [head = "", tail = ""] = k.split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const groups = k.includes("::") ? [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
    k = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
  } else if (k.includes(".")) {
    k = k.slice(k.lastIndexOf(":") + 1); // IPv4, also when mapped into IPv6
  }
  return b64(await hmac(secret, `unlock:${k}`)).slice(0, 22);
}

/** Until when this client is locked out of the link (0 or past = free to try). */
export async function lockedUntil(db: D1Database, linkId: string, client: string): Promise<number> {
  const r = await db.prepare("SELECT locked_until FROM unlock_attempts WHERE link_id = ? AND client = ?").bind(linkId, client).first<number>("locked_until");
  return r ?? 0;
}

/** Counts a wrong password; returns the end of the lock it caused, or 0. */
export async function recordFailure(db: D1Database, linkId: string, client: string, at = Date.now()): Promise<number> {
  const fails = await db
    .prepare(
      `INSERT INTO unlock_attempts (link_id, client, fails, locked_until, updated_at) VALUES (?1, ?2, 1, 0, ?3)
       ON CONFLICT (link_id, client) DO UPDATE SET fails = CASE WHEN updated_at < ?4 THEN 1 ELSE fails + 1 END, updated_at = ?3
       RETURNING fails`,
    )
    .bind(linkId, client, at, at - ATTEMPTS_RESET_MS)
    .first<number>("fails");
  if (!fails || fails % ATTEMPTS_PER_LOCK) return 0;
  const until = at + LOCK_MINUTES[Math.min(fails / ATTEMPTS_PER_LOCK, LOCK_MINUTES.length) - 1]! * 60_000;
  await db.prepare("UPDATE unlock_attempts SET locked_until = ? WHERE link_id = ? AND client = ?").bind(until, linkId, client).run();
  return until;
}

export const clearFailures = (db: D1Database, linkId: string, client: string) =>
  db.prepare("DELETE FROM unlock_attempts WHERE link_id = ? AND client = ?").bind(linkId, client).run();

// ---------- What a link can see ----------

const LIVE_SQL = `SELECT s.*, f.parent_id AS folder_parent_id FROM share_links s JOIN artists a ON a.id = s.artist_id AND a.deleted_at IS NULL
       LEFT JOIN folders f ON f.id = s.folder_id
       LEFT JOIN tracks t ON t.id = s.track_id
       WHERE (s.folder_id IS NULL OR f.deleted_at IS NULL) AND (s.track_id IS NULL OR t.deleted_at IS NULL)`;

/**
 * The link and everything it points to must still exist and be live. A share a
 * guest made also needs its parent live, and follows it: same versions, lyrics,
 * comments and expiry, never downloads, never shares again.
 */
export async function findLiveLink(db: D1Database, token: string): Promise<LinkRow | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const l = await db.prepare(`${LIVE_SQL} AND s.token = ?`).bind(token).first<LinkRow>();
  if (!l || linkStatus(l) !== "active") return null;
  if (!l.parent_link_id) return { ...l, selection_id: l.id };
  const p = await db.prepare(`${LIVE_SQL} AND s.id = ?`).bind(l.parent_link_id).first<LinkRow>();
  if (!p || linkStatus(p) !== "active") return null;
  return {
    ...l,
    version_mode: p.version_mode,
    show_lyrics: p.show_lyrics,
    allow_comments: p.allow_comments,
    expires_at: p.expires_at,
    allow_download: 0,
    allow_share: 0,
    selection_id: p.id,
  };
}

const SUBTREE = `WITH RECURSIVE sub(id) AS (
  SELECT ?1 UNION SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id WHERE f.deleted_at IS NULL
)`;

/** Track rows in the link's scope (live, with at least one ready version). */
export async function scopeTracks(db: D1Database, l: LinkRow) {
  const cols = "t.id, t.folder_id, t.title, t.position, t.artwork_key, t.updated_at";
  const ready = "AND EXISTS (SELECT 1 FROM versions v WHERE v.track_id = t.id AND v.status = 'ready' AND v.deleted_at IS NULL)";
  const stmt = l.track_id
    ? db.prepare(`SELECT ${cols} FROM tracks t WHERE t.id = ?1 AND t.deleted_at IS NULL ${ready}`).bind(l.track_id)
    : l.folder_id
      ? db.prepare(`${SUBTREE} SELECT ${cols} FROM tracks t WHERE t.folder_id IN (SELECT id FROM sub) AND t.deleted_at IS NULL ${ready} ORDER BY t.position`).bind(l.folder_id)
      : db.prepare(`SELECT ${cols} FROM tracks t WHERE t.artist_id = ?1 AND t.deleted_at IS NULL ${ready} ORDER BY t.position`).bind(l.artist_id);
  return (await stmt.all<{ id: string; folder_id: string | null; title: string; position: number; artwork_key: string | null; updated_at: number }>()).results;
}

/** Ready versions of the given tracks after applying the link's version mode, newest first. */
export async function scopeVersions(db: D1Database, l: LinkRow, trackIds: string[]): Promise<VersionRow[]> {
  if (!trackIds.length) return [];
  const out: VersionRow[] = [];
  for (let i = 0; i < trackIds.length; i += 90) {
    const part = trackIds.slice(i, i + 90);
    const rows = await db
      .prepare(
        `SELECT ${VERSION_COLS} FROM versions WHERE status = 'ready' AND deleted_at IS NULL AND track_id IN (${part.map(() => "?").join(",")})
         ORDER BY number DESC`,
      )
      .bind(...part)
      .all<VersionRow>();
    out.push(...rows.results);
  }
  if (l.version_mode === "latest") {
    const seen = new Set<string>();
    return out.filter((v) => !seen.has(v.track_id) && seen.add(v.track_id));
  }
  if (l.version_mode === "selected") {
    const sel = await db.prepare("SELECT version_id FROM share_link_versions WHERE link_id = ?").bind(l.selection_id ?? l.id).all<{ version_id: string }>();
    const ids = new Set(sel.results.map((r) => r.version_id));
    return out.filter((v) => ids.has(v.id));
  }
  return out;
}

/** One version, only if the link can play it (used by every audio Range request). */
export async function versionInScope(db: D1Database, l: LinkRow, versionId: string): Promise<VersionRow | null> {
  const v = await db
    .prepare(
      `SELECT ${VERSION_COLS.replace(/(^|, )/g, "$1v.")}, t.folder_id, t.artist_id FROM versions v JOIN tracks t ON t.id = v.track_id
       WHERE v.id = ? AND v.status = 'ready' AND v.deleted_at IS NULL AND t.deleted_at IS NULL`,
    )
    .bind(versionId)
    .first<VersionRow & { folder_id: string | null; artist_id: string }>();
  if (!v || v.artist_id !== l.artist_id) return null;
  if (l.track_id && v.track_id !== l.track_id) return null;
  if (l.folder_id) {
    if (!v.folder_id) return null;
    const hit = await db.prepare(`${SUBTREE} SELECT 1 AS ok FROM sub WHERE id = ?2`).bind(l.folder_id, v.folder_id).first("ok");
    if (!hit) return null;
  }
  if (l.version_mode === "latest") {
    const max = await db.prepare("SELECT MAX(number) AS n FROM versions WHERE track_id = ? AND status = 'ready' AND deleted_at IS NULL").bind(v.track_id).first<number>("n");
    if (max !== v.number) return null;
  } else if (l.version_mode === "selected") {
    const hit = await db.prepare("SELECT 1 AS ok FROM share_link_versions WHERE link_id = ? AND version_id = ?").bind(l.selection_id ?? l.id, v.id).first("ok");
    if (!hit) return null;
  }
  return v;
}

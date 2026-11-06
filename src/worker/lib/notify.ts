import { getCommentRow, ownerName, type CommentRow } from "./comments";
import { badRequest } from "./errors";
import { newId } from "./ids";
import { findLiveLink, scopeTracks, scopeVersions, versionInScope, type LinkRow } from "./links";
import { isPushEndpoint, sendPush, unb64url, vapidOf, type PushMessage } from "./push";

// Who hears about what (each call runs after the response, in waitUntil):
// - the owner's devices: a guest's comment, voice note or reply;
// - a guest's devices on a link: the owner's reply in a thread they wrote in,
//   and new music on that link (a new track, or a new version they can play).
// Private owner notes never notify anyone.

/** Enough for a personal app, and well inside the free plan's subrequests and CPU per request. */
const MAX_SENDS = 25;
const RECENT_MS = 30 * 60 * 1000;

interface SubRow {
  id: string;
  scope: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const SUB_COLS = "p.id, p.scope, p.endpoint, p.p256dh, p.auth";

async function deliver(env: Env, origin: string, subs: SubRow[], message: PushMessage, topic: string) {
  const vapid = await vapidOf(env);
  if (!vapid || !subs.length) return;
  const results = await Promise.all(subs.slice(0, MAX_SENDS).map((s) => sendPush(vapid, origin, s, message, { topic })));
  // The push service says the device unsubscribed (or the browser data was cleared).
  const gone = subs.filter((_, i) => results[i] === "gone").map((s) => s.id);
  if (gone.length) await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id IN (${gone.map(() => "?").join(",")})`).bind(...gone).run();
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

async function trackOf(db: D1Database, trackId: string) {
  return db.prepare("SELECT id, title, artist_id FROM tracks WHERE id = ?").bind(trackId).first<{ id: string; title: string; artist_id: string }>();
}

/** "Marta: texto" / "Marta respondeu: texto" / "Marta enviou uma nota de voz (0:12)". */
function said(who: string, row: CommentRow) {
  if (row.voice_key) return `${who} ${row.parent_id ? "respondeu com" : "enviou"} uma nota de voz (${mmss(row.voice_duration_s ?? 0)})`;
  return `${who}${row.parent_id ? " respondeu" : ""}: ${clip(row.body)}`;
}

/** A guest wrote something: the owner's devices. */
export async function notifyOwnerOfComment(env: Env, origin: string, commentId: string) {
  const db = env.DB;
  const row = await getCommentRow(db, commentId);
  if (!row || row.guest_id === null) return;
  const track = await trackOf(db, row.track_id);
  if (!track) return;
  const subs = (await db.prepare(`SELECT ${SUB_COLS} FROM push_subscriptions p WHERE p.scope = 'owner'`).all<SubRow>()).results;
  const who = [row.guest_name ?? "Convidado", row.link_name].filter(Boolean).join(" · ");
  await deliver(env, origin, subs, {
    title: `${track.title} · v${row.version_number}`,
    body: said(who, row),
    tag: `c-${track.id}`,
    url: `/admin/artistas/${track.artist_id}/faixas/${track.id}?v=${row.version_id}&c=${row.parent_id ?? row.id}`,
  }, `c-${track.id}`);
}

/** A guest shared a track or folder of a link: the owner's devices. */
export async function notifyOwnerOfShare(env: Env, origin: string, linkId: string) {
  const db = env.DB;
  const r = await db
    .prepare(
      `SELECT g.name AS who, p.name AS parent, COALESCE(t.title, f.name) AS what FROM share_links s
       JOIN share_links p ON p.id = s.parent_link_id LEFT JOIN guests g ON g.id = s.created_by_guest_id
       LEFT JOIN tracks t ON t.id = s.track_id LEFT JOIN folders f ON f.id = s.folder_id WHERE s.id = ?`,
    )
    .bind(linkId)
    .first<{ who: string | null; parent: string; what: string | null }>();
  if (!r) return;
  const subs = (await db.prepare(`SELECT ${SUB_COLS} FROM push_subscriptions p WHERE p.scope = 'owner'`).all<SubRow>()).results;
  await deliver(env, origin, subs, {
    title: "Nova partilha",
    body: `${r.who ?? "Um convidado"} partilhou “${r.what ?? "?"}” (link ${r.parent})`,
    tag: `s-${linkId}`,
    url: "/admin/links",
  }, `s-${linkId}`);
}

/** The owner replied in a thread: the guests who wrote in it, on links that still show the track. */
export async function notifyGuestsOfReply(env: Env, origin: string, commentId: string) {
  const db = env.DB;
  const row = await getCommentRow(db, commentId);
  if (!row || row.guest_id !== null || row.is_private || !row.parent_id) return;
  const track = await trackOf(db, row.track_id);
  if (!track) return;
  const subs = (
    await db
      .prepare(
        `SELECT ${SUB_COLS}, s.token FROM push_subscriptions p JOIN share_links s ON s.id = p.scope
         WHERE p.guest_id IN (SELECT DISTINCT guest_id FROM comments WHERE (id = ?1 OR parent_id = ?1) AND guest_id IS NOT NULL AND deleted_at IS NULL)`,
      )
      .bind(row.parent_id)
      .all<SubRow & { token: string }>()
  ).results;
  const name = await ownerName(db);
  const byToken = new Map<string, SubRow[]>();
  for (const s of subs) byToken.set(s.token, [...(byToken.get(s.token) ?? []), s]);
  for (const [token, list] of byToken) {
    const l = await findLiveLink(db, token);
    if (!l?.allow_comments || !(await scopeTracks(db, l)).some((t) => t.id === track.id)) continue;
    await deliver(env, origin, list, {
      title: `${track.title} · v${row.version_number}`,
      body: said(name, row),
      tag: `r-${row.parent_id}`,
      url: `/s/${token}/t/${track.id}?v=${row.version_id}&c=${row.parent_id}`,
    }, `r-${row.parent_id}`);
  }
}

/** The name a guest knows the link by: its folder or project, the track, or the artist. */
async function linkTitle(db: D1Database, l: LinkRow) {
  if (l.folder_id) return (await db.prepare("SELECT name FROM folders WHERE id = ?").bind(l.folder_id).first<string>("name")) ?? "nectr";
  if (l.track_id) return (await db.prepare("SELECT title FROM tracks WHERE id = ?").bind(l.track_id).first<string>("title")) ?? "nectr";
  return (await db.prepare("SELECT name FROM artists WHERE id = ?").bind(l.artist_id).first<string>("name")) ?? "nectr";
}

/**
 * A version became ready: guests of every link that can now play it. Uploads
 * come in batches (a whole album), so the notification sums up what arrived
 * on that link in the last half hour; each one replaces the previous.
 */
export async function notifyGuestsOfVersion(env: Env, origin: string, versionId: string, at = Date.now()) {
  const db = env.DB;
  const v = await db
    .prepare("SELECT v.track_id, t.artist_id FROM versions v JOIN tracks t ON t.id = v.track_id WHERE v.id = ? AND v.status = 'ready'")
    .bind(versionId)
    .first<{ track_id: string; artist_id: string }>();
  if (!v) return;
  const tokens = (
    await db
      .prepare(
        `SELECT DISTINCT s.token FROM share_links s JOIN push_subscriptions p ON p.scope = s.id
         WHERE s.artist_id = ? AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)`,
      )
      .bind(v.artist_id, at)
      .all<{ token: string }>()
  ).results;
  for (const { token } of tokens) {
    const l = await findLiveLink(db, token);
    if (!l || !(await versionInScope(db, l, versionId))) continue;
    const subs = (await db.prepare(`SELECT ${SUB_COLS}, p.created_at FROM push_subscriptions p WHERE p.scope = ?`).bind(l.id).all<SubRow & { created_at: number }>()).results;
    // What arrived lately, and only after these devices asked (what came before, they have seen).
    const since = Math.max(at - RECENT_MS, ...subs.map((x) => x.created_at));
    const tracks = await scopeTracks(db, l);
    const versions = await scopeVersions(db, l, tracks.map((t) => t.id));
    const recent = versions.filter((x) => x.created_at >= since);
    if (!recent.some((x) => x.id === versionId)) recent.push((await versionInScope(db, l, versionId))!);
    const titleOf = new Map(tracks.map((t) => [t.id, t.title]));
    const recentTracks = [...new Set(recent.map((x) => x.track_id))];
    let body: string, url: string;
    if (recentTracks.length === 1) {
      const x = recent.find((r) => r.id === versionId)!;
      const title = titleOf.get(x.track_id) ?? "";
      body = x.number > 1 ? `Nova versão de ${title}: v${x.number}${x.label ? ` · ${x.label}` : ""}` : `Faixa nova: ${title}`;
      url = `/s/${token}/t/${x.track_id}?v=${x.id}`;
    } else {
      const names = recentTracks.map((id) => titleOf.get(id) ?? "");
      const list = names.length <= 3 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : `${names.slice(0, 2).join(", ")} e mais ${names.length - 2}`;
      body = `${names.length} novidades: ${list}`;
      url = `/s/${token}`;
    }
    await deliver(env, origin, subs, { title: await linkTitle(db, l), body, tag: `u-${l.id}`, url }, `u-${l.id}`);
  }
}

/** Runs a notification after the response; a failure never touches the request. */
export function later(ctx: { waitUntil(p: Promise<unknown>): void }, origin: string, run: (origin: string) => Promise<void>) {
  ctx.waitUntil(run(origin).catch((e) => console.error("notify", e)));
}

// ---------- Devices ----------

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A browser PushSubscription (toJSON()), checked: a real push service and well-formed keys. */
export function parseSubscription(b: Record<string, unknown>): Subscription {
  const keys = (b.keys ?? {}) as Record<string, unknown>;
  const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  const size = (s: string) => {
    try {
      return /^[A-Za-z0-9_-]+={0,2}$/.test(s) ? unb64url(s.replace(/=+$/, "")).length : 0;
    } catch {
      return 0;
    }
  };
  if (!isPushEndpoint(endpoint) || size(p256dh) !== 65 || size(auth) !== 16) throw badRequest("Este browser deu uma subscrição de avisos inválida.");
  return { endpoint, p256dh: p256dh.replace(/=+$/, ""), auth: auth.replace(/=+$/, "") };
}

/** Most devices one audience keeps (the oldest goes when a new one arrives). */
const MAX_DEVICES = 20;

export async function saveSubscription(db: D1Database, scope: string, s: Subscription, guestId: string | null) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_subscriptions (id, scope, endpoint, p256dh, auth, guest_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint, scope) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, guest_id = excluded.guest_id`,
      )
      .bind(newId(), scope, s.endpoint, s.p256dh, s.auth, guestId, Date.now()),
    db
      .prepare(`DELETE FROM push_subscriptions WHERE scope = ?1 AND id NOT IN (SELECT id FROM push_subscriptions WHERE scope = ?1 ORDER BY created_at DESC LIMIT ${MAX_DEVICES})`)
      .bind(scope),
  ]);
}

export const removeSubscription = (db: D1Database, scope: string, endpoint: string) =>
  db.prepare("DELETE FROM push_subscriptions WHERE scope = ? AND endpoint = ?").bind(scope, endpoint).run();

/** A test notification for one of the owner's devices. */
export async function sendTest(env: Env, origin: string, endpoint: string): Promise<boolean> {
  const sub = await env.DB.prepare(`SELECT ${SUB_COLS} FROM push_subscriptions p WHERE p.scope = 'owner' AND p.endpoint = ?`).bind(endpoint).first<SubRow>();
  const vapid = await vapidOf(env);
  if (!sub || !vapid) return false;
  const r = await sendPush(vapid, origin, sub, { title: "nectr", body: "Os avisos estão a funcionar neste dispositivo.", tag: "test", url: "/admin" });
  if (r === "gone") await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
  return r === "sent";
}

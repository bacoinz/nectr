import { api } from "./api";

// Notifications on this device (Web Push). A browser has one subscription; the
// same one is registered for each audience that switched them on here: the
// owner ("owner") and/or one or more links ("link:<token>"). The browser does
// the delivery through public/sw.js, with the page closed.

export type PushState = "unsupported" | "ios-install" | "unconfigured" | "denied" | "off" | "on";

/** Where one audience saves and removes this device. */
export interface PushTarget {
  scope: string;
  save(sub: PushSubscriptionJSON): Promise<unknown>;
  remove(endpoint: string): Promise<unknown>;
  /** Changes when the device gets a name on the link (it then hears about replies too). */
  who?: () => string;
}

export const ownerPush: PushTarget = {
  scope: "owner",
  save: (sub) => api("/api/admin/push", { method: "POST", json: sub }),
  remove: (endpoint) => api("/api/admin/push", { method: "DELETE", json: { endpoint } }),
};

export function linkPush(token: string, who: () => { id: string; secret: string } | null): PushTarget {
  const headers = (): Record<string, string> => {
    const g = who();
    return g ? { "X-Guest": `${g.id}.${g.secret}` } : {};
  };
  return {
    scope: `link:${token}`,
    save: (sub) => api(`/s/${token}/api/push`, { method: "POST", json: sub, headers: headers() }),
    remove: (endpoint) => api(`/s/${token}/api/push`, { method: "DELETE", json: { endpoint } }),
    who: () => who()?.id ?? "",
  };
}

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/** iPhone/iPad: Web Push only for a site added to the home screen. */
const iosBrowser = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let key: Promise<string | null> | null = null;
/** The server's public key (null until the owner set it up). */
function serverKey() {
  key ??= fetch("/api/push/key")
    .then((r) => (r.ok ? r.json() : { key: null }))
    .then((j: { key: string | null }) => j.key)
    .catch(() => ((key = null), null));
  return key;
}

const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sameBytes = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

// What this device switched on, per audience: { endpoint, who, at }.
interface Mark {
  endpoint: string;
  who: string;
  at: number;
}
const STORE = "nectr.push";
function marks(): Record<string, Mark> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, Mark>;
  } catch {
    return {};
  }
}
function mark(scope: string, m: Mark | null) {
  const all = marks();
  if (m) all[scope] = m;
  else delete all[scope];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* private window: on for this visit only */
  }
}

async function currentSub() {
  return (await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription()) ?? null;
}

export async function pushState(t: PushTarget): Promise<PushState> {
  if (!supported()) return iosBrowser() ? "ios-install" : "unsupported";
  if (!(await serverKey())) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const sub = await currentSub();
  return sub && Notification.permission === "granted" && marks()[t.scope]?.endpoint === sub.endpoint ? "on" : "off";
}

/** Asks the browser (it must follow a tap or click) and registers this device. */
export async function enablePush(t: PushTarget): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const k = await serverKey();
  if (!k) return "unconfigured";
  if (!(await navigator.serviceWorker.getRegistration("/"))) await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Made with another server key: unusable, start over.
  if (sub && !sameBytes(sub.options.applicationServerKey, bytes(k))) (await sub.unsubscribe(), (sub = null));
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(k) });
  await t.save(sub.toJSON());
  mark(t.scope, { endpoint: sub.endpoint, who: t.who?.() ?? "", at: Date.now() });
  return "on";
}

export async function disablePush(t: PushTarget): Promise<PushState> {
  const m = marks()[t.scope];
  mark(t.scope, null);
  if (m) await t.remove(m.endpoint).catch(() => {});
  // The browser's subscription goes only when no audience on this device uses it.
  if (!Object.keys(marks()).length) await (await currentSub())?.unsubscribe();
  return "off";
}

/**
 * On a visit, an audience that is on sends its subscription again when it
 * changed (browsers renew them), when the device got a name, or once a day.
 */
export async function refreshPush(t: PushTarget) {
  const m = marks()[t.scope];
  if (!m || !supported() || Notification.permission !== "granted") return;
  const sub = await currentSub();
  if (!sub) return mark(t.scope, null);
  const who = t.who?.() ?? "";
  if (sub.endpoint === m.endpoint && who === m.who && Date.now() - m.at < 86400_000) return;
  if (sub.endpoint !== m.endpoint) await t.remove(m.endpoint).catch(() => {});
  await t.save(sub.toJSON());
  mark(t.scope, { endpoint: sub.endpoint, who, at: Date.now() });
}

/** Sends a test notification to this device (owner). */
export async function testPush() {
  const sub = await currentSub();
  if (sub) await api("/api/admin/push/test", { method: "POST", json: { endpoint: sub.endpoint } });
}

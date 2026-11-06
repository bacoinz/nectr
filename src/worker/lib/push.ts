// Web Push without a library: the message is encrypted for the device
// (RFC 8291, aes128gcm) and the request is signed with the app's VAPID key
// (RFC 8292). The browser's push service (Mozilla's, Google's…) delivers it
// to the service worker, even with the page closed.

export interface PushTarget {
  endpoint: string;
  /** The device's public key (P-256, uncompressed, base64url). */
  p256dh: string;
  /** The device's 16-byte auth secret (base64url). */
  auth: string;
}

/** What the service worker shows (public/sw.js). */
export interface PushMessage {
  title: string;
  body: string;
  /** Same tag = the notification is replaced, not stacked. */
  tag: string;
  /** Opened on tap (a path of this site). */
  url: string;
}

export type PushResult = "sent" | "gone" | "failed";

/** Bytes backed by a plain ArrayBuffer (what Web Crypto and fetch take). */
type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const utf8 = (s: string): Bytes => new Uint8Array(enc.encode(s));

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Bytes {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** A P-256 public point (0x04 ‖ x ‖ y) as the x/y of a JWK. */
function pointXY(raw: Uint8Array) {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Chave pública inválida.");
  return { x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33)) };
}

/**
 * Encrypts a message for one device (RFC 8291). `sender` and `salt` are only
 * passed by the tests (the RFC's example); normally both are new every time.
 */
export async function encryptPush(
  plaintext: Bytes,
  target: Pick<PushTarget, "p256dh" | "auth">,
  fixed?: { sender: { privateKey: string; publicKey: string }; salt: Bytes },
): Promise<Bytes> {
  const uaPublic = unb64url(target.p256dh);
  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
  let asPrivate: CryptoKey, asPublic: Bytes;
  if (fixed) {
    asPublic = unb64url(fixed.sender.publicKey);
    asPrivate = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", ...pointXY(asPublic), d: fixed.sender.privateKey }, ecdh, false, ["deriveBits"]);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, ecdh, false, []);
  // `public` is the Web Crypto name; the workers types spell it `$public`.
  const params = { name: "ECDH", public: uaKey } as never;
  const secret = new Uint8Array(await crypto.subtle.deriveBits(params, asPrivate, 256));

  const ikm = await hkdf(unb64url(target.auth), secret, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // One record: the message and the 0x02 "last record" delimiter.
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

// ---------- VAPID ----------

interface Vapid {
  key: CryptoKey;
  /** Public key, base64url: what the browser subscribes with. */
  publicKey: string;
}

let cached: { jwk: string; vapid: Vapid } | null = null;

/** The app's VAPID key pair, from the VAPID_JWK secret (a P-256 private JWK); null when not set up. */
export async function vapidOf(env: { VAPID_JWK?: string }): Promise<Vapid | null> {
  const raw = env.VAPID_JWK;
  if (!raw) return null;
  if (cached?.jwk === raw) return cached.vapid;
  const jwk = JSON.parse(raw) as JsonWebKey;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const publicKey = b64url(concat(Uint8Array.of(4), unb64url(jwk.x!), unb64url(jwk.y!)));
  const vapid = { key, publicKey };
  cached = { jwk: raw, vapid };
  return vapid;
}

/** "vapid t=<JWT>, k=<public key>" for one push service (the JWT's audience). */
export async function vapidAuth(vapid: Vapid, endpoint: string, contact: string, at = Date.now()): Promise<string> {
  const part = (o: object) => b64url(utf8(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(at / 1000) + 12 * 3600, sub: contact })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapid.key, utf8(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.publicKey}`;
}

// ---------- Sending ----------

/**
 * Only the browsers' own push services: the endpoint comes from the browser,
 * and the Worker must never be made to post anywhere else.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname)) && endpoint.length <= 1024;
  } catch {
    return false;
  }
}

export async function sendPush(
  vapid: Vapid,
  contact: string,
  target: PushTarget,
  message: PushMessage,
  opts: { ttl?: number; topic?: string } = {},
): Promise<PushResult> {
  if (!isPushEndpoint(target.endpoint)) return "gone";
  try {
    const body = await encryptPush(utf8(JSON.stringify(message)), target);
    const headers: Record<string, string> = {
      Authorization: await vapidAuth(vapid, target.endpoint, contact),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl ?? 2 * 24 * 3600),
      Urgency: "normal",
    };
    // A newer message with the same topic replaces one still waiting for the device.
    if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
    const res = await fetch(target.endpoint, { method: "POST", headers, body });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) console.warn("push", res.status, new URL(target.endpoint).hostname, (await res.text()).slice(0, 200));
    return res.ok ? "sent" : "failed";
  } catch (e) {
    console.warn("push", e);
    return "failed";
  }
}

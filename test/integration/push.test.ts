import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtistResponse, CommentDTO, FolderDTO, GuestIdentity, LinkDTO, UploadResponse, VersionDTO } from "../../src/shared/api-types";
import { encodePeaks } from "../../src/shared/peaks";
import { purge } from "../../src/worker/cron";
import { b64url, unb64url } from "../../src/worker/lib/push";
import { makeWav } from "../fixtures/audio";

const OWNER = "http://localhost";
const GUEST = "https://nectr.example.workers.dev";
const PEAKS = encodePeaks(new Float32Array(64));

async function call<T>(base: string, method: string, path: string, body?: unknown, who?: GuestIdentity): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (who) headers["X-Guest"] = `${who.id}.${who.secret}`;
  const raw = body instanceof Uint8Array;
  const res = await exports.default.fetch(`${base}${path}`, { method, headers: raw ? {} : headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: T | undefined;
  try { json = JSON.parse(text) as T; } catch { /* empty */ }
  return { status: res.status, json: json as T };
}
const owner = <T>(method: string, path: string, body?: unknown) => call<T>(OWNER, method, path, body);
const guest = <T>(method: string, path: string, body?: unknown, who?: GuestIdentity) => call<T>(GUEST, method, path, body, who);

/** A browser's push subscription, with the private key to read what arrives. */
async function device() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const endpoint = `https://fcm.googleapis.com/fcm/send/${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
  return { endpoint, keys: { p256dh: b64url(pub), auth: b64url(auth) }, privateKey: pair.privateKey };
}
type Device = Awaited<ReturnType<typeof device>>;
const sub = (d: Device) => ({ endpoint: d.endpoint, keys: d.keys });

/** RFC 8291 from the receiving side, as the browser does it. */
async function readPush(d: Device, body: Uint8Array) {
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, n: number) => {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const i = typeof info === "string" ? new TextEncoder().encode(info) : info;
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: i }, k, n * 8));
  };
  const salt = body.subarray(0, 16);
  const asPublic = body.subarray(21, 21 + body[20]!);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const params = { name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const secret = new Uint8Array(await crypto.subtle.deriveBits(params, d.privateKey, 256));
  const uaPublic = unb64url(d.keys.p256dh);
  const info = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(unb64url(d.keys.auth), secret, info, 32);
  const cek = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16), "AES-GCM", false, ["decrypt"]);
  const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, body.subarray(21 + body[20]!)));
  return JSON.parse(new TextDecoder().decode(plain.subarray(0, plain.lastIndexOf(2)))) as { title: string; body: string; tag: string; url: string };
}

// Outgoing requests to the push service are caught here; `reply` sets its answer.
let sent: { endpoint: string; headers: Headers; body: Uint8Array }[] = [];
let reply = 201;
beforeEach(() => {
  sent = [];
  reply = 201;
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (new URL(req.url).hostname !== "fcm.googleapis.com") return real(input, init);
    sent.push({ endpoint: req.url, headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) });
    return new Response(null, { status: reply });
  });
});
afterEach(() => vi.restoreAllMocks());

const to = (d: Device) => sent.filter((s) => s.endpoint === d.endpoint);
async function arrived(d: Device, n = 1) {
  await vi.waitFor(() => expect(to(d)).toHaveLength(n), { timeout: 3000 });
  return Promise.all(to(d).map((s) => readPush(d, s.body)));
}
const settle = () => new Promise((r) => setTimeout(r, 150));

async function upload(artistId: string, filename: string, extra: Record<string, unknown>) {
  const file = makeWav({ frames: 4410 });
  const u = (await owner<UploadResponse>("POST", "/api/admin/uploads", { artistId, filename, size: file.length, ...extra })).json;
  await owner("PUT", u.upload.url, file);
  const v = (await owner<VersionDTO>("POST", `/api/admin/versions/${u.versionId}/finalize`, { peaks: PEAKS })).json;
  return { trackId: u.trackId, versionId: v.id };
}

async function setup() {
  const artist = (await owner<ArtistResponse>("POST", "/api/admin/artists", { name: "Luz" })).json.artist;
  const project = (await owner<FolderDTO>("POST", `/api/admin/artists/${artist.id}/folders`, { name: "Marés" })).json;
  const a1 = await upload(artist.id, "Onda.wav", { folderId: project.id });
  const link = async (body: Record<string, unknown>) => (await owner<LinkDTO>("POST", "/api/admin/links", { name: "Editora", target: { type: "folder", id: project.id }, ...body })).json;
  return { artist, project, a1, link };
}

describe("notifications", () => {
  it("gives the public key and refuses anything that is not a push service", async () => {
    const k = await call<{ key: string }>(GUEST, "GET", "/api/push/key");
    expect(unb64url(k.json.key)).toHaveLength(65);

    const d = await device();
    expect((await owner("POST", "/api/admin/push", sub(d))).status).toBe(204);
    expect((await owner("POST", "/api/admin/push", { ...sub(d), endpoint: "https://evil.example/collect" })).status).toBe(400);
    expect((await owner("POST", "/api/admin/push", { ...sub(d), endpoint: "http://fcm.googleapis.com/fcm/send/x" })).status).toBe(400);
    expect((await owner("POST", "/api/admin/push", { endpoint: d.endpoint, keys: { p256dh: "abc", auth: d.keys.auth } })).status).toBe(400);
    // Saving again is not a second device.
    await owner("POST", "/api/admin/push", sub(d));
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").bind(d.endpoint).first<number>("n");
    expect(n).toBe(1);

    expect((await owner("POST", "/api/admin/push/test", { endpoint: d.endpoint })).status).toBe(204);
    const [test] = await arrived(d);
    expect(test).toMatchObject({ title: "nectr", url: "/admin" });
    expect(to(d)[0]!.headers.get("Authorization")).toMatch(/^vapid t=.+, k=.+$/);
    expect(to(d)[0]!.headers.get("Content-Encoding")).toBe("aes128gcm");
    await owner("DELETE", "/api/admin/push", { endpoint: d.endpoint });
  });

  it("tells the owner about a guest's comment, and the guest about the owner's reply", async () => {
    const s = await setup();
    const l = await s.link({});
    const me = await device();
    await owner("POST", "/api/admin/push", sub(me));
    const rita = (await guest<GuestIdentity>("POST", `${l.path}/api/guest`, { name: "Rita" })).json;
    const phone = await device();
    expect((await guest("POST", `${l.path}/api/push`, sub(phone), rita)).status).toBe(204);

    const c = (await guest<CommentDTO>("POST", `${l.path}/api/comments`, { versionId: s.a1.versionId, body: "O refrão pode subir", tStart: 0.05 }, rita)).json;
    const [toOwner] = await arrived(me);
    expect(toOwner).toEqual({
      title: "Onda · v1",
      body: "Rita · Editora: O refrão pode subir",
      tag: `c-${s.a1.trackId}`,
      url: `/admin/artistas/${s.artist.id}/faixas/${s.a1.trackId}?v=${s.a1.versionId}&c=${c.id}`,
    });
    expect(to(me)[0]!.headers.get("Topic")).toBe(`c-${s.a1.trackId}`);

    // A private note in the thread says nothing; a public reply reaches Rita.
    await owner("POST", "/api/admin/comments", { versionId: s.a1.versionId, parentId: c.id, body: "nota só minha", tStart: 0, isPrivate: true });
    await owner("POST", "/api/admin/comments", { versionId: s.a1.versionId, parentId: c.id, body: "Combinado, subo 2 dB", tStart: 0 });
    const [toRita] = await arrived(phone);
    expect(toRita).toMatchObject({ title: "Onda · v1", body: "Produtor respondeu: Combinado, subo 2 dB", url: `${l.path}/t/${s.a1.trackId}?v=${s.a1.versionId}&c=${c.id}` });
    await settle();
    expect(to(phone)).toHaveLength(1);
    // The owner's own reply is not news to the owner.
    expect(to(me)).toHaveLength(1);
  });

  it("tells a link's guests about new music they can play, and nobody else", async () => {
    const s = await setup();
    const all = await s.link({});
    const latest = await s.link({ versionMode: "latest" });
    const picked = await s.link({ target: { type: "track", id: s.a1.trackId }, versionMode: "selected", versionIds: [s.a1.versionId] });
    const revoked = await s.link({});
    await owner("PATCH", `/api/admin/links/${revoked.id}`, { revoked: true });
    const [dAll, dLatest, dPicked, dRevoked] = await Promise.all([device(), device(), device(), device()]);
    for (const [l, d] of [[all, dAll], [latest, dLatest], [picked, dPicked]] as const) expect((await guest("POST", `${l.path}/api/push`, sub(d))).status).toBe(204);
    // A revoked link takes no new devices either.
    expect((await guest("POST", `${revoked.path}/api/push`, sub(dRevoked))).status).toBe(404);

    const v2 = await upload(s.artist.id, "Onda.wav", { trackId: s.a1.trackId });
    const [n] = await arrived(dAll);
    expect(n).toEqual({ title: "Marés", body: "Nova versão de Onda: v2", tag: `u-${all.id}`, url: `${all.path}/t/${s.a1.trackId}?v=${v2.versionId}` });
    await arrived(dLatest);
    await settle();
    expect(to(dPicked)).toHaveLength(0);

    // A batch sums up what arrived on the link in the last half hour.
    await upload(s.artist.id, "Brisa.wav", { folderId: s.project.id });
    const sums = await arrived(dAll, 2);
    expect(sums[1]!.body).toBe("2 novidades: Onda e Brisa");
    expect(sums[1]!.url).toBe(all.path);
  });

  it("forgets a device the push service no longer knows, and devices of revoked links", async () => {
    const s = await setup();
    const l = await s.link({});
    const d = await device();
    await guest("POST", `${l.path}/api/push`, sub(d));
    reply = 410;
    await upload(s.artist.id, "Vento.wav", { folderId: s.project.id });
    await arrived(d);
    await vi.waitFor(async () => expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").bind(d.endpoint).first("n")).toBe(0));

    reply = 201;
    const d2 = await device();
    await guest("POST", `${l.path}/api/push`, sub(d2));
    await guest("DELETE", `${l.path}/api/push`, { endpoint: d2.endpoint });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").bind(d2.endpoint).first("n")).toBe(0);

    const d3 = await device();
    await guest("POST", `${l.path}/api/push`, sub(d3));
    await owner("PATCH", `/api/admin/links/${l.id}`, { revoked: true });
    await purge(env);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?").bind(d3.endpoint).first("n")).toBe(0);
  });
});

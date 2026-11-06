import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ArtistResponse, FolderDTO, GuestInfoDTO, LinkDTO, UploadResponse, VersionDTO } from "../../src/shared/api-types";
import { encodePeaks } from "../../src/shared/peaks";
import { clientKey, recordFailure } from "../../src/worker/lib/links";
import { makeWav } from "../fixtures/audio";

const OWNER = "http://localhost";
const GUEST = "https://nectr.example.workers.dev";
const PEAKS = encodePeaks(new Float32Array(64));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const NEUTRAL = "Este link não está disponível";

async function owner<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await exports.default.fetch(`${OWNER}${path}`, {
    method,
    headers: body instanceof Uint8Array ? headers : { "Content-Type": "application/json", ...headers },
    body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as T };
}

async function guest(path: string, init: RequestInit = {}) {
  return exports.default.fetch(`${GUEST}${path}`, init);
}

/** Artist "Duarte" → project "Noites" (Alfa v1+v2) → folder "Demos" (Demo); plus a loose track "Solto". */
async function setup() {
  const artist = (await owner<ArtistResponse>("POST", "/api/admin/artists", { name: "Duarte" })).json.artist;
  const project = (await owner<FolderDTO>("POST", `/api/admin/artists/${artist.id}/folders`, { name: "Noites", year: 2026, description: "Verão de 2026" })).json;
  const folder = (await owner<FolderDTO>("POST", `/api/admin/artists/${artist.id}/folders`, { name: "Demos", parentId: project.id })).json;
  const add = async (filename: string, extra: Record<string, unknown> = {}) => {
    const file = makeWav({ frames: 500 });
    const u = (await owner<UploadResponse>("POST", "/api/admin/uploads", { artistId: artist.id, filename, size: file.length, ...extra })).json;
    await owner("PUT", u.upload.url, file);
    const v = (await owner<VersionDTO>("POST", `/api/admin/versions/${u.versionId}/finalize`, { peaks: PEAKS })).json;
    return { trackId: u.trackId, versionId: v.id };
  };
  const a1 = await add("Alfa.wav", { folderId: project.id });
  const a2 = await add("Alfa.wav", { trackId: a1.trackId });
  const demo = await add("Demo.wav", { folderId: folder.id });
  const loose = await add("Solto.wav");
  return { artist, project, folder, a1, a2, demo, loose };
}

async function link(body: Record<string, unknown>) {
  const r = await owner<LinkDTO>("POST", "/api/admin/links", { name: "Cliente", ...body });
  expect(r.status).toBe(201);
  return r.json;
}

const info = async (path: string) => (await (await guest(`${path}/api/info`)).json()) as GuestInfoDTO;
const isNeutral = async (res: Response) => res.status === 404 && (await res.text()).includes(NEUTRAL);

describe("open links", () => {
  it("shares a project: header, tracks, audio, and downloads only when allowed", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    expect(l).toMatchObject({ status: "active", hasPassword: false, allowDownload: false, target: { type: "project", name: "Noites", artistName: "Duarte" } });
    expect(l.path).toMatch(/^\/s\/[A-Za-z0-9_-]{22}$/);

    const i = await info(l.path);
    expect(i.link.type).toBe("project");
    expect(i.hero).toMatchObject({ name: "Noites", subtitle: "Duarte · 2026", description: "Verão de 2026" });
    expect(i.artist.name).toBe("Duarte");
    expect(i.ownerName).toBeTruthy();
    expect(i.folders.map((f) => f.name).sort()).toEqual(["Demos", "Noites"]);
    expect(i.tracks.map((t) => [t.title, t.versions.map((v) => v.number)])).toEqual([["Alfa", [2, 1]], ["Demo", [1]]]);
    expect(i.tracks[0]!.versions[0]).not.toHaveProperty("originalFilename");

    const audio = await guest(`${l.path}/audio/${s.a1.versionId}`, { headers: { Range: "bytes=0-1" } });
    expect(audio.status).toBe(206);
    expect(new TextDecoder().decode(await audio.arrayBuffer())).toBe("RI");
    expect(await isNeutral(await guest(`${l.path}/audio/${s.loose.versionId}`))).toBe(true);

    expect(await isNeutral(await guest(`${l.path}/download/${s.a1.versionId}`))).toBe(true);
    await owner("PATCH", `/api/admin/links/${l.id}`, { allowDownload: true });
    const dl = await guest(`${l.path}/download/${s.a1.versionId}`);
    expect(dl.headers.get("Content-Disposition")).toMatch(/^attachment; filename="Duarte - Alfa \(v1\)\.wav"/);
    await dl.arrayBuffer();
  });

  it("shares a whole artist, with project covers", async () => {
    const s = await setup();
    await owner("PUT", `/api/admin/folders/${s.project.id}/artwork`, PNG, { "Content-Type": "image/png" });
    const l = await link({ target: { type: "artist", id: s.artist.id } });
    expect(l.target).toMatchObject({ type: "artist", name: "Duarte" });
    const i = await info(l.path);
    expect(i.hero).toMatchObject({ name: "Duarte", subtitle: "" });
    expect(i.tracks.map((t) => t.title).sort()).toEqual(["Alfa", "Demo", "Solto"]);
    const cover = i.folders.find((f) => f.id === s.project.id)!.artworkUrl!;
    expect(cover).toMatch(new RegExp(`^${l.path}/cover/${s.project.id}\\?v=\\d+$`));
    const img = await guest(cover);
    expect(img.headers.get("Content-Type")).toBe("image/png");
    await img.arrayBuffer();

    // A link to a folder inside the project shows that project's cover, nothing else.
    const f = await link({ target: { type: "folder", id: s.folder.id } });
    const fi = await info(f.path);
    expect(fi.link.type).toBe("folder");
    expect(fi.hero).toMatchObject({ name: "Demos", subtitle: "Noites · Duarte" });
    expect(fi.hero.artworkUrl).toMatch(new RegExp(`^${f.path}/cover/${s.project.id}`));
    expect((await guest(`${f.path}/cover/${s.project.id}`)).status).toBe(200);
  });

  it("limits what a link can play by version mode and scope", async () => {
    const s = await setup();
    const latest = await link({ target: { type: "folder", id: s.project.id }, versionMode: "latest" });
    expect((await info(latest.path)).tracks[0]!.versions.map((v) => v.number)).toEqual([2]);
    expect(await isNeutral(await guest(`${latest.path}/audio/${s.a1.versionId}`))).toBe(true);

    const picked = await link({ target: { type: "track", id: s.a1.trackId }, versionMode: "selected", versionIds: [s.a1.versionId] });
    const pinfo = await info(picked.path);
    expect(pinfo.hero.name).toBe("Noites");
    expect(pinfo.tracks.map((t) => t.versions.map((v) => v.id))).toEqual([[s.a1.versionId]]);
    expect(await isNeutral(await guest(`${picked.path}/audio/${s.a2.versionId}`))).toBe(true);
    expect(await isNeutral(await guest(`${picked.path}/audio/${s.demo.versionId}`))).toBe(true);
    expect((await owner("POST", "/api/admin/links", { name: "x", target: { type: "track", id: s.a1.trackId }, versionMode: "selected", versionIds: [s.demo.versionId] })).status).toBe(400);

    const folder = await link({ target: { type: "folder", id: s.folder.id } });
    expect((await info(folder.path)).tracks.map((t) => t.title)).toEqual(["Demo"]);
    expect((await guest(`${folder.path}/audio/${s.demo.versionId}`)).status).toBe(200);
    expect(await isNeutral(await guest(`${folder.path}/audio/${s.a2.versionId}`))).toBe(true);

    const solo = await link({ target: { type: "track", id: s.loose.trackId } });
    expect((await info(solo.path)).hero).toMatchObject({ name: "Duarte", subtitle: "" });
  });

  it("stops working when revoked, expired or when its target is deleted", async () => {
    const s = await setup();
    const l = await link({ target: { type: "track", id: s.demo.trackId } });
    await owner("PATCH", `/api/admin/links/${l.id}`, { revoked: true });
    expect(await isNeutral(await guest(`${l.path}/api/info`))).toBe(true);
    expect(await isNeutral(await guest(l.path))).toBe(true);
    expect((await owner<{ links: LinkDTO[] }>("GET", "/api/admin/links")).json.links.find((x) => x.id === l.id)?.status).toBe("revoked");

    await owner("PATCH", `/api/admin/links/${l.id}`, { revoked: false });
    expect((await guest(`${l.path}/api/info`)).status).toBe(200);

    await env.DB.prepare("UPDATE share_links SET expires_at = ? WHERE id = ?").bind(Date.now() - 1000, l.id).run();
    expect(await isNeutral(await guest(`${l.path}/api/info`))).toBe(true);
    expect((await owner("PATCH", `/api/admin/links/${l.id}`, { expiresAt: Date.now() - 5 })).status).toBe(400);
    await owner("PATCH", `/api/admin/links/${l.id}`, { expiresAt: null });
    expect((await guest(`${l.path}/api/info`)).status).toBe(200);

    await owner("POST", `/api/admin/artists/${s.artist.id}/delete`, { trackIds: [s.demo.trackId] });
    expect(await isNeutral(await guest(`${l.path}/api/info`))).toBe(true);
  });
});

describe("who entered a link", () => {
  it("lists the names given on each link, with their comments, for the owner", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    const other = await link({ target: { type: "track", id: s.loose.trackId }, allowComments: false });
    const join = async (name: string) =>
      (await (await guest(`${l.path}/api/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })).json()) as { id: string; secret: string };
    const marta = await join("Marta");
    await join("Rui Costa");
    // Spam is refused, so it never shows up here.
    expect((await guest(`${l.path}/api/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "asdasd" }) })).status).toBe(400);
    await guest(`${l.path}/api/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Guest": `${marta.id}.${marta.secret}` },
      body: JSON.stringify({ versionId: s.a2.versionId, body: "Gosto muito", tStart: 0 }),
    });

    const list = (await owner<{ links: LinkDTO[] }>("GET", "/api/admin/links")).json.links;
    const people = list.find((x) => x.id === l.id)!.guests;
    expect(people.map((g) => g.name).sort()).toEqual(["Marta", "Rui Costa"]);
    expect(people.find((g) => g.name === "Marta")).toMatchObject({ comments: 1 });
    expect(people.find((g) => g.name === "Rui Costa")).toMatchObject({ comments: 0 });
    expect(list.find((x) => x.id === other.id)!.guests).toEqual([]);
  });
});

describe("guests sharing part of a link", () => {
  const post = (path: string, body: unknown, who?: { id: string; secret: string }) =>
    guest(path, { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { "X-Guest": `${who.id}.${who.secret}` } : {}) }, body: JSON.stringify(body) });

  it("lets a named guest share a track or folder, listed for the owner, without downloads, ending with the link", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id }, allowDownload: true, password: "segredo1", allowShare: true });
    // The link has a password: unlock it, then give a name.
    const unlock = await post(`${l.path}/api/unlock`, { password: "segredo1" });
    const cookie = unlock.headers.get("Set-Cookie")!.split(";")[0]!;
    const g = (await guest(`${l.path}/api/guest`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ name: "Marta" }) }).then((r) => r.json())) as { id: string; secret: string };
    const shareAs = (body: unknown) =>
      guest(`${l.path}/api/shares`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "X-Guest": `${g.id}.${g.secret}` }, body: JSON.stringify(body) });

    const r = await shareAs({ type: "track", id: s.a1.trackId, to: "Rui" });
    expect(r.status).toBe(201);
    const made = (await r.json()) as { id: string; path: string; name: string };
    expect(made.name).toBe("Partilha de Marta para Rui");
    // The share has no password and no downloads, even though its link has both.
    const child = await info(made.path);
    expect(child.link).toMatchObject({ type: "track", allowDownload: false, allowShare: false, allowComments: true });
    expect(child.tracks.map((t) => t.id)).toEqual([s.a1.trackId]);
    expect((await guest(`${made.path}/download/${s.a2.versionId}`)).status).toBe(404);
    expect((await guest(`${made.path}/audio/${s.a2.versionId}`)).status).not.toBe(401);
    // A share cannot share again; the folder share works; something outside the link does not.
    expect((await post(`${made.path}/api/shares`, { type: "track", id: s.a1.trackId })).status).toBe(403);
    expect((await shareAs({ type: "folder", id: s.folder.id })).status).toBe(201);
    expect((await shareAs({ type: "track", id: s.loose.trackId })).status).toBe(404);

    // The owner sees the shares under the link, with who made them.
    const list = (await owner<{ links: LinkDTO[] }>("GET", "/api/admin/links")).json.links;
    const shares = list.filter((x) => x.parentId === l.id);
    expect(shares).toHaveLength(2);
    expect(shares.every((x) => x.createdBy === "Marta" && !x.allowDownload && x.status === "active")).toBe(true);
    // Settings belong to the link: only the name and revoking are the share's.
    expect((await owner("PATCH", `/api/admin/links/${made.id}`, { allowDownload: true })).status).toBe(400);

    // The guest takes one back; revoking the link stops the other.
    expect((await guest(`${l.path}/api/shares/${made.id}`, { method: "DELETE", headers: { Cookie: cookie, "X-Guest": `${g.id}.${g.secret}` } })).status).toBe(204);
    expect(await isNeutral(await guest(`${made.path}/api/info`))).toBe(true);
    const folderShare = shares.find((x) => x.id !== made.id)!;
    expect((await guest(`${folderShare.path}/api/info`)).status).toBe(200);
    await owner("PATCH", `/api/admin/links/${l.id}`, { revoked: true });
    expect(await isNeutral(await guest(`${folderShare.path}/api/info`))).toBe(true);
    const after = (await owner<{ links: LinkDTO[] }>("GET", "/api/admin/links")).json.links.find((x) => x.id === folderShare.id)!;
    expect(after.status).toBe("revoked");
  });

  it("only where the owner allows it", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    const g = (await post(`${l.path}/api/guest`, { name: "Rui" }).then((r) => r.json())) as { id: string; secret: string };
    expect((await post(`${l.path}/api/shares`, { type: "track", id: s.a1.trackId }, g)).status).toBe(403);
    // A listen-only link that allows sharing still asks for a name first.
    const quiet = await link({ target: { type: "folder", id: s.project.id }, allowComments: false, allowShare: true });
    expect((await post(`${quiet.path}/api/shares`, { type: "track", id: s.a1.trackId })).status).toBe(401);
    const q = (await post(`${quiet.path}/api/guest`, { name: "Rui" }).then((r) => r.json())) as { id: string; secret: string };
    expect((await post(`${quiet.path}/api/shares`, { type: "track", id: s.a1.trackId }, q)).status).toBe(201);
  });
});

describe("installing a link", () => {
  it("gives each link its own manifest, opening on the link", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id }, password: "segredo" });
    const res = await guest(`${l.path}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/manifest+json");
    expect(await res.json()).toMatchObject({ name: "Noites · nectr", short_name: "Noites", start_url: l.path, scope: l.path, display: "standalone" });
    expect(await isNeutral(await guest("/s/AAAAAAAAAAAAAAAAAAAAAA/manifest.webmanifest"))).toBe(true);
  });
});

describe("lyrics", () => {
  it("keeps lyrics per track with per-version timing, and shows them only where the link allows", async () => {
    const s = await setup();
    const track = "[00:01.00]Primeira\n[00:02.50]Segunda";
    const later = "[00:03.00]Primeira\n[00:04.50]Segunda";
    const put = await owner<ArtistResponse>("PUT", `/api/admin/tracks/${s.a1.trackId}/lyrics`, { lrc: track });
    expect(put.status).toBe(200);
    expect(put.json.tracks.find((t) => t.id === s.a1.trackId)?.hasLyrics).toBe(true);
    await owner("PUT", `/api/admin/tracks/${s.a1.trackId}/lyrics`, { lrc: later, versionId: s.a2.versionId });
    expect((await owner("PUT", `/api/admin/tracks/${s.a1.trackId}/lyrics`, { lrc: "x", versionId: s.demo.versionId })).status).toBe(404);
    const all = (await owner<{ track: string; overrides: Record<string, string> }>("GET", `/api/admin/tracks/${s.a1.trackId}/lyrics`)).json;
    expect(all).toEqual({ track, overrides: { [s.a2.versionId]: later } });

    const l = await link({ target: { type: "folder", id: s.project.id }, versionMode: "all" });
    const lyr = async (path: string, v: string) => (await (await guest(`${path}/api/lyrics/${v}`)).json()) as { lrc: string | null };
    expect(await lyr(l.path, s.a1.versionId)).toEqual({ lrc: track });
    expect(await lyr(l.path, s.a2.versionId)).toEqual({ lrc: later });
    expect(await isNeutral(await guest(`${l.path}/api/lyrics/${s.loose.versionId}`))).toBe(true);
    const quiet = await link({ target: { type: "folder", id: s.project.id }, versionMode: "all", showLyrics: false });
    expect(await lyr(quiet.path, s.a1.versionId)).toEqual({ lrc: null });

    // Removing the version's own timing falls back to the track's.
    await owner("PUT", `/api/admin/tracks/${s.a1.trackId}/lyrics`, { lrc: null, versionId: s.a2.versionId });
    expect(await lyr(l.path, s.a2.versionId)).toEqual({ lrc: track });
  });
});

describe("password links", () => {
  it("asks for the password, then unlocks with a cookie scoped to the link", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id }, password: "maré2026" });
    expect(l.hasPassword).toBe(true);

    const locked = await guest(`${l.path}/api/info`);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ error: { code: "password_required" }, gate: { hero: { name: "Noites", subtitle: "Duarte · 2026" } } });
    expect((await guest(`${l.path}/audio/${s.a1.versionId}`)).status).toBe(401);

    const wrong = await guest(`${l.path}/api/unlock`, { method: "POST", body: JSON.stringify({ password: "errada" }), headers: { "Content-Type": "application/json" } });
    expect(wrong.status).toBe(401);

    const ok = await guest(`${l.path}/api/unlock`, { method: "POST", body: JSON.stringify({ password: "maré2026" }), headers: { "Content-Type": "application/json" } });
    expect(ok.status).toBe(204);
    const setCookie = ok.headers.get("Set-Cookie")!;
    expect(setCookie).toContain(`Path=${l.path}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0]!;

    expect((await guest(`${l.path}/api/info`, { headers: { Cookie: cookie } })).status).toBe(200);
    const audio = await guest(`${l.path}/audio/${s.a1.versionId}`, { headers: { Cookie: cookie } });
    expect(audio.status).toBe(200);
    await audio.arrayBuffer();
    expect((await guest(`${l.path}/api/info`, { headers: { Cookie: cookie.replace(/.$/, "x") } })).status).toBe(401);

    // A new password logs everyone out of this link.
    await owner("PATCH", `/api/admin/links/${l.id}`, { password: "outra-pass" });
    expect((await guest(`${l.path}/api/info`, { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("locks a connection out after 5 wrong passwords, whatever the tab or window", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id }, password: "segredo" });
    const attempt = async (password: string, ip: string) => {
      const r = await guest(`${l.path}/api/unlock`, { method: "POST", body: JSON.stringify({ password }), headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip } });
      return { status: r.status, body: (await r.json().catch(() => null)) as { retryAfter?: number } | null };
    };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await attempt(`x${i}`, "2001:db8:1:2::a")).status);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    // A new private window (no cookies) gets another IPv6 address from the same /64: still locked, even with the right password.
    const locked = await attempt("segredo", "2001:db8:1:2:ffff::b");
    expect(locked.status).toBe(429);
    expect(locked.body?.retryAfter).toBeGreaterThan(50);
    // Somebody else is not affected.
    expect((await attempt("segredo", "198.51.100.7")).status).toBe(204);
    // Once the lock is over, the right password works and clears the count.
    await env.DB.prepare("UPDATE unlock_attempts SET locked_until = 0 WHERE link_id = ?").bind(l.id).run();
    expect((await attempt("segredo", "2001:db8:1:2::c")).status).toBe(204);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM unlock_attempts WHERE link_id = ?").bind(l.id).first("n")).toBe(0);
  });

  it("locks for longer each time and groups addresses by connection", async () => {
    const at = Date.now();
    const locks: number[] = [];
    for (let i = 0; i < 20; i++) {
      const until = await recordFailure(env.DB, "link-x", "client-x", at);
      if (until) locks.push((until - at) / 60_000);
    }
    expect(locks).toEqual([1, 5, 15, 60]);
    expect(await clientKey("k", "2001:0db8:0001:0002::9")).toBe(await clientKey("k", "2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
    expect(await clientKey("k", "2001:db8:1:3::9")).not.toBe(await clientKey("k", "2001:db8:1:2::9"));
    expect(await clientKey("k", "::ffff:203.0.113.9")).toBe(await clientKey("k", "203.0.113.9"));
    expect(await clientKey("k", "203.0.113.10")).not.toBe(await clientKey("k", "203.0.113.9"));
  });
});

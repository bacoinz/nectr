import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ArtistResponse, FolderDTO, GuestInfoDTO, LibraryResponse, MergeResponse, SplitResponse, UploadResponse, VersionDTO } from "../../src/shared/api-types";
import { encodePeaks } from "../../src/shared/peaks";
import { purge } from "../../src/worker/cron";
import { makeMp3, makeWav } from "../fixtures/audio";

// localhost + ENVIRONMENT=development stands in for Cloudflare Access (see getOwner).
const BASE = "http://localhost";

async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers };
  if (body instanceof Uint8Array) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json", ...headers };
  }
  const res = await exports.default.fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json: T | undefined;
  try { json = JSON.parse(text) as T; } catch { /* binary or empty */ }
  return { res, json: json as T, text };
}

const PEAKS = encodePeaks(new Float32Array(2048).map((_, i) => (i % 2 ? 0.5 : -0.5)));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

async function newArtist(name = "Inês Lobo") {
  const { res, json } = await call<ArtistResponse>("POST", "/api/admin/artists", { name });
  expect(res.status).toBe(201);
  return json.artist;
}

async function newFolder(artistId: string, body: Record<string, unknown>) {
  const { res, json } = await call<FolderDTO>("POST", `/api/admin/artists/${artistId}/folders`, body);
  expect(res.status).toBe(201);
  return json;
}

async function upload(artistId: string, file: Uint8Array, filename: string, extra: Record<string, unknown> = {}) {
  const { res, json } = await call<UploadResponse>("POST", "/api/admin/uploads", { artistId, filename, size: file.length, ...extra });
  expect(res.status).toBe(201);
  expect(json.upload.url).toBe(`/api/admin/dev-upload/${json.versionId}`);
  const put = await call("PUT", json.upload.url, file);
  expect(put.res.status).toBe(204);
  return json;
}

async function uploadReady(artistId: string, file: Uint8Array, filename: string, extra: Record<string, unknown> = {}) {
  const u = await upload(artistId, file, filename, extra);
  const fin = await call<VersionDTO>("POST", `/api/admin/versions/${u.versionId}/finalize`, { peaks: PEAKS });
  expect(fin.res.status).toBe(200);
  return { ...u, version: fin.json };
}

const tree = (artistId: string) => call<ArtistResponse>("GET", `/api/admin/artists/${artistId}`).then((r) => r.json);

describe("artists, projects and folders", () => {
  it("creates, lists and edits an artist", async () => {
    const a = await newArtist();
    expect(a).toMatchObject({ name: "Inês Lobo", photoUrl: null });
    const lib = await call<LibraryResponse>("GET", "/api/admin/library");
    expect(lib.json.artists.find((x) => x.id === a.id)).toMatchObject({ projectCount: 0, trackCount: 0 });

    const edit = await call<ArtistResponse>("PATCH", `/api/admin/artists/${a.id}`, { color: "#2ec4b6", description: "Cantautora de Lisboa" });
    expect(edit.json.artist).toMatchObject({ color: "#2ec4b6", description: "Cantautora de Lisboa" });
    expect((await call("PATCH", `/api/admin/artists/${a.id}`, { color: "#000000" })).res.status).toBe(400);
    expect((await call("PATCH", `/api/admin/artists/${a.id}`, { name: "  " })).res.status).toBe(400);
  });

  it("creates projects with details, and folders inside them", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "Maré Alta", year: 2026, label: "Selo", description: "Disco de estreia" });
    expect(p).toMatchObject({ parentId: null, icon: "disc", color: a.color, year: 2026, label: "Selo", description: "Disco de estreia", artworkUrl: null });
    const f = await newFolder(a.id, { name: "Ao vivo", parentId: p.id, icon: "mic", color: "#ff9f43" });
    expect(f).toMatchObject({ parentId: p.id, icon: "mic" });
    expect((await call("POST", `/api/admin/artists/${a.id}/folders`, { name: "X", icon: "skull" })).res.status).toBe(400);
    expect((await call("PATCH", `/api/admin/folders/${p.id}`, { year: 1800 })).res.status).toBe(400);
    const edited = await call<FolderDTO>("PATCH", `/api/admin/folders/${p.id}`, { name: "Maré Alta (deluxe)", year: null });
    expect(edited.json).toMatchObject({ name: "Maré Alta (deluxe)", year: null, label: "Selo" });
    expect((await tree(a.id)).folders.map((x) => x.name)).toEqual(["Maré Alta (deluxe)", "Ao vivo"]);
    const lib = await call<LibraryResponse>("GET", "/api/admin/library");
    expect(lib.json.artists.find((x) => x.id === a.id)?.projectCount).toBe(1);
  });

  it("stores artist photos and project covers after sniffing the real image type", async () => {
    const a = await newArtist();
    const put = await call<ArtistResponse>("PUT", `/api/admin/artists/${a.id}/photo`, PNG, { "Content-Type": "image/png" });
    expect(put.json.artist.photoUrl).toMatch(new RegExp(`^/api/admin/artists/${a.id}/photo\\?v=\\d+$`));
    const img = await exports.default.fetch(`${BASE}${put.json.artist.photoUrl}`);
    expect(img.headers.get("Content-Type")).toBe("image/png");
    await img.arrayBuffer();
    const bad = await call("PUT", `/api/admin/artists/${a.id}/photo`, new TextEncoder().encode("<svg onload=alert(1)>"), { "Content-Type": "image/png" });
    expect(bad.res.status).toBe(400);

    const p = await newFolder(a.id, { name: "Maré Alta" });
    const cover = await call<ArtistResponse>("PUT", `/api/admin/folders/${p.id}/artwork`, PNG, { "Content-Type": "image/png" });
    expect(cover.json.folders[0]!.artworkUrl).toMatch(new RegExp(`^/api/admin/folders/${p.id}/artwork\\?v=\\d+$`));
    const sub = await newFolder(a.id, { name: "Demos", parentId: p.id });
    expect((await call("PUT", `/api/admin/folders/${sub.id}/artwork`, PNG, { "Content-Type": "image/png" })).res.status).toBe(400);
  });

  it("keeps the owner's display name", async () => {
    expect((await call<{ profile: { name: string } }>("GET", "/api/admin/me")).json.profile.name).toBe("Produtor");
    await call("PATCH", "/api/admin/profile", { name: "Pedro" });
    expect((await call<{ email: string; profile: { name: string } }>("GET", "/api/admin/me")).json).toMatchObject({ email: "owner@example.com", profile: { name: "Pedro" } });
  });
});

describe("search", () => {
  it("lists the names of everything live", async () => {
    const a = await newArtist("Rui Veloso Tributo");
    const p = await newFolder(a.id, { name: "Ar de Rock" });
    await uploadReady(a.id, makeWav(), "Chico Fininho.wav", { folderId: p.id });
    const gone = await uploadReady(a.id, makeWav(), "Apagada.wav");
    await call("POST", `/api/admin/artists/${a.id}/delete`, { trackIds: [gone.trackId] });
    const idx = (await call<{ artists: { name: string }[]; folders: { name: string; artistId: string }[]; tracks: { title: string; folderId: string | null }[] }>("GET", "/api/admin/search-index")).json;
    expect(idx.artists.some((x) => x.name === "Rui Veloso Tributo")).toBe(true);
    expect(idx.folders.find((f) => f.name === "Ar de Rock")?.artistId).toBe(a.id);
    expect(idx.tracks.find((t) => t.title === "Chico Fininho")?.folderId).toBe(p.id);
    expect(idx.tracks.some((t) => t.title === "Apagada")).toBe(false);
  });
});

describe("a track's DAW project name", () => {
  it("is the owner's alone: in the owner's lists and search, never on a link", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "Maré Alta" });
    const t = await uploadReady(a.id, makeWav(), "Maré alta.wav", { folderId: p.id });

    expect((await call("PATCH", `/api/admin/tracks/${t.trackId}`, { title: "Maré alta", sessionName: "mare alta v7 final Project" })).res.status).toBe(200);
    expect((await tree(a.id)).tracks.find((x) => x.id === t.trackId)?.sessionName).toBe("mare alta v7 final Project");
    // A title-only rename keeps it.
    await call("PATCH", `/api/admin/tracks/${t.trackId}`, { title: "Maré Alta" });
    expect((await tree(a.id)).tracks.find((x) => x.id === t.trackId)).toMatchObject({ title: "Maré Alta", sessionName: "mare alta v7 final Project" });
    const idx = (await call<{ tracks: { id: string; sessionName: string }[] }>("GET", "/api/admin/search-index")).json;
    expect(idx.tracks.find((x) => x.id === t.trackId)?.sessionName).toBe("mare alta v7 final Project");

    const link = (await call<{ path: string }>("POST", "/api/admin/links", { name: "Cliente", target: { type: "folder", id: p.id } })).json;
    const info = await exports.default.fetch(`https://nectr.example.workers.dev${link.path}/api/info`);
    expect(info.status).toBe(200);
    const text = await info.text();
    expect(text).toContain("Maré Alta");
    expect(text).not.toContain("v7 final");
    expect(text).not.toContain("sessionName");

    // Cleared with an empty name.
    await call("PATCH", `/api/admin/tracks/${t.trackId}`, { sessionName: "" });
    expect((await tree(a.id)).tracks.find((x) => x.id === t.trackId)?.sessionName).toBe("");
  });
});


describe("project kinds, track covers and the artists' order", () => {
  it("keeps albums/EPs apart from working projects, which show an icon and no cover", async () => {
    const a = await newArtist();
    const album = await newFolder(a.id, { name: "Disco", year: 2026 });
    expect(album).toMatchObject({ kind: "release", icon: "disc" });
    const wip = await newFolder(a.id, { name: "Ideias", kind: "wip" });
    expect(wip).toMatchObject({ kind: "wip", icon: "wave", parentId: null });
    expect((await newFolder(a.id, { name: "Ao vivo", kind: "live" })).icon).toBe("mic");
    expect((await call("POST", `/api/admin/artists/${a.id}/folders`, { name: "x", kind: "single" })).res.status).toBe(400);

    // A cover on a release; turned into a WIP it is kept but no longer shown.
    await call("PUT", `/api/admin/folders/${album.id}/artwork`, PNG, { "Content-Type": "image/png" });
    expect((await tree(a.id)).folders.find((f) => f.id === album.id)?.artworkUrl).toBeTruthy();
    await call("PATCH", `/api/admin/folders/${album.id}`, { kind: "other" });
    expect((await tree(a.id)).folders.find((f) => f.id === album.id)).toMatchObject({ kind: "other", artworkUrl: null });
    await call("PATCH", `/api/admin/folders/${album.id}`, { kind: "release" });
    expect((await tree(a.id)).folders.find((f) => f.id === album.id)?.artworkUrl).toBeTruthy();
    // A folder inside a project has no kind of its own.
    const sub = await newFolder(a.id, { name: "Demos", parentId: wip.id });
    await call("PATCH", `/api/admin/folders/${sub.id}`, { kind: "live" });
    expect((await tree(a.id)).folders.find((f) => f.id === sub.id)?.kind).toBe("release");

    // On a link of the WIP project: the hero is an icon, the folders carry their kind.
    const t = await uploadReady(a.id, makeWav(), "Rascunho.wav", { folderId: sub.id });
    const link = (await call<{ path: string }>("POST", "/api/admin/links", { name: "Banda", target: { type: "folder", id: wip.id } })).json;
    const info = (await exports.default.fetch(`https://nectr.example.workers.dev${link.path}/api/info`).then((r) => r.json())) as GuestInfoDTO;
    expect(info.hero).toMatchObject({ name: "Ideias", artworkUrl: null, icon: "wave" });
    expect(info.folders.find((f) => f.id === wip.id)?.kind).toBe("wip");
    expect(info.tracks.find((x) => x.id === t.trackId)?.artworkUrl).toBeNull();
    // A folder page of a dead link is the neutral page, like any other (the live one is the SPA, served from assets).
    await call("PATCH", `/api/admin/links/${(await call<{ links: { id: string; path: string }[] }>("GET", "/api/admin/links")).json.links.find((l) => l.path === link.path)!.id}`, { revoked: true });
    expect((await exports.default.fetch(`https://nectr.example.workers.dev${link.path}/f/${sub.id}`)).status).toBe(404);
  });

  it("gives a track its own cover, for the owner and for a link, and purges it with the track", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "EP" });
    const t = await uploadReady(a.id, makeWav(), "Canção.wav", { folderId: p.id });
    const r = await call<ArtistResponse>("PUT", `/api/admin/tracks/${t.trackId}/artwork`, PNG, { "Content-Type": "image/png" });
    expect(r.res.status).toBe(200);
    const url = r.json.tracks.find((x) => x.id === t.trackId)!.artworkUrl!;
    expect(url).toMatch(new RegExp(`^/api/admin/tracks/${t.trackId}/artwork\\?v=`));
    expect((await call("GET", url)).res.status).toBe(200);
    const key = await env.DB.prepare("SELECT artwork_key FROM tracks WHERE id = ?").bind(t.trackId).first<string>("artwork_key");

    const link = (await call<{ path: string }>("POST", "/api/admin/links", { name: "Cliente", target: { type: "folder", id: p.id } })).json;
    const info = (await exports.default.fetch(`https://nectr.example.workers.dev${link.path}/api/info`).then((x) => x.json())) as GuestInfoDTO;
    const guestUrl = info.tracks[0]!.artworkUrl!;
    expect(guestUrl).toMatch(new RegExp(`^${link.path}/track-cover/${t.trackId}\\?v=`));
    expect((await exports.default.fetch(`https://nectr.example.workers.dev${guestUrl}`)).status).toBe(200);
    // Only for tracks the link shows.
    const other = await uploadReady(a.id, makeWav(), "Solta.wav");
    await call("PUT", `/api/admin/tracks/${other.trackId}/artwork`, PNG, { "Content-Type": "image/png" });
    expect((await exports.default.fetch(`https://nectr.example.workers.dev${link.path}/track-cover/${other.trackId}`)).status).toBe(404);

    // Removing it goes back to the project's; a purged track takes its cover from R2.
    const off = await call<ArtistResponse>("DELETE", `/api/admin/tracks/${t.trackId}/artwork`);
    expect(off.json.tracks.find((x) => x.id === t.trackId)?.artworkUrl).toBeNull();
    expect(await env.BUCKET.head(key!)).toBeNull();
    await call("PUT", `/api/admin/tracks/${other.trackId}/artwork`, PNG, { "Content-Type": "image/png" });
    const otherKey = await env.DB.prepare("SELECT artwork_key FROM tracks WHERE id = ?").bind(other.trackId).first<string>("artwork_key");
    await call("POST", `/api/admin/artists/${a.id}/delete`, { trackIds: [other.trackId] });
    await purge(env, Date.now() + 8 * 24 * 3600 * 1000);
    expect(await env.BUCKET.head(otherKey!)).toBeNull();
  });

  it("orders the artists as the owner wants, new ones last", async () => {
    const x = await newArtist("Primeiro");
    const y = await newArtist("Segundo");
    const ids = (await call<LibraryResponse>("GET", "/api/admin/library")).json.artists.map((a) => a.id);
    expect(ids.at(-1)).toBe(y.id);
    expect(ids.indexOf(x.id)).toBeLessThan(ids.indexOf(y.id));
    const wanted = [y.id, ...ids.filter((i) => i !== y.id)];
    expect((await call("POST", "/api/admin/artists/reorder", { ids: wanted })).res.status).toBe(204);
    expect((await call<LibraryResponse>("GET", "/api/admin/library")).json.artists.map((a) => a.id)).toEqual(wanted);
    // The whole list, or nothing.
    expect((await call("POST", "/api/admin/artists/reorder", { ids: wanted.slice(1) })).res.status).toBe(400);
  });
});

describe("uploads", () => {
  it("creates a track from a WAV upload and reads the metadata back from R2", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "Maré Alta" });
    const wav = makeWav({ sampleRate: 48000, bits: 24, extensible: true, frames: 48000 * 2 });
    const u = await uploadReady(a.id, wav, "03_Maré alta (mix final).wav", { folderId: p.id });
    expect(u.version).toMatchObject({ number: 1, format: "wav", sampleRate: 48000, bitDepth: 24, channels: 2, durationS: 2, sizeBytes: wav.length });

    const t = await tree(a.id);
    expect(t.tracks).toHaveLength(1);
    expect(t.tracks[0]).toMatchObject({ title: "Maré alta (mix final)", folderId: p.id, versions: [{ id: u.versionId }] });
    const peaks = await call<{ peaks: string }>("GET", `/api/admin/versions/${u.versionId}/peaks`);
    expect(peaks.json.peaks).toBe(PEAKS);
  });

  it("stores the loudness measured in the browser, and accepts it later for older versions", async () => {
    const a = await newArtist();
    const u = await upload(a.id, makeWav(), "medido.wav");
    const bad = await call("POST", `/api/admin/versions/${u.versionId}/finalize`, { peaks: PEAKS, loudness: { integrated: 99, range: 3, truePeak: -1 } });
    expect(bad.res.status).toBe(400);
    const fin = await call<VersionDTO>("POST", `/api/admin/versions/${u.versionId}/finalize`, { peaks: PEAKS, loudness: { integrated: -9.876, range: 4.2, truePeak: -0.31 } });
    expect(fin.json).toMatchObject({ lufsIntegrated: -9.88, lufsRange: 4.2, truePeakDbtp: -0.31 });

    const old = await uploadReady(a.id, makeWav(), "antigo.wav");
    expect(old.version.lufsIntegrated).toBeNull();
    const put = await call<VersionDTO>("PUT", `/api/admin/versions/${old.versionId}/loudness`, { integrated: -14, range: null, truePeak: -1.5 });
    expect(put.json).toMatchObject({ lufsIntegrated: -14, lufsRange: null, truePeakDbtp: -1.5 });
  });

  it("adds a new version to an existing track", async () => {
    const a = await newArtist();
    const first = await uploadReady(a.id, makeWav(), "Lume.wav");
    const second = await uploadReady(a.id, makeMp3(), "Lume v2.mp3", { trackId: first.trackId });
    expect(second.trackId).toBe(first.trackId);
    expect(second.version).toMatchObject({ number: 2, format: "mp3", bitrateKbps: 128, bitDepth: null });
    expect((await tree(a.id)).tracks[0]!.versions.map((v) => v.number)).toEqual([2, 1]);
  });

  it("rejects an invalid file on finalize and removes it everywhere", async () => {
    const a = await newArtist();
    const u = await upload(a.id, makeWav({ format: 3, bits: 32 }), "float.wav");
    const fin = await call<{ error: { code: string; message: string } }>("POST", `/api/admin/versions/${u.versionId}/finalize`, { peaks: PEAKS });
    expect(fin.res.status).toBe(422);
    expect(fin.json.error).toEqual({ code: "wav_float", message: "WAV 32 bit float não é suportado. Exporta em PCM de 16 ou 24 bit." });
    expect(await env.BUCKET.head(`audio/${u.trackId}/${u.versionId}.wav`)).toBeNull();
    expect((await tree(a.id)).tracks).toHaveLength(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE id = ?").bind(u.trackId).first("n")).toBe(0);
  });

  it("refuses to finalize before the file arrived or without peaks", async () => {
    const a = await newArtist();
    const r = await call<UploadResponse>("POST", "/api/admin/uploads", { artistId: a.id, filename: "a.wav", size: 1000 });
    expect((await call("POST", `/api/admin/versions/${r.json.versionId}/finalize`, { peaks: PEAKS })).res.status).toBe(409);
    expect((await call("POST", `/api/admin/versions/${r.json.versionId}/finalize`, { peaks: "not base64!" })).res.status).toBe(400);
  });

  it("refuses unsupported names and oversized files up front", async () => {
    const a = await newArtist();
    expect((await call("POST", "/api/admin/uploads", { artistId: a.id, filename: "a.flac", size: 10 })).res.status).toBe(400);
    expect((await call("POST", "/api/admin/uploads", { artistId: a.id, filename: "a.wav", size: 201 * 1024 * 1024 })).res.status).toBe(400);
  });
});

describe("streaming", () => {
  it("serves byte ranges the way Safari expects", async () => {
    const a = await newArtist();
    const wav = makeWav({ frames: 1000 });
    const u = await uploadReady(a.id, wav, "range.wav");
    const url = `${BASE}/api/admin/audio/${u.versionId}`;

    const probe = await exports.default.fetch(url, { headers: { Range: "bytes=0-1" } });
    expect(probe.status).toBe(206);
    expect(probe.headers.get("Content-Range")).toBe(`bytes 0-1/${wav.length}`);
    expect(probe.headers.get("Content-Length")).toBe("2");
    expect(probe.headers.get("Accept-Ranges")).toBe("bytes");
    expect(probe.headers.get("Content-Type")).toBe("audio/wav");
    expect(probe.headers.get("Content-Disposition")).toBe("inline");
    expect(new TextDecoder().decode(await probe.arrayBuffer())).toBe("RI");

    const open = await exports.default.fetch(url, { headers: { Range: "bytes=100-" } });
    expect(open.headers.get("Content-Range")).toBe(`bytes 100-${wav.length - 1}/${wav.length}`);
    expect((await open.arrayBuffer()).byteLength).toBe(wav.length - 100);

    const suffix = await exports.default.fetch(url, { headers: { Range: "bytes=-4" } });
    expect(suffix.headers.get("Content-Range")).toBe(`bytes ${wav.length - 4}-${wav.length - 1}/${wav.length}`);
    await suffix.arrayBuffer();

    const past = await exports.default.fetch(url, { headers: { Range: `bytes=0-${wav.length + 5000}` } });
    expect(past.status).toBe(206);
    expect(past.headers.get("Content-Range")).toBe(`bytes 0-${wav.length - 1}/${wav.length}`);
    await past.arrayBuffer();

    const beyond = await exports.default.fetch(url, { headers: { Range: `bytes=${wav.length + 10}-` } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("Content-Range")).toBe(`bytes */${wav.length}`);

    const full = await exports.default.fetch(url);
    expect(full.status).toBe(200);
    expect(full.headers.get("Content-Length")).toBe(String(wav.length));
    await full.arrayBuffer();
  });

  it("downloads with a clean file name (artist - title)", async () => {
    const a = await newArtist();
    const u = await uploadReady(a.id, makeWav(), "Maré.wav");
    await call("PATCH", `/api/admin/versions/${u.versionId}`, { label: "vocals up" });
    const res = await exports.default.fetch(`${BASE}/api/admin/download/${u.versionId}`);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="Ines Lobo - Mare (v1 _ vocals up).wav"; filename*=UTF-8''${encodeURIComponent("Inês Lobo - Maré (v1 — vocals up).wav")}`,
    );
    await res.arrayBuffer();
  });
});

describe("organising", () => {
  it("soft-deletes a project with its contents and undoes it", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "Demos" });
    await uploadReady(a.id, makeWav(), "a.wav", { folderId: p.id });
    await uploadReady(a.id, makeWav(), "b.wav");
    const del = await call<{ batch: number }>("POST", `/api/admin/artists/${a.id}/delete`, { folderIds: [p.id] });
    let t = await tree(a.id);
    expect(t.folders).toHaveLength(0);
    expect(t.tracks.map((x) => x.title)).toEqual(["b"]);
    t = (await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/restore-items`, { batch: del.json.batch })).json;
    expect(t.folders).toHaveLength(1);
    expect(t.tracks.map((x) => x.title).sort()).toEqual(["a", "b"]);
  });

  it("deleting the last version deletes the track", async () => {
    const a = await newArtist();
    const u = await uploadReady(a.id, makeWav(), "only.wav");
    await call("POST", `/api/admin/artists/${a.id}/delete`, { versionIds: [u.versionId] });
    expect((await tree(a.id)).tracks).toHaveLength(0);
  });

  it("moves items and refuses to put a folder inside itself", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "A" });
    const f = await newFolder(a.id, { name: "B", parentId: p.id });
    const t = await uploadReady(a.id, makeWav(), "t.wav");
    const moved = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/move`, { trackIds: [t.trackId], toFolderId: f.id });
    expect(moved.json.tracks[0]!.folderId).toBe(f.id);
    expect((await call("POST", `/api/admin/artists/${a.id}/move`, { folderIds: [p.id], toFolderId: f.id })).res.status).toBe(400);
    const back = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/move`, { trackIds: [t.trackId], toFolderId: null });
    expect(back.json.tracks[0]!.folderId).toBeNull();
    // A folder moved to the artist's root becomes a project.
    const promoted = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/move`, { folderIds: [f.id], toFolderId: null });
    expect(promoted.json.folders.find((x) => x.id === f.id)?.parentId).toBeNull();
  });

  it("turns a track into new versions of another, and undoes it", async () => {
    const a = await newArtist();
    const target = await uploadReady(a.id, makeWav(), "Alvo.wav");
    await uploadReady(a.id, makeWav(), "Alvo mix 2.wav", { trackId: target.trackId });
    const src = await uploadReady(a.id, makeWav(), "Fonte.wav");
    const merged = await call<MergeResponse>("POST", `/api/admin/artists/${a.id}/merge`, { trackIds: [src.trackId], intoTrackId: target.trackId });
    expect(merged.res.status).toBe(200);
    expect(merged.json.artist.tracks.map((t) => t.title)).toEqual(["Alvo"]);
    expect(merged.json.artist.tracks[0]!.versions.map((v) => [v.number, v.originalFilename])).toEqual([[3, "Fonte.wav"], [2, "Alvo mix 2.wav"], [1, "Alvo.wav"]]);
    expect(merged.json.moved).toEqual([{ versionId: src.versionId, trackId: src.trackId, number: 1, name: null }]);

    const back = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/unmerge`, { batch: merged.json.batch, moved: merged.json.moved });
    expect(back.res.status).toBe(200);
    expect(back.json.tracks.map((t) => t.title).sort()).toEqual(["Alvo", "Fonte"]);
    expect(back.json.tracks.find((t) => t.title === "Fonte")!.versions.map((v) => v.number)).toEqual([1]);
    expect(back.json.tracks.find((t) => t.title === "Alvo")!.versions).toHaveLength(2);
    expect((await call("POST", `/api/admin/artists/${a.id}/unmerge`, { batch: merged.json.batch, moved: merged.json.moved })).res.status).toBe(404);
    expect((await call("POST", `/api/admin/artists/${a.id}/merge`, { trackIds: [target.trackId], intoTrackId: target.trackId })).res.status).toBe(400);
  });

  it("keeps a renamed track's name on its version after a merge, and on a split", async () => {
    const a = await newArtist();
    const target = await uploadReady(a.id, makeWav(), "Alvo.wav");
    const src = await uploadReady(a.id, makeWav(), "bounce_final_03.wav");
    await call("PATCH", `/api/admin/tracks/${target.trackId}`, { title: "Maré Alta" });
    await call("PATCH", `/api/admin/tracks/${src.trackId}`, { title: "Maré Alta (refrão novo)" });

    const merged = await call<MergeResponse>("POST", `/api/admin/artists/${a.id}/merge`, { trackIds: [src.trackId], intoTrackId: target.trackId });
    const t = merged.json.artist.tracks[0]!;
    // The target keeps its title; the dropped track is now the main (latest) version, under its own name.
    expect(t.title).toBe("Maré Alta");
    expect(t.versions.map((v) => [v.number, v.name])).toEqual([[2, "Maré Alta (refrão novo)"], [1, null]]);

    // Undo gives the track back its name and the version none.
    const back = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/unmerge`, { batch: merged.json.batch, moved: merged.json.moved });
    expect(back.json.tracks.find((x) => x.id === src.trackId)).toMatchObject({ title: "Maré Alta (refrão novo)" });
    expect(back.json.tracks.find((x) => x.id === src.trackId)!.versions[0]!.name).toBeNull();

    // Merged again and dragged back out, it comes out under that name, not the file's.
    const again = await call<MergeResponse>("POST", `/api/admin/artists/${a.id}/merge`, { trackIds: [src.trackId], intoTrackId: target.trackId });
    const split = await call<SplitResponse>("POST", `/api/admin/artists/${a.id}/split`, { versionId: src.versionId });
    expect(split.json.artist.tracks.find((x) => x.id === split.json.trackId)?.title).toBe("Maré Alta (refrão novo)");
    expect(again.res.status).toBe(200);

    // A new file dropped on a renamed track: the title stays, the file becomes the main version.
    const v3 = await uploadReady(a.id, makeWav(), "outra mistura.wav", { trackId: target.trackId });
    const now = (await tree(a.id)).tracks.find((x) => x.id === target.trackId)!;
    expect(now.title).toBe("Maré Alta");
    expect(now.versions[0]!.id).toBe(v3.versionId);

    // A link never shows these names.
    const link = (await call<{ path: string }>("POST", "/api/admin/links", { name: "Cliente", target: { type: "track", id: target.trackId } })).json;
    await call<MergeResponse>("POST", `/api/admin/artists/${a.id}/merge`, { trackIds: [split.json.trackId], intoTrackId: target.trackId });
    const info = await (await exports.default.fetch(`https://nectr.example.workers.dev${link.path}/api/info`)).text();
    expect(info).not.toContain("refrão novo");
    expect(info).not.toContain('"name":null');
  });

  it("turns a version into a track of its own, right after it, and undoes it", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "EP" });
    const first = await uploadReady(a.id, makeWav(), "01_Abertura.wav", { folderId: p.id });
    const v2 = await uploadReady(a.id, makeWav(), "Abertura alt.wav", { trackId: first.trackId });
    const last = await uploadReady(a.id, makeWav(), "Fim.wav", { folderId: p.id });

    const split = await call<SplitResponse>("POST", `/api/admin/artists/${a.id}/split`, { versionId: v2.versionId });
    expect(split.res.status).toBe(200);
    expect(split.json.from).toEqual({ trackId: first.trackId, number: 2 });
    const inFolder = split.json.artist.tracks.filter((t) => t.folderId === p.id).sort((x, y) => x.position - y.position);
    expect(inFolder.map((t) => t.title)).toEqual(["Abertura", "Abertura alt", "Fim"]);
    expect(inFolder[1]!.versions.map((v) => [v.id, v.number])).toEqual([[v2.versionId, 1]]);
    expect(inFolder[2]!.id).toBe(last.trackId);
    // The only version left cannot be split off.
    expect((await call("POST", `/api/admin/artists/${a.id}/split`, { versionId: first.versionId })).res.status).toBe(400);

    const back = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/unsplit`, { trackId: split.json.trackId, from: split.json.from });
    expect(back.res.status).toBe(200);
    expect(back.json.tracks.map((t) => t.title).sort()).toEqual(["Abertura", "Fim"]);
    expect(back.json.tracks.find((t) => t.id === first.trackId)!.versions.map((v) => v.number)).toEqual([2, 1]);
  });

  it("reorders tracks inside a container", async () => {
    const a = await newArtist();
    const x = await uploadReady(a.id, makeWav(), "x.wav");
    const y = await uploadReady(a.id, makeWav(), "y.wav");
    const z = await uploadReady(a.id, makeWav(), "z.wav");
    const r = await call<ArtistResponse>("POST", `/api/admin/artists/${a.id}/reorder`, { kind: "tracks", parentId: null, ids: [z.trackId, x.trackId, y.trackId] });
    expect(r.json.tracks.map((t) => t.title)).toEqual(["z", "x", "y"]);
  });
});

describe("daily purge", () => {
  it("removes soft-deleted items and abandoned uploads after their grace period", async () => {
    const a = await newArtist();
    const p = await newFolder(a.id, { name: "P" });
    await call("PUT", `/api/admin/folders/${p.id}/artwork`, PNG, { "Content-Type": "image/png" });
    const sub = await newFolder(a.id, { name: "Sub", parentId: p.id });
    const kept = await uploadReady(a.id, makeWav(), "kept.wav");
    const gone = await uploadReady(a.id, makeWav(), "gone.wav", { folderId: sub.id });
    const pending = await upload(a.id, makeWav(), "pending.wav");
    const coverKey = await env.DB.prepare("SELECT artwork_key FROM folders WHERE id = ?").bind(p.id).first<string>("artwork_key");
    await call("POST", `/api/admin/artists/${a.id}/delete`, { folderIds: [p.id] });

    await purge(env, Date.now() + 2 * 24 * 3600 * 1000);
    expect(await env.BUCKET.head(`audio/${pending.trackId}/${pending.versionId}.wav`)).toBeNull();
    expect(await env.BUCKET.head(`audio/${gone.trackId}/${gone.versionId}.wav`)).not.toBeNull();

    await purge(env, Date.now() + 8 * 24 * 3600 * 1000);
    expect(await env.BUCKET.head(`audio/${gone.trackId}/${gone.versionId}.wav`)).toBeNull();
    expect(await env.BUCKET.head(coverKey!)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM folders WHERE id IN (?, ?)").bind(p.id, sub.id).first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM tracks WHERE id IN (?, ?)").bind(gone.trackId, pending.trackId).first("n")).toBe(0);
    expect(await env.BUCKET.head(`audio/${kept.trackId}/${kept.versionId}.wav`)).not.toBeNull();
  });
});

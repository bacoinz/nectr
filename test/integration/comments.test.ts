import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type {
  ArtistResponse, CommentDTO, CommentsResponse, FolderDTO, GuestIdentity, GuestInfoDTO, LibraryResponse, LinkDTO, RevisionsResponse, UploadResponse, VersionDTO,
} from "../../src/shared/api-types";
import { encodePeaks } from "../../src/shared/peaks";
import { purge } from "../../src/worker/cron";
import { makeWav } from "../fixtures/audio";

const OWNER = "http://localhost";
const GUEST = "https://nectr.example.workers.dev";
const PEAKS = encodePeaks(new Float32Array(64));
const NEUTRAL = "Este link não está disponível";
// A tiny "MP4" (ftyp box) and something that is no audio container at all.
const M4A = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
const JUNK = new Uint8Array(32).fill(7);

async function owner<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const raw = body instanceof Uint8Array;
  const res = await exports.default.fetch(`${OWNER}${path}`, {
    method,
    headers: raw ? { "Content-Type": "audio/mp4" } : { "Content-Type": "application/json" },
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as T };
}

async function guest<T>(method: string, path: string, body?: unknown, who?: GuestIdentity): Promise<{ status: number; json: T; text: string }> {
  const raw = body instanceof Uint8Array;
  const headers: Record<string, string> = raw ? { "Content-Type": "audio/mp4" } : { "Content-Type": "application/json" };
  if (who) headers["X-Guest"] = `${who.id}.${who.secret}`;
  const res = await exports.default.fetch(`${GUEST}${path}`, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: T | undefined;
  try { json = JSON.parse(text) as T; } catch { /* html or empty */ }
  return { status: res.status, json: json as T, text };
}

/** Artist → project "Noites" (Alfa v1+v2) → folder "Demos" (Demo); a loose track "Solto". */
async function setup() {
  const artist = (await owner<ArtistResponse>("POST", "/api/admin/artists", { name: "Duarte" })).json.artist;
  const project = (await owner<FolderDTO>("POST", `/api/admin/artists/${artist.id}/folders`, { name: "Noites" })).json;
  const folder = (await owner<FolderDTO>("POST", `/api/admin/artists/${artist.id}/folders`, { name: "Demos", parentId: project.id })).json;
  const add = async (filename: string, extra: Record<string, unknown> = {}) => {
    const file = makeWav({ frames: 48000 * 3 });
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
  const r = await owner<LinkDTO>("POST", "/api/admin/links", { name: "Editora", ...body });
  expect(r.status).toBe(201);
  return r.json;
}

async function newGuest(path: string, name = "Marta") {
  const r = await guest<GuestIdentity>("POST", `${path}/api/guest`, { name });
  expect(r.status).toBe(201);
  return r.json;
}

const ownerList = (trackId: string, since?: number) => owner<CommentsResponse>("GET", `/api/admin/tracks/${trackId}/comments${since ? `?since=${since}` : ""}`).then((r) => r.json);
const guestList = (path: string, trackId: string, who?: GuestIdentity, since?: number) =>
  guest<CommentsResponse>("GET", `${path}/api/comments?track=${trackId}${since ? `&since=${since}` : ""}`, undefined, who).then((r) => r.json);

describe("comments", () => {
  it("lets a named guest comment, the owner answer, and hides private notes from links", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    const marta = await newGuest(l.path);

    // No identity, no comment.
    expect((await guest("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, body: "Olá", tStart: 1 })).status).toBe(401);

    const c = await guest<CommentDTO>("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, body: "Voz mais alta aqui", tStart: 1.24, tEnd: 2 }, marta);
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ author: { kind: "guest", name: "Marta" }, mine: true, tStart: 1.2, tEnd: 2, status: "open", versionNumber: 2, via: null });

    // The owner sees where it came from; a private note and a public reply.
    const seen = await ownerList(s.a1.trackId);
    expect(seen.comments[0]).toMatchObject({ id: c.json.id, via: "Editora", mine: false });
    const note = await owner<CommentDTO>("POST", "/api/admin/comments", { versionId: s.a2.versionId, body: "Rever o compressor", tStart: 2, isPrivate: true });
    expect(note.json).toMatchObject({ isPrivate: true, mine: true, author: { kind: "owner" } });
    const answer = await owner<CommentDTO>("POST", "/api/admin/comments", { versionId: s.a1.versionId, parentId: c.json.id, body: "Feito na próxima", tStart: 0 });
    // A reply joins its thread: same version and time as the top comment.
    expect(answer.json).toMatchObject({ parentId: c.json.id, versionId: s.a2.versionId, tStart: 1.2, isPrivate: false });

    const g = await guestList(l.path, s.a1.trackId, marta);
    expect(g.comments.map((x) => x.body).sort()).toEqual(["Feito na próxima", "Voz mais alta aqui"]);
    expect(g.comments.every((x) => !x.isPrivate && x.via === null)).toBe(true);
    // Someone else on the same link does not own Marta's comment.
    expect((await guestList(l.path, s.a1.trackId)).comments.find((x) => x.id === c.json.id)?.mine).toBe(false);

    // Answering the owner's answer goes to the top of the thread.
    const back = await guest<CommentDTO>("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, parentId: answer.json.id, body: "Obrigada", tStart: 0 }, marta);
    expect(back.json.parentId).toBe(c.json.id);
    // A private note cannot be answered (or even found) from a link.
    expect((await guest("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, parentId: note.json.id, body: "?", tStart: 0 }, marta)).status).toBe(404);
  });

  it("renames a guest everywhere, and lets a guest delete only their own comments", async () => {
    const s = await setup();
    const l = await link({ target: { type: "track", id: s.a1.trackId } });
    const marta = await newGuest(l.path);
    const rui = await newGuest(l.path, "Rui");
    const c = (await guest<CommentDTO>("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, body: "Primeiro", tStart: 0 }, marta)).json;
    const before = await guestList(l.path, s.a1.trackId, marta);

    expect((await guest("PATCH", `${l.path}/api/guest`, { name: "Marta S." }, marta)).status).toBe(200);
    const after = await guestList(l.path, s.a1.trackId, marta, before.now);
    expect(after.comments.find((x) => x.id === c.id)?.author.name).toBe("Marta S.");

    expect((await guest("DELETE", `${l.path}/api/comments/${c.id}`, undefined, rui)).status).toBe(404);
    expect((await guest("DELETE", `${l.path}/api/comments/${c.id}`, undefined, marta)).status).toBe(204);
    const gone = await guestList(l.path, s.a1.trackId, marta, after.now);
    expect(gone.removed).toContain(c.id);
    expect((await guestList(l.path, s.a1.trackId, marta)).comments).toHaveLength(0);
  });

  it("keeps links to what they share, and listen-only links silent", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.folder.id } });
    const marta = await newGuest(l.path);
    // Outside the shared folder: no comments, no reading.
    expect((await guest("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, body: "x", tStart: 0 }, marta)).status).toBe(404);
    const outside = await guest("GET", `${l.path}/api/comments?track=${s.a1.trackId}`);
    expect(outside.status).toBe(404);
    expect(outside.text).toContain(NEUTRAL);

    const quiet = await link({ target: { type: "folder", id: s.project.id }, allowComments: false });
    expect((await guest("POST", `${quiet.path}/api/guest`, { name: "Rui" })).status).toBe(403);
    await owner("POST", "/api/admin/comments", { versionId: s.a2.versionId, body: "Público", tStart: 0 });
    expect((await guestList(quiet.path, s.a1.trackId)).comments).toHaveLength(0);
    const i = (await guest<GuestInfoDTO>("GET", `${quiet.path}/api/info`)).json;
    expect(i.tracks.every((t) => t.commentCount === 0)).toBe(true);
  });

  it("marks requests done in a version, counts what is open, and lists them for review", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    const marta = await newGuest(l.path);
    const req = (await guest<CommentDTO>("POST", `${l.path}/api/comments`, { versionId: s.a1.versionId, body: "Mais graves", tStart: 0.5 }, marta)).json;
    await guest("POST", `${l.path}/api/comments`, { versionId: s.demo.versionId, body: "Gosto", tStart: 1 }, marta);
    const note = (await owner<CommentDTO>("POST", "/api/admin/comments", { versionId: s.a1.versionId, body: "minha", tStart: 0, isPrivate: true })).json;

    let a = (await owner<ArtistResponse>("GET", `/api/admin/artists/${s.artist.id}`)).json;
    expect(a.tracks.find((t) => t.id === s.a1.trackId)).toMatchObject({ openRequests: 1, commentCount: 1 });
    let lib = (await owner<LibraryResponse>("GET", "/api/admin/library")).json;
    expect(lib.artists.find((x) => x.id === s.artist.id)?.openRequests).toBe(2);
    expect(lib.activity.slice(0, 2).map((x) => [x.author, x.trackTitle, x.kind])).toEqual([["Marta", "Demo", "comment"], ["Marta", "Alfa", "comment"]]);
    const i = (await guest<GuestInfoDTO>("GET", `${l.path}/api/info`)).json;
    expect(i.tracks.find((t) => t.id === s.a1.trackId)?.commentCount).toBe(1);

    // Done in the newest version by default, or in the one chosen.
    const done = await owner<CommentDTO>("PATCH", `/api/admin/comments/${req.id}`, { status: "done" });
    expect(done.json).toMatchObject({ status: "done", resolvedInVersionId: s.a2.versionId, resolvedInNumber: 2 });
    const inV1 = await owner<CommentDTO>("PATCH", `/api/admin/comments/${req.id}`, { status: "done", resolvedInVersionId: s.a1.versionId });
    expect(inV1.json.resolvedInNumber).toBe(1);
    expect((await owner("PATCH", `/api/admin/comments/${note.id}`, { status: "done" })).status).toBe(400);
    a = (await owner<ArtistResponse>("GET", `/api/admin/artists/${s.artist.id}`)).json;
    expect(a.tracks.find((t) => t.id === s.a1.trackId)?.openRequests).toBe(0);
    // The guest sees it was done.
    expect((await guestList(l.path, s.a1.trackId, marta)).comments[0]).toMatchObject({ status: "done", resolvedInNumber: 1 });

    const rev = (await owner<RevisionsResponse>("GET", "/api/admin/revisions")).json;
    const mine = rev.items.filter((x) => x.trackId === s.a1.trackId || x.trackId === s.demo.trackId);
    expect(mine.map((x) => x.body).sort()).toEqual(["Gosto", "Mais graves"]);
    expect(rev.tracks.find((t) => t.id === s.demo.trackId)).toMatchObject({ title: "Demo", artistName: "Duarte", projectName: "Noites", folderName: "Demos" });
    expect(rev.tracks.find((t) => t.id === s.a1.trackId)?.versions.map((v) => v.number)).toEqual([2, 1]);

    await owner("PATCH", `/api/admin/comments/${req.id}`, { status: "open" });
    lib = (await owner<LibraryResponse>("GET", "/api/admin/library")).json;
    expect(lib.artists.find((x) => x.id === s.artist.id)?.openRequests).toBe(2);
  });

  it("stores voice notes, streams them with ranges, and refuses anything else", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    const marta = await newGuest(l.path);
    const q = `versionId=${s.a2.versionId}&tStart=1&duration=4.2`;
    expect((await guest("POST", `${l.path}/api/comments/voice?${q}`, JUNK, marta)).status).toBe(400);
    expect((await guest("POST", `${l.path}/api/comments/voice?versionId=${s.a2.versionId}&tStart=1&duration=75`, M4A, marta)).status).toBe(400);
    const v = await guest<CommentDTO>("POST", `${l.path}/api/comments/voice?${q}`, M4A, marta);
    expect(v.status).toBe(201);
    expect(v.json).toMatchObject({ body: "", voice: { durationS: 4.2, mime: "audio/mp4" } });

    const res = await exports.default.fetch(`${GUEST}${l.path}/voice/${v.json.id}`, { headers: { Range: "bytes=4-7" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Type")).toBe("audio/mp4");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("ftyp");

    // A private voice note of the owner never plays through a link.
    const mine = await owner<CommentDTO>("POST", `/api/admin/comments/voice?versionId=${s.a2.versionId}&tStart=0&duration=2&private=1`, M4A);
    expect(mine.json.isPrivate).toBe(true);
    const hidden = await exports.default.fetch(`${GUEST}${l.path}/voice/${mine.json.id}`);
    expect(hidden.status).toBe(404);
    await hidden.text();
    const ownerVoice = await exports.default.fetch(`${OWNER}/api/admin/voice/${mine.json.id}`);
    expect(ownerVoice.status).toBe(200);
    await ownerVoice.arrayBuffer();

    const lib = (await owner<LibraryResponse>("GET", "/api/admin/library")).json;
    expect(lib.storage.voiceBytes).toBeGreaterThanOrEqual(M4A.length * 2);
  });

  it("refuses junk names and lets authors edit: the owner anytime, a guest on the same day", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    for (const name of ["asd", "aaaa", "teste", "http://x.pt", "M4rta"]) {
      expect((await guest("POST", `${l.path}/api/guest`, { name })).status, name).toBe(400);
    }
    const marta = await newGuest(l.path);
    const rui = await newGuest(l.path, "Rui");
    const c = (await guest<CommentDTO>("POST", `${l.path}/api/comments`, { versionId: s.a2.versionId, body: "Grave", tStart: 3 }, marta)).json;
    expect(c).toMatchObject({ canEdit: true, editedAt: null });
    expect((await guestList(l.path, s.a1.trackId, rui)).comments[0]?.canEdit).toBe(false);

    expect((await guest("PATCH", `${l.path}/api/comments/${c.id}`, { body: "x" }, rui)).status).toBe(404);
    const edited = await guest<CommentDTO>("PATCH", `${l.path}/api/comments/${c.id}`, { body: "Mais grave" }, marta);
    expect(edited.json).toMatchObject({ body: "Mais grave", canEdit: true });
    expect(edited.json.editedAt).toBeGreaterThan(0);

    // The next day it is too late.
    await env.DB.prepare("UPDATE comments SET created_at = created_at - 86400000 * 2 WHERE id = ?").bind(c.id).run();
    expect((await guest("PATCH", `${l.path}/api/comments/${c.id}`, { body: "Outra" }, marta)).status).toBe(403);
    expect((await guestList(l.path, s.a1.trackId, marta)).comments[0]?.canEdit).toBe(false);

    // The owner edits their own messages, never a guest's; voice notes are not edited.
    const mine = (await owner<CommentDTO>("POST", "/api/admin/comments", { versionId: s.a2.versionId, body: "Nota", tStart: 0 })).json;
    await env.DB.prepare("UPDATE comments SET created_at = 0 WHERE id = ?").bind(mine.id).run();
    expect((await owner<CommentDTO>("PATCH", `/api/admin/comments/${mine.id}`, { body: "Nota revista" })).json).toMatchObject({ body: "Nota revista", canEdit: true });
    expect((await owner("PATCH", `/api/admin/comments/${c.id}`, { body: "?" })).status).toBe(400);
    const voice = (await owner<CommentDTO>("POST", `/api/admin/comments/voice?versionId=${s.a2.versionId}&tStart=0&duration=1`, M4A)).json;
    expect(voice.canEdit).toBe(false);
    expect((await owner("PATCH", `/api/admin/comments/${voice.id}`, { body: "?" })).status).toBe(400);

    // "Revisões" brings the answers of each request.
    await owner("POST", "/api/admin/comments", { versionId: s.a2.versionId, parentId: c.id, body: "Já está", tStart: 0 });
    const rev = (await owner<RevisionsResponse>("GET", "/api/admin/revisions")).json;
    expect(rev.replies.filter((r) => r.parentId === c.id).map((r) => r.body)).toEqual(["Já está"]);
  });

  it("purges deleted comments and their voice notes after 7 days", async () => {
    const s = await setup();
    const v = (await owner<CommentDTO>("POST", `/api/admin/comments/voice?versionId=${s.loose.versionId}&tStart=0&duration=1`, M4A)).json;
    expect((await owner("DELETE", `/api/admin/comments/${v.id}`)).status).toBe(204);
    const key = await env.DB.prepare("SELECT voice_key FROM comments WHERE id = ?").bind(v.id).first<string>("voice_key");
    expect(await env.BUCKET.head(key!)).not.toBeNull();
    const r = await purge(env, Date.now() + 8 * 86400_000);
    expect(r.comments).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE id = ?").bind(v.id).first("n")).toBe(0);
    expect(await env.BUCKET.head(key!)).toBeNull();
  });

  it("deletes a track with all its versions, and 7 days later their audio and voice notes leave R2", async () => {
    const s = await setup();
    const l = await link({ target: { type: "folder", id: s.project.id } });
    const marta = await newGuest(l.path);
    const gv = await guest<CommentDTO>("POST", `${l.path}/api/comments/voice?versionId=${s.a1.versionId}&tStart=0&duration=1`, M4A, marta);
    expect(gv.status).toBe(201);
    const ov = (await owner<CommentDTO>("POST", `/api/admin/comments/voice?versionId=${s.a2.versionId}&tStart=0&duration=1`, M4A)).json;
    const audio = (await env.DB.prepare("SELECT r2_key FROM versions WHERE track_id = ?").bind(s.a1.trackId).all<{ r2_key: string }>()).results.map((r) => r.r2_key);
    const voice = (await env.DB.prepare("SELECT voice_key FROM comments WHERE id IN (?, ?)").bind(gv.json.id, ov.id).all<{ voice_key: string }>()).results.map((r) => r.voice_key);
    expect(audio).toHaveLength(2);
    expect(voice).toHaveLength(2);
    for (const k of [...audio, ...voice]) expect(await env.BUCKET.head(k)).not.toBeNull();
    const before = (await owner<LibraryResponse>("GET", "/api/admin/library")).json.storage;

    expect((await owner("POST", `/api/admin/artists/${s.artist.id}/delete`, { trackIds: [s.a1.trackId] })).status).toBe(200);
    // Both versions go with the track, and the library stops counting them.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM versions WHERE track_id = ? AND deleted_at IS NULL").bind(s.a1.trackId).first("n")).toBe(0);
    const after = (await owner<LibraryResponse>("GET", "/api/admin/library")).json.storage;
    expect(after.versionCount).toBe(before.versionCount - 2);
    expect(after.trashBytes).toBe(before.trashBytes + (before.audioBytes - after.audioBytes));
    expect(after.trashUntil).toBeGreaterThan(Date.now() + 6 * 86400_000);

    await purge(env, Date.now() + 8 * 86400_000);
    for (const k of [...audio, ...voice]) expect(await env.BUCKET.head(k)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM versions WHERE track_id = ?").bind(s.a1.trackId).first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE id IN (?, ?)").bind(gv.json.id, ov.id).first("n")).toBe(0);
    expect((await owner<LibraryResponse>("GET", "/api/admin/library")).json.storage.trashBytes).toBe(0);
  });

  it("keeps only the latest version of a track, with undo", async () => {
    const s = await setup();
    const del = await owner<{ batch: number }>("POST", `/api/admin/artists/${s.artist.id}/delete`, { versionIds: [s.a1.versionId] });
    expect(del.status).toBe(200);
    const track = (await owner<ArtistResponse>("GET", `/api/admin/artists/${s.artist.id}`)).json.tracks.find((t) => t.id === s.a1.trackId)!;
    expect(track.versions.map((v) => v.id)).toEqual([s.a2.versionId]);
    const back = (await owner<ArtistResponse>("POST", `/api/admin/artists/${s.artist.id}/restore-items`, { batch: del.json.batch })).json;
    expect(back.tracks.find((t) => t.id === s.a1.trackId)!.versions).toHaveLength(2);
  });

  it("brings back every version when a deleted track is undone", async () => {
    const s = await setup();
    const del = await owner<{ batch: number }>("POST", `/api/admin/artists/${s.artist.id}/delete`, { trackIds: [s.a1.trackId] });
    const back = (await owner<ArtistResponse>("POST", `/api/admin/artists/${s.artist.id}/restore-items`, { batch: del.json.batch })).json;
    expect(back.tracks.find((t) => t.id === s.a1.trackId)!.versions.map((v) => v.number)).toEqual([2, 1]);
  });
});

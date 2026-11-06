import { probeAudio } from "../../shared/audio/probe";
import { analyse } from "../audio/analyse";
import { admin, ApiError } from "./api";
import { toast } from "./toast.svelte";

// Upload queue: validate the header in the browser, then upload straight to R2
// while the waveform is computed, and finalize (the Worker re-validates).

export interface UploadItem {
  key: number;
  artistId: string;
  folderId: string | null;
  /** Set for a new version of an existing track (and once a new track exists). */
  trackId: string | null;
  kind: "new" | "version";
  title: string;
  stage: "waiting" | "upload" | "analyse" | "finalize" | "error";
  /** 0..1 upload progress */
  sent: number;
  /** 0..1 analysis progress */
  analysed: number;
  error?: string;
}

export const uploads = $state<UploadItem[]>([]);
let seq = 0;
let running = 0;
const PARALLEL = 3;
const queue: (() => Promise<void>)[] = [];

export const isAudioName = (name: string) => /\.(wav|wave|mp3)$/i.test(name);
const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").replace(/^\s*\d{1,3}\s*[-_.)]\s*/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim() || name;

export function uploadsFor(artistId: string) {
  return uploads.filter((u) => u.artistId === artistId);
}

/**
 * Queues files for upload. Non-audio files are skipped with a notice. With
 * `trackId`, the first file becomes a new version of that track.
 */
export function startUploads(files: File[], ctx: { artistId: string; folderId: string | null; trackId?: string }, onDone: () => Promise<unknown> | void) {
  const audio = files.filter((f) => isAudioName(f.name));
  const skipped = files.length - audio.length;
  if (!audio.length) {
    toast(files.length ? "Só são aceites ficheiros WAV e MP3." : "Não há ficheiros para carregar.");
    return;
  }
  const list = ctx.trackId ? audio.slice(0, 1) : audio;
  if (ctx.trackId && audio.length > 1) toast("Para uma versão nova, usei só o primeiro ficheiro.");
  else if (skipped) toast(`${skipped === 1 ? "1 ficheiro ignorado" : `${skipped} ficheiros ignorados`}: só WAV e MP3.`);
  for (const file of list) {
    const item: UploadItem = {
      key: ++seq,
      artistId: ctx.artistId,
      folderId: ctx.folderId,
      trackId: ctx.trackId ?? null,
      kind: ctx.trackId ? "version" : "new",
      title: titleOf(file.name),
      stage: "waiting",
      sent: 0,
      analysed: 0,
    };
    uploads.push(item);
    queue.push(() => run(item.key, file, onDone));
  }
  pump();
}

function pump() {
  while (running < PARALLEL && queue.length) {
    running++;
    void queue.shift()!().finally(() => {
      running--;
      pump();
    });
  }
}

const find = (key: number) => uploads.find((u) => u.key === key);

function fail(key: number, message: string) {
  const u = find(key);
  if (!u) return;
  u.stage = "error";
  u.error = message;
  toast(`“${u.title}”: ${message}`);
  setTimeout(() => remove(key), 8000);
}

function remove(key: number) {
  const i = uploads.findIndex((u) => u.key === key);
  if (i >= 0) uploads.splice(i, 1);
}

function put(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`O envio falhou (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("O envio falhou. Verifica a ligação e tenta outra vez."));
    xhr.send(file);
  });
}

async function run(key: number, file: File, onDone: () => Promise<unknown> | void) {
  const item = find(key)!;
  const probe = await probeAudio(async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()), file.size);
  if (!probe.ok) return fail(key, probe.message);

  let versionId: string | null = null;
  try {
    const start = await admin.startUpload({ artistId: item.artistId, folderId: item.folderId, trackId: item.trackId ?? undefined, filename: file.name, size: file.size });
    versionId = start.versionId;
    item.trackId = start.trackId;
    if (item.kind === "version") item.title = `v${start.number}`;
    item.stage = "upload";
    const [, analysis] = await Promise.all([
      put(start.upload.url, file, (p) => (find(key)!.sent = p)),
      analyse(file, probe.info, (p) => (find(key)!.analysed = p)),
    ]);
    item.stage = "finalize";
    await admin.finalize(versionId, analysis);
    // Refresh first, so the finished row never blinks out before the real one appears.
    await Promise.resolve(onDone()).catch(() => {});
    remove(key);
    toast(item.kind === "version" ? `${item.title} pronta` : `“${item.title}” carregada`);
  } catch (e) {
    if (versionId && !(e instanceof ApiError && e.status === 422)) void admin.cancelUpload(versionId).catch(() => {});
    fail(key, e instanceof Error ? e.message : "Não foi possível carregar.");
  }
}

/** "A carregar 42%" / "A analisar…" for the row that shows an upload. */
export function uploadLabel(u: UploadItem): string {
  if (u.stage === "error") return u.error ?? "Erro";
  if (u.stage === "waiting") return "À espera…";
  if (u.stage === "finalize") return "A verificar o ficheiro…";
  if (u.sent >= 1) return "A analisar a forma de onda…";
  return `${u.kind === "version" ? `${u.title} · ` : ""}A carregar ${Math.round(u.sent * 100)}%`;
}

/** Collects files from a drop, walking dropped folders (webkitGetAsEntry). */
export async function filesFromDrop(dt: DataTransfer): Promise<{ files: File[]; folderName: string | null }> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const dir = entries.length === 1 && entries[0]!.isDirectory ? entries[0]!.name : null;
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const x of batch) await walk(x);
      }
    }
  };
  if (entries.length) for (const e of entries) await walk(e);
  else out.push(...dt.files);
  return { files: out, folderName: dir };
}

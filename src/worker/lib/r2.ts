import { AwsClient } from "aws4fetch";
import type { Context } from "hono";
import { HttpError } from "./errors";

/**
 * Where the browser PUTs an upload. In production: a presigned URL straight to
 * R2 (files never pass through the Worker, which caps bodies at 100 MB). In
 * development the presigned URL would hit the real bucket while the local
 * Worker reads the simulated one, so uploads go through /api/admin/dev-upload.
 */
export async function createUploadTarget(env: Env, key: string, versionId: string) {
  if (env.ENVIRONMENT === "development") {
    return { url: `/api/admin/dev-upload/${versionId}`, method: "PUT" as const, headers: {} };
  }
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new HttpError(503, "storage_not_configured", "O armazenamento ainda não está configurado (faltam as credenciais do R2).");
  }
  const client = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const url = new URL(`https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
  url.searchParams.set("X-Amz-Expires", "3600");
  const signed = await client.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return { url: signed.url, method: "PUT" as const, headers: {} };
}

/** Reads `length` bytes at `offset` (clamped to the object) — the ByteSource for probeAudio. */
export const r2Source = (bucket: R2Bucket, key: string, size: number) => async (offset: number, length: number) => {
  const obj = await bucket.get(key, { range: { offset, length: Math.min(length, size - offset) } });
  return obj ? new Uint8Array(await obj.arrayBuffer()) : new Uint8Array(0);
};

type Range = { offset: number; length?: number } | { suffix: number };

/** A single `bytes=` range; anything else (multi-range, junk) is ignored as RFC 9110 allows. */
export function parseRange(header: string | undefined): Range | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const start = Number(m[1]);
  if (m[2] === "") return { offset: start };
  const end = Number(m[2]);
  return end < start ? null : { offset: start, length: end - start + 1 };
}

export interface ServeOptions {
  contentType: string;
  /** Set for downloads (Content-Disposition: attachment); otherwise inline. */
  downloadName?: string;
  cacheControl?: string;
}

/**
 * Streams an R2 object with HTTP Range support (206 + Content-Range), which
 * Safari/iOS requires for seeking. The R2 key never appears in the response.
 */
export async function serveObject(c: Context, bucket: R2Bucket, key: string, o: ServeOptions): Promise<Response> {
  const range = parseRange(c.req.header("Range"));
  let obj: R2ObjectBody | null = null;
  try {
    obj = range ? await bucket.get(key, { range }) : await bucket.get(key);
  } catch {
    // R2 rejects ranges past the end; clamp an explicit end, or answer 416.
    const head = await bucket.head(key);
    if (!head) return notFoundResponse();
    if (range && "offset" in range && range.offset < head.size) {
      obj = await bucket.get(key, { range: { offset: range.offset, length: head.size - range.offset } });
    } else {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${head.size}`, "Accept-Ranges": "bytes" } });
    }
  }
  if (!obj) return notFoundResponse();

  const size = obj.size;
  const headers = new Headers({
    "Content-Type": o.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": o.cacheControl ?? "private, max-age=86400",
    ETag: obj.httpEtag,
    "Content-Disposition": o.downloadName ? contentDisposition(o.downloadName) : "inline",
  });
  if (!range) {
    headers.set("Content-Length", String(size));
    return new Response(obj.body, { status: 200, headers });
  }
  let start: number;
  let length: number;
  if ("suffix" in range) {
    start = Math.max(0, size - range.suffix);
    length = size - start;
  } else {
    start = range.offset;
    length = Math.min(range.length ?? size - start, size - start);
  }
  if (length <= 0 || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  }
  headers.set("Content-Length", String(length));
  headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${size}`);
  return new Response(obj.body, { status: 206, headers });
}

const notFoundResponse = () => new Response(JSON.stringify({ error: { code: "not_found", message: "Ficheiro não encontrado." } }), { status: 404, headers: { "Content-Type": "application/json" } });

/** attachment with an ASCII fallback plus the UTF-8 name (RFC 6266). */
export function contentDisposition(name: string): string {
  const ascii = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const IMAGE_MAGIC: [string, (b: Uint8Array) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["image/webp", (b) => String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP"],
];

/** Checks the bytes, not the declared Content-Type. */
export const sniffImage = (b: Uint8Array) => IMAGE_MAGIC.find(([, test]) => b.length > 12 && test(b))?.[0] ?? null;

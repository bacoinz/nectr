import type { Context } from "hono";
import { LIMITS } from "../../../shared/constants";
import { badRequest, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { sniffImage } from "../../lib/r2";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Stores an artwork/profile image sent as the raw request body. The browser
 * already resized it to ≤1200 px; here we only enforce the size and sniff the
 * real type. Every upload gets a fresh key, so the old URL can be cached forever.
 */
export async function putImage<E extends { Bindings: Env }>(c: Context<E>, prefix: string): Promise<string> {
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > LIMITS.maxImageBytes) throw badRequest("A imagem tem mais de 2 MB.");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw badRequest("A imagem está vazia.");
  if (bytes.length > LIMITS.maxImageBytes) throw badRequest("A imagem tem mais de 2 MB.");
  const type = sniffImage(bytes);
  if (!type) throw badRequest("Usa uma imagem JPG, PNG ou WebP.");
  const key = `images/${prefix}-${newId()}.${EXT[type]}`;
  await c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  return key;
}

export async function deleteImage<E extends { Bindings: Env }>(c: Context<E>, key: string) {
  await c.env.BUCKET.delete(key);
}

export async function serveImage<E extends { Bindings: Env }>(c: Context<E>, key: string | null): Promise<Response> {
  if (!key) throw notFound("Sem imagem.");
  const obj = await c.env.BUCKET.get(key);
  if (!obj) throw notFound("Sem imagem.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      // The URL carries ?v=<updated_at> and keys never get reused.
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: obj.httpEtag,
    },
  });
}

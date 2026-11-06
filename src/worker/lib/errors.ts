import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** JSON error shape shared by every API route; `message` is shown to the user (pt-PT). */
export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

/** Thrown from handlers and turned into an apiError response by the app's onError. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
export const notFound = (message = "Não encontrado.") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);

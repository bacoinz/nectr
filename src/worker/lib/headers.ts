import type { MiddlewareHandler } from "hono";

// Keep in sync with public/_headers (static assets bypass the Worker);
// headers.test.ts fails if the two drift apart.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self' https://*.r2.cloudflarestorage.com",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
};

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  // Responses from fetch()/ASSETS have immutable headers, so re-wrap first.
  const res = new Response(c.res.body, c.res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "private, no-store");
  c.res = res;
};

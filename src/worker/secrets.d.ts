// Secrets that only exist in production (`wrangler secret put`), so `wrangler types`
// cannot see them in .dev.vars. Locally, uploads use the dev-upload route instead.
interface Env {
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

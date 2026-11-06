import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // Applied to the local D1 before the integration tests (test/apply-migrations.ts).
  const migrations = await readD1Migrations("./migrations");
  // A throwaway notification key for the tests (the real one is a secret: scripts/push-key.mjs).
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const vapid = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
  return {
    test: {
      projects: [
        {
          // Pure TypeScript modules (parsers, DSP, crypto helpers) run in Node.
          test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" },
        },
        {
          // Our loudness meter against ffmpeg (needs ffmpeg in PATH): npm run loudness.
          test: { name: "loudness", include: ["scripts/compare-loudness.test.ts"], environment: "node", testTimeout: 600_000 },
        },
        {
          // The Worker runs in workerd with local D1/R2, like in production.
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  ENVIRONMENT: "development",
                  OWNER_EMAIL: "owner@example.com",
                  ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
                  ACCESS_AUD: "test-aud",
                  COOKIE_SECRET: "test-cookie-secret",
                  VAPID_JWK: vapid,
                  TEST_MIGRATIONS: migrations,
                },
              },
            }),
          ],
          test: { name: "worker", include: ["test/integration/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
        },
      ],
    },
  };
});

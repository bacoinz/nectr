import { applyD1Migrations, env } from "cloudflare:test";

// Runs before each integration test file; already-applied migrations are skipped.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

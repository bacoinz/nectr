import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://nectr.example.workers.dev";

describe("public routes", () => {
  it("GET /api/health responds with security headers", async () => {
    const res = await exports.default.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("unknown API routes return a JSON 404", async () => {
    const res = await exports.default.fetch(`${BASE}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("owner API", () => {
  it("rejects requests without an Access token", async () => {
    const res = await exports.default.fetch(`${BASE}/api/admin/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects an invalid Access token", async () => {
    const res = await exports.default.fetch(`${BASE}/api/admin/me`, {
      headers: { "Cf-Access-Jwt-Assertion": "garbage.token.value" },
    });
    expect(res.status).toBe(401);
  });

  it("only skips Access on localhost in development", async () => {
    const res = await exports.default.fetch("http://localhost/api/admin/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "owner@example.com" });
  });
});

describe("share links", () => {
  it("unknown tokens get the same neutral 404 page", async () => {
    const a = await exports.default.fetch(`${BASE}/s/abc123`);
    const b = await exports.default.fetch(`${BASE}/s/zzz999/audio/v1`);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.headers.get("Content-Type")).toContain("text/html");
    expect(await a.text()).toBe(await b.text());
  });
});

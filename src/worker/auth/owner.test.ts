import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { getOwner, normalizeTeamDomain, verifyAccessToken, type AccessCheck } from "./owner";

const check: AccessCheck = {
  teamDomain: "https://team.cloudflareaccess.com",
  audience: "aud-123",
  ownerEmail: "Owner@Example.com",
};

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

function token(claims: Record<string, unknown> = {}, opts: { iss?: string; aud?: string; exp?: string } = {}) {
  return new SignJWT({ email: "owner@example.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? check.teamDomain)
    .setAudience(opts.aud ?? check.audience)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(privateKey);
}

describe("verifyAccessToken", () => {
  it("accepts a valid token for the owner (email is case-insensitive)", async () => {
    expect(await verifyAccessToken(await token(), keys, check)).toEqual({ email: "owner@example.com" });
  });

  it("rejects another email", async () => {
    expect(await verifyAccessToken(await token({ email: "someone@example.com" }), keys, check)).toBeNull();
  });

  it("rejects a token without email", async () => {
    expect(await verifyAccessToken(await token({ email: undefined }), keys, check)).toBeNull();
  });

  it("rejects the wrong audience or issuer", async () => {
    expect(await verifyAccessToken(await token({}, { aud: "other" }), keys, check)).toBeNull();
    expect(await verifyAccessToken(await token({}, { iss: "https://evil.cloudflareaccess.com" }), keys, check)).toBeNull();
  });

  it("rejects an expired token", async () => {
    expect(await verifyAccessToken(await token({}, { exp: "-1m" }), keys, check)).toBeNull();
  });

  it("rejects a token signed with another key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: "owner@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(check.teamDomain)
      .setAudience(check.audience)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await verifyAccessToken(forged, keys, check)).toBeNull();
  });

  it("rejects garbage and unsigned tokens", async () => {
    expect(await verifyAccessToken("not-a-jwt", keys, check)).toBeNull();
    const unsigned = `${btoa('{"alg":"none"}')}.${btoa('{"email":"owner@example.com"}')}.`;
    expect(await verifyAccessToken(unsigned, keys, check)).toBeNull();
  });
});

describe("getOwner", () => {
  const env = {
    ENVIRONMENT: "development",
    OWNER_EMAIL: "owner@example.com",
    ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    ACCESS_AUD: "aud-123",
  };

  it("trusts the configured owner only on localhost in development", async () => {
    expect(await getOwner(new Request("http://localhost:5173/api/admin/me"), env)).toEqual({ email: "owner@example.com" });
    expect(await getOwner(new Request("https://nectr.example.workers.dev/api/admin/me"), env)).toBeNull();
  });

  it("never bypasses Access in production, even on localhost", async () => {
    const prod = { ...env, ENVIRONMENT: "production" };
    expect(await getOwner(new Request("http://localhost/api/admin/me"), prod)).toBeNull();
  });
});

describe("normalizeTeamDomain", () => {
  it("adds https and strips trailing slashes", () => {
    expect(normalizeTeamDomain("team.cloudflareaccess.com")).toBe("https://team.cloudflareaccess.com");
    expect(normalizeTeamDomain("https://team.cloudflareaccess.com/")).toBe("https://team.cloudflareaccess.com");
  });
});

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface Owner {
  email: string;
}

/** The subset of the Worker env that owner authentication depends on. */
export interface OwnerEnv {
  ENVIRONMENT: string;
  OWNER_EMAIL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

export interface AccessCheck {
  teamDomain: string;
  audience: string;
  ownerEmail: string;
}

/**
 * The single place that decides who the owner is. Today this trusts a
 * Cloudflare Access JWT; replace this function to move to app-managed accounts.
 */
export async function getOwner(request: Request, env: OwnerEnv): Promise<Owner | null> {
  if (isLocalDevelopment(request, env)) {
    return env.OWNER_EMAIL ? { email: env.OWNER_EMAIL.toLowerCase() } : null;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL) return null;

  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  return verifyAccessToken(token, accessKeys(teamDomain), {
    teamDomain,
    audience: env.ACCESS_AUD,
    ownerEmail: env.OWNER_EMAIL,
  });
}

/** Verifies an Access JWT (signature, issuer, audience, expiry) and checks the email. */
export async function verifyAccessToken(
  token: string,
  keys: JWTVerifyGetKey,
  check: AccessCheck,
): Promise<Owner | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: check.teamDomain,
      audience: check.audience,
      algorithms: ["RS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    return email !== "" && email === check.ownerEmail.toLowerCase() ? { email } : null;
  } catch {
    return null;
  }
}

/** Accepts "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/". */
export function normalizeTeamDomain(value: string): string {
  const withScheme = value.startsWith("https://") ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

// createRemoteJWKSet caches and refreshes keys itself; keep one per isolate.
const keysByTeam = new Map<string, JWTVerifyGetKey>();

function accessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keysByTeam.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    keysByTeam.set(teamDomain, keys);
  }
  return keys;
}

// Access is not in front of the local dev server; only there, and only on a
// loopback host, the configured owner is trusted without a token.
function isLocalDevelopment(request: Request, env: OwnerEnv): boolean {
  if (env.ENVIRONMENT !== "development") return false;
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

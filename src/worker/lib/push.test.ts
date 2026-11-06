import { describe, expect, it } from "vitest";
import { b64url, encryptPush, isPushEndpoint, unb64url, vapidAuth, vapidOf } from "./push";

// RFC 8291, Appendix A: the worked example, byte for byte.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("web push encryption", () => {
  it("matches the RFC 8291 example", async () => {
    const out = await encryptPush(new TextEncoder().encode(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      sender: { privateKey: RFC.asPrivate, publicKey: RFC.asPublic },
      salt: unb64url(RFC.salt),
    });
    expect(b64url(out)).toBe(RFC.body);
  });

  it("uses a new key and salt for every message", async () => {
    const t = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const a = await encryptPush(new Uint8Array([1, 2, 3]), t);
    const b = await encryptPush(new Uint8Array([1, 2, 3]), t);
    expect(b64url(a.subarray(0, 16))).not.toBe(b64url(b.subarray(0, 16)));
    expect(b64url(a.subarray(21, 86))).not.toBe(b64url(b.subarray(21, 86)));
    // salt 16 + rs 4 + idlen 1 + key 65 + (3 bytes + delimiter + 16-byte tag)
    expect(a.length).toBe(16 + 4 + 1 + 65 + 3 + 1 + 16);
  });
});

describe("vapid", () => {
  it("signs a JWT for the push service with the app's key", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const vapid = (await vapidOf({ VAPID_JWK: JSON.stringify(jwk) }))!;
    expect(unb64url(vapid.publicKey).length).toBe(65);

    const header = await vapidAuth(vapid, "https://fcm.googleapis.com/fcm/send/abc", "https://nectr.example", 1_700_000_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(vapid.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(unb64url(m[2]!)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_700_000_000 + 12 * 3600, sub: "https://nectr.example" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, unb64url(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it("is off without a key", async () => {
    expect(await vapidOf({ VAPID_JWK: "" })).toBeNull();
  });
});

describe("push endpoints", () => {
  it("accepts only the browsers' push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc:def")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://evil.example/push.services.mozilla.com")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });
});

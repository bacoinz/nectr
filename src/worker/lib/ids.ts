const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** 12-character id (72 random bits) for database rows. */
export const newId = () => toBase64Url(random(9));

/** 22-character share token (128 random bits). */
export const newToken = () => toBase64Url(random(16));

export const now = () => Date.now();

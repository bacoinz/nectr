// Creates the key that signs notifications (VAPID) and stores it without ever
// printing the private part.
//
//   node scripts/push-key.mjs          saves it as the VAPID_JWK secret in Cloudflare
//   node scripts/push-key.mjs --dev    writes it to .dev.vars (local development)
//
// Run it once. A new key turns off notifications on every device that had them
// on, until each one is switched on again (that is why it asks for --force).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const dev = process.argv.includes("--dev");
const force = process.argv.includes("--force");

const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const { kty, crv, x, y, d } = await crypto.subtle.exportKey("jwk", privateKey);
const value = JSON.stringify({ kty, crv, x, y, d });

if (dev) {
  const file = ".dev.vars";
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  if (lines.some((l) => l.startsWith("VAPID_JWK=")) && !force) {
    console.log(".dev.vars já tem VAPID_JWK. Para criar outra, junta --force.");
    process.exit(0);
  }
  const kept = lines.filter((l) => !l.startsWith("VAPID_JWK="));
  while (kept.length && kept.at(-1) === "") kept.pop();
  writeFileSync(file, [...kept, `VAPID_JWK='${value}'`, ""].join("\n"));
  console.log("VAPID_JWK guardada em .dev.vars.");
} else {
  const list = spawnSync("npx wrangler secret list", { shell: true, encoding: "utf8" });
  if (list.status === 0 && list.stdout.includes('"VAPID_JWK"') && !force) {
    console.log("A chave das notificações já existe na Cloudflare. Criar outra desliga os avisos em todos os dispositivos; se é isso que queres, junta --force.");
    process.exit(0);
  }
  const put = spawnSync("npx wrangler secret put VAPID_JWK", { shell: true, input: value, stdio: ["pipe", "inherit", "inherit"] });
  if (put.status !== 0) process.exit(put.status ?? 1);
  console.log("Feito: a chave das notificações ficou guardada como secret VAPID_JWK.");
}

// Guest names: a real-looking name, checked the same way in the browser and in
// the Worker, so "asd", "aaaa", "teste" or "http://…" do not end up on comments.

export const GUEST_NAME_MIN = 2;
export const GUEST_NAME_MAX = 40;

const ROWS = ["qwertyuiop", "asdfghjklç", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz"];
const JUNK = new Set([
  "teste", "testes", "test", "testing", "xpto", "nome", "name", "anonimo", "anon", "anonymous", "ninguem", "nada",
  "eu", "user", "guest", "convidado", "cliente", "lol", "ola", "hello", "hi", "asdf", "abc", "xyz", "ok", "sim", "nao",
  "spam", "fake", "random", "aleatorio", "qualquer", "qualquercoisa", "coisa", "cena", "cenas", "fulano", "sicrano", "beltrano",
  "bla", "blabla", "blablabla", "yo", "oi", "boas", "oii", "hey", "admin", "root", "null", "undefined", "none",
]);
/** The home row: a word made only of these letters (6+) is a hand dragged over the keyboard. */
const HOME_ROW = /^[asdfghjklç]{6,}$/;

/** Letters only, lower case, without accents (for the checks, not for display). */
const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zç]/g, "");

/** Four or more keys in a row of the keyboard, anywhere in the word ("qwer", "lkjh"). */
function hasKeyRun(word: string) {
  for (const row of ROWS) {
    for (const r of [row, [...row].reverse().join("")]) {
      for (let i = 0; i + 4 <= r.length; i++) if (word.includes(r.slice(i, i + 4))) return true;
    }
  }
  return false;
}

/** Typed nonsense rather than a name. */
function isMash(word: string) {
  if (word.length < 3) return false;
  if (ROWS.some((row) => row.includes(word) || [...row].reverse().join("").includes(word))) return true;
  if (hasKeyRun(word) || HOME_ROW.test(word)) return true;
  // A short chunk said over and over: "asdasd", "jdjdjd", "hahaha" (but "Lulu" and "Nini" are names).
  if (/^(.{3,4})\1+$/.test(word) || /^(.{1,2})\1{2,}$/.test(word)) return true;
  // Five consonants in a row, or a long word with a single vowel: "jdksjdka", "sdfkjl".
  if (/[^aeiouy]{5,}/.test(word)) return true;
  if (word.length >= 8 && (word.match(/[aeiouy]/g)?.length ?? 0) < 2) return true;
  // "y" only stands in for a vowel in short names ("Ty"): "yygnjy" is not a name.
  if (word.length >= 4 && !/[aeiou]/.test(word)) return true;
  return false;
}

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

export function checkGuestName(raw: string): NameCheck {
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  const bad = (message: string): NameCheck => ({ ok: false, message });
  if (name.length < GUEST_NAME_MIN) return bad("Escreve o teu nome.");
  if (name.length > GUEST_NAME_MAX) return bad(`O nome pode ter até ${GUEST_NAME_MAX} caracteres.`);
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’. -]*$/u.test(name)) return bad("Usa só letras: sem números, símbolos nem links.");
  const words = name.split(" ");
  if (words.length > 5) return bad("Chega o primeiro nome e o apelido.");
  const letters = plain(name);
  if (letters.length < GUEST_NAME_MIN) return bad("Escreve o teu nome.");
  if (/(.)\1\1/.test(letters)) return bad("Escreve o teu nome verdadeiro (por exemplo, Marta ou Rui Costa).");
  if (!/[aeiouy]/.test(letters)) return bad("Escreve o teu nome verdadeiro (por exemplo, Marta ou Rui Costa).");
  if (JUNK.has(letters) || words.some((w) => isMash(plain(w)))) return bad("Escreve o teu nome verdadeiro (por exemplo, Marta ou Rui Costa).");
  return { ok: true, name };
}

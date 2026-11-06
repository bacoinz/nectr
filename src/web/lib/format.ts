// pt-PT formatting: decimal comma, d/m/yyyy dates, minus sign for negatives.

/** 107.4 → "1:47" (hours when needed). */
export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A whole track's length, rounded like other players show it (183.6 → "3:04"). */
export const fmtDuration = (s: number) => fmtTime(Math.round(s));

/** -9.84 → "−9,8" */
export const num = (v: number, digits = 1) => v.toFixed(digits).replace(".", ",").replace("-", "−");

export const kHz = (sr: number) => `${num(sr / 1000, sr % 1000 ? 1 : 0)} kHz`;

export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1000 ** 2) return `${num(n / 1000, 0)} KB`;
  if (n < 1000 ** 3) return `${num(n / 1000 ** 2, n < 10 * 1000 ** 2 ? 1 : 0)} MB`;
  return `${num(n / 1000 ** 3, 1)} GB`;
}

const pad = (n: number) => String(n);
export function date(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "22/10" (day and month only). */
export function dayMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** "há 12 min", "ontem", "3/10/2026" */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "agora mesmo";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 2 * 86400) return "ontem";
  if (s < 7 * 86400) return `há ${Math.round(s / 86400)} dias`;
  return date(ms);
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const fmtLabel = (v: { format: "wav" | "mp3"; bitDepth: number | null; bitrateKbps: number }) =>
  v.format === "wav" ? `WAV ${v.bitDepth} bit` : `MP3 ${v.bitrateKbps} kbps`;

export const versionName = (v: { number: number; label: string }) => `v${v.number}${v.label ? ` · ${v.label}` : ""}`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/**
 * Text colour for a project colour: dark ink or white, whichever contrasts
 * more (WCAG relative luminance).
 */
export function inkFor(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return (L + 0.05) / 0.0574 >= 1.05 / (L + 0.05) ? "#1d1404" : "#ffffff";
}

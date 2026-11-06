// Lyrics as LRC text: "[mm:ss.xx]line". Parsed tolerantly (several timestamps
// per line, [m:ss], [mm:ss:xx], [offset:±ms], tags like [ar:] are ignored),
// written back in the common [mm:ss.xx] form. A line without a time is plain
// text: lyrics without any time are shown unsynchronised.

export interface LyricLine {
  /** Seconds, or null for a line without a time. */
  t: number | null;
  text: string;
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TAG = /^\[([a-z#]+):(.*)\]\s*$/i;

export function parseLrc(src: string): LyricLine[] {
  let offset = 0;
  const out: { t: number | null; text: string; order: number }[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, order) => {
    const line = raw.replace(/\s+$/, "");
    const tag = TAG.exec(line.trim());
    if (tag && !/^\d/.test(tag[1]!)) {
      if (tag[1]!.toLowerCase() === "offset") offset = (Number(tag[2]) || 0) / 1000;
      return;
    }
    const times: number[] = [];
    let m: RegExpExecArray | null;
    STAMP.lastIndex = 0;
    let rest = line;
    while ((m = STAMP.exec(line))) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
    }
    if (times.length) rest = line.replace(STAMP, "");
    const text = rest.trim();
    if (!times.length) out.push({ t: null, text, order });
    else for (const t of times) out.push({ t, text, order });
  });
  // LRC applies the offset by subtracting it ("+" means the lyrics come earlier).
  for (const l of out) if (l.t !== null) l.t = Math.max(0, Math.round((l.t - offset) * 1000) / 1000);
  // Several stamps on one line (repeated choruses) put lines out of order: sort timed lines,
  // keeping untimed ones right after whatever preceded them.
  let last = -1;
  const keyed = out.map((l) => {
    if (l.t !== null) last = l.t;
    return { ...l, key: last };
  });
  keyed.sort((a, b) => a.key - b.key || a.order - b.order);
  // Trim blank lines at both ends.
  while (keyed.length && !keyed[0]!.text && keyed[0]!.t === null) keyed.shift();
  while (keyed.length && !keyed.at(-1)!.text && keyed.at(-1)!.t === null) keyed.pop();
  return keyed.map(({ t, text }) => ({ t, text }));
}

const two = (n: number) => String(n).padStart(2, "0");
export function stamp(t: number) {
  const cs = Math.round(t * 100);
  return `${two(Math.floor(cs / 6000))}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}`;
}

export function serializeLrc(lines: LyricLine[], meta: { title?: string; artist?: string } = {}): string {
  const head = [meta.title ? `[ti:${meta.title}]` : "", meta.artist ? `[ar:${meta.artist}]` : ""].filter(Boolean);
  const body = lines.map((l) => (l.t !== null ? `[${stamp(l.t)}]${l.text}` : l.text));
  return [...head, ...body].join("\n");
}

export const isSynced = (lines: LyricLine[]) => lines.some((l) => l.t !== null);

/** The line being sung at `t`: the last timed line that started, or -1. */
export function activeLine(lines: LyricLine[], t: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lt = lines[i]!.t;
    if (lt === null) continue;
    if (lt <= t + 0.05) idx = i;
    else break;
  }
  return idx;
}

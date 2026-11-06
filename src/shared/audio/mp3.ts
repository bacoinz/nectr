import { ascii, type Reader } from "./reader";
import { fail, type ProbeResult } from "./types";

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface FrameHeader {
  /** 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5 */
  version: number;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  length: number;
  samples: number;
}

/** Parses a Layer III frame header; anything else (incl. layers I/II, free format) is null. */
export function parseFrameHeader(b: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > b.length) return null;
  const b1 = b[at + 1]!, b2 = b[at + 2]!, b3 = b[at + 3]!;
  if (b[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  const brIndex = b2 >> 4;
  const srIndex = (b2 >> 2) & 3;
  if (version === 1 || layer !== 1 || brIndex === 0 || brIndex === 15 || srIndex === 3) return null;
  const v1 = version === 3;
  const bitrateKbps = (v1 ? BITRATES_V1 : BITRATES_V2)[brIndex]!;
  const sampleRate = SAMPLE_RATES[version]![srIndex]!;
  const padding = (b2 >> 1) & 1;
  const length = Math.floor(((v1 ? 144000 : 72000) * bitrateKbps) / sampleRate) + padding;
  return { version, bitrateKbps, sampleRate, channels: b3 >> 6 === 3 ? 1 : 2, length, samples: v1 ? 1152 : 576 };
}

const syncsafe = (b: Uint8Array, at: number) => ((b[at]! & 0x7f) << 21) | ((b[at + 1]! & 0x7f) << 14) | ((b[at + 2]! & 0x7f) << 7) | (b[at + 3]! & 0x7f);
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** Bytes to look for the first frame after the ID3 tag(s): encoders sometimes pad with zeros. */
const SCAN = 16 * 1024;

/**
 * Skips ID3v2 tags by their declared size (cover art can be megabytes), then
 * requires a Layer III frame whose successor also syncs — "ID3" alone is not
 * proof of an MP3. Duration comes from the Xing/Info or VBRI frame count, or
 * from the file size for CBR files.
 */
export async function probeMp3(r: Reader): Promise<ProbeResult> {
  let pos = 0;
  for (let i = 0; i < 4; i++) {
    const h = await r.bytes(pos, 10);
    if (h.length < 10 || ascii(h, 0, 3) !== "ID3") break;
    pos += 10 + syncsafe(h, 6) + (h[5]! & 0x10 ? 10 : 0);
  }
  if (pos >= r.size) return fail("corrupt");

  const win = await r.bytes(pos, SCAN + 4);
  let first: FrameHeader | null = null;
  let at = -1;
  for (let i = 0; i + 4 <= win.length; i++) {
    const f = parseFrameHeader(win, i);
    if (!f) continue;
    const next = await r.bytes(pos + i + f.length, 4);
    const g = parseFrameHeader(next, 0);
    if (g && g.version === f.version && g.sampleRate === f.sampleRate) {
      first = f;
      at = pos + i;
      break;
    }
  }
  if (!first) return fail(pos > 0 ? "corrupt" : "unsupported_format");

  // ID3v1 ("TAG", 128 bytes) at the very end is not audio.
  const tail = r.size >= 128 ? await r.bytes(r.size - 128, 3) : new Uint8Array(0);
  const audioBytes = r.size - at - (tail.length === 3 && ascii(tail, 0, 3) === "TAG" ? 128 : 0);

  const frame = await r.bytes(at, 200);
  const sideInfo = first.version === 3 ? (first.channels === 1 ? 17 : 32) : first.channels === 1 ? 9 : 17;
  let frames = 0;
  const xing = 4 + sideInfo;
  const tag = ascii(frame, xing, 4);
  if ((tag === "Xing" || tag === "Info") && frame.length >= xing + 12 && u32be(frame, xing + 4) & 1) {
    frames = u32be(frame, xing + 8);
  } else if (ascii(frame, 36, 4) === "VBRI" && frame.length >= 36 + 18) {
    frames = u32be(frame, 36 + 14);
  }

  const durationS = frames > 0 ? (frames * first.samples) / first.sampleRate : (audioBytes * 8) / (first.bitrateKbps * 1000);
  if (!(durationS > 0)) return fail("empty");
  const bitrateKbps = frames > 0 ? Math.round((audioBytes * 8) / durationS / 1000) : first.bitrateKbps;

  return {
    ok: true,
    info: { format: "mp3", sampleRate: first.sampleRate, channels: first.channels, bitDepth: null, durationS, bitrateKbps, firstFrameOffset: at },
  };
}

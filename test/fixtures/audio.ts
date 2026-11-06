// Builds small, valid (or deliberately broken) WAV and MP3 files in memory for tests.

export interface WavOptions {
  sampleRate?: number;
  channels?: number;
  bits?: number;
  /** WAVE format code: 1 = PCM, 3 = float. */
  format?: number;
  /** Write WAVE_FORMAT_EXTENSIBLE with `format` as the sub-format GUID. */
  extensible?: boolean;
  frames?: number;
  /** Extra chunks written before `fmt ` (BWF bext, iXML, JUNK…). */
  before?: { id: string; size: number }[];
  /** Value written in the data chunk's size field (e.g. 0xFFFFFFFF). */
  dataSizeField?: number;
  /** Sample generator, -1..1, per frame and channel. Defaults to silence. */
  sample?: (frame: number, channel: number) => number;
}

export function makeWav(o: WavOptions = {}): Uint8Array {
  const sampleRate = o.sampleRate ?? 44100;
  const channels = o.channels ?? 2;
  const bits = o.bits ?? 16;
  const format = o.format ?? 1;
  const frames = o.frames ?? 4410;
  const bytesPerSample = bits / 8;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const fmtSize = o.extensible ? 40 : 16;
  const before = o.before ?? [];
  const beforeBytes = before.reduce((n, c) => n + 8 + c.size + (c.size & 1), 0);
  const total = 12 + beforeBytes + 8 + fmtSize + 8 + dataBytes;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));

  tag(0, "RIFF");
  v.setUint32(4, total - 8, true);
  tag(8, "WAVE");
  let p = 12;
  for (const c of before) {
    tag(p, c.id);
    v.setUint32(p + 4, c.size, true);
    p += 8 + c.size + (c.size & 1);
  }
  tag(p, "fmt ");
  v.setUint32(p + 4, fmtSize, true);
  v.setUint16(p + 8, o.extensible ? 0xfffe : format, true);
  v.setUint16(p + 10, channels, true);
  v.setUint32(p + 12, sampleRate, true);
  v.setUint32(p + 16, sampleRate * blockAlign, true);
  v.setUint16(p + 20, blockAlign, true);
  v.setUint16(p + 22, bits, true);
  if (o.extensible) {
    v.setUint16(p + 24, 22, true);
    v.setUint16(p + 26, bits, true);
    v.setUint32(p + 28, channels === 1 ? 4 : 3, true);
    v.setUint16(p + 32, format, true);
    out.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], p + 34);
  }
  p += 8 + fmtSize;
  tag(p, "data");
  v.setUint32(p + 4, o.dataSizeField ?? dataBytes, true);
  p += 8;
  if (o.sample && format === 1) {
    const max = 2 ** (bits - 1) - 1;
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.round(Math.max(-1, Math.min(1, o.sample(f, c))) * max);
        const at = p + f * blockAlign + c * bytesPerSample;
        if (bits === 16) v.setInt16(at, s, true);
        else { out[at] = s & 0xff; out[at + 1] = (s >> 8) & 0xff; out[at + 2] = (s >> 16) & 0xff; }
      }
    }
  }
  return out;
}

export interface Mp3Options {
  /** Size of an ID3v2 tag body to prepend (0 = none). */
  id3Bytes?: number;
  frames?: number;
  /** First frame carries a Xing header with this frame count (VBR). */
  xingFrames?: number;
  mono?: boolean;
  /** Bytes of garbage instead of frames after the tag. */
  garbage?: number;
}

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz frames of 417 bytes. */
export function makeMp3(o: Mp3Options = {}): Uint8Array {
  const FRAME = 417;
  const frames = o.frames ?? 40;
  const id3 = o.id3Bytes ? 10 + o.id3Bytes : 0;
  const body = o.garbage ?? frames * FRAME;
  const out = new Uint8Array(id3 + body);
  if (id3) {
    out.set([0x49, 0x44, 0x33, 4, 0, 0], 0);
    const s = o.id3Bytes!;
    out.set([(s >> 21) & 0x7f, (s >> 14) & 0x7f, (s >> 7) & 0x7f, s & 0x7f], 6);
  }
  if (o.garbage) {
    for (let i = 0; i < body; i++) out[id3 + i] = (i * 31 + 7) & 0x7f;
    return out;
  }
  for (let f = 0; f < frames; f++) {
    const at = id3 + f * FRAME;
    out.set([0xff, 0xfb, (9 << 4) | (0 << 2), o.mono ? 0xc0 : 0x00], at);
  }
  if (o.xingFrames) {
    const x = id3 + 4 + (o.mono ? 17 : 32);
    out.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1], x);
    const n = o.xingFrames;
    out.set([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff], x + 8);
  }
  return out;
}

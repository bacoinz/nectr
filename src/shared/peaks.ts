import { LIMITS } from "./constants";

/** Min/max pairs per version: enough detail for 16× zoom on a full-width waveform. */
export const PEAK_PAIRS = 16384;

/** Quantises interleaved min/max pairs (-1..1) to int8 and base64-encodes them. */
export function encodePeaks(pairs: Float32Array): string {
  const bytes = new Uint8Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    const v = Math.max(-1, Math.min(1, pairs[i]!)) * 127;
    // Round half away from zero so the waveform stays symmetric.
    bytes[i] = (Math.sign(v) * Math.round(Math.abs(v))) & 0xff;
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Interleaved min/max pairs as int8 (-127..127). */
export function decodePeaks(s: string): Int8Array {
  const bin = atob(s);
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}

export const isPeaks = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxPeaksChars && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);

/**
 * Streams frames into PEAK_PAIRS min/max buckets without holding the audio:
 * call addFrame(lo, hi) once per frame with the lowest/highest sample across
 * channels (-1..1), then finish().
 */
export class PeakBuilder {
  private readonly out: Float32Array;
  private frame = 0;
  private bucket = 0;
  private edge: number;
  private lo = Infinity;
  private hi = -Infinity;

  constructor(
    private readonly totalFrames: number,
    private readonly pairs = PEAK_PAIRS,
  ) {
    this.out = new Float32Array(pairs * 2);
    this.edge = this.edgeOf(0);
  }

  private edgeOf(b: number) {
    return Math.max(1, Math.floor(((b + 1) * this.totalFrames) / this.pairs));
  }

  addFrame(lo: number, hi: number) {
    if (lo < this.lo) this.lo = lo;
    if (hi > this.hi) this.hi = hi;
    if (++this.frame >= this.edge) this.flush();
  }

  private flush() {
    if (this.bucket < this.pairs && this.lo !== Infinity) {
      this.out[this.bucket * 2] = this.lo;
      this.out[this.bucket * 2 + 1] = this.hi;
    }
    this.lo = Infinity;
    this.hi = -Infinity;
    this.bucket++;
    // Skip empty buckets when there are fewer frames than pairs: copy the last value.
    while (this.bucket < this.pairs && (this.edge = this.edgeOf(this.bucket)) <= this.frame) {
      this.out[this.bucket * 2] = this.out[this.bucket * 2 - 2]!;
      this.out[this.bucket * 2 + 1] = this.out[this.bucket * 2 - 1]!;
      this.bucket++;
    }
  }

  finish(): Float32Array {
    if (this.lo !== Infinity) this.flush();
    return this.out;
  }
}

// Loudness after ITU-R BS.1770-4 / EBU R128, streamed block by block (no
// dependency; D3 in plano.md):
// - integrated loudness: 400 ms blocks every 100 ms, absolute gate −70 LUFS,
//   relative gate −10 LU;
// - loudness range (EBU Tech 3342): 3 s blocks every 100 ms, gates −70 LUFS
//   and −20 LU, 95th minus 10th percentile;
// - true peak: 4× oversampling (2× above 48 kHz) with a windowed-sinc
//   polyphase interpolator, never below the sample peak.
// Mono and stereo only (channel weight 1, as ffmpeg and libebur128 by default).

export interface Loudness {
  /** LUFS; null for (near) silence. */
  integrated: number | null;
  /** LU. */
  range: number | null;
  /** dBTP; null for digital silence. */
  truePeak: number | null;
}

class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}
  run(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** The K-weighting pre-filter for any sample rate, derived like libebur128 does from BS.1770's 48 kHz filters. */
function kWeighting(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = new Biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass = new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  return [shelf, highpass];
}

function besselI0(x: number) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/**
 * Polyphase interpolator: phase p estimates the signal p/L of a sample after
 * the newest-but-centre one. Kaiser-windowed sinc, `taps` per phase, each
 * phase normalised to unity gain at DC. Phase 0 is the sample itself.
 */
export function interpolator(L: number, taps: number): Float64Array[] {
  const N = L * taps;
  const c = N / 2;
  const beta = 8;
  const i0b = besselI0(beta);
  const h = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const x = (n - c) / L;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = (n - c) / c;
    h[n] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b);
  }
  return Array.from({ length: L }, (_, p) => {
    const ph = new Float64Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) sum += ph[k] = h[p + k * L]!;
    for (let k = 0; k < taps; k++) ph[k]! /= sum;
    return ph;
  });
}

const TAPS = 24;

class TruePeak {
  /** Every sample twice (at i and i + TAPS), so the last TAPS samples are always contiguous. */
  private hist = new Float64Array(2 * TAPS);
  private w = 0;
  private hot = 0;
  max = 0;
  constructor(private phases: Float64Array[]) {}

  push(x: number) {
    const ax = Math.abs(x);
    if (ax > this.max) this.max = ax;
    this.w = (this.w + 1) % TAPS;
    this.hist[this.w] = x;
    this.hist[this.w + TAPS] = x;
    // Only near loud samples can the waveform between samples beat the peak so far:
    // the interpolator's gain is under 2.5, so 0.35 × the peak is a safe floor.
    if (ax >= this.max * 0.35) this.hot = TAPS;
    if (this.hot === 0 || this.phases.length === 1) return;
    this.hot--;
    const base = this.w + TAPS;
    for (let p = 1; p < this.phases.length; p++) {
      const ph = this.phases[p]!;
      let y = 0;
      for (let k = 0; k < TAPS; k++) y += ph[k]! * this.hist[base - k]!;
      const ay = Math.abs(y);
      if (ay > this.max) this.max = ay;
    }
  }
}

const blockLoudness = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/** Gated mean of block energies (BS.1770): above −70 LUFS, then above (that mean − `relative` LU). */
function gated(blocks: number[], relative: number): number[] {
  const abs = blocks.filter((z) => z > 0 && blockLoudness(z) > -70);
  if (!abs.length) return [];
  const gate = blockLoudness(abs.reduce((s, z) => s + z, 0) / abs.length) - relative;
  return abs.filter((z) => blockLoudness(z) > gate);
}

export class LoudnessMeter {
  private filters: [Biquad, Biquad][];
  private peaks: TruePeak[];
  /** Samples per 100 ms segment. */
  private seg: number;
  private acc = 0;
  private count = 0;
  /** Sum over channels of the squared K-weighted samples, per completed 100 ms segment. */
  private segments: number[] = [];
  private sq = new Float64Array(0);

  constructor(sampleRate: number, private channels: number) {
    this.seg = Math.max(1, Math.round(sampleRate / 10));
    this.filters = Array.from({ length: channels }, () => kWeighting(sampleRate));
    const L = sampleRate <= 48_000 ? 4 : sampleRate <= 96_000 ? 2 : 1;
    const phases = interpolator(L, TAPS);
    this.peaks = Array.from({ length: channels }, () => new TruePeak(phases));
  }

  /** Planar samples in −1…1, one array per channel; `n` frames (default: the whole arrays). */
  add(data: ArrayLike<number>[], n = data[0]?.length ?? 0) {
    if (this.sq.length < n) this.sq = new Float64Array(n);
    const sq = this.sq;
    sq.fill(0, 0, n);
    for (let c = 0; c < this.channels; c++) {
      const x = data[c]!;
      const [f1, f2] = this.filters[c]!;
      const tp = this.peaks[c]!;
      for (let i = 0; i < n; i++) {
        const v = x[i]!;
        const y = f2.run(f1.run(v));
        sq[i]! += y * y;
        tp.push(v);
      }
    }
    for (let i = 0; i < n; i++) {
      this.acc += sq[i]!;
      if (++this.count === this.seg) {
        this.segments.push(this.acc);
        this.acc = 0;
        this.count = 0;
      }
    }
  }

  finish(): Loudness {
    const e = this.segments;
    const N = this.seg;
    const windows = (len: number) => {
      const out: number[] = [];
      let s = 0;
      for (let j = 0; j < e.length; j++) {
        s += e[j]!;
        if (j >= len) s -= e[j - len]!;
        if (j >= len - 1) out.push(Math.max(0, s) / (len * N));
      }
      return out;
    };
    const momentary = gated(windows(4), 10);
    const integrated = momentary.length ? blockLoudness(momentary.reduce((s, z) => s + z, 0) / momentary.length) : null;

    // Loudness range from the short-term (3 s) values, nearest-rank percentiles like libebur128.
    const st = gated(windows(30), 20).sort((a, b) => a - b);
    let range: number | null = null;
    if (st.length) {
      const lo = st[Math.floor((st.length - 1) * 0.1 + 0.5)]!;
      const hi = st[Math.floor((st.length - 1) * 0.95 + 0.5)]!;
      range = blockLoudness(hi) - blockLoudness(lo);
    }

    const peak = Math.max(0, ...this.peaks.map((p) => p.max));
    return {
      integrated: integrated === null ? null : round2(integrated),
      range: range === null ? null : round2(range),
      truePeak: peak > 0 ? round2(20 * Math.log10(peak)) : null,
    };
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Convenience for whole buffers (tests, the comparison script). */
export function measure(sampleRate: number, data: ArrayLike<number>[]): Loudness {
  const m = new LoudnessMeter(sampleRate, data.length);
  m.add(data);
  return m.finish();
}

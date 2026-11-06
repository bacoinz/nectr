import { describe, expect, it } from "vitest";
import { interpolator, measure } from "./loudness";

// Test signals from EBU Tech 3341 (loudness, true peak) and Tech 3342 (range),
// synthesised here: 1 kHz sines at given levels, stereo unless noted.

const db = (x: number) => 10 ** (x / 20);

/** Segments of [seconds, dBFS] as a 1 kHz sine, the same in every channel. */
function tones(fs: number, parts: [number, number][], channels = 2, freq = 1000, phase = 0) {
  const n = parts.reduce((s, [sec]) => s + Math.round(sec * fs), 0);
  const ch = new Float32Array(n);
  let i = 0;
  for (const [sec, level] of parts) {
    const a = db(level);
    for (let k = Math.round(sec * fs); k > 0; k--, i++) ch[i] = a * Math.sin((2 * Math.PI * freq * i) / fs + phase);
  }
  return Array.from({ length: channels }, () => ch);
}

/** The same with 20 ms fades: an abrupt start rings between samples (a real overshoot, not the meter's). */
function faded(fs: number, parts: [number, number][], channels: number, freq: number, phase: number) {
  const chs = tones(fs, parts, channels, freq, phase);
  const ch = chs[0]!;
  const f = Math.round(fs * 0.02);
  for (let i = 0; i < f; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
    ch[i]! *= g;
    ch[ch.length - 1 - i]! *= g;
  }
  return chs;
}

describe("integrated loudness (EBU Tech 3341)", () => {
  it("measures stereo sines at −23 and −33 dBFS", () => {
    expect(measure(48000, tones(48000, [[20, -23]])).integrated).toBeCloseTo(-23, 1);
    expect(measure(48000, tones(48000, [[20, -33]])).integrated).toBeCloseTo(-33, 1);
  });

  it("gates quiet parts away (cases 3, 4 and 5)", () => {
    expect(measure(48000, tones(48000, [[10, -36], [60, -23], [10, -36]])).integrated).toBeCloseTo(-23, 1);
    expect(measure(48000, tones(48000, [[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]])).integrated).toBeCloseTo(-23, 1);
    expect(measure(48000, tones(48000, [[20, -26], [20.1, -20], [20, -26]])).integrated).toBeCloseTo(-23, 1);
  });

  it("works at other sample rates and in mono", () => {
    for (const fs of [44100, 32000, 88200, 96000]) expect(measure(fs, tones(fs, [[10, -23]])).integrated, String(fs)).toBeCloseTo(-23, 1);
    // A mono sine at −20 dBFS: −20 − 3.01 (sine RMS) = −23.0 LUFS.
    expect(measure(48000, tones(48000, [[10, -20]], 1)).integrated).toBeCloseTo(-23, 1);
  });

  it("reports silence as unknown", () => {
    expect(measure(48000, [new Float32Array(48000 * 2)])).toEqual({ integrated: null, range: null, truePeak: null });
  });
});

describe("loudness range (EBU Tech 3342)", () => {
  const lra = (parts: [number, number][]) => measure(48000, tones(48000, parts)).range!;
  it("matches the reference cases within 1 LU", () => {
    expect(Math.abs(lra([[20, -20], [20, -30]]) - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([[20, -20], [20, -15]]) - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([[20, -40], [20, -20]]) - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([[20, -50], [20, -35], [20, -20], [20, -35], [20, -50]]) - 15)).toBeLessThanOrEqual(1);
  });
});

describe("true peak", () => {
  it("finds the peak between samples", () => {
    // fs/4 at 45°: every sample is at 0.707 of the real peak (−3 dB under it).
    const r = measure(48000, faded(48000, [[2, -6.02]], 2, 12000, Math.PI / 4));
    expect(r.truePeak).toBeCloseTo(-6.02, 1);
    const r44 = measure(44100, faded(44100, [[2, -6.02]], 2, 11025, Math.PI / 4));
    expect(r44.truePeak).toBeCloseTo(-6.02, 1);
  });

  it("is within 0.1 dB of the real peak up to 18 kHz at 48 kHz", () => {
    for (const f of [997, 5000, 10000, 15000, 18000]) {
      const r = measure(48000, faded(48000, [[1, -1]], 1, f, 0.3));
      expect(Math.abs(r.truePeak! + 1), String(f)).toBeLessThan(0.1);
    }
    // Near the top, 4× oversampling may land between peaks (BS.1770 allows it): still within 0.5 dB.
    expect(Math.abs(measure(48000, faded(48000, [[1, -1]], 1, 20000, 0.3)).truePeak! + 1)).toBeLessThan(0.5);
  });

  it("has phases that sum to one and reproduce the samples", () => {
    const ph = interpolator(4, 24);
    for (const p of ph) expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(ph[0]!.filter((x) => Math.abs(x) > 1e-9)).toHaveLength(1);
  });
});

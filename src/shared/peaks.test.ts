import { describe, expect, it } from "vitest";
import { decodePeaks, encodePeaks, isPeaks, PeakBuilder } from "./peaks";

describe("PeakBuilder", () => {
  it("keeps min and max per bucket", () => {
    const b = new PeakBuilder(8, 4);
    [[-0.1, 0.2], [-0.5, 0.1], [0, 0], [-0.2, 0.9], [0, 0.3], [-1, 0], [0.1, 0.1], [-0.3, 0.4]].forEach(([lo, hi]) => b.addFrame(lo!, hi!));
    expect([...b.finish()].map((v) => Math.round(v * 10) / 10)).toEqual([-0.5, 0.2, -0.2, 0.9, -1, 0.3, -0.3, 0.4]);
  });

  it("fills every bucket when there are fewer frames than pairs", () => {
    const b = new PeakBuilder(2, 6);
    b.addFrame(-0.5, 0.5);
    b.addFrame(-0.25, 0.75);
    const out = [...b.finish()];
    expect(out).toHaveLength(12);
    expect(out.slice(0, 2)).toEqual([-0.5, 0.5]);
    expect(out.slice(-2)).toEqual([-0.25, 0.75]);
  });
});

describe("encoding", () => {
  it("round-trips through int8 base64", () => {
    const s = encodePeaks(new Float32Array([-1, 1, -0.5, 0.5, 0, 0]));
    expect(isPeaks(s)).toBe(true);
    expect([...decodePeaks(s)]).toEqual([-127, 127, -64, 64, 0, 0]);
  });
});

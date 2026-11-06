import { describe, expect, it } from "vitest";
import { makeMp3, makeWav } from "../../../test/fixtures/audio";
import { probeAudio } from "./probe";
import { fromBytes } from "./reader";

const probe = (b: Uint8Array) => probeAudio(fromBytes(b), b.length);

describe("WAV", () => {
  it("reads a 16-bit stereo PCM header", async () => {
    const r = await probe(makeWav({ sampleRate: 44100, channels: 2, bits: 16, frames: 44100 }));
    expect(r).toEqual({
      ok: true,
      info: { format: "wav", sampleRate: 44100, channels: 2, bitDepth: 16, durationS: 1, bitrateKbps: 1411, dataOffset: 44, dataBytes: 176400 },
    });
  });

  it("accepts 24-bit WAVE_FORMAT_EXTENSIBLE with a PCM sub-format", async () => {
    const r = await probe(makeWav({ sampleRate: 48000, bits: 24, extensible: true, frames: 48000 * 3 }));
    expect(r.ok && r.info).toMatchObject({ sampleRate: 48000, bitDepth: 24, durationS: 3, bitrateKbps: 2304 });
  });

  it("walks past BWF chunks before `fmt `, even beyond the first read window", async () => {
    const r = await probe(makeWav({ before: [{ id: "bext", size: 602 }, { id: "JUNK", size: 100_001 }, { id: "iXML", size: 3000 }], channels: 1 }));
    expect(r.ok && r.info).toMatchObject({ channels: 1, durationS: 0.1 });
  });

  it("uses the file length when the data size field is unknown", async () => {
    const r = await probe(makeWav({ frames: 4410, dataSizeField: 0xffffffff }));
    expect(r.ok && r.info.durationS).toBeCloseTo(0.1, 6);
  });

  it.each([
    ["float", { format: 3, bits: 32 }, "wav_float"],
    ["extensible float", { format: 3, bits: 32, extensible: true }, "wav_float"],
    ["8-bit", { bits: 8 }, "wav_bit_depth"],
    ["32-bit PCM", { bits: 32 }, "wav_bit_depth"],
    ["ADPCM", { format: 2 }, "wav_compressed"],
    ["5.1", { channels: 6 }, "too_many_channels"],
  ] as const)("rejects %s", async (_, opts, code) => {
    const r = await probe(makeWav(opts));
    expect(r).toMatchObject({ ok: false, code });
    expect(r.ok || r.message).toMatch(/\S/);
  });

  it("rejects truncated files", async () => {
    expect(await probe(makeWav().subarray(0, 30))).toMatchObject({ ok: false, code: "corrupt" });
  });

  it("gives up on files that need too many reads", async () => {
    const before = Array.from({ length: 30 }, () => ({ id: "JUNK", size: 70_000 }));
    expect(await probe(makeWav({ before, frames: 10 }))).toMatchObject({ ok: false, code: "corrupt" });
  });
});

describe("MP3", () => {
  it("estimates CBR duration from the file size", async () => {
    const r = await probe(makeMp3({ frames: 40 }));
    expect(r.ok && r.info).toMatchObject({ format: "mp3", sampleRate: 44100, channels: 2, bitDepth: null, bitrateKbps: 128 });
    expect(r.ok && r.info.durationS).toBeCloseTo((40 * 417 * 8) / 128000, 6);
  });

  it("uses the Xing frame count for VBR files", async () => {
    const r = await probe(makeMp3({ frames: 40, xingFrames: 1000 }));
    expect(r.ok && r.info.durationS).toBeCloseTo((1000 * 1152) / 44100, 6);
  });

  it("skips a large ID3v2 tag (cover art) by its declared size", async () => {
    const r = await probe(makeMp3({ id3Bytes: 300_000, frames: 20, mono: true }));
    expect(r.ok && r.info).toMatchObject({ channels: 1, firstFrameOffset: 300_010 });
  });

  it("does not accept an ID3 tag followed by garbage", async () => {
    expect(await probe(makeMp3({ id3Bytes: 1000, garbage: 5000 }))).toMatchObject({ ok: false, code: "corrupt" });
  });
});

describe("other files", () => {
  it.each([
    ["text", new TextEncoder().encode("isto não é áudio, é texto ".repeat(200))],
    ["FLAC", new TextEncoder().encode("fLaC" + "\0".repeat(200))],
    ["AIFF", new TextEncoder().encode("FORM\0\0\0\0AIFF" + "\0".repeat(200))],
  ])("rejects %s as unsupported", async (_, bytes) => {
    expect(await probe(bytes)).toMatchObject({ ok: false, code: "unsupported_format" });
  });

  it("rejects empty and oversized files without reading them", async () => {
    const never = async () => { throw new Error("should not read"); };
    expect(await probeAudio(never, 0)).toMatchObject({ code: "empty" });
    expect(await probeAudio(never, 300 * 1024 * 1024)).toMatchObject({ code: "too_large" });
  });
});

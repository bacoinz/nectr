// Our loudness meter against ffmpeg (D4 in plano.md). Run with `npm run loudness`.
//
// Reads every WAV/MP3 in fixtures/real/ (your own files; the folder is not in git).
// With none there, it makes a set of test files with ffmpeg itself (noise, tones
// with level changes, a sweep, inter-sample peaks, clipping, an MP3).
// References: ffmpeg's `ebur128` (asserted: integrated ±0.1 LU, true peak ±0.2 dB; it
// measures at 48 kHz like us) and `loudnorm` (two decimals, shown; it measures after
// resampling to 192 kHz, which trims content right at the top of the band, so on
// noisy or clipped material it can read ~0.1 LU lower than both).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MPEGDecoder } from "mpg123-decoder";
import { describe, expect, it } from "vitest";
import { probeAudio } from "../src/shared/audio/probe";
import { measure, type Loudness } from "../src/shared/loudness";

const run = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-nostdin", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
const runErr = (args: string[]) => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-nostats", ...args], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 26 });
    return "";
  } catch (e) {
    throw new Error(String((e as { stderr?: string }).stderr ?? e));
  }
};
/** ffmpeg prints filter summaries on stderr even on success. */
function stderrOf(args: string[]) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-nostats", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  return String(r.stderr);
}

const haveFfmpeg = (() => {
  try {
    run(["-version"]);
    return true;
  } catch {
    return false;
  }
})();

function testFiles(): string[] {
  const real = join(process.cwd(), "fixtures", "real");
  const mine = existsSync(real) ? readdirSync(real).filter((f) => /\.(wav|mp3)$/i.test(f)).map((f) => join(real, f)) : [];
  if (mine.length) return mine;
  const dir = join(tmpdir(), "nectr-loudness");
  mkdirSync(dir, { recursive: true });
  const make = (name: string, args: string[]) => {
    const out = join(dir, name);
    if (!existsSync(out)) runErr([...args, "-y", out]);
    return out;
  };
  const noise = make("pink-noise-48k-24bit.wav", ["-filter_complex", "anoisesrc=c=pink:a=0.3:d=30:r=48000:s=1[a];anoisesrc=c=pink:a=0.3:d=30:r=48000:s=2[b];[a][b]amerge=inputs=2", "-c:a", "pcm_s24le"]);
  return [
    noise,
    make("dynamics-44k-16bit.wav", ["-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.05*t))+0.15*sin(2*PI*1320*t)|0.4*sin(2*PI*330*t)*(0.55+0.45*sin(2*PI*0.04*t))+0.1*sin(2*PI*4400*t):s=44100:d=60", "-c:a", "pcm_s16le"]),
    make("sweep-96k-24bit.wav", ["-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*(20*t+(19980/40)*t*t)):s=96000:d=20", "-ac", "2", "-c:a", "pcm_s24le"]),
    make("intersample-44k-16bit.wav", ["-f", "lavfi", "-i", "aevalsrc=0.95*sin(2*PI*11025*t+PI/4)*min(1\\,t*20)|0.9*sin(2*PI*7000*t)*min(1\\,t*20):s=44100:d=8", "-c:a", "pcm_s16le"]),
    make("clipped-noise-48k-16bit.wav", ["-filter_complex", "anoisesrc=c=pink:a=0.9:d=20:r=48000:s=3,volume=9dB[a];anoisesrc=c=white:a=0.5:d=20:r=48000:s=4[b];[a][b]amerge=inputs=2", "-c:a", "pcm_s16le"]),
    make("pink-noise-192k.mp3", ["-i", noise, "-c:a", "libmp3lame", "-b:a", "192k"]),
    make("mono-tone-48k-24bit.wav", ["-f", "lavfi", "-i", "sine=f=1000:r=48000:d=12,volume=-20dB", "-c:a", "pcm_s24le"]),
  ];
}

/** Our side, as the app does it: WAV read by our own parser, MP3 decoded by mpg123. */
async function ours(file: string): Promise<Loudness & { rate: number }> {
  const buf = readFileSync(file);
  const p = await probeAudio(async (o, l) => new Uint8Array(buf.buffer, buf.byteOffset + o, Math.max(0, Math.min(l, buf.length - o))), buf.length);
  if (!p.ok) throw new Error(`${file}: ${p.message}`);
  const { channels, sampleRate } = p.info;
  let planar: Float32Array[];
  if (p.info.format === "wav") {
    const bytes = p.info.bitDepth! / 8;
    const frames = Math.floor(p.info.dataBytes! / (bytes * channels));
    planar = Array.from({ length: channels }, () => new Float32Array(frames));
    let o = p.info.dataOffset!;
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++, o += bytes) {
        planar[c]![f] = bytes === 2 ? buf.readInt16LE(o) / 32768 : buf.readIntLE(o, 3) / 8388608;
      }
    }
  } else {
    const decoder = new MPEGDecoder();
    await decoder.ready;
    const r = decoder.decode(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    decoder.free();
    planar = r.channelData.map((c) => c.subarray(0, r.samplesDecoded));
  }
  return { ...measure(sampleRate, planar), rate: sampleRate };
}

function ebur128(file: string) {
  const s = stderrOf(["-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]);
  const sum = s.slice(s.lastIndexOf("Summary:"));
  const num = (re: RegExp) => Number(re.exec(sum)?.[1]);
  return { integrated: num(/I:\s+(-?[\d.]+) LUFS/), range: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

function loudnorm(file: string) {
  const s = stderrOf(["-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const j = JSON.parse(s.slice(s.lastIndexOf("{"), s.lastIndexOf("}") + 1)) as Record<string, string>;
  return { integrated: Number(j.input_i), range: Number(j.input_lra), truePeak: Number(j.input_tp) };
}

describe.skipIf(!haveFfmpeg)("loudness against ffmpeg", () => {
  it("agrees within ±0.1 LU (integrated) and ±0.2 dB (true peak)", async () => {
    const rows: Record<string, string | number>[] = [];
    const failures: string[] = [];
    for (const file of testFiles()) {
      const a = await ours(file);
      const e = ebur128(file);
      const l = loudnorm(file);
      const dI = a.integrated! - e.integrated;
      const dTP = a.truePeak! - e.truePeak;
      rows.push({
        ficheiro: file.split(/[\\/]/).pop()!,
        "I nosso": a.integrated!, "I ebur128": e.integrated, "ΔI": Number(dI.toFixed(2)), "I loudnorm": l.integrated,
        "TP nosso": a.truePeak!, "TP ebur128": e.truePeak, "ΔTP": Number(dTP.toFixed(2)), "TP loudnorm": l.truePeak,
        "LRA nosso": a.range!, "LRA ebur128": e.range, "LRA loudnorm": l.range,
      });
      if (Math.abs(dI) > 0.1) failures.push(`${file}: integrated ${a.integrated} vs ${e.integrated}`);
      if (Math.abs(dTP) > 0.2) failures.push(`${file}: true peak ${a.truePeak} vs ${e.truePeak}`);
    }
    console.table(rows);
    expect(failures).toEqual([]);
  });
});

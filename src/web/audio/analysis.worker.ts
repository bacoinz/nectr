/// <reference lib="webworker" />
import { MPEGDecoder } from "mpg123-decoder";
import { LoudnessMeter, type Loudness } from "../../shared/loudness";
import { PeakBuilder } from "../../shared/peaks";

// Upload analysis off the main thread, in one pass: waveform peaks and
// loudness (integrated, range, true peak).
// - WAV: read straight from the file in 4 MB slices, never all in memory.
// - MP3: decoded here by mpg123 (WebAssembly), 1 MB at a time. Browsers clip
//   decoded MP3 at 0 dBFS, which hides the overs a true-peak reading is for.

export type AnalysisJob =
  | { kind: "wav"; file: Blob; dataOffset: number; dataBytes: number; channels: number; bitDepth: number; sampleRate: number }
  | { kind: "mp3"; file: Blob; sampleRate: number; durationS: number };

export type AnalysisResult = { progress: number } | { peaks: Float32Array; loudness: Loudness } | { error: string };

const post = (m: AnalysisResult, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** Feeds one chunk of planar samples to the peaks and the meter. */
function feed(pb: PeakBuilder, meter: LoudnessMeter, chs: Float32Array[], n: number) {
  for (let f = 0; f < n; f++) {
    let lo = 1, hi = -1;
    for (const ch of chs) {
      const v = ch[f]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    pb.addFrame(lo, hi);
  }
  meter.add(chs, n);
}

async function wav(job: Extract<AnalysisJob, { kind: "wav" }>) {
  const { file, dataOffset, dataBytes, channels, bitDepth, sampleRate } = job;
  const bytesPerSample = bitDepth / 8;
  const block = channels * bytesPerSample;
  const frames = Math.floor(dataBytes / block);
  const total = frames * block;
  const chunk = Math.floor((4 * 1024 * 1024) / block) * block;
  const pb = new PeakBuilder(frames);
  const meter = new LoudnessMeter(sampleRate, channels);
  const chs = Array.from({ length: channels }, () => new Float32Array(chunk / block));
  for (let off = 0; off < total; off += chunk) {
    const buf = await file.slice(dataOffset + off, dataOffset + Math.min(off + chunk, total)).arrayBuffer();
    const n = Math.floor(buf.byteLength / block);
    if (bitDepth === 16) {
      const s = new Int16Array(buf, 0, n * channels);
      for (let f = 0; f < n; f++) for (let c = 0; c < channels; c++) chs[c]![f] = s[f * channels + c]! / 32768;
    } else {
      const b = new Uint8Array(buf);
      for (let f = 0; f < n; f++) {
        for (let c = 0; c < channels; c++) {
          const p = f * block + c * 3;
          chs[c]![f] = (((b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16)) << 8) >> 8) / 8388608;
        }
      }
    }
    feed(pb, meter, chs, n);
    post({ progress: Math.min(1, (off + chunk) / total) });
  }
  return { peaks: pb.finish(), loudness: meter.finish() };
}

async function mp3(job: Extract<AnalysisJob, { kind: "mp3" }>) {
  const { file } = job;
  // The probe's duration sizes the waveform; a few frames more or less only touch its last bucket.
  const pb = new PeakBuilder(Math.max(1, Math.round(job.durationS * job.sampleRate)));
  const decoder = new MPEGDecoder();
  await decoder.ready;
  let meter: LoudnessMeter | null = null;
  try {
    const chunk = 1024 * 1024;
    for (let off = 0; off < file.size; off += chunk) {
      const r = decoder.decode(new Uint8Array(await file.slice(off, off + chunk).arrayBuffer()));
      if (r.samplesDecoded) {
        meter ??= new LoudnessMeter(r.sampleRate, r.channelData.length);
        feed(pb, meter, r.channelData, r.samplesDecoded);
      }
      post({ progress: Math.min(1, (off + chunk) / file.size) });
    }
  } finally {
    decoder.free();
  }
  if (!meter) throw new Error("Não foi possível descodificar este MP3.");
  return { peaks: pb.finish(), loudness: meter.finish() };
}

self.onmessage = async (e: MessageEvent<AnalysisJob>) => {
  try {
    const r = e.data.kind === "wav" ? await wav(e.data) : await mp3(e.data);
    post(r, [r.peaks.buffer]);
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};

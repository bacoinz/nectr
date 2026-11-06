import type { AudioInfo } from "../../shared/audio/probe";
import type { Loudness } from "../../shared/loudness";
import { encodePeaks } from "../../shared/peaks";
import type { AnalysisJob, AnalysisResult } from "./analysis.worker";

export interface Analysis {
  /** base64 int8 min/max pairs, as the API stores them. */
  peaks: string;
  loudness: Loudness;
}

/** Waveform peaks and loudness for an audio file (an upload, or a stored version being measured). */
export async function analyse(file: Blob, info: AudioInfo, onProgress: (p: number) => void): Promise<Analysis> {
  const job: AnalysisJob =
    info.format === "wav"
      ? { kind: "wav", file, dataOffset: info.dataOffset!, dataBytes: info.dataBytes!, channels: info.channels, bitDepth: info.bitDepth!, sampleRate: info.sampleRate }
      : { kind: "mp3", file, sampleRate: info.sampleRate, durationS: info.durationS };
  const r = await inWorker(job, onProgress);
  onProgress(1);
  return { peaks: encodePeaks(r.peaks), loudness: r.loudness };
}

function inWorker(job: AnalysisJob, onProgress: (p: number) => void): Promise<{ peaks: Float32Array; loudness: Loudness }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    const fail = () => (worker.terminate(), reject(new Error("Não foi possível analisar este ficheiro.")));
    worker.onmessage = (e: MessageEvent<AnalysisResult>) => {
      const m = e.data;
      if ("progress" in m) return onProgress(m.progress);
      worker.terminate();
      if ("peaks" in m) resolve(m);
      else fail();
    };
    worker.onerror = fail;
    worker.postMessage(job);
  });
}

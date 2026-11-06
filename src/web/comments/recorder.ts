import { LIMITS } from "../../shared/constants";

// Voice notes with MediaRecorder (no dependency), mono and small: Opus at 24 kbps
// (~180 KB a minute, clear speech) wherever the browser records it, AAC at
// 32 kbps in MP4 otherwise (older Safari).
const TYPES: [mime: string, bps: number][] = [
  ["audio/webm;codecs=opus", 24_000],
  ["audio/ogg;codecs=opus", 24_000],
  ["audio/mp4;codecs=opus", 24_000],
  ["audio/mp4;codecs=mp4a.40.2", 32_000],
  ["audio/mp4", 32_000],
];

export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export class VoiceRecorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  // Live level for the waveform drawn while recording.
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;

  /** Asks for the microphone (first time) and starts recording. */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const type = TYPES.find(([t]) => MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type[0], audioBitsPerSecond: type[1] } : { audioBitsPerSecond: 32_000 });
    try {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
    } catch {
      this.analyser = null; // no meter, the recording still works
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.t0 = performance.now();
  }

  /** 0–1, how loud the microphone is right now. */
  level(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 5);
  }

  get elapsed() {
    return this.rec ? (performance.now() - this.t0) / 1000 : 0;
  }

  stop(): Promise<{ blob: Blob; durationS: number }> {
    const r = this.rec;
    if (!r) return Promise.reject(new Error("Não está a gravar."));
    const durationS = Math.min(LIMITS.voiceMaxSeconds, Math.max(0.5, this.elapsed));
    return new Promise((resolve) => {
      r.onstop = () => {
        const blob = new Blob(this.chunks, { type: (r.mimeType || "audio/webm").split(";")[0] });
        this.release();
        resolve({ blob, durationS });
      };
      r.stop();
    });
  }

  cancel() {
    if (this.rec && this.rec.state !== "inactive") {
      this.rec.onstop = null;
      this.rec.stop();
    }
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.rec = null;
  }
}

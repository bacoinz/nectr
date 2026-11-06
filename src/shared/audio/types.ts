export interface AudioInfo {
  format: "wav" | "mp3";
  sampleRate: number;
  channels: number;
  /** null for MP3 */
  bitDepth: number | null;
  durationS: number;
  bitrateKbps: number;
  /** WAV only: where the PCM samples start and how many bytes they take. */
  dataOffset?: number;
  dataBytes?: number;
  /** MP3 only: byte offset of the first audio frame (after ID3v2). */
  firstFrameOffset?: number;
}

export type ProbeErrorCode =
  | "unsupported_format"
  | "wav_float"
  | "wav_bit_depth"
  | "wav_compressed"
  | "too_many_channels"
  | "corrupt"
  | "too_large"
  | "empty";

export type ProbeResult = { ok: true; info: AudioInfo } | { ok: false; code: ProbeErrorCode; message: string };

/** User-facing messages (pt-PT), shown in the upload list and returned by the API. */
export const PROBE_MESSAGES: Record<ProbeErrorCode, string> = {
  unsupported_format: "Formato não suportado. Usa WAV (16 ou 24 bit) ou MP3.",
  wav_float: "WAV 32 bit float não é suportado. Exporta em PCM de 16 ou 24 bit.",
  wav_bit_depth: "Só são suportados WAV de 16 ou 24 bit.",
  wav_compressed: "Este WAV usa um formato comprimido. Exporta em PCM de 16 ou 24 bit.",
  too_many_channels: "Só são suportados ficheiros mono ou estéreo.",
  corrupt: "O ficheiro parece estar danificado ou incompleto.",
  too_large: "O ficheiro tem mais de 200 MB.",
  empty: "O ficheiro está vazio.",
};

export const fail = (code: ProbeErrorCode): ProbeResult => ({ ok: false, code, message: PROBE_MESSAGES[code] });

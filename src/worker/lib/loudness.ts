import type { LoudnessDTO } from "../../shared/api-types";
import { badRequest } from "./errors";

// Loudness is measured in the browser (src/shared/loudness.ts); the Worker
// only checks that the numbers are plausible before storing them.

const value = (v: unknown, field: string, min: number, max: number): number | null => {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw badRequest(`${field}: valor inválido.`);
  return Math.round(v * 100) / 100;
};

export function parseLoudness(v: unknown): LoudnessDTO {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw badRequest("Loudness: pedido inválido.");
  const o = v as Record<string, unknown>;
  return {
    integrated: value(o.integrated, "LUFS", -90, 10),
    range: value(o.range, "LRA", 0, 80),
    truePeak: value(o.truePeak, "True peak", -120, 24),
  };
}

import { probeMp3 } from "./mp3";
import { ascii, ReadBudgetError, Reader, type ByteSource } from "./reader";
import { probeWav } from "./wav";
import { LIMITS } from "../constants";
import { fail, type ProbeResult } from "./types";

export type { AudioInfo, ProbeResult } from "./types";

/**
 * Identifies and validates an upload from its header. The same code runs in
 * the browser (before uploading, for instant feedback) and in the Worker (on
 * finalize, reading the object back from R2), so both agree on what is valid.
 */
export async function probeAudio(source: ByteSource, size: number): Promise<ProbeResult> {
  if (size === 0) return fail("empty");
  if (size > LIMITS.maxUploadBytes) return fail("too_large");
  const r = new Reader(source, size);
  try {
    const head = await r.bytes(0, 12);
    const magic = ascii(head, 0, 4);
    if (magic === "RIFF") return await probeWav(r);
    if (magic === "RF64" || magic === "FORM" || magic === "fLaC" || magic === "OggS") return fail("unsupported_format");
    // ID3-tagged or raw MP3; anything else fails the two-consecutive-frames check in probeMp3.
    return await probeMp3(r);
  } catch (e) {
    if (e instanceof ReadBudgetError) return fail("corrupt");
    throw e;
  }
}

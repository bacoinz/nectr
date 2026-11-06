import { ascii, type Reader } from "./reader";
import { fail, type ProbeResult } from "./types";

const FORMAT_PCM = 0x0001;
const FORMAT_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;
// KSDATAFORMAT_SUBTYPE_* GUIDs share these 14 trailing bytes; the first two hold the format code.
const GUID_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

/**
 * Walks the RIFF chunks (BWF files often put bext/iXML/JUNK before `fmt `)
 * and accepts only PCM 16/24 bit, mono or stereo, plain or WAVE_FORMAT_EXTENSIBLE.
 */
export async function probeWav(r: Reader): Promise<ProbeResult> {
  const head = await r.bytes(0, 12);
  if (head.length < 12 || ascii(head, 0, 4) !== "RIFF" || ascii(head, 8, 4) !== "WAVE") return fail("corrupt");

  let fmt: Uint8Array | null = null;
  let dataOffset = -1;
  let dataBytes = 0;
  let pos = 12;
  while (pos + 8 <= r.size && (!fmt || dataOffset < 0)) {
    const h = await r.bytes(pos, 8);
    if (h.length < 8) break;
    const id = ascii(h, 0, 4);
    const size = new DataView(h.buffer, h.byteOffset, 8).getUint32(4, true);
    if (id === "fmt ") {
      if (size < 16) return fail("corrupt");
      fmt = (await r.bytes(pos + 8, Math.min(size, 40))).slice();
    } else if (id === "data") {
      dataOffset = pos + 8;
      // Some writers leave the size at 0 or 0xFFFFFFFF while streaming; trust the file length then.
      const left = r.size - dataOffset;
      dataBytes = size === 0 || size > left ? left : size;
      if (!fmt) {
        // `data` before `fmt ` is unusual; keep walking past it.
        pos = dataOffset + dataBytes + (dataBytes & 1);
        continue;
      }
    }
    pos += 8 + size + (size & 1);
  }
  if (!fmt || dataOffset < 0) return fail("corrupt");
  const f = fmt;

  const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
  let code = v.getUint16(0, true);
  const channels = v.getUint16(2, true);
  const sampleRate = v.getUint32(4, true);
  const blockAlign = v.getUint16(12, true);
  const bits = v.getUint16(14, true);

  if (code === FORMAT_EXTENSIBLE) {
    if (f.length < 40 || !GUID_TAIL.every((b, i) => f[26 + i] === b)) return fail("wav_compressed");
    code = v.getUint16(24, true);
  }
  if (code === FORMAT_FLOAT) return fail("wav_float");
  if (code !== FORMAT_PCM) return fail("wav_compressed");
  if (bits !== 16 && bits !== 24) return fail("wav_bit_depth");
  if (channels < 1) return fail("corrupt");
  if (channels > 2) return fail("too_many_channels");
  if (sampleRate < 8000 || sampleRate > 384000) return fail("corrupt");
  if (blockAlign !== channels * (bits / 8)) return fail("corrupt");
  if (dataBytes < blockAlign) return fail("empty");

  return {
    ok: true,
    info: {
      format: "wav",
      sampleRate,
      channels,
      bitDepth: bits,
      durationS: Math.floor(dataBytes / blockAlign) / sampleRate,
      bitrateKbps: Math.round((sampleRate * bits * channels) / 1000),
      dataOffset,
      dataBytes: dataBytes - (dataBytes % blockAlign),
    },
  };
}

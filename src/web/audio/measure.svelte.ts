import type { VersionDTO } from "../../shared/api-types";
import { probeAudio } from "../../shared/audio/probe";
import { admin, audioUrl } from "../lib/api";
import { analyse } from "./analyse";

// Versions uploaded before loudness was measured get measured when the owner
// opens them (on a computer): the file comes back from R2, is analysed in the
// browser like an upload, and only the three numbers go back to the Worker.

export const measuring = $state({ versionId: null as string | null, progress: 0 });
const tried = new Set<string>();

export async function measureStored(versionId: string): Promise<VersionDTO | null> {
  if (tried.has(versionId) || measuring.versionId) return null;
  tried.add(versionId);
  measuring.versionId = versionId;
  measuring.progress = 0;
  try {
    const res = await fetch(audioUrl(versionId));
    if (!res.ok) return null;
    const blob = await res.blob();
    const probe = await probeAudio(async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()), blob.size);
    if (!probe.ok) return null;
    const { loudness } = await analyse(blob, probe.info, (p) => (measuring.progress = p));
    return await admin.putLoudness(versionId, loudness);
  } catch {
    return null;
  } finally {
    measuring.versionId = null;
  }
}

import type { PeaksResponse } from "../../shared/api-types";
import { decodePeaks } from "../../shared/peaks";
import { api } from "./api";

// Reactive viewport flags and a small peaks cache shared by owner and guest players.

const phoneQ = matchMedia("(max-width: 760px)");
const narrowQ = matchMedia("(max-width: 1200px)");
// Below this the owner's side rail folds to icons by itself.
const railQ = matchMedia("(max-width: 1024px)");

export const viewport = $state({ phone: phoneQ.matches, narrow: narrowQ.matches, railNarrow: railQ.matches });
function sync() {
  // Assigning the same value is a no-op for runes, so this only wakes what changed.
  viewport.phone = phoneQ.matches;
  viewport.narrow = narrowQ.matches;
  viewport.railNarrow = railQ.matches;
}
for (const q of [phoneQ, narrowQ, railQ]) q.addEventListener("change", sync);
// Some embedded browsers miss the "change" events when the window is resized.
addEventListener("resize", sync);

const cache = new Map<string, Promise<Int8Array | null>>();

/** Peaks are immutable per version, so one fetch per session is enough. */
export function getPeaks(url: string): Promise<Int8Array | null> {
  let p = cache.get(url);
  if (!p) {
    p = api<PeaksResponse>(url).then((r) => (r.peaks ? decodePeaks(r.peaks) : null));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

import { untrack } from "svelte";
import type { GuestInfoDTO, GuestTrackDTO, GuestVersionDTO } from "../../shared/api-types";
import { getPeaks } from "../lib/media.svelte";
import { load, player, prepare, setQueue, takeWantPlay, type Loaded } from "../lib/player.svelte";
import { viewport } from "../lib/media.svelte";
import { navigate } from "../router.svelte";
import { trackCover, type GuestUrls } from "./guest";

/**
 * Keeps the shared player and the waveform peaks in sync with the selected
 * track/version. Call during component setup; a version switch keeps the position.
 * `queue` is the list the track sits in: "next" and the end of a track go through it,
 * and the page follows the player to the next track.
 */
export function usePlayback(
  get: () => { urls: GuestUrls; info: GuestInfoDTO; track: GuestTrackDTO | undefined; version: GuestVersionDTO | undefined; queue?: GuestTrackDTO[] },
) {
  let peaks = $state<Int8Array | null>(null);
  let lastTrack = "";
  let shown = "";

  const item = (urls: GuestUrls, info: GuestInfoDTO, t: GuestTrackDTO, v: GuestVersionDTO): Loaded => ({
    key: v.id,
    src: urls.audio(v.id),
    duration: v.durationS,
    title: t.title,
    artist: info.artist.name,
    artwork: trackCover(info, t),
    href: urls.track(t.id),
  });

  $effect(() => {
    const { urls, info, track, version } = get();
    if (!track || !version) {
      shown = "";
      return;
    }
    const same = lastTrack === track.id;
    lastTrack = track.id;
    shown = urls.track(track.id);
    const it = item(urls, info, track, version);
    // Untracked: load() reads the player, and this effect must not rerun when the player moves on.
    untrack(() =>
      load(
        it,
        // Only a play button starts a track; otherwise it keeps playing if something was.
        same ? { at: player.t } : { at: 0, play: takeWantPlay() || undefined },
      ),
    );
  });

  $effect(() => {
    const { urls, info, queue } = get();
    if (queue) setQueue(queue.map((t) => item(urls, info, t, t.versions[0]!)));
  });

  // When the player moves on by itself (the end of a track, "next"), the page goes with it.
  $effect(() => {
    const href = player.item?.href;
    if (!href || !shown || href === shown) return;
    const { urls, queue } = untrack(get);
    if (queue?.some((t) => urls.track(t.id) === href)) untrack(() => navigate(href));
  });

  // The other versions of the track stay loaded for instant switching (computer only).
  $effect(() => {
    const { urls, info, track, version } = get();
    if (!track || !version || viewport.phone) return prepare([]);
    const items = [version, ...track.versions.filter((v) => v.id !== version.id)].slice(0, 4).map((v) => item(urls, info, track, v));
    untrack(() => prepare(items));
  });
  $effect(() => () => prepare([]));

  $effect(() => {
    const { urls, version } = get();
    if (!version) return;
    const id = version.id;
    peaks = null;
    getPeaks(urls.peaks(id)).then((p) => get().version?.id === id && (peaks = p)).catch(() => {});
  });

  return {
    get peaks() {
      return peaks;
    },
  };
}

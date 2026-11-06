<script lang="ts" module>
  // One voice note plays at a time, on its own element (the track keeps its place).
  const audio = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
  let stopCurrent: (() => void) | null = null;

  /** Bar heights for a note, stable per comment id. */
  function barsFor(seed: string, n: number) {
    let h = 7;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Array.from({ length: n }, (_, i) => {
      h = (h * 1103515245 + 12345) | 0;
      return Math.round(25 + 75 * Math.abs(Math.sin(i * 0.7 + (h % 100) / 10)) * (0.55 + 0.45 * ((h >>> 8) % 100) / 100));
    });
  }
</script>

<script lang="ts">
  import { fmtTime } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { pause } from "../lib/player.svelte";

  let { id, url, durationS }: { id: string; url: string; durationS: number } = $props();

  let playing = $state(false);
  let t = $state(0);
  // svelte-ignore state_referenced_locally
  const bars = barsFor(id, 26);
  const progress = $derived(durationS ? t / durationS : 0);

  function stop() {
    playing = false;
    t = 0;
    audio.ontimeupdate = audio.onended = audio.onerror = null;
  }

  function toggle() {
    if (playing) {
      audio.pause();
      stopCurrent?.();
      stopCurrent = null;
      return;
    }
    stopCurrent?.();
    pause();
    audio.src = url;
    audio.currentTime = 0;
    audio.ontimeupdate = () => (t = audio.currentTime);
    audio.onended = audio.onerror = () => (stop(), (stopCurrent = null));
    stopCurrent = stop;
    playing = true;
    void audio.play().catch(() => stop());
  }

  $effect(() => () => {
    if (playing) {
      audio.pause();
      stop();
      stopCurrent = null;
    }
  });
</script>

<button class="voice" class:is-playing={playing} type="button" aria-label="{playing ? 'Parar' : 'Ouvir'} nota de voz de {fmtTime(durationS)}" onclick={toggle}>
  <span class="vp">{@html playing ? ICON.pauseSm : ICON.playSm}</span>
  <span class="bars">{#each bars as h, i (i)}<i style="--h:{h}" class:on={playing && i / bars.length < progress}></i>{/each}</span>
  <span class="mono">{fmtTime(playing ? t : durationS)}</span>
</button>

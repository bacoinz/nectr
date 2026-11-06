<script lang="ts">
  import { fmtDuration, fmtTime } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { hasNext, nextTrack, player, seek, skip, toggle } from "../lib/player.svelte";
  import Volume from "./Volume.svelte";
  import { ZOOMS } from "./Waveform.svelte";

  // Desktop: time · centred controls (start, -5 s, play, +5 s, next track, loop) · volume and zoom.
  // Phone (compact): the controls only; zoom lives on the versions row.
  // Bare: the controls alone, for the mini player bar.
  let { compact = false, bare = false, zoom = $bindable(1) }: { compact?: boolean; bare?: boolean; zoom?: number } = $props();

  const zoomBy = (dir: number) => (zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + dir))]!);
  // Media buttons never take focus, so the phone keyboard stays open while typing.
  const keep = (e: MouseEvent) => e.preventDefault();
</script>

{#snippet controls(big: boolean)}
  <button class="tbtn" type="button" aria-label="Voltar ao início" onmousedown={keep} onclick={() => seek(0)}>{@html ICON.start}</button>
  <button class="tbtn" type="button" aria-label="Recuar 5 segundos" onmousedown={keep} onclick={() => skip(-5)}>{@html ICON.rew}</button>
  <button class="play" class:sm={!big} type="button" aria-label={player.playing ? "Pausa" : "Reproduzir"} onmousedown={keep} onclick={toggle}>{@html player.playing ? ICON.pause : ICON.play}</button>
  <button class="tbtn" type="button" aria-label="Avançar 5 segundos" onmousedown={keep} onclick={() => skip(5)}>{@html ICON.ff}</button>
  <button class="tbtn" type="button" aria-label="Faixa seguinte" title="Faixa seguinte" disabled={!hasNext()} onmousedown={keep} onclick={nextTrack}>{@html ICON.next}</button>
  <button class="tbtn loop-btn" type="button" aria-pressed={player.loop} aria-label="Repetir a faixa" onmousedown={keep} onclick={() => (player.loop = !player.loop)}>{@html ICON.loop}</button>
{/snippet}

{#if bare}
  <div class="tgroup">{@render controls(false)}</div>
{:else if compact}
  <div class="ph-bar">{@render controls(false)}</div>
{:else}
  <div class="transport">
    <span class="now"><b>{fmtTime(player.t)}</b> / <span>{fmtDuration(player.duration)}</span></span>
    <div class="tgroup main">{@render controls(true)}</div>
    <div class="tgroup zoom">
      <Volume />
      <button class="tbtn sm" type="button" aria-label="Menos zoom" onmousedown={keep} onclick={() => zoomBy(-1)}>{@html ICON.zoomOut}</button>
      <span class="zoom-label">{zoom}×</span>
      <button class="tbtn sm" type="button" aria-label="Mais zoom" onmousedown={keep} onclick={() => zoomBy(1)}>{@html ICON.zoomIn}</button>
    </div>
  </div>
{/if}

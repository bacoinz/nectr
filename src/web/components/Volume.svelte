<script lang="ts">
  import { ICON } from "../lib/icons";
  import { player, setVolume, toggleMute } from "../lib/player.svelte";

  // Volume on a computer: the speaker mutes, the slider sets the level (kept per
  // device). Phones and tablets use their own buttons, so it is hidden there.
  const silent = $derived(player.muted || player.volume === 0);
  const pct = $derived(Math.round((silent ? 0 : player.volume) * 100));
  const keep = (e: MouseEvent) => e.preventDefault();
</script>

<div class="volume">
  <button class="tbtn sm" type="button" aria-label={silent ? "Ligar o som (M)" : "Sem som (M)"} title={silent ? "Ligar o som (M)" : "Sem som (M)"} onmousedown={keep} onclick={toggleMute}>
    {@html silent ? ICON.volumeOff : player.volume < 0.5 ? ICON.volumeLow : ICON.volume}
  </button>
  <input class="vol-slider" type="range" min="0" max="1" step="0.01" aria-label="Volume" aria-valuetext="{pct}%"
    value={silent ? 0 : player.volume} style="--v:{pct}%" oninput={(e) => setVolume(Number(e.currentTarget.value))} />
</div>

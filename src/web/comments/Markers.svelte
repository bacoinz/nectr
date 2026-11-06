<script lang="ts">
  import { authorColor, stampText, type CommentsState } from "./comments.svelte";

  // A dot with the author's initial above the waveform for each thread of the version.
  let { cm, duration, small = false }: { cm: CommentsState; duration: number; small?: boolean } = $props();
  // Dots at the very start or end stay whole inside the waveform box.
  const edge = $derived(small ? 10 : 13);
</script>

{#each cm.threads as th (th.top.id)}
  {@const c = th.top}
  <button class="marker" class:sm={small} class:is-voice={!!c.voice} class:is-focus={cm.ui.focusId === c.id} type="button"
    style="left:clamp({edge}px, {duration ? Math.min(100, (c.tStart / duration) * 100) : 0}%, calc(100% - {edge}px));--mc:{authorColor(c)}"
    aria-label="{stampText(c)}, {c.author.name}" onclick={() => cm.focus(c)}>{c.author.name.trim().charAt(0).toUpperCase() || "?"}</button>
{/each}

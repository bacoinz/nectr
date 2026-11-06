<script lang="ts">
  import { activeLine, isSynced, type LyricLine } from "../../shared/lrc";
  import { player, seek } from "../lib/player.svelte";

  // Lyrics next to the player. Synced lyrics follow the music: the line being
  // sung lights up and stays in view inside its own box (the page never jumps);
  // a click on a line goes there. After you scroll by hand it waits 3 s.
  let { lines, phone = false }: { lines: LyricLine[]; phone?: boolean } = $props();

  const synced = $derived(isSynced(lines));
  const active = $derived(synced ? activeLine(lines, player.t) : -1);

  let box = $state<HTMLElement>();
  let userAt = 0;
  let programmatic = false;

  $effect(() => {
    const i = active;
    if (!box || i < 0 || Date.now() - userAt < 3000) return;
    const el = box.querySelector<HTMLElement>(`[data-ly="${i}"]`);
    if (!el) return;
    const top = el.offsetTop - box.clientHeight * 0.42;
    if (Math.abs(box.scrollTop - top) < 2) return;
    programmatic = true;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  });

  function onscroll() {
    if (programmatic) {
      // A smooth scroll fires many events; it ends when the box stops moving.
      clearTimeout(settle);
      settle = window.setTimeout(() => (programmatic = false), 150);
    } else userAt = Date.now();
  }
  let settle = 0;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={phone ? "ph-lyrics" : "glyrics"} bind:this={box} {onscroll} onwheel={() => (programmatic = false)} ontouchstart={() => (programmatic = false)}>
  <div class="lyrics" class:plain={!synced}>
    {#each lines as l, i (i)}
      {#if !l.text}
        <div class="ly-gap" data-ly={i}></div>
      {:else if synced && l.t !== null}
        <button class="ly" class:is-active={i === active} class:is-past={i < active} type="button" data-ly={i} onclick={() => seek(l.t!)}>{l.text}</button>
      {:else}
        <p class="ly" data-ly={i}>{l.text}</p>
      {/if}
    {/each}
  </div>
</div>

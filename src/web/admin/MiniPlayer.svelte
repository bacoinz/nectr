<script lang="ts">
  import Art from "../components/Art.svelte";
  import Transport from "../components/Transport.svelte";
  import Volume from "../components/Volume.svelte";
  import { fmtDuration, fmtTime, inkFor } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { viewport } from "../lib/media.svelte";
  import { nextTrack, player, prevTrack, seek, skip, toggle } from "../lib/player.svelte";

  // What is playing stays at hand on every other screen. Computer: a bar under the
  // page with the track player's controls and a seek line. Phone: a card above the
  // tab bar; swipe left for the next track, right for the previous one.
  const color = $derived(player.item?.color ?? "#f4b740");
  const pct = $derived(player.duration ? Math.min(100, (player.t / player.duration) * 100) : 0);

  // ---------- Computer: click or drag on the line to seek ----------
  function seekAt(e: PointerEvent) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * player.duration);
  }
  function seekDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekAt(e);
  }
  function seekKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") (e.preventDefault(), skip(-5));
    else if (e.key === "ArrowRight") (e.preventDefault(), skip(5));
  }

  // ---------- Phone: horizontal swipe ----------
  let startX: number | null = null;
  let swiping = false;
  let dx = $state(0);
  function down(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX;
    swiping = false;
  }
  function move(e: PointerEvent) {
    if (startX === null) return;
    const d = e.clientX - startX;
    if (!swiping && Math.abs(d) > 10) {
      swiping = true;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    }
    if (swiping) dx = d;
  }
  function up() {
    if (startX === null) return;
    const d = dx;
    startX = null;
    dx = 0;
    if (d < -70) nextTrack();
    else if (d > 70) prevTrack();
  }
  // A swipe is not a tap on the title or the button.
  function click(e: MouseEvent) {
    if (!swiping) return;
    e.preventDefault();
    e.stopPropagation();
    swiping = false;
  }
</script>

{#if player.item}
  {@const it = player.item}
  {#if viewport.phone}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="miniplayer owner-mini proj-scope" class:is-swiping={dx !== 0}
      style="--proj-main:{color};--proj-ink:{inkFor(color)};transform:translateX({dx}px);opacity:{1 - Math.min(0.6, Math.abs(dx) / 300)}"
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onclickcapture={click}>
      <span class="prog" style="width:{pct}%"></span>
      <Art {color} url={it.artwork} seed={it.title} />
      <a href={it.href} draggable="false" style="text-decoration:none;color:inherit;min-width:0;flex:1">
        <span class="t">{it.title}</span>
        <span class="s">{it.artist} · {fmtTime(player.t)} / {fmtDuration(player.duration)}</span>
      </a>
      <button class="play xs" type="button" aria-label={player.playing ? "Pausa" : "Reproduzir"} onclick={toggle}>{@html player.playing ? ICON.pauseSm : ICON.playSm}</button>
    </div>
  {:else}
    <div class="nowbar proj-scope" style="--proj-main:{color};--proj-ink:{inkFor(color)}">
      <div class="nb-seek" role="slider" tabindex="0" aria-label="Posição na faixa" aria-valuemin={0} aria-valuemax={Math.round(player.duration)} aria-valuenow={Math.round(player.t)} aria-valuetext={fmtTime(player.t)}
        onpointerdown={seekDown} onpointermove={(e) => e.buttons === 1 && seekAt(e)} onkeydown={seekKey}><i style="width:{pct}%"></i></div>
      <a class="nb-info" href={it.href}>
        <Art {color} url={it.artwork} seed={it.title} />
        <span><span class="t">{it.title}</span><span class="s">{it.artist}</span></span>
      </a>
      <Transport bare />
      <span class="nb-end"><Volume /><span class="nb-time"><b>{fmtTime(player.t)}</b> / {fmtDuration(player.duration)}</span></span>
    </div>
  {/if}
{/if}

<style>
  .owner-mini { margin: 0 8px 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; touch-action: pan-y; user-select: none; -webkit-user-select: none; transition: transform 0.2s ease, opacity 0.2s ease; }
  .owner-mini.is-swiping { transition: none; }
  .owner-mini .t, .owner-mini .s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .owner-mini .prog { top: 0; }

  .nowbar { grid-column: 2; position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 16px; padding: 10px clamp(16px, 3vw, 36px); background: var(--surface); border-top: 1px solid var(--line); }
  .nb-seek { position: absolute; left: 0; right: 0; top: -6px; height: 12px; cursor: pointer; touch-action: none; }
  .nb-seek::before, .nb-seek i { content: ""; position: absolute; left: 0; top: 5px; height: 2px; transition: top 0.12s ease, height 0.12s ease; }
  .nb-seek::before { right: 0; background: var(--line); }
  .nb-seek i { background: var(--accent); }
  .nb-seek:hover::before, .nb-seek:hover i, .nb-seek:focus-visible::before, .nb-seek:focus-visible i { top: 4px; height: 4px; }
  .nb-info { display: flex; gap: 12px; align-items: center; min-width: 0; color: inherit; text-decoration: none; }
  .nb-info :global(.art) { width: 44px; border-radius: 8px; flex: none; box-shadow: none; }
  .nb-info > span { min-width: 0; }
  .nb-info .t { display: block; font-weight: 700; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nb-info .s { display: block; font-size: 12.5px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nb-info:hover .t { text-decoration: underline; }
  .nowbar :global(.tbtn) { width: 38px; height: 38px; }
  .nowbar :global(.play) { width: 44px; height: 44px; }
  .nb-end { justify-self: end; display: flex; align-items: center; gap: 14px; }
  .nb-time { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; color: var(--fg-muted); }
  .nb-time b { color: var(--fg); font-weight: 600; }
</style>

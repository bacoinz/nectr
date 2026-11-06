<script lang="ts">
  import { ICON } from "../lib/icons";
  import { cropper } from "../lib/crop.svelte";
  import { toast } from "../lib/toast.svelte";

  // The square cropper behind cropImage(): drag to frame, zoom with the slider,
  // the mouse wheel or two fingers. The result never scales the image up.
  const job = $derived(cropper.job!);

  let frame = $state<HTMLDivElement>();
  let img = $state<HTMLImageElement>();
  let F = $state(0);
  let nat = $state<{ w: number; h: number } | null>(null);
  let z = $state(1);
  let x = $state(0);
  let y = $state(0);
  let placed = false;

  // At zoom 1 the image just covers the frame.
  const base = $derived(nat && F ? F / Math.min(nat.w, nat.h) : 1);
  const s = $derived(base * z);

  function clamp() {
    if (!nat) return;
    x = Math.min(0, Math.max(F - nat.w * s, x));
    y = Math.min(0, Math.max(F - nat.h * s, y));
  }
  $effect(() => {
    if (!nat || !F || placed) return;
    placed = true;
    x = (F - nat.w * s) / 2;
    y = (F - nat.h * s) / 2;
  });
  // The frame can change size (window resize): keep the image covering it.
  $effect(() => {
    void F;
    clamp();
  });

  /** Zoom around a point of the frame (its centre by default). */
  function zoomTo(nz: number, px = F / 2, py = F / 2) {
    nz = Math.min(4, Math.max(1, nz));
    const k = (base * nz) / s;
    x = px - (px - x) * k;
    y = py - (py - y) * k;
    z = nz;
    clamp();
  }

  // One pointer pans; two pinch.
  const pts = new Map<number, { x: number; y: number }>();
  let last: { x: number; y: number; d: number } | null = null;
  function gesture() {
    const p = [...pts.values()];
    if (!p.length) return null;
    if (p.length === 1) return { x: p[0]!.x, y: p[0]!.y, d: 0 };
    const [a, b] = p as [{ x: number; y: number }, { x: number; y: number }];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  function down(e: PointerEvent) {
    frame?.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = gesture();
  }
  function move(e: PointerEvent) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture();
    if (last && g) {
      if (g.d && last.d) {
        const r = frame!.getBoundingClientRect();
        zoomTo(z * (g.d / last.d), g.x - r.left, g.y - r.top);
      }
      x += g.x - last.x;
      y += g.y - last.y;
      clamp();
    }
    last = g;
  }
  function up(e: PointerEvent) {
    pts.delete(e.pointerId);
    last = gesture();
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      x += moves[e.key]![0];
      y += moves[e.key]![1];
      clamp();
    } else if (e.key === "+" || e.key === "=") zoomTo(z * 1.15);
    else if (e.key === "-") zoomTo(z / 1.15);
  }

  // The wheel needs a non-passive listener to keep the page from scrolling.
  $effect(() => {
    const el = frame;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  // Escape closes only the cropper, not the dialog it was opened from.
  $effect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopImmediatePropagation(), job.done(null));
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  });

  let busy = $state(false);
  async function use() {
    if (!nat || !img || busy) return;
    busy = true;
    const side = F / s;
    const out = Math.max(1, Math.min(job.size, Math.round(side)));
    const c = document.createElement("canvas");
    c.width = c.height = out;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#16161d"; // under transparent PNGs, since the result is a JPEG
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(img, -x / s, -y / s, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
    busy = false;
    if (!blob) return toast("Não foi possível preparar a imagem.");
    job.done(blob);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim is-opening crop-scrim" onclick={(e) => e.target === e.currentTarget && job.done(null)}>
  <div class="dialog crop-dialog" role="dialog" aria-modal="true" aria-label={job.title}>
    <div class="dialog-head">
      <div><h2 class="title-md">{job.title}</h2><p>Arrasta para enquadrar e usa o zoom para aproximar.</p></div>
      <button class="iconbtn sm" type="button" aria-label="Cancelar" onclick={() => job.done(null)}>{@html ICON.close}</button>
    </div>
    <div class="dialog-body">
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="crop-frame" class:round={job.round} bind:this={frame} bind:clientWidth={F} tabindex="0" role="application" aria-label="Enquadramento: setas para mover, + e − para o zoom"
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}>
        <img bind:this={img} src={job.url} alt="" draggable="false" style="transform:translate({x}px,{y}px) scale({s})"
          onload={() => img && (nat = { w: img.naturalWidth, h: img.naturalHeight })}
          onerror={() => (toast("Não foi possível ler esta imagem."), job.done(null))} />
      </div>
      <div class="crop-zoom">
        {@html ICON.zoomOut}
        <input class="vol-slider" type="range" min="1" max="4" step="0.01" value={z} style="--v:{((z - 1) / 3) * 100}%" aria-label="Zoom" oninput={(e) => zoomTo(Number(e.currentTarget.value))} />
        {@html ICON.zoomIn}
      </div>
    </div>
    <div class="dialog-foot">
      <button class="btn" type="button" onclick={() => job.done(null)}>Cancelar</button>
      <button class="btn btn-primary" type="button" disabled={!nat || busy} onclick={use}>Usar imagem</button>
    </div>
  </div>
</div>

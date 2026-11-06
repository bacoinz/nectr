<script lang="ts" module>
  export const ZOOMS = [1, 2, 4, 8, 16];
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  // Min/max peaks painted per pixel column. The track is zoom × the view
  // width and scrolls; the canvas only paints the visible window.
  // A long press (touch) asks for a comment at that point.
  let { peaks, duration, t, playing, zoom = 1, onseek, onlongpress, ranges = [], children, label = "Forma de onda; clica para saltar" }: {
    peaks: Int8Array | null;
    duration: number;
    t: number;
    playing: boolean;
    zoom?: number;
    onseek: (t: number) => void;
    onlongpress?: (t: number) => void;
    /** Stretches painted over the waveform (range comments, the range being picked). */
    ranges?: { start: number; end: number; color: string; strong?: boolean }[];
    children?: Snippet;
    label?: string;
  } = $props();

  let scroller = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let viewW = $state(0);
  let programmatic = false;
  let userAt = 0;

  const totalW = $derived(viewW * zoom);
  const x = (s: number) => (duration > 0 ? (Math.min(s, duration) / duration) * totalW : 0);
  const playheadX = $derived(duration > 0 ? (Math.min(t, duration) / duration) * totalW : 0);

  function draw() {
    if (!scroller || !canvas) return;
    const w = scroller.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const left = scroller.scrollLeft;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.left = `${left}px`;
    canvas.style.width = `${w}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(scroller);
    const played = css.getPropertyValue("--proj").trim() || css.getPropertyValue("--accent").trim();
    const rest = css.getPropertyValue("--wave").trim();
    const mid = h / 2;
    const amp = mid - 1;
    const total = w * zoom;
    const playedPx = duration > 0 ? (t / duration) * total : 0;
    if (!peaks || !peaks.length) {
      ctx.fillStyle = rest;
      ctx.fillRect(0, mid - 0.5, w, 1);
      return;
    }
    const pairs = peaks.length / 2;
    const step = 1 / dpr;
    for (let x = 0; x < w; x += step) {
      const gx = left + x;
      const i0 = Math.floor((gx / total) * pairs);
      const i1 = Math.max(i0 + 1, Math.floor(((gx + step) / total) * pairs));
      let mn = 0, mx = 0;
      for (let i = i0; i < i1 && i < pairs; i++) {
        const a = peaks[2 * i]!, b = peaks[2 * i + 1]!;
        if (a < mn) mn = a;
        if (b > mx) mx = b;
      }
      ctx.fillStyle = gx < playedPx ? played : rest;
      ctx.fillRect(x, mid - (mx / 127) * amp, step, Math.max(step, ((mx - mn) / 127) * amp));
    }
  }

  // Redraw on any change of data, time, zoom or size.
  $effect(() => {
    void peaks;
    void t;
    void zoom;
    void viewW;
    draw();
  });

  $effect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => (viewW = scroller!.clientWidth));
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  // Zoom keeps the playhead in the middle of the view (or as close as the edges allow).
  let lastZoom = 1;
  $effect(() => {
    const z = zoom;
    if (!scroller || z === lastZoom) return;
    lastZoom = z;
    const target = Math.max(0, Math.min(viewW * z - viewW, playheadX - viewW / 2));
    programmatic = true;
    userAt = 0;
    queueMicrotask(() => scroller && (scroller.scrollLeft = target));
  });

  // While playing with zoom: the playhead walks to the middle, then the waveform
  // scrolls under it, and at the end the playhead walks on to the right edge.
  $effect(() => {
    void t;
    if (!scroller || zoom === 1 || !playing || Date.now() - userAt < 2500) return;
    const target = Math.max(0, Math.min(totalW - viewW, playheadX - viewW / 2));
    if (Math.abs(target - scroller.scrollLeft) >= 1) {
      programmatic = true;
      scroller.scrollLeft = target;
    }
  });

  function onscroll() {
    if (programmatic) programmatic = false;
    else userAt = Date.now();
    if (press?.timer) clearTimeout(press.timer);
    draw();
  }

  let press: { x: number; sl: number; moved: boolean; touch: boolean; timer?: number; long?: boolean } | null = null;
  const timeAt = (clientX: number) => {
    const rect = scroller!.querySelector(".wave-track")!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };
  function down(e: PointerEvent) {
    press = { x: e.clientX, sl: scroller!.scrollLeft, moved: false, touch: e.pointerType === "touch" };
    if (!press.touch) canvas!.setPointerCapture(e.pointerId);
    else if (onlongpress) {
      const p = press;
      const at = timeAt(e.clientX);
      p.timer = window.setTimeout(() => {
        p.long = true;
        navigator.vibrate?.(15);
        onlongpress(at);
      }, 550);
    }
  }
  function move(e: PointerEvent) {
    if (!press) return;
    const dx = e.clientX - press.x;
    if (press.touch) {
      if (Math.abs(dx) > 10 && press.timer) clearTimeout(press.timer);
      return;
    }
    if (Math.abs(dx) > 5) press.moved = true;
    if (!press.moved) return;
    if (zoom > 1) {
      scroller!.scrollLeft = press.sl - dx;
      userAt = Date.now();
    } else onseek(timeAt(e.clientX));
  }
  function up(e: PointerEvent) {
    if (press?.timer) clearTimeout(press.timer);
    if (press && !press.moved && !press.long) onseek(timeAt(e.clientX));
    press = null;
  }
  function cancel() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
  }
</script>

<div class="wave-scroll" bind:this={scroller} {onscroll}>
  <div class="wave-track" style="width:{totalW || 0}px">
    <div class="markers">{@render children?.()}</div>
    <canvas class="wave" bind:this={canvas} aria-label={label} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} oncontextmenu={(e) => onlongpress && e.preventDefault()}></canvas>
    {#each ranges as r, i (i)}
      <div class="wrange" class:strong={r.strong} style="left:{x(r.start)}px;width:{Math.max(2, x(r.end) - x(r.start))}px;--rc:{r.color}"></div>
    {/each}
    <div class="playhead" style="left:{playheadX}px"></div>
  </div>
</div>

<script lang="ts" module>
  export interface MenuItem {
    label: string;
    hint?: string;
    icon?: string;
    danger?: boolean;
    run: () => void;
  }
</script>

<script lang="ts">
  // Popover menu with fixed coordinates, so tables and scroll boxes never clip it.
  // Anchored under its parent (the .plus-wrap with the button that opened it), or
  // at a point (`at`) for right-click menus. Flips up or left when it would not fit.
  let { items, onclose, align = "right", at }: { items: MenuItem[]; onclose: () => void; align?: "left" | "right"; at?: { x: number; y: number } } = $props();
  let el = $state<HTMLElement>();

  $effect(() => {
    if (!el) return;
    const anchor = at ? null : el.parentElement;
    const m = el.getBoundingClientRect();
    const [vw, vh, pad, gap] = [innerWidth, innerHeight, 8, 8];
    let x: number, y: number;
    if (at) {
      x = at.x + m.width > vw - pad ? at.x - m.width : at.x;
      y = at.y + m.height > vh - pad ? at.y - m.height : at.y;
    } else {
      const r = anchor!.getBoundingClientRect();
      x = align === "left" ? r.left : r.right - m.width;
      y = r.bottom + gap + m.height > vh - pad && r.top - gap - m.height > pad ? r.top - gap - m.height : r.bottom + gap;
    }
    el.style.left = `${Math.max(pad, Math.min(x, vw - m.width - pad))}px`;
    el.style.top = `${Math.max(pad, Math.min(y, vh - m.height - pad))}px`;
    el.style.visibility = "visible";

    const away = (e: PointerEvent) => !el?.contains(e.target as Node) && !anchor?.contains(e.target as Node) && onclose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onclose();
    // Next tick, so the click that opened the menu does not close it.
    const t = setTimeout(() => document.addEventListener("pointerdown", away));
    document.addEventListener("keydown", esc);
    // Fixed coordinates would drift away from the row: scrolling or resizing closes it.
    addEventListener("scroll", onclose, true);
    addEventListener("resize", onclose);
    el.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      removeEventListener("scroll", onclose, true);
      removeEventListener("resize", onclose);
    };
  });
</script>

<div class="menu" role="menu" tabindex="-1" bind:this={el} style="position:fixed;right:auto;visibility:hidden" oncontextmenu={(e) => (e.preventDefault(), e.stopPropagation())}>
  {#each items as item (item.label)}
    <button type="button" role="menuitem" style={item.danger ? "color:var(--rec)" : ""} onclick={() => (onclose(), item.run())}>
      {#if item.icon}{@html item.icon}{/if}
      <span>{item.label}{#if item.hint}<small>{item.hint}</small>{/if}</span>
    </button>
  {/each}
</div>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { ICON } from "../lib/icons";

  // Modal dialog on a scrim (Escape or a click on the scrim closes it).
  let { title, subtitle = "", onclose, children, footer, wide = false, cls = "" }: {
    title: string;
    subtitle?: string;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    wide?: boolean;
    cls?: string;
  } = $props();

  let dialog = $state<HTMLElement>();
  // Tab cycles inside the dialog, never back to the page behind it.
  function trap(e: KeyboardEvent) {
    if (e.key !== "Tab" || !dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!, last = items.at(-1)!;
    if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  }
  $effect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => prev?.focus?.();
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim is-opening {cls}" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" style={wide ? "width:min(720px,100%)" : ""} role="dialog" aria-modal="true" aria-label={title} bind:this={dialog} tabindex="-1" onkeydown={trap}>
    <div class="dialog-head">
      <div>
        <h2 class="title-md">{title}</h2>
        {#if subtitle}<p>{subtitle}</p>{/if}
      </div>
      <button class="iconbtn sm" type="button" aria-label="Fechar" onclick={onclose}>{@html ICON.close}</button>
    </div>
    <div class="dialog-body">{@render children()}</div>
    {#if footer}<div class="dialog-foot">{@render footer()}</div>{/if}
  </div>
</div>

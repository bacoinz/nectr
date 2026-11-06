<script lang="ts">
  import { folderIcon } from "../lib/icons";

  // Project artwork: the uploaded image, or a generated pattern in the project colour.
  // With `icon` (a working project: WIP, live…), the folder icon on a tint instead.
  let { color, url = null, seed = "", cls = "", tag = "div", icon = null }: { color: string; url?: string | null; seed?: string; cls?: string; tag?: string; icon?: string | null } = $props();

  const pattern = $derived(icon ? "is-icon" : `a${(([...seed].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4) + 1)}`);
  const style = $derived(`--proj:${color}${url ? `;background:center/cover no-repeat url('${url}')` : ""}`);
</script>

<svelte:element this={tag} class="art {pattern} {cls}" class:has-img={!!url} {style}>{#if icon && !url}{@html folderIcon(icon, 64)}{/if}</svelte:element>

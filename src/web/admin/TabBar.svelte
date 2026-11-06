<script lang="ts">
  import { initials } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { router } from "../router.svelte";
  import { store } from "./store.svelte";

  // Owner on the phone: the rail becomes this bottom bar (layout.css shows it ≤760 px).
  const section = $derived(router.path.startsWith("/admin/links") ? "links" : router.path.startsWith("/admin/perfil") ? "profile" : router.path.startsWith("/admin/revisoes") ? "rev" : "lib");
  const profile = $derived(store.me?.profile);
</script>

<nav class="tabbar" aria-label="Secções" style="grid-template-columns:repeat(4,1fr)">
  <a href="/admin" class="tab" aria-current={section === "lib" ? "page" : undefined}>{@html ICON.grid}<span>Biblioteca</span></a>
  <a href="/admin/revisoes" class="tab" aria-current={section === "rev" ? "page" : undefined}>
    {@html ICON.revisions}<span>Revisões</span>{#if store.library?.openRequests}<span class="count">{store.library.openRequests}</span>{/if}
  </a>
  <a href="/admin/links" class="tab" aria-current={section === "links" ? "page" : undefined}>{@html ICON.link}<span>Links</span></a>
  <a href="/admin/perfil" class="tab" aria-current={section === "profile" ? "page" : undefined}>
    <span class="avatar" style={profile?.photoUrl ? `background-image:url('${profile.photoUrl}')` : ""}>{profile?.photoUrl ? "" : initials(profile?.name ?? "")}</span><span>Perfil</span>
  </a>
</nav>

<style>
  .tab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0; font-size: 12.5px; font-weight: 700; color: var(--fg-faint); text-decoration: none; }
  .tab :global(svg) { width: 22px; height: 22px; }
  .tab[aria-current="page"] { color: var(--accent); }
  .tab .avatar { width: 24px; height: 24px; font-size: 10px; }
  .tab .count { position: absolute; top: -2px; left: calc(50% + 6px); margin: 0; }
</style>

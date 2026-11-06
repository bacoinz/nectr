<script lang="ts">
  import type { FolderDTO } from "../../shared/api-types";
  import { bytes, dayMonth, initials, num, plural } from "../lib/format";
  import { folderIcon, ICON, LOGO } from "../lib/icons";
  import { match, router } from "../router.svelte";
  import { loadArtist, store } from "./store.svelte";

  let { mini, onfold, onprofile }: { mini: boolean; onfold: () => void; onprofile: () => void } = $props();

  // Expanded tree nodes: "lib", "a:<artist>", "f:<folder>". Kept per device.
  let open = $state(new Set<string>(JSON.parse(localStorage.getItem("nectr.tree") ?? '["lib"]')));
  function toggle(key: string, artistId?: string) {
    const next = new Set(open);
    next.has(key) ? next.delete(key) : next.add(key);
    open = next;
    localStorage.setItem("nectr.tree", JSON.stringify([...next]));
    if (artistId && next.has(key)) void loadArtist(artistId).catch(() => {});
  }

  const here = $derived(match("/admin/artistas/:id", router.path) ?? match("/admin/artistas/:id/pastas/:folderId", router.path));
  const children = (folders: FolderDTO[], parent: string | null) => folders.filter((f) => f.parentId === parent).sort((a, b) => a.position - b.position);

  const storage = $derived(store.library?.storage);
  // What R2 really holds: the library, voice notes, and deleted files waiting for the clean-up.
  const used = $derived(storage ? storage.audioBytes + storage.trashBytes + storage.voiceBytes : 0);
  const pct = $derived(storage ? Math.min(100, (used / storage.limitBytes) * 100) : 0);
  // A 5-minute 24-bit/48 kHz stereo WAV is about 86 MB.
  const wavLeft = $derived(storage ? Math.max(0, Math.floor((storage.limitBytes - used) / 86_400_000)) : 0);
  const profile = $derived(store.me?.profile);
</script>

{#snippet folderNode(folders: FolderDTO[], f: FolderDTO, artistId: string)}
  {@const kids = children(folders, f.id)}
  <div class="tree-item">
    {#if kids.length}
      <button class="tree-toggle" type="button" aria-expanded={open.has(`f:${f.id}`)} aria-label="Mostrar subpastas de {f.name}" onclick={() => toggle(`f:${f.id}`)}>{@html ICON.chev}</button>
    {:else}<span class="tree-toggle spacer"></span>{/if}
    <a class="tree-row" href="/admin/artistas/{artistId}/pastas/{f.id}" aria-current={here?.folderId === f.id ? "page" : undefined}>
      {#if f.parentId || f.kind !== "release"}<span class="ficon sm" style="--fc:{f.color}">{@html folderIcon(f.icon, 14)}</span>{/if}<span class="l">{f.name}</span>
    </a>
  </div>
  {#if kids.length && open.has(`f:${f.id}`)}
    <div class="tree-children">{#each kids as k (k.id)}{@render folderNode(folders, k, artistId)}{/each}</div>
  {/if}
{/snippet}

<aside class="rail">
  <div class="rail-top">
    <a class="brand" href="/admin" style="text-decoration:none">{@html LOGO(28)}<span class="brand-name">nectr</span></a>
    <button class="iconbtn sm rail-fold" type="button" onclick={onfold} aria-expanded={!mini} aria-label={mini ? "Expandir a barra lateral" : "Recolher a barra lateral"} data-tip={mini ? "Expandir" : "Recolher"}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </button>
  </div>
  <nav class="rail-nav" aria-label="Secções">
    <div class="tree">
      <div class="tree-item">
        <button class="tree-toggle" type="button" aria-expanded={open.has("lib")} aria-label="Mostrar artistas" onclick={() => toggle("lib")}>{@html ICON.chev}</button>
        <a class="tree-row top" href="/admin" data-tip="Biblioteca" aria-current={router.path === "/admin" ? "page" : undefined}>{@html ICON.grid}<span class="l">Biblioteca</span></a>
      </div>
      {#if open.has("lib")}
        <div class="tree-children">
          {#each store.library?.artists ?? [] as ar (ar.id)}
            {@const folders = store.artists[ar.id]?.folders ?? []}
            {@const roots = children(folders, null)}
            <div class="tree-item">
              {#if ar.projectCount}
                <button class="tree-toggle" type="button" aria-expanded={open.has(`a:${ar.id}`)} aria-label="Mostrar os projetos de {ar.name}" onclick={() => toggle(`a:${ar.id}`, ar.id)}>{@html ICON.chev}</button>
              {:else}<span class="tree-toggle spacer"></span>{/if}
              <a class="tree-row" href="/admin/artistas/{ar.id}" aria-current={here?.id === ar.id && !here.folderId ? "page" : undefined}><span class="l">{ar.name}</span></a>
            </div>
            {#if ar.projectCount && open.has(`a:${ar.id}`)}
              <div class="tree-children">{#each roots as f (f.id)}{@render folderNode(folders, f, ar.id)}{/each}</div>
            {/if}
          {:else}
            {#if store.library}<p class="rail-tree-empty">Ainda sem artistas</p>{/if}
          {/each}
        </div>
      {/if}
    </div>
    <div class="rail-sep"></div>
    <a href="/admin/revisoes" data-tip="Revisões" aria-current={router.path === "/admin/revisoes" ? "page" : undefined}>
      {@html ICON.revisions}<span class="l">Revisões</span>{#if store.library?.openRequests}<span class="count">{store.library.openRequests}</span>{/if}
    </a>
    <a href="/admin/links" data-tip="Links" aria-current={router.path === "/admin/links" ? "page" : undefined}>{@html ICON.link}<span class="l">Links</span></a>
    <button class="navbtn" type="button" data-tip="Procurar (Ctrl K)" onclick={() => (store.searchOpen = true)}>{@html ICON.search}<span class="l">Procurar</span><kbd class="l">Ctrl K</kbd></button>
    <button class="navbtn" type="button" data-tip="Ajuda (?)" onclick={() => (store.helpOpen = true)}><span class="qmark" aria-hidden="true">?</span><span class="l">Ajuda</span></button>
  </nav>
  {#if storage}
    <div class="storage">
      <span><strong class="mono">{bytes(used)}</strong> de {num(storage.limitBytes / 1e9, 0)} GB grátis</span>
      <div class="meter"><i style="width:{pct}%;{pct > 80 ? 'background:var(--warn)' : ''}"></i></div>
      <span class="faint">{plural(storage.versionCount, "versão", "versões")} · ~{wavLeft} WAV ainda cabem</span>
      {#if storage.trashBytes && storage.trashUntil}<span class="faint">{bytes(storage.trashBytes)} apagados saem até {dayMonth(storage.trashUntil)}</span>{/if}
    </div>
  {/if}
  <button class="owner" type="button" onclick={onprofile} aria-label="O teu perfil e resumo da app" data-tip="Perfil">
    <span class="avatar" style={profile?.photoUrl ? `background-image:url('${profile.photoUrl}')` : ""}>{profile?.photoUrl ? "" : initials(profile?.name ?? "")}</span>
    <span class="owner-text"><b>{profile?.name ?? "…"}</b><span>Perfil e resumo</span></span>
  </button>
</aside>

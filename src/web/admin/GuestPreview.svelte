<script lang="ts">
  import type { GuestHeroDTO, GuestInfoDTO } from "../../shared/api-types";
  import { audioUrl, downloadUrl } from "../lib/api";
  import { previewSource } from "../comments/source";
  import { viewport } from "../lib/media.svelte";
  import { router } from "../router.svelte";
  import GuestDesktop from "../guest/GuestDesktop.svelte";
  import GuestMobile from "../guest/GuestMobile.svelte";
  import type { GuestUrls } from "../guest/guest";
  import { folderSubtree, projectOf } from "./project/tree";
  import { isRelease } from "../lib/kinds";
  import { loadArtist, store } from "./store.svelte";

  // "Ver como convidado": the guest pages fed from the owner API, without a link.
  // `scope` is a project or folder id; without it the whole artist is shown.
  let { artistId, scope }: { artistId: string; scope: string | null } = $props();

  let failed = $state(false);
  $effect(() => {
    loadArtist(artistId).catch(() => (failed = true));
  });

  const a = $derived(store.artists[artistId]);
  const info = $derived.by((): GuestInfoDTO | null => {
    if (!a) return null;
    const scoped = scope ? a.folders.find((f) => f.id === scope) : undefined;
    const inScope = scoped ? folderSubtree(a, scoped.id) : null;
    const project = scoped ? projectOf(a, scoped.id) : null;
    const release = project ? isRelease(project) : true;
    const hero: GuestHeroDTO = !scoped
      ? { name: a.artist.name, subtitle: "", color: a.artist.color, artworkUrl: a.artist.photoUrl, icon: null, description: a.artist.description }
      : scoped.parentId
        ? { name: scoped.name, subtitle: `${project!.name} · ${a.artist.name}`, color: project!.color, artworkUrl: release ? project!.artworkUrl : null, icon: release ? null : scoped.icon, description: "" }
        : { name: scoped.name, subtitle: [a.artist.name, release ? scoped.year : null].filter(Boolean).join(" · "), color: scoped.color, artworkUrl: scoped.artworkUrl, icon: release ? null : scoped.icon, description: scoped.description };
    return {
      link: { type: !scoped ? "artist" : scoped.parentId ? "folder" : "project", allowDownload: false, showLyrics: true, allowComments: true, expiresAt: null, allowShare: false },
      artist: { name: a.artist.name, description: a.artist.description, color: a.artist.color, photoUrl: a.artist.photoUrl },
      hero,
      ownerName: store.me?.profile.name ?? "Produtor",
      folders: a.folders
        .filter((f) => !inScope || inScope.has(f.id))
        .map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, icon: f.icon, color: f.color, position: f.position, kind: f.kind, artworkUrl: f.artworkUrl, year: f.year, label: f.label, description: f.description })),
      tracks: [...a.tracks]
        .filter((t) => !inScope || (t.folderId !== null && inScope.has(t.folderId)))
        .sort((x, y) => x.position - y.position)
        .map((t) => ({ id: t.id, folderId: t.folderId, title: t.title, artworkUrl: t.artworkUrl, versions: t.versions.map(({ originalFilename: _, name: _n, ...v }) => v), commentCount: t.commentCount })),
    };
  });

  const base = $derived(`/admin/artistas/${artistId}/convidado`);
  const urls = $derived<GuestUrls>({
    base: scope ? `${base}?scope=${scope}` : base,
    track: (id) => `${base}?${scope ? `scope=${scope}&` : ""}t=${id}`,
    folder: (id) => (id ? `${base}?${scope ? `scope=${scope}&` : ""}f=${id}` : scope ? `${base}?scope=${scope}` : base),
    audio: audioUrl,
    peaks: (id) => `/api/admin/versions/${id}/peaks`,
    download: downloadUrl,
    comments: previewSource,
    lyrics: (id) => `/api/admin/versions/${id}/lyrics`,
    push: null,
    shares: null,
  });
  const trackId = $derived(router.query.get("t"));
  const backTo = $derived(scope ? `/admin/artistas/${artistId}/pastas/${scope}` : `/admin/artistas/${artistId}`);
</script>

<div class="preview-bar">
  <span><b>Pré-visualização.</b> É assim que um convidado vê {scope ? (info?.link.type === "project" ? "este projeto" : "esta pasta") : "este artista"}, com todas as versões e sem download.</span>
  <a class="btn sm" href={backTo}>Fechar</a>
</div>
{#if failed}
  <div class="page-error"><h1>Artista não encontrado</h1><a class="btn" href="/admin">Voltar à biblioteca</a></div>
{:else if !info}
  <p class="page-loading">A carregar…</p>
{:else if !info.tracks.length}
  <div class="page-error"><h1>{info.hero.name}</h1><p>Ainda não há músicas aqui.</p><a class="btn" href={backTo}>Voltar</a></div>
{:else if viewport.phone}
  <GuestMobile {urls} {info} {trackId} folderId={router.query.get("f")} versionId={router.query.get("v")} />
{:else}
  <GuestDesktop {urls} {info} {trackId} folderId={router.query.get("f")} versionId={router.query.get("v")} />
{/if}

<style>
  .preview-bar { position: fixed; z-index: 30; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); width: max-content; max-width: calc(100% - 24px);
    display: flex; gap: 12px; align-items: center; padding: 8px 8px 8px 16px; border-radius: 14px; background: var(--fg); color: var(--bg); box-shadow: var(--shadow); font-size: 13.5px; }
  .preview-bar :global(.btn) { background: var(--bg); color: var(--fg); border-color: transparent; }
  @media (max-width: 760px) { .preview-bar { bottom: auto; top: calc(8px + env(safe-area-inset-top, 0px)); } }
</style>

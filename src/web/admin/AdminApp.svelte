<script lang="ts">
  import LogoDefs from "../components/LogoDefs.svelte";
  import { match, router } from "../router.svelte";
  import GuestPreview from "./GuestPreview.svelte";
  import Library from "./Library.svelte";
  import Links from "./Links.svelte";
  import MiniPlayer from "./MiniPlayer.svelte";
  import ProfileDialog from "./ProfileDialog.svelte";
  import ProfilePanel from "./ProfilePanel.svelte";
  import ArtistPage from "./ArtistPage.svelte";
  import Rail from "./Rail.svelte";
  import Revisions from "./Revisions.svelte";
  import { refreshLibrary, refreshMe, saveRail, store } from "./store.svelte";
  import { viewport } from "../lib/media.svelte";
  import TabBar from "./TabBar.svelte";
  import TrackPage from "./TrackPage.svelte";
  import Help from "./Help.svelte";
  import Search from "./Search.svelte";
  import CropDialog from "../components/CropDialog.svelte";
  import { cropper } from "../lib/crop.svelte";

  let failed = $state<string | null>(null);
  $effect(() => {
    Promise.all([refreshMe(), refreshLibrary()]).catch((e) => (failed = e instanceof Error ? e.message : "Ocorreu um erro inesperado."));
  });

  const artistRoute = $derived(match("/admin/artistas/:id") ?? match("/admin/artistas/:id/pastas/:folderId"));
  const trackRoute = $derived(match("/admin/artistas/:id/faixas/:trackId"));
  const previewRoute = $derived(match("/admin/artistas/:id/convidado"));

  // The rail folds to icons by itself on the track page and in narrow windows;
  // elsewhere it stays as the owner last left it (kept per device). In the
  // automatic places the fold button holds until the context changes (another
  // screen, or the window crossing the narrow width); switching tracks keeps it.
  const auto = $derived(!!trackRoute || viewport.railNarrow);
  let lastContext = "";
  $effect(() => {
    const context = `${!!trackRoute}|${viewport.railNarrow}`;
    if (context !== lastContext) store.railPref = null;
    lastContext = context;
  });
  const mini = $derived(store.railPref ?? (auto || store.railSaved === "mini"));
  function fold() {
    if (auto) store.railPref = !mini;
    else (saveRail(!mini), (store.railPref = null));
  }

  let profileOpen = $state(false);

  // Ctrl/⌘+K or / opens the search, ? the help (not while typing or with a dialog open).
  function onkey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      store.searchOpen = true;
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".scrim")) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "/") (e.preventDefault(), (store.searchOpen = true));
    else if (e.key === "?") (e.preventDefault(), (store.helpOpen = true));
  }
</script>

<svelte:window onkeydown={onkey} />

<LogoDefs />
{#if store.sessionExpired}
  <div class="page-error">
    <h1>Sessão expirada</h1>
    <p>Por segurança, o acesso do dono expira ao fim de algum tempo.</p>
    <button class="btn btn-primary" type="button" onclick={() => location.reload()}>Recarregar e entrar</button>
  </div>
{:else if failed}
  <div class="page-error">
    <h1>Não foi possível abrir a biblioteca</h1>
    <p>{failed}</p>
    <button class="btn" type="button" onclick={() => location.reload()}>Tentar outra vez</button>
  </div>
{:else if previewRoute}
  <GuestPreview artistId={previewRoute.id!} scope={router.query.get("scope")} />
{:else}
  <div class="app" class:rail-mini={mini} class:on-track={!!trackRoute}>
    <Rail {mini} onfold={fold} onprofile={() => (profileOpen = true)} />
    <main class="main">
      {#if router.path === "/admin" || router.path === "/admin/"}
        <Library />
      {:else if trackRoute}
        {#key trackRoute.id}<TrackPage artistId={trackRoute.id!} trackId={trackRoute.trackId!} />{/key}
      {:else if artistRoute}
        {#key artistRoute.id}<ArtistPage artistId={artistRoute.id!} folderId={artistRoute.folderId ?? null} />{/key}
      {:else if router.path === "/admin/revisoes"}
        <Revisions />
      {:else if router.path === "/admin/links"}
        <Links />
      {:else if router.path === "/admin/perfil"}
        <ProfilePanel />
      {:else}
        <div class="page-error"><h1>Página não encontrada</h1><a class="btn" href="/admin">Voltar à biblioteca</a></div>
      {/if}
    </main>
    {#if !trackRoute}<MiniPlayer />{/if}
    <TabBar />
  </div>
  {#if profileOpen}<ProfileDialog onclose={() => (profileOpen = false)} />{/if}
  {#if store.searchOpen}<Search onclose={() => (store.searchOpen = false)} />{/if}
  {#if store.helpOpen}<Help onclose={() => (store.helpOpen = false)} />{/if}
{/if}
{#if cropper.job}<CropDialog />{/if}

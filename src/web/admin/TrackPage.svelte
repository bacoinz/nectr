<script lang="ts">
  import { untrack } from "svelte";
  import type { TrackDTO, TrackLyricsDTO, VersionDTO } from "../../shared/api-types";
  import { isSynced, parseLrc } from "../../shared/lrc";
  import Lyrics from "../lyrics/Lyrics.svelte";
  import LyricsEditor from "../lyrics/LyricsEditor.svelte";
  import Art from "../components/Art.svelte";
  import Metaline from "../components/Metaline.svelte";
  import PromptDialog from "../components/PromptDialog.svelte";
  import TrackCoverDialog from "./TrackCoverDialog.svelte";
  import { isRelease, KIND_EYEBROW } from "../lib/kinds";
  import Transport from "../components/Transport.svelte";
  import Waveform, { ZOOMS } from "../components/Waveform.svelte";
  import CommentList from "../comments/CommentList.svelte";
  import { useComments } from "../comments/comments.svelte";
  import Composer from "../comments/Composer.svelte";
  import Markers from "../comments/Markers.svelte";
  import { ownerSource } from "../comments/source";
  import { admin, audioUrl, downloadUrl } from "../lib/api";
  import { date, fmtDuration, fmtTime, inkFor, plural } from "../lib/format";
  import { folderIcon, ICON } from "../lib/icons";
  import { getPeaks, viewport } from "../lib/media.svelte";
  import { load, play, player, prepare, seek, setQueue, skip, takeWantPlay, toggle, toggleMute, wantPlay, type Loaded } from "../lib/player.svelte";
  import { measureStored, measuring } from "../audio/measure.svelte";
  import { toastError } from "../lib/toast.svelte";
  import { navigate, router } from "../router.svelte";
  import { latest, projectOf, tracksIn } from "./project/tree";
  import ShareDialog from "./ShareDialog.svelte";
  import { loadArtist, setArtist, store } from "./store.svelte";

  let { artistId, trackId }: { artistId: string; trackId: string } = $props();

  let failed = $state<string | null>(null);
  $effect(() => {
    loadArtist(artistId).catch((e) => (failed = e instanceof Error ? e.message : "Artista não encontrado."));
  });
  const refresh = () => loadArtist(artistId, true).then(setArtist);

  const p = $derived(store.artists[artistId]);
  const track = $derived(p?.tracks.find((t) => t.id === trackId));
  const version = $derived(track ? (track.versions.find((v) => v.id === router.query.get("v")) ?? latest(track)) : undefined);
  const folder = $derived(p && track?.folderId ? p.folders.find((f) => f.id === track.folderId) : undefined);
  const siblings = $derived(p && track ? tracksIn(p, track.folderId) : []);
  // The project (album) the track belongs to; loose tracks show the artist instead.
  const project = $derived(p && track ? projectOf(p, track.folderId) : null);
  const color = $derived(project?.color ?? p?.artist.color ?? "#f4b740");
  const projStyle = $derived(`--proj-main:${color};--proj-ink:${inkFor(color)}`);
  const base = $derived(`/admin/artistas/${artistId}`);
  const listUrl = $derived(folder ? `${base}/pastas/${folder.id}` : base);

  // The cover a track shows: its own, else its project's (a release), else the artist's photo.
  const projectCover = $derived(project && isRelease(project) ? project.artworkUrl : null);
  const coverOf = (t: TrackDTO) => t.artworkUrl ?? projectCover ?? p?.artist.photoUrl ?? null;
  let coverOpen = $state(false);
  const toLoaded = (t: TrackDTO, v: VersionDTO): Loaded => ({
    key: v.id, src: audioUrl(v.id), duration: v.durationS, title: t.title, artist: p!.artist.name,
    artwork: coverOf(t), href: `${base}/faixas/${t.id}`, color,
  });

  // Load the version into the shared player; a version switch keeps the position.
  let lastTrack = "";
  let shown = "";
  $effect(() => {
    if (!p || !track || !version) return;
    const sameTrack = lastTrack === track.id;
    lastTrack = track.id;
    shown = `${base}/faixas/${track.id}`;
    // ?t= (from "Revisões") opens the track at that second.
    const at = sameTrack ? 0 : Number(untrack(() => router.query.get("t"))) || 0;
    const item = toLoaded(track, version);
    // Untracked: load() reads the player, and this effect must not rerun when the player moves on.
    untrack(() => {
      load(
        item,
        // Only a play button starts it; otherwise it keeps playing if something was.
        sameTrack ? { at: player.t } : { at, play: takeWantPlay() || undefined },
      );
      if (at) seek(at);
    });
  });

  // Comments of this track; a change refreshes the request counts (table, rail).
  const cm = useComments(() => ({
    source: ownerSource,
    trackId: track?.id ?? null,
    version: version ? { id: version.id, number: version.number } : null,
    onchange: () => void refresh(),
  }));
  $effect(() => {
    const c = router.query.get("c");
    if (c) untrack(() => (cm.ui.focusId = c));
  });
  let tab = $state<"comments" | "lyrics" | "info">("comments");

  // Lyrics: the track's, or this version's own timing.
  let lyr = $state<TrackLyricsDTO | null>(null);
  const loadLyrics = (id: string) => admin.trackLyrics(id).then((l) => track?.id === id && (lyr = l)).catch(() => {});
  $effect(() => {
    const id = track?.id;
    lyr = null;
    if (id) void loadLyrics(id);
  });
  const lines = $derived(lyr && version ? parseLrc(lyr.overrides[version.id] ?? lyr.track ?? "") : []);
  let editingLyrics = $state(false);

  // The other versions stay loaded next to the playing one, so switching is instant (computer only).
  $effect(() => {
    if (!p || !track || !version || viewport.phone) return prepare([]);
    const v = version;
    const items = [v, ...track.versions.filter((x) => x.id !== v.id)].slice(0, 4).map((x) => toLoaded(track, x));
    untrack(() => prepare(items));
  });
  $effect(() => () => prepare([]));

  // Versions from before loudness was measured are measured now (computer only).
  $effect(() => {
    const v = version;
    if (!v || v.lufsIntegrated !== null || viewport.phone) return;
    void measureStored(v.id).then((r) => r && refresh());
  });

  // When the player moves on by itself (the end of a track, "next"), the page goes with it.
  $effect(() => {
    const href = player.item?.href;
    if (href && shown && href !== shown && href.startsWith(`${base}/faixas/`)) untrack(() => navigate(href));
  });

  // Next/previous in the mini player walk this track's folder.
  $effect(() => {
    if (p) setQueue(siblings.map((t) => toLoaded(t, latest(t))));
  });

  let peaks = $state<Int8Array | null>(null);
  $effect(() => {
    const id = version?.id;
    if (!id) return;
    peaks = null;
    getPeaks(`/api/admin/versions/${id}/peaks`).then((x) => version?.id === id && (peaks = x)).catch(() => {});
  });

  let zoom = $state(1);
  // B goes back to the version heard before (A/B by ear).
  let previous: string | null = null;
  function pickVersion(id: string) {
    if (version && id !== version.id) previous = version.id;
    navigate(`${router.path}?v=${id}`, { replace: true });
  }

  // Keyboard: space play/pause, ←/→ ±5 s, Home to the start, 1–9 pick a version, +/− zoom.
  function onkey(e: KeyboardEvent) {
    if ((e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) || document.querySelector(".scrim") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " ") (e.preventDefault(), toggle());
    else if (e.key === "ArrowLeft") (e.preventDefault(), skip(-5));
    else if (e.key === "ArrowRight") (e.preventDefault(), skip(5));
    else if (e.key === "Home") seek(0);
    else if ((e.key === "b" || e.key === "B") && previous && track?.versions.some((v) => v.id === previous)) pickVersion(previous);
    else if (/^[1-9]$/.test(e.key) && track) {
      const v = [...track.versions].reverse()[Number(e.key) - 1];
      if (v) pickVersion(v.id);
    } else if (e.key === "+" || e.key === "=") zoom = ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!;
    else if (e.key === "-") zoom = ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!;
    else if (e.key === "m" || e.key === "M") toggleMute();
  }

  // "Sobre esta versão": open by default on wide windows, folds by itself when narrow.
  let asidePref = $state<boolean | null>(null);
  $effect(() => {
    void viewport.narrow;
    asidePref = null;
  });
  const asideOpen = $derived(asidePref ?? !viewport.narrow);

  let sharing = $state(false);
  let editingNotes = $state(false);
</script>

<svelte:window onkeydown={onkey} />

{#snippet versionChips(compact: boolean)}
  {#each track!.versions as v (v.id)}
    <button class="vchip" type="button" aria-pressed={v.id === version!.id} onmousedown={(e) => e.preventDefault()} onclick={() => pickVersion(v.id)}>
      <b>v{v.number}</b>{#if !compact && v.label}<span>{v.label}</span>{/if}
    </button>
  {/each}
{/snippet}

{#snippet composer(desktop: boolean)}
  <Composer owner {desktop} duration={version!.durationS} replyTo={cm.ui.replyTo} oncancelreply={() => (cm.ui.replyTo = null)} onsend={cm.send} startAt={cm.ui.startAt}
    editing={cm.ui.editing} oncanceledit={() => (cm.ui.editing = null)} ondraft={(d) => (cm.ui.draft = d)} />
{/snippet}

{#snippet aboutVersion()}
  <div class="gnote">
    <strong>v{version!.number}{version!.label ? ` · ${version!.label}` : ""}</strong>
    {#if version!.notes}<span>{version!.notes}</span>{/if}
    <span class="faint">{version!.name ? `Era a faixa “${version!.name}” · ` : ""}Carregada a {date(version!.createdAt)} · {version!.originalFilename}</span>
    <button class="linkbtn" type="button" onclick={() => (editingNotes = true)}>{@html ICON.pencil}Nome e notas</button>
    <a class="linkbtn" href={downloadUrl(version!.id)} download>{@html ICON.download}Descarregar original</a>
  </div>
{/snippet}

{#if failed}
  <div class="page-error"><h1>{failed}</h1><a class="btn" href="/admin">Voltar à biblioteca</a></div>
{:else if !p}
  <p class="page-loading">A carregar…</p>
{:else if !track || !version}
  <div class="page-error"><h1>Faixa não encontrada</h1><a class="btn" href={base}>Voltar ao artista</a></div>
{:else if viewport.phone}
  <!-- Owner on the phone: full-screen player, controls at the bottom. -->
  <section class="proj-scope mshell" style={projStyle}>
    <div class="ph-scroll">
      <div class="m-topbar">
        <a class="m-back" href={listUrl} style="text-decoration:none">{@html ICON.back}{folder?.name ?? p.artist.name}</a>
        <button class="iconbtn sm" type="button" aria-label="Partilhar" onclick={() => (sharing = true)}>{@html ICON.share}</button>
      </div>
      <div class="m-head tcover-head" style="padding-top:8px">
        <button class="tcover" type="button" aria-label="Capa da faixa" title="Capa da faixa" onclick={() => (coverOpen = true)}><Art {color} url={coverOf(track)} seed={track.title} cls={track.artworkUrl ? "" : "is-fallback"} /></button>
        <h2 class="ph-title" style="font-size:24px">{track.title}{#if track.sessionName}<span class="sess">{track.sessionName}</span>{/if}</h2>
      </div>
      <div class="ph-vrow">
        <div class="ph-versions">{@render versionChips(true)}</div>
        <div class="ph-zoom">
          <button class="tbtn" type="button" aria-label="Menos zoom" onclick={() => (zoom = ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!)}>{@html ICON.zoomOut}</button>
          <button class="tbtn" type="button" aria-label="Mais zoom" onclick={() => (zoom = ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!)}>{@html ICON.zoomIn}</button>
        </div>
      </div>
      <div class="ph-wave">
        <Waveform {peaks} duration={version.durationS} t={player.t} playing={player.playing} {zoom} onseek={seek} onlongpress={cm.commentAt} ranges={cm.ranges} label="Forma de onda: toca para saltar; mantém premido para comentar">
          <Markers {cm} duration={version.durationS} small />
        </Waveform>
      </div>
      <div class="ph-times mono"><span>{fmtTime(player.t)}</span><span>{zoom}× · {fmtDuration(version.durationS)}</span></div>
      <div class="ph-composer">{@render composer(false)}</div>
      <div class="ph-tabs" role="tablist">
        <button class="ph-tab" role="tab" type="button" aria-selected={tab === "comments"} onclick={() => (tab = "comments")}>Comentários<span>{cm.threads.length}</span></button>
        <button class="ph-tab" role="tab" type="button" aria-selected={tab === "lyrics"} onclick={() => (tab = "lyrics")}>Letra</button>
        <button class="ph-tab" role="tab" type="button" aria-selected={tab === "info"} onclick={() => (tab = "info")}>Info</button>
      </div>
      <div class="ph-panel">
        {#if tab === "lyrics"}
          <div class="ly-tools"><span>{isSynced(lines) ? "Letra sincronizada" : lines.length ? "Letra" : ""}</span><button class="linkbtn" type="button" onclick={() => (editingLyrics = true)}>{@html ICON.pencil}{lines.length ? "Editar" : "Adicionar letra"}</button></div>
          {#if lines.length}<Lyrics {lines} phone />{:else}<p class="empty">Ainda não há letra para esta faixa.</p>{/if}
        {:else if tab === "comments"}
          <CommentList {cm} owner phone voiceUrl={ownerSource.voiceUrl} empty="Ainda não há comentários nesta versão. Mantém premido na forma de onda para comentar num ponto." />
        {:else}
          <div class="info">
            <Metaline v={version} />
            {@render aboutVersion()}
          </div>
        {/if}
      </div>
    </div>
    <Transport compact />
  </section>
{:else}
  <section class="proj-scope is-entering" style={projStyle}>
    <div class="proj-head">
      {#if project}
        <Art color={project.color} url={project.artworkUrl} icon={isRelease(project) ? null : project.icon} seed={project.name} />
        <div class="proj-info">
          <span class="eyebrow">{KIND_EYEBROW[project.kind]}</span>
          <h1 class="title-xl"><a href="{base}/pastas/{project.id}" style="color:inherit;text-decoration:none">{project.name}</a></h1>
          <p><a class="by" href={base} style="color:inherit">{p.artist.name}</a> <span class="muted">{project.year ? `· ${project.year}` : ""}</span></p>
        </div>
      {:else}
        <Art color={p.artist.color} url={p.artist.photoUrl} seed={p.artist.name} />
        <div class="proj-info">
          <span class="eyebrow">Artista</span>
          <h1 class="title-xl"><a href={base} style="color:inherit;text-decoration:none">{p.artist.name}</a></h1>
          <p class="muted">{plural(p.tracks.length, "faixa", "faixas")}</p>
        </div>
      {/if}
      <div class="actions">
        <button class="btn btn-primary" type="button" onclick={() => (sharing = true)}>{@html ICON.share}Partilhar</button>
      </div>
    </div>

    <div class="player-layout" class:lyrics-open={asideOpen}>
      <nav class="tracklist" aria-label="Faixas">
        <div class="tl-head">
          <span class="section-label">Faixas</span>
          <a class="linkbtn" href={listUrl}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>Lista detalhada
          </a>
        </div>
        <ol>
          {#if folder}<li class="ggroup-head">{#if !isRelease(folder)}<span class="ficon sm" style="--fc:{folder.color}">{@html folderIcon(folder.icon, 15)}</span>{:else}<Art color={folder.color} url={folder.artworkUrl} seed={folder.name} cls="thumb" />{/if}{folder.name}</li>{/if}
          {#each siblings as t, i (t.id)}
            <li>
              <a class="trk" href="{base}/faixas/{t.id}" aria-current={t.id === track.id ? "true" : undefined} style="text-decoration:none;color:inherit">
                <span class="n"><span class="num">{i + 1}</span><span class="pi" role="presentation" onclick={(e) => (t.id === track.id ? (e.preventDefault(), play()) : wantPlay())}>{@html ICON.playSm}</span></span><span><span class="t">{t.title}{#if t.sessionName}<span class="sess">{t.sessionName}</span>{/if}</span><span class="s">v{latest(t).number} · {fmtDuration(latest(t).durationS)}</span></span>{#if t.openRequests}<span class="open-dot" title="Pedidos abertos"></span>{:else}<span></span>{/if}
              </a>
            </li>
          {/each}
        </ol>
      </nav>

      <div class="stack">
        <div class="player">
          <div class="player-title tcover-head">
            <button class="tcover" type="button" aria-label="Capa da faixa" title="Capa da faixa" onclick={() => (coverOpen = true)}><Art {color} url={coverOf(track)} seed={track.title} cls={track.artworkUrl ? "" : "is-fallback"} /></button>
            <h2>{track.title}{#if track.sessionName}<span class="sess" title="Projeto no Ableton (só tu vês)">{track.sessionName}</span>{/if}</h2>
          </div>
          <Metaline v={version} />
          {#if measuring.versionId === version.id}<p class="faint" style="font-size:12.5px;margin-top:-4px">A medir o loudness desta versão… {Math.round(measuring.progress * 100)}%</p>{/if}
          <div class="versions">
            {@render versionChips(false)}
            {#if track.versions.length > 1}<span class="vhint">A posição mantém-se ao mudar de versão · B volta à anterior</span>{/if}
          </div>
          <Waveform {peaks} duration={version.durationS} t={player.t} playing={player.playing} {zoom} onseek={seek} ranges={cm.ranges}>
            <Markers {cm} duration={version.durationS} />
          </Waveform>
          <Transport bind:zoom />
          {#if player.error}<p class="upstate err">{player.error}</p>{/if}
        </div>
        <section class="comments" aria-label="Comentários">
          <div class="comments-head">
            <span class="section-label">Comentários</span><span class="n">{cm.threads.length} nesta versão</span>
            <div class="seg">
              <button type="button" aria-pressed={cm.ui.filter === "all"} onclick={() => (cm.ui.filter = "all")}>Todos</button>
              <button type="button" aria-pressed={cm.ui.filter === "open"} onclick={() => (cm.ui.filter = "open")}>Abertos</button>
            </div>
          </div>
          {@render composer(true)}
          <CommentList {cm} owner voiceUrl={ownerSource.voiceUrl} empty="Ainda não há comentários nesta versão." />
        </section>
      </div>

      <aside class="gaside paside" aria-label="Sobre esta versão">
        <button class="aside-rail" type="button" aria-label="Mostrar “Sobre esta versão”" onclick={() => (asidePref = true)}>
          <span class="chev">{@html ICON.back}</span><span class="vlabel">Sobre esta versão · Letra</span>
        </button>
        <div class="aside-full">
          <div class="gaside-head"><h3>Sobre esta versão</h3><button class="iconbtn sm" type="button" aria-label="Recolher o painel" onclick={() => (asidePref = false)}>{@html ICON.chev}</button></div>
          {@render aboutVersion()}
          <div class="gaside-head"><h3>Letra</h3>{#if lines.length}<button class="linkbtn" type="button" onclick={() => (editingLyrics = true)}>{@html ICON.pencil}Editar</button>{/if}</div>
          {#if lines.length}
            <Lyrics {lines} />
          {:else}
            <p class="muted" style="font-size:14px">Ainda não há letra para esta faixa.</p>
            <button class="btn sm" type="button" style="align-self:flex-start" onclick={() => (editingLyrics = true)}>Adicionar letra</button>
          {/if}
        </div>
      </aside>
    </div>
  </section>
{/if}

{#if sharing && p && track}<ShareDialog a={p} context={{ type: "track", id: track.id }} onclose={() => (sharing = false)} />{/if}
{#if editingLyrics && lyr && p && track && version}
  <LyricsEditor {track} {version} lyrics={lyr} artistName={p.artist.name} onclose={() => (editingLyrics = false)}
    onsaved={(a) => (setArtist(a), void loadLyrics(track.id))} />
{/if}
{#if editingNotes && version}
  {@const v = version}
  <PromptDialog title="v{v.number}: nome e notas" subtitle="As notas aparecem a quem ouve, em “Sobre esta versão”." label="Nome da versão (ex.: vocals up)" value={v.label} notesLabel="Notas" notes={v.notes}
    onclose={() => (editingNotes = false)}
    onsubmit={async (label, notes) => { await admin.updateVersion(v.id, { label, notes }).catch((e) => { toastError(e); throw e; }); await refresh(); }} />
{/if}
{#if coverOpen && p && track}
  <TrackCoverDialog {track} fallback={projectCover ?? p.artist.photoUrl} {color} onsaved={(r) => setArtist(r)} onclose={() => (coverOpen = false)} />
{/if}

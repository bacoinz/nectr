<script lang="ts">
  import type { GuestInfoDTO } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import Metaline from "../components/Metaline.svelte";
  import Transport from "../components/Transport.svelte";
  import Waveform, { ZOOMS } from "../components/Waveform.svelte";
  import { date, fmtDuration, plural } from "../lib/format";
  import { folderIcon, ICON, LOGO } from "../lib/icons";
  import { viewport } from "../lib/media.svelte";
  import { play, player, seek, skip, toggle, toggleMute, wantPlay } from "../lib/player.svelte";
  import { navigate, router } from "../router.svelte";
  import { untrack } from "svelte";
  import { countUnder, linkFolderId, projStyle, shelfFor, withParam, type GuestUrls } from "./guest";
  import type { GuestFolderDTO } from "../../shared/api-types";
  import { KIND_LABEL } from "../lib/kinds";
  import { usePlayback } from "./playback.svelte";
  import CommentList from "../comments/CommentList.svelte";
  import { useComments } from "../comments/comments.svelte";
  import Composer from "../comments/Composer.svelte";
  import { askName, guest } from "../comments/guest.svelte";
  import Markers from "../comments/Markers.svelte";
  import NameCard from "../comments/NameCard.svelte";
  import GuestHelp from "./GuestHelp.svelte";
  import GuestAlerts from "./GuestAlerts.svelte";
  import GuestShareDialog from "./GuestShareDialog.svelte";
  import { useAlerts } from "./alerts.svelte";
  import type { LyricLine } from "../../shared/lrc";
  import Lyrics from "../lyrics/Lyrics.svelte";
  import { loadLyrics } from "../lyrics/fetch";

  // Guest on a computer: folders and tracks · player · "Sobre esta versão" (folds into a rail).
  // The list browses folders (closed until opened); the player keeps the last track opened.
  let { urls, info, trackId, folderId, versionId }: { urls: GuestUrls; info: GuestInfoDTO; trackId: string | null; folderId: string | null; versionId: string | null } = $props();

  const routeTrack = $derived(trackId ? info.tracks.find((t) => t.id === trackId) : undefined);
  const shelf = $derived(shelfFor(info, routeTrack ? routeTrack.folderId : folderId));
  let lastOpened = $state<string | null>(null);
  $effect(() => {
    if (routeTrack) lastOpened = routeTrack.id;
  });
  // A track that starts playing stays on screen while the guest browses other folders.
  $effect(() => {
    if (!player.playing) return;
    const key = player.key;
    const t = untrack(() => info.tracks.find((x) => x.versions.some((v) => v.id === key)));
    if (t) lastOpened = t.id;
  });
  const track = $derived(routeTrack ?? info.tracks.find((t) => t.id === lastOpened) ?? shelf.tracks[0] ?? info.tracks[0]!);
  // The list the track sits in: "next" and the end of a track go through it.
  const queue = $derived(shelfFor(info, track.folderId).tracks);
  const ownFolder = $derived(linkFolderId(info));
  // At an artist's top: albums and EPs, then the working projects (labelled when both are there).
  const sections = $derived.by(() => {
    if (shelf.folder) return [{ label: "", list: shelf.folders }];
    const rel = shelf.folders.filter((f) => f.kind === "release"), work = shelf.folders.filter((f) => f.kind !== "release");
    return rel.length && work.length ? [{ label: "Álbuns e EPs", list: rel }, { label: "Outros projetos", list: work }] : [{ label: "", list: shelf.folders }];
  });
  const folderSub = (f: GuestFolderDTO) => [!f.parentId ? (f.kind === "release" ? (f.year ? String(f.year) : "") : KIND_LABEL[f.kind]) : "", plural(countUnder(info, f.id), "faixa", "faixas")].filter(Boolean).join(" · ");
  const version = $derived(track.versions.find((v) => v.id === versionId) ?? track.versions[0]!);
  const playback = usePlayback(() => ({ urls, info, track, version, queue }));
  let zoom = $state(1);

  // Comments (none on a listen-only link).
  const talk = $derived(info.link.allowComments);
  const cm = useComments(() => ({ source: urls.comments, trackId: talk ? track.id : null, version: { id: version.id, number: version.number } }));
  const readOnly = $derived(urls.comments.readOnly);
  let helpOpen = $state(false);
  // Sharing a track or folder of this link (where the owner allows it).
  const canShare = $derived(info.link.allowShare && !!urls.shares);
  let shareWhat = $state<{ type: "track" | "folder"; id: string; name: string } | null>(null);
  const alerts = useAlerts(() => urls.push);
  // After a message, offer notifications once (so the guest hears the answer).
  const send: typeof cm.send = (m) => cm.send(m).then((ok) => (ok && alerts.offer(), ok));
  // ?c= (from a notification) opens that conversation.
  $effect(() => {
    const c = router.query.get("c");
    if (c) untrack(() => ((cm.ui.focusId = c)));
  });

  // Lyrics (when the link shows them), for the version on screen.
  let lyricLines = $state<LyricLine[]>([]);
  $effect(() => {
    const url = info.link.showLyrics ? urls.lyrics(version.id) : null;
    lyricLines = [];
    if (url) void loadLyrics(url).then((l) => urls.lyrics(version.id) === url && (lyricLines = l));
  });
  // The open track counts what is on screen (a new comment shows at once).
  const countOf = (t: { id: string; commentCount: number }) => (t.id === track.id && cm.loaded ? cm.all.filter((c) => !c.parentId).length : t.commentCount);

  const openTrack = (id: string) => (info.link.type === "track" ? undefined : navigate(urls.track(id)));
  // B goes back to the version heard before.
  let previous: string | null = null;
  function pickVersion(id: string) {
    if (id !== version.id) previous = version.id;
    navigate(withParam("v", id), { replace: true });
  }

  let asidePref = $state<boolean | null>(null);
  $effect(() => {
    void viewport.narrow;
    asidePref = null;
  });
  const asideOpen = $derived(asidePref ?? !viewport.narrow);

  function onkey(e: KeyboardEvent) {
    if ((e.target instanceof Element && e.target.closest("input, textarea, select")) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " ") (e.preventDefault(), toggle());
    else if (e.key === "ArrowLeft") (e.preventDefault(), skip(-5));
    else if (e.key === "ArrowRight") (e.preventDefault(), skip(5));
    else if (e.key === "Home") seek(0);
    else if ((e.key === "b" || e.key === "B") && previous && track.versions.some((v) => v.id === previous)) pickVersion(previous);
    else if (/^[1-9]$/.test(e.key)) {
      const v = [...track.versions].reverse()[Number(e.key) - 1];
      if (v) pickVersion(v.id);
    } else if (e.key === "+" || e.key === "=") zoom = ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)]!;
    else if (e.key === "-") zoom = ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)]!;
    else if (e.key === "m" || e.key === "M") toggleMute();
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="guest-desk proj-scope" style={projStyle(info.hero.color)}>
  <div class="gtop">
    <div class="brand">{@html LOGO(24)}nectr</div>
    <span style="flex:1"></span>
    {#if talk && !readOnly}
      <span class="gwho">
        {#if guest.me}A comentar como <button class="uname" type="button" title="Mudar o teu nome" onclick={() => askName("rename")}>{guest.me.name}</button>
        {:else}<button class="linkbtn" type="button" onclick={() => askName("send")}>Diz-nos o teu nome para comentar</button>{/if}
      </span>
    {/if}
    {#if urls.push && alerts.available}<button class="iconbtn sm" class:is-on={alerts.on} type="button" aria-label={alerts.on ? "Avisos ligados" : "Avisos"} title={alerts.on ? "Avisos ligados" : "Avisos"} onclick={() => (alerts.open = true)}>{@html alerts.on ? ICON.bellOn : ICON.bell}</button>{/if}
    <button class="iconbtn sm" type="button" aria-label="Como funciona" title="Como funciona" onclick={() => (helpOpen = true)}><span class="qmark" aria-hidden="true">?</span></button>
  </div>
  <div class="gapp" class:lyrics-open={asideOpen}>
    <aside class="gside" aria-label="Pastas e faixas">
      {#key shelf.folder?.id ?? "top"}
      <div class="gshelf is-entering">
      {#if shelf.top}
        <Art color={info.hero.color} url={info.hero.artworkUrl} icon={info.hero.icon} seed={info.hero.name} />
        <div>
          <p class="ph-title">{info.hero.name}</p>
          <p class="ph-by">{[info.hero.subtitle, plural(info.tracks.length, "faixa", "faixas")].filter(Boolean).join(" · ")}</p>
          {#if info.hero.description}<p class="muted" style="font-size:13.5px;margin-top:6px">{info.hero.description}</p>{/if}
        </div>
      {:else if shelf.folder}
        <a class="gback" href={shelf.upId ? urls.folder(shelf.upId) : urls.base}>{@html ICON.back}{shelf.upName}</a>
        <div class="gfolder-head">
          {#if shelf.folder.kind === "release" && !shelf.folder.parentId}<Art color={shelf.folder.color} url={shelf.folder.artworkUrl} seed={shelf.folder.name} />
          {:else}<Art color={shelf.folder.color} icon={shelf.folder.icon} seed={shelf.folder.name} />{/if}
          <div>
            <p class="ph-title">{shelf.folder.name}</p>
            <p class="ph-by">{folderSub(shelf.folder)}</p>
            {#if shelf.folder.description}<p class="muted" style="font-size:13.5px;margin-top:6px">{shelf.folder.description}</p>{/if}
            {#if canShare}{@const f = shelf.folder}<button class="linkbtn" type="button" style="margin-top:6px" onclick={() => (shareWhat = { type: "folder", id: f.id, name: f.name })}>{@html ICON.share}Partilhar esta pasta</button>{/if}
          </div>
        </div>
      {/if}
      <nav>
        {#if shelf.top && shelf.folder && shelf.folder.id !== ownFolder}<div class="ggroup-head">{#if shelf.folder.kind === "release" && !shelf.folder.parentId}<Art color={shelf.folder.color} url={shelf.folder.artworkUrl} seed={shelf.folder.name} cls="thumb" />{:else}<span class="ficon sm" style="--fc:{shelf.folder.color}">{@html folderIcon(shelf.folder.icon, 15)}</span>{/if}{shelf.folder.name}</div>{/if}
        {#each sections as sec (sec.label)}
          {#if sec.label && sec.list.length}<div class="ggroup-head">{sec.label}</div>{/if}
          {#each sec.list as f (f.id)}
            <a class="gfolder" href={urls.folder(f.id)}>
              {#if f.kind === "release" && !f.parentId}<Art color={f.color} url={f.artworkUrl} seed={f.name} cls="thumb" />{:else}<span class="ficon sm" style="--fc:{f.color}">{@html folderIcon(f.icon, 15)}</span>{/if}
              <span><span class="t">{f.name}</span><span class="s">{folderSub(f)}</span></span>
              <span class="faint">{@html ICON.chev}</span>
            </a>
          {/each}
        {/each}
        {#if shelf.tracks.length && shelf.folders.length}<div class="ggroup-head">Faixas</div>{/if}
        {#each shelf.tracks as t, i (t.id)}
            <button class="trk" type="button" aria-current={t.id === track.id ? "true" : undefined} onclick={() => openTrack(t.id)}>
              <span class="n"><span class="num">{i + 1}</span><span class="pi" role="presentation" onclick={(e) => (t.id === track.id ? (e.stopPropagation(), play()) : wantPlay())}>{@html ICON.playSm}</span></span><span><span class="t">{t.title}</span><span class="s">v{t.versions[0]!.number}{t.versions[0]!.label ? ` · ${t.versions[0]!.label}` : ""} · {fmtDuration(t.versions[0]!.durationS)}</span></span>
              {#if talk}<span class="ccount" class:none={!countOf(t)} aria-label="{countOf(t)} comentários">{@html ICON.commentSm}{countOf(t) || ""}</span>{:else}<span></span>{/if}
            </button>
        {/each}
      </nav>
      </div>
      {/key}
    </aside>

    <main class="gmain">
      <div class="player">
        <div class="player-title">
          <h2>{track.title}</h2>
          <span style="margin-left:auto"></span>
          {#if canShare}<button class="btn sm" type="button" onclick={() => (shareWhat = { type: "track", id: track.id, name: track.title })}>{@html ICON.share}Partilhar</button>{/if}
          {#if info.link.allowDownload}<a class="btn sm" href={urls.download(version.id)} download>{@html ICON.download}Descarregar</a>{/if}
        </div>
        <Metaline v={version} />
        {#if track.versions.length > 1}
          <div class="versions">
            {#each track.versions as v (v.id)}
              <button class="vchip" type="button" aria-pressed={v.id === version.id} onmousedown={(e) => e.preventDefault()} onclick={() => pickVersion(v.id)}><b>v{v.number}</b>{#if v.label}<span>{v.label}</span>{/if}</button>
            {/each}
            <span class="vhint">A posição mantém-se ao mudar de versão · B volta à anterior</span>
          </div>
        {/if}
        <Waveform peaks={playback.peaks} duration={version.durationS} t={player.t} playing={player.playing} {zoom} onseek={seek} ranges={talk ? cm.ranges : []}>
          {#if talk}<Markers {cm} duration={version.durationS} />{/if}
        </Waveform>
        <Transport bind:zoom />
        {#if player.error}<p class="upstate err">{player.error}</p>{/if}
      </div>
      {#if talk}
        <section class="comments" aria-label="Comentários">
          <div class="comments-head"><span class="section-label">Comentários</span><span class="n">{cm.threads.length} nesta versão</span></div>
          {#if !readOnly}
            <Composer desktop duration={version.durationS} replyTo={cm.ui.replyTo} oncancelreply={() => (cm.ui.replyTo = null)} onsend={send} startAt={cm.ui.startAt}
              editing={cm.ui.editing} oncanceledit={() => (cm.ui.editing = null)} ondraft={(d) => (cm.ui.draft = d)} />
          {/if}
          <CommentList {cm} owner={false} {readOnly} voiceUrl={urls.comments.voiceUrl}
            empty={readOnly ? "Ainda sem comentários públicos nesta versão." : "Ainda sem comentários nesta versão. Escreve no campo acima, no ponto que quiseres."} />
        </section>
      {/if}
    </main>

    <aside class="gaside" aria-label="Sobre esta versão">
      <button class="aside-rail" type="button" aria-label="Mostrar “Sobre esta versão”" onclick={() => (asidePref = true)}>
        <span class="chev">{@html ICON.back}</span><span class="vlabel">Sobre esta versão{info.link.showLyrics ? " · Letra" : ""}</span>
      </button>
      <div class="aside-full">
        <div class="gaside-head"><h3>Sobre esta versão</h3><button class="iconbtn sm" type="button" aria-label="Recolher o painel" onclick={() => (asidePref = false)}>{@html ICON.chev}</button></div>
        <div class="gnote">
          <strong>v{version.number}{version.label ? ` · ${version.label}` : ""}</strong>
          {#if version.notes}<span>{version.notes}</span>{/if}
          <span class="faint">Carregada a {date(version.createdAt)}</span>
        </div>
        {#if info.link.showLyrics}
          <h3>Letra</h3>
          {#if lyricLines.length}<Lyrics lines={lyricLines} />{:else}<p class="muted" style="font-size:14px">Ainda não há letra para esta faixa.</p>{/if}
        {/if}
      </div>
    </aside>
    {#if guest.prompt && !readOnly}<NameCard phone={false} hero={info.hero} />{/if}
    {#if helpOpen}<GuestHelp comments={talk} phone={false} onclose={() => (helpOpen = false)} />{/if}
    {#if shareWhat && urls.shares}<GuestShareDialog base={urls.shares} what={shareWhat} onclose={() => (shareWhat = null)} />{/if}
    {#if alerts.open && urls.push}<GuestAlerts target={urls.push} ownerName={info.ownerName} comments={talk && !readOnly} phone={false} onclose={() => (alerts.open = false)} onchange={(on) => (alerts.on = on)} />{/if}
  </div>
</div>

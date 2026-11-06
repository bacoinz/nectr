<script lang="ts">
  import type { GuestInfoDTO } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import Metaline from "../components/Metaline.svelte";
  import Transport from "../components/Transport.svelte";
  import Waveform, { ZOOMS } from "../components/Waveform.svelte";
  import { date, fmtDuration, fmtTime, plural } from "../lib/format";
  import { folderIcon, ICON, LOGO } from "../lib/icons";
  import { player, seek, toggle, wantPlay } from "../lib/player.svelte";
  import { navigate, router } from "../router.svelte";
  import { untrack } from "svelte";
  import { countUnder, linkFolderId, projStyle, shelfFor, trackCover, withParam, type GuestUrls } from "./guest";
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

  // Guest on a phone: folder pages (closed folders, opened one at a time) and the
  // player slide over each other.
  let { urls, info, trackId, folderId, versionId }: { urls: GuestUrls; info: GuestInfoDTO; trackId: string | null; folderId: string | null; versionId: string | null } = $props();

  const track = $derived(trackId ? info.tracks.find((t) => t.id === trackId) : undefined);
  const version = $derived(track ? (track.versions.find((v) => v.id === versionId) ?? track.versions[0]!) : undefined);
  // The folder page under the player is the track's own folder.
  const shelf = $derived(shelfFor(info, track ? track.folderId : folderId));
  const queue = $derived(track ? shelfFor(info, track.folderId).tracks : undefined);
  const playback = usePlayback(() => ({ urls, info, track, version, queue }));
  const ownFolder = $derived(linkFolderId(info));
  const sections = $derived.by(() => {
    if (shelf.folder) return [{ label: "", list: shelf.folders }];
    const rel = shelf.folders.filter((f) => f.kind === "release"), work = shelf.folders.filter((f) => f.kind !== "release");
    return rel.length && work.length ? [{ label: "Álbuns e EPs", list: rel }, { label: "Outros projetos", list: work }] : [{ label: "", list: shelf.folders }];
  });
  const folderSub = (f: GuestFolderDTO) => [!f.parentId ? (f.kind === "release" ? (f.year ? String(f.year) : "") : KIND_LABEL[f.kind]) : "", plural(countUnder(info, f.id), "faixa", "faixas")].filter(Boolean).join(" · ");
  const isCover = (f: GuestFolderDTO) => f.kind === "release" && !f.parentId;
  let zoom = $state(1);

  // Comments (none on a listen-only link): composer under the waveform, list in its tab.
  const talk = $derived(info.link.allowComments);
  const readOnly = $derived(urls.comments.readOnly);
  const cm = useComments(() => ({ source: urls.comments, trackId: talk && track ? track.id : null, version: version ? { id: version.id, number: version.number } : null }));
  let tab = $state<"comments" | "lyrics" | "info">("comments");
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
    if (c) untrack(() => ((cm.ui.focusId = c), (tab = "comments")));
  });

  // Lyrics (when the link shows them and there are some): their own tab.
  let lyricLines = $state<LyricLine[]>([]);
  $effect(() => {
    const url = version && info.link.showLyrics ? urls.lyrics(version.id) : null;
    lyricLines = [];
    if (url) void loadLyrics(url).then((l) => version && urls.lyrics(version.id) === url && (lyricLines = l));
  });
  $effect(() => {
    if (tab === "lyrics" && !lyricLines.length) tab = talk ? "comments" : "info";
  });
  const countOf = (t: { id: string; commentCount: number }) => (t.id === track?.id && cm.loaded ? cm.all.filter((c) => !c.parentId).length : t.commentCount);
  $effect(() => {
    if (!talk) tab = "info";
  });

  // The mini player shows whatever is loaded, even after going back to the list.
  const loaded = $derived(info.tracks.find((t) => t.versions.some((v) => v.id === player.key)));
  const isTrackLink = $derived(info.link.type === "track");
  const pickVersion = (id: string) => navigate(withParam("v", id), { replace: true });
  // From the player, back to the track's folder page.
  const back = () => navigate(shelf.top || !shelf.folder ? urls.base : urls.folder(shelf.folder.id));
  const backLabel = $derived(shelf.top || !shelf.folder ? info.hero.name : shelf.folder.name);
  const zoomBy = (d: number) => (zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + d))]!);
</script>

<div class="mshell proj-scope" class:at-album={!track} style={projStyle(info.hero.color)}>
  <div class="ph-stack">
    {#if !isTrackLink}
      <div class="ph-page album-page">
        <div class="ph-scroll">
          {#key shelf.folder?.id ?? "top"}
          <div class="is-entering">
          {#if !shelf.top && shelf.folder}
            <div class="m-topbar ph-topbar">
              <a class="ph-back" href={shelf.upId ? urls.folder(shelf.upId) : urls.base} style="text-decoration:none">{@html ICON.back}{shelf.upName}</a>
              <div class="ph-actions">
                {#if canShare}{@const f = shelf.folder}<button class="iconbtn sm" type="button" aria-label="Partilhar esta pasta" onclick={() => (shareWhat = { type: "folder", id: f.id, name: f.name })}>{@html ICON.share}</button>{/if}
                {#if urls.push && alerts.available}<button class="iconbtn sm" class:is-on={alerts.on} type="button" aria-label={alerts.on ? "Avisos ligados" : "Avisos"} onclick={() => (alerts.open = true)}>{@html alerts.on ? ICON.bellOn : ICON.bell}</button>{/if}
                <button class="iconbtn sm" type="button" aria-label="Como funciona" onclick={() => (helpOpen = true)}><span class="qmark" aria-hidden="true">?</span></button>
              </div>
            </div>
            <div class="album album-folder">
              {#if isCover(shelf.folder)}<Art color={shelf.folder.color} url={shelf.folder.artworkUrl} seed={shelf.folder.name} />{:else}<Art color={shelf.folder.color} icon={shelf.folder.icon} seed={shelf.folder.name} />{/if}
              <div>
                <p class="ph-title">{shelf.folder.name}</p>
                <p class="ph-by">{folderSub(shelf.folder)}</p>
              </div>
              {#if shelf.folder.description}<p class="muted" style="font-size:13.5px;max-width:42ch">{shelf.folder.description}</p>{/if}
            </div>
          {:else}
          <div class="album">
            <div class="ph-brand">{@html LOGO(22)}nectr</div>
            <div class="help-corner">
              {#if urls.push && alerts.available}<button class="iconbtn sm" class:is-on={alerts.on} type="button" aria-label={alerts.on ? "Avisos ligados" : "Avisos"} title={alerts.on ? "Avisos ligados" : "Avisos"} onclick={() => (alerts.open = true)}>{@html alerts.on ? ICON.bellOn : ICON.bell}</button>{/if}
              <button class="iconbtn sm" type="button" aria-label="Como funciona" onclick={() => (helpOpen = true)}><span class="qmark" aria-hidden="true">?</span></button>
            </div>
            <Art color={info.hero.color} url={info.hero.artworkUrl} icon={info.hero.icon} seed={info.hero.name} />
            <div>
              <p class="ph-title">{info.hero.name}</p>
              <p class="ph-by">
                {[info.hero.subtitle, plural(info.tracks.length, "faixa", "faixas")].filter(Boolean).join(" · ")}{#if talk && guest.me && !readOnly}{" · "}<button class="uname" type="button" title="Mudar o teu nome" onclick={() => askName("rename")}>{guest.me.name}</button>{/if}
              </p>
            </div>
            {#if info.hero.description}<p class="muted" style="font-size:13.5px;max-width:42ch">{info.hero.description}</p>{/if}
          </div>
          {/if}
          <div class="gtracks">
            {#if shelf.top && shelf.folder && shelf.folder.id !== ownFolder}<div class="ggroup-head" style="padding-inline:18px">{#if isCover(shelf.folder)}<Art color={shelf.folder.color} url={shelf.folder.artworkUrl} seed={shelf.folder.name} cls="thumb" />{:else}<span class="ficon sm" style="--fc:{shelf.folder.color}">{@html folderIcon(shelf.folder.icon, 15)}</span>{/if}{shelf.folder.name}</div>{/if}
            {#each sections as sec (sec.label)}
              {#if sec.label && sec.list.length}<div class="ggroup-head" style="padding-inline:18px">{sec.label}</div>{/if}
              {#each sec.list as f (f.id)}
                <a class="gtrack gfolder-row" href={urls.folder(f.id)} style="text-decoration:none;color:inherit">
                  {#if isCover(f)}<Art color={f.color} url={f.artworkUrl} seed={f.name} cls="thumb" />{:else}<span class="ficon sm" style="--fc:{f.color}">{@html folderIcon(f.icon, 15)}</span>{/if}
                  <span><span class="t">{f.name}</span><span class="s">{folderSub(f)}</span></span>
                  <span class="faint">{@html ICON.chev}</span>
                </a>
              {/each}
            {/each}
            {#if shelf.tracks.length && shelf.folders.length}<div class="ggroup-head" style="padding-inline:18px">Faixas</div>{/if}
              {#each shelf.tracks as t, i (t.id)}
                {@const playing = loaded?.id === t.id && player.playing}
                <a class="gtrack" class:is-playing={loaded?.id === t.id} href={urls.track(t.id)} style="text-decoration:none;color:inherit">
                  {#if playing}<span class="eq" aria-label="A tocar"><i style="height:60%"></i><i style="height:100%"></i><i style="height:40%"></i></span>{:else}<span class="mplay" role="presentation" aria-label="Ouvir" onclick={wantPlay}>{@html ICON.playSm}</span>{/if}
                  <span><span class="t">{t.title}</span><span class="s">v{t.versions[0]!.number}{t.versions[0]!.label ? ` · ${t.versions[0]!.label}` : ""} · {fmtDuration(t.versions[0]!.durationS)}</span></span>
                  {#if talk}<span class="cc" aria-label="{countOf(t)} comentários">{@html ICON.commentSm}{countOf(t) || ""}</span>{:else}<span></span>{/if}
                </a>
              {/each}
          </div>
          </div>
          {/key}
        </div>
        {#if loaded}
          <div class="miniplayer">
            <span class="prog" style="width:{player.duration ? (player.t / player.duration) * 100 : 0}%"></span>
            <Art color={info.hero.color} url={trackCover(info, loaded)} seed={info.hero.name} />
            <a href={urls.track(loaded.id)} style="text-decoration:none;color:inherit;min-width:0"><span class="t">{loaded.title}</span><span class="s">{fmtTime(player.t)} / {fmtDuration(player.duration)}</span></a>
            <button class="play xs" type="button" aria-label={player.playing ? "Pausa" : "Reproduzir"} onclick={toggle}>{@html player.playing ? ICON.pauseSm : ICON.playSm}</button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="ph-page player-page">
      {#if track && version}
        <div class="ph-scroll">
          <div class="m-topbar ph-topbar">
            {#if !isTrackLink}<button class="ph-back" type="button" onclick={back}>{@html ICON.back}{backLabel}</button>{:else}<div class="ph-brand" style="padding:4px 8px">{@html LOGO(20)}nectr</div>{/if}
            <div class="ph-actions">
              {#if canShare}<button class="iconbtn sm" type="button" aria-label="Partilhar esta faixa" onclick={() => (shareWhat = { type: "track", id: track.id, name: track.title })}>{@html ICON.share}</button>{/if}
              {#if urls.push && alerts.available}<button class="iconbtn sm" class:is-on={alerts.on} type="button" aria-label={alerts.on ? "Avisos ligados" : "Avisos"} title={alerts.on ? "Avisos ligados" : "Avisos"} onclick={() => (alerts.open = true)}>{@html alerts.on ? ICON.bellOn : ICON.bell}</button>{/if}
              <button class="iconbtn sm" type="button" aria-label="Como funciona" onclick={() => (helpOpen = true)}><span class="qmark" aria-hidden="true">?</span></button>
            </div>
          </div>
          <div class="ph-hero">
            <div class="ph-hero-row">
              <Art color={info.hero.color} url={trackCover(info, track)} seed={info.hero.name} />
              <div><p class="ph-title">{track.title}</p><p class="ph-by">{info.artist.name}</p></div>
            </div>
          </div>
          <div class="ph-vrow">
            <div class="ph-versions">
              {#each track.versions as v (v.id)}
                <button class="vchip" type="button" aria-pressed={v.id === version.id} onclick={() => pickVersion(v.id)}><b>v{v.number}</b></button>
              {/each}
            </div>
            <div class="ph-zoom">
              <button class="tbtn" type="button" aria-label="Menos zoom" onclick={() => zoomBy(-1)}>{@html ICON.zoomOut}</button>
              <button class="tbtn" type="button" aria-label="Mais zoom" onclick={() => zoomBy(1)}>{@html ICON.zoomIn}</button>
            </div>
          </div>
          <div class="ph-wave">
            <Waveform peaks={playback.peaks} duration={version.durationS} t={player.t} playing={player.playing} {zoom} onseek={seek}
              onlongpress={talk && !readOnly ? cm.commentAt : undefined} ranges={talk ? cm.ranges : []} label={talk ? "Forma de onda: toca para saltar; mantém premido para comentar" : "Forma de onda: toca para saltar"}>
              {#if talk}<Markers {cm} duration={version.durationS} small />{/if}
            </Waveform>
          </div>
          <div class="ph-times mono"><span>{fmtTime(player.t)}</span><span>{zoom}× · {fmtDuration(version.durationS)}</span></div>
          {#if talk && !readOnly}
            <div class="ph-composer"><Composer duration={version.durationS} replyTo={cm.ui.replyTo} oncancelreply={() => (cm.ui.replyTo = null)} onsend={send} startAt={cm.ui.startAt}
              editing={cm.ui.editing} oncanceledit={() => (cm.ui.editing = null)} ondraft={(d) => (cm.ui.draft = d)} /></div>
          {/if}
          <div class="ph-tabs" role="tablist">
            {#if talk}<button class="ph-tab" role="tab" type="button" aria-selected={tab === "comments"} onclick={() => (tab = "comments")}>Comentários<span>{cm.threads.length}</span></button>{/if}
            {#if lyricLines.length}<button class="ph-tab" role="tab" type="button" aria-selected={tab === "lyrics"} onclick={() => (tab = "lyrics")}>Letra</button>{/if}
            <button class="ph-tab" role="tab" type="button" aria-selected={tab === "info"} onclick={() => (tab = "info")}>Info</button>
          </div>
          <div class="ph-panel">
            {#if tab === "lyrics" && lyricLines.length}
              <Lyrics lines={lyricLines} phone />
            {:else if tab === "comments" && talk}
              <CommentList {cm} owner={false} {readOnly} phone voiceUrl={urls.comments.voiceUrl}
                empty={readOnly ? "Ainda sem comentários públicos nesta versão." : "Ainda sem comentários. Escreve no campo acima ou mantém premido na forma de onda, no ponto que quiseres."} />
            {:else}
            <div class="info">
              <p class="muted" style="font-size:14px"><b style="color:var(--fg)">v{version.number}{version.label ? ` · ${version.label}` : ""}</b> · carregada a {date(version.createdAt)}</p>
              <Metaline v={version} />
              {#if version.notes}<p class="muted" style="font-size:14px">{version.notes}</p>{/if}
              {#if info.link.allowDownload}<a class="btn sm" style="align-self:flex-start" href={urls.download(version.id)} download>{@html ICON.download}Descarregar</a>{/if}
            </div>
            {/if}
          </div>
        </div>
        <Transport compact />
      {/if}
    </div>
  </div>
  {#if guest.prompt && !readOnly}<NameCard phone hero={info.hero} />{/if}
  {#if helpOpen}<GuestHelp comments={talk} phone onclose={() => (helpOpen = false)} />{/if}
  {#if shareWhat && urls.shares}<GuestShareDialog base={urls.shares} what={shareWhat} onclose={() => (shareWhat = null)} />{/if}
  {#if alerts.open && urls.push}<GuestAlerts target={urls.push} ownerName={info.ownerName} comments={talk && !readOnly} phone={true} onclose={() => (alerts.open = false)} onchange={(on) => (alerts.on = on)} />{/if}
</div>

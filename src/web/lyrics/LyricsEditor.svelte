<script lang="ts">
  import type { ArtistResponse, TrackDTO, TrackLyricsDTO, VersionDTO } from "../../shared/api-types";
  import { isSynced, parseLrc, serializeLrc, stamp, type LyricLine } from "../../shared/lrc";
  import Dialog from "../components/Dialog.svelte";
  import { admin } from "../lib/api";
  import { fmtTime } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { pause, play, player, seek, skip, toggle } from "../lib/player.svelte";
  import { toast, toastError } from "../lib/toast.svelte";
  import { clearLyricsCache } from "./fetch";

  // Lyrics editor: write or paste the text (or import an .lrc), then set the
  // times by tapping "Marcar" as each line starts while the song plays.
  // Saved for the whole track, or only for this version when its timing differs.
  let { track, version, lyrics, artistName, onsaved, onclose }: {
    track: TrackDTO;
    version: VersionDTO;
    lyrics: TrackLyricsDTO;
    artistName: string;
    onsaved: (a: ArtistResponse) => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const own = lyrics.overrides[version.id];
  // svelte-ignore state_referenced_locally
  let lines = $state<LyricLine[]>(parseLrc(own ?? lyrics.track ?? ""));
  // svelte-ignore state_referenced_locally
  let text = $state(lines.map((l) => l.text).join("\n"));
  let step = $state<"text" | "sync">("text");
  // svelte-ignore state_referenced_locally
  let scope = $state<"track" | "version">(own !== undefined ? "version" : "track");
  let busy = $state(false);
  let file = $state<HTMLInputElement>();

  // ---------- Text ----------
  /** New text keeps the times of lines that did not change (matched in order, a few lines of slack). */
  function fromText() {
    const parsed = parseLrc(text);
    if (isSynced(parsed)) return parsed; // pasted LRC: its own times
    let j = 0;
    return parsed.map((l) => {
      for (let k = j; k < Math.min(lines.length, j + 4); k++) {
        if (lines[k]!.text === l.text && l.text) {
          j = k + 1;
          return { t: lines[k]!.t, text: l.text };
        }
      }
      return { t: null, text: l.text };
    });
  }
  function toSync() {
    lines = fromText();
    if (!lines.some((l) => l.text)) return toast("Escreve ou cola a letra primeiro.");
    cursor = Math.max(0, lines.findIndex((l) => l.text && l.t === null));
    step = "sync";
  }
  async function importLrc(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 256 * 1024) return toast("Esse ficheiro é demasiado grande para ser uma letra.");
    const parsed = parseLrc(await f.text());
    lines = parsed;
    text = parsed.map((l) => l.text).join("\n");
    if (file) file.value = "";
    toast(isSynced(parsed) ? "Letra importada com os tempos" : "Letra importada (sem tempos)");
    if (isSynced(parsed)) step = "sync";
  }

  // ---------- Times ----------
  /** The next line to mark. */
  let cursor = $state(0);
  // People tap a little after the line starts.
  const REACTION = 0.15;
  const nextLine = (from: number) => {
    for (let i = from; i < lines.length; i++) if (lines[i]!.text) return i;
    return lines.length;
  };
  let undo = $state<{ i: number; t: number | null }[]>([]);
  function mark() {
    if (cursor >= lines.length) return;
    undo.push({ i: cursor, t: lines[cursor]!.t });
    lines[cursor]!.t = Math.max(0, Math.round((player.t - REACTION) * 100) / 100);
    cursor = nextLine(cursor + 1);
    scrollToCursor();
  }
  function undoMark() {
    const u = undo.pop();
    if (!u) return;
    lines[u.i]!.t = u.t;
    cursor = u.i;
    scrollToCursor();
  }
  const nudge = (i: number, d: number) => (lines[i]!.t = Math.max(0, Math.round(((lines[i]!.t ?? player.t) + d) * 100) / 100));
  function restart() {
    for (const l of lines) l.t = null;
    undo = [];
    cursor = nextLine(0);
    pause();
    seek(0);
  }
  let list = $state<HTMLElement>();
  const scrollToCursor = () => queueMicrotask(() => list?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  /** Lines whose time comes before the previous line's. */
  const outOfOrder = $derived.by(() => {
    const bad = new Set<number>();
    let last = -1;
    lines.forEach((l, i) => {
      if (l.t === null) return;
      if (l.t < last) bad.add(i);
      last = Math.max(last, l.t);
    });
    return bad;
  });
  const timed = $derived(lines.filter((l) => l.t !== null).length);
  const toTime = $derived(lines.filter((l) => l.text).length);

  function onkey(e: KeyboardEvent) {
    if (step !== "sync" || (e.target instanceof Element && e.target.closest("input, textarea, select"))) return;
    if (e.key === "Enter") (e.preventDefault(), mark());
    else if (e.key === " ") (e.preventDefault(), toggle());
    else if (e.key === "Backspace") (e.preventDefault(), undoMark());
  }

  // ---------- Save / export ----------
  const current = () => (step === "text" ? fromText() : lines);
  async function save(lrc: string | null) {
    if (lrc && outOfOrder.size) return toast("Há tempos fora de ordem (a vermelho). Corrige-os antes de guardar.");
    busy = true;
    try {
      onsaved(await admin.putLyrics(track.id, { lrc, versionId: scope === "version" ? version.id : null }));
      clearLyricsCache();
      toast(lrc ? "Letra guardada" : "Letra removida");
      onclose();
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }
  function exportLrc() {
    const blob = new Blob([serializeLrc(current(), { title: track.title, artist: artistName })], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${artistName} - ${track.title}.lrc`.replace(/[\\/:*?"<>|]+/g, " ");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const hasAny = $derived(own !== undefined || !!lyrics.track);
</script>

<svelte:window onkeydown={onkey} />

<Dialog title="Letra de “{track.title}”" subtitle={step === "text" ? "Escreve ou cola a letra, ou importa um ficheiro .lrc." : "Toca ▶ e carrega em Marcar (ou Enter) quando cada linha começa."} {onclose} wide>
  {#if step === "text"}
    <div class="field">
      <label for="ly-text">Letra <span class="faint">(uma linha por verso; linha vazia separa estrofes)</span></label>
      <textarea class="input" id="ly-text" rows="14" bind:value={text} placeholder="Cola aqui a letra…"></textarea>
      <p class="help">Se colares uma letra com tempos ([00:12.50]…), os tempos ficam.</p>
    </div>
    <div class="actions">
      <button class="btn sm" type="button" onclick={() => file?.click()}>{@html ICON.folderUp}Importar .lrc</button>
      {#if text.trim()}<button class="btn sm" type="button" onclick={exportLrc}>{@html ICON.download}Descarregar .lrc</button>{/if}
      <input type="file" bind:this={file} accept=".lrc,.txt,text/plain" hidden onchange={importLrc} />
    </div>
  {:else}
    <div class="lysync-bar">
      <button class="play sm" type="button" aria-label={player.playing ? "Pausa" : "Reproduzir"} onclick={toggle}>{@html player.playing ? ICON.pause : ICON.play}</button>
      <button class="tbtn" type="button" aria-label="Recuar 3 segundos" onclick={() => skip(-3)}>{@html ICON.rew}</button>
      <span class="mono">{fmtTime(player.t)}</span>
      <span class="faint" style="font-size:13px">{timed} de {toTime} linhas com tempo</span>
      <span style="flex:1"></span>
      <button class="btn sm" type="button" disabled={!undo.length} onclick={undoMark}>Desfazer</button>
      <button class="btn btn-primary" type="button" disabled={cursor >= lines.length} onclick={mark}>Marcar ↵</button>
    </div>
    <div class="lysync" bind:this={list}>
      {#each lines as l, i (i)}
        {#if l.text}
          <div class="lyrow" class:is-cursor={i === cursor} class:is-bad={outOfOrder.has(i)} data-row={i}>
            <button class="stamp" type="button" disabled={l.t === null} title="Ouvir a partir daqui" onclick={() => l.t !== null && (seek(Math.max(0, l.t - 1)), play())}>{l.t === null ? "—" : stamp(l.t)}</button>
            <button class="lytext" type="button" title="Marcar esta linha a seguir" onclick={() => (cursor = i)}>{l.text}</button>
            <span class="lynudge">
              <button class="iconbtn sm" type="button" aria-label="Mais cedo 0,1 s" onclick={() => nudge(i, -0.1)}>−</button>
              <button class="iconbtn sm" type="button" aria-label="Mais tarde 0,1 s" onclick={() => nudge(i, 0.1)}>+</button>
              <button class="iconbtn sm" type="button" aria-label="Tirar o tempo" disabled={l.t === null} onclick={() => (l.t = null)}>{@html ICON.close}</button>
            </span>
          </div>
        {:else}<div class="lyrow-gap"></div>{/if}
      {/each}
    </div>
    <p class="help">Os tempos ficam 0,15 s antes do toque, para compensar a reação. Clica numa linha para a marcar a seguir; no tempo, para a ouvir. Espaço: tocar/pausa · Backspace: desfazer.</p>
  {/if}

  {#if track.versions.length > 1}
    <div class="seg" style="align-self:flex-start">
      <button type="button" aria-pressed={scope === "track"} onclick={() => (scope = "track")}>Todas as versões</button>
      <button type="button" aria-pressed={scope === "version"} onclick={() => (scope = "version")}>Só a v{version.number}</button>
    </div>
    <p class="help" style="margin-top:-10px">{scope === "version" ? `Os tempos valem só para a v${version.number} (por exemplo, se a introdução mudou). As outras usam os da faixa.` : "A mesma letra e os mesmos tempos em todas as versões, exceto as que têm tempos próprios."}</p>
  {/if}

  {#snippet footer()}
    {#if hasAny}<button class="btn" type="button" style="margin-right:auto" disabled={busy} onclick={() => save(null)}>Remover letra</button>{/if}
    {#if step === "sync"}
      <button class="btn" type="button" onclick={() => (step = "text")}>Editar texto</button>
      <button class="btn" type="button" onclick={restart}>Recomeçar tempos</button>
      <button class="btn" type="button" onclick={exportLrc}>.lrc</button>
    {:else}
      <button class="btn" type="button" onclick={toSync}>Acertar tempos</button>
    {/if}
    <button class="btn btn-primary" type="button" disabled={busy} onclick={() => save(serializeLrc(current()) || null)}>Guardar</button>
  {/snippet}
</Dialog>

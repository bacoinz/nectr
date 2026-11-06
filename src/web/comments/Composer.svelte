<script lang="ts">
  import { untrack } from "svelte";
  import type { CommentDTO } from "../../shared/api-types";
  import { LIMITS } from "../../shared/constants";
  import { fmtTime } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { pause, player } from "../lib/player.svelte";
  import { toast } from "../lib/toast.svelte";
  import { stampText, type ReplyTarget } from "./comments.svelte";
  import { canRecord, VoiceRecorder } from "./recorder";
  import type { NewComment } from "./source";

  // The comment field, WhatsApp-style, shared by owner and guest:
  // - the time chip follows the music until you start writing; a tap fixes the
  //   start, a second marks the end (a range), a third goes back to live;
  // - mic when the field is empty, send when there is text. Phone: hold to record,
  //   release to send, slide left to lock. Computer: a click records, locked.
  // Writing never pauses the music; recording does.
  // Editing one of your messages reuses the field: its text comes in, its time stays.
  let { owner = false, desktop = false, duration, replyTo = null, oncancelreply, onsend, startAt = null, editing = null, oncanceledit, ondraft }: {
    owner?: boolean;
    desktop?: boolean;
    duration: number;
    replyTo?: ReplyTarget | null;
    oncancelreply: () => void;
    onsend: (m: Omit<NewComment, "versionId" | "parentId">) => Promise<boolean>;
    startAt?: { t: number; n: number } | null;
    editing?: CommentDTO | null;
    oncanceledit?: () => void;
    /** The time being picked, for the waveform to show it. */
    ondraft?: (d: { start: number; end: number | null } | null) => void;
  } = $props();

  const tenth = (t: number) => Math.round(t * 10) / 10;

  // ---------- Time ----------
  let mode = $state<"live" | "start" | "range">("live");
  let start = $state(0);
  let end = $state(0);
  function fixStart() {
    if (mode === "live") {
      mode = "start";
      start = tenth(player.t);
    }
  }
  function cycle() {
    if (mode === "live") fixStart();
    else if (mode === "start") {
      mode = "range";
      end = player.t > start + 1 ? tenth(player.t) : Math.min(duration, start + 5);
    } else mode = "live";
  }
  const fixed = $derived(editing ?? replyTo?.top ?? null);
  const chipText = $derived(fixed ? stampText(fixed) : mode === "live" ? fmtTime(player.t) : mode === "range" ? `${fmtTime(start)}–${fmtTime(end)}` : fmtTime(start));
  const chipLabel = $derived(
    editing ? "Tempo da mensagem que estás a editar" : replyTo ? "Tempo do comentário a que respondes" : mode === "live" ? "Tempo atual. Toca para fixar." : mode === "start" ? "Início fixado. Toca para marcar o fim." : "Intervalo marcado. Toca para voltar ao tempo atual.",
  );
  const times = () =>
    fixed ? { tStart: fixed.tStart, tEnd: fixed.tEnd } : { tStart: mode === "live" ? tenth(player.t) : start, tEnd: mode === "range" ? end : null };

  // The waveform shows the start (and end) being picked for a new comment.
  $effect(() => {
    ondraft?.(fixed || mode === "live" ? null : { start, end: mode === "range" ? end : null });
  });
  $effect(() => () => ondraft?.(null));

  // Editing: the message's text comes into the field.
  let input = $state<HTMLInputElement>();
  $effect(() => {
    const e = editing;
    untrack(() => {
      text = e ? e.body : "";
      if (e) queueMicrotask(() => input?.focus());
    });
  });

  // A long press on the waveform starts a comment at that point.
  $effect(() => {
    const s = startAt;
    if (!s) return;
    untrack(() => {
      mode = "start";
      start = tenth(s.t);
      input?.focus();
    });
  });

  // ---------- Owner notes: private or public ----------
  const VIS_KEY = "nectr.vis";
  let lastVis = $state<"private" | "public">((() => {
    try {
      return localStorage.getItem(VIS_KEY) === "public" ? "public" : "private";
    } catch {
      return "private";
    }
  })());
  let visChoice = $state<"private" | "public" | null>(null);
  // A reply starts public; a new note uses the last choice.
  const vis = $derived(visChoice ?? (replyTo ? "public" : lastVis));
  $effect(() => {
    void replyTo;
    untrack(() => (visChoice = null));
  });
  function toggleVis() {
    const next = vis === "public" ? "private" : "public";
    visChoice = next;
    if (!replyTo) {
      lastVis = next;
      try {
        localStorage.setItem(VIS_KEY, next);
      } catch {
        /* ignore */
      }
    }
  }
  const placeholder = $derived(
    editing
      ? "Escreve a mensagem corrigida…"
      : replyTo?.self
        ? "Acrescenta algo à tua mensagem…"
        : owner
          ? replyTo
            ? vis === "public" ? `Responder a ${replyTo.name}…` : `Nota privada sobre o comentário de ${replyTo.name}…`
            : vis === "public" ? "Comentário público neste ponto…" : "Nota privada neste ponto…"
          : replyTo ? `Responder a ${replyTo.name}…` : "Escreve um comentário…",
  );

  // ---------- Text ----------
  let text = $state(untrack(() => editing?.body ?? ""));
  let sending = $state(false);
  function reset() {
    mode = "live";
    text = "";
    visChoice = null;
    // Sending closes the phone keyboard: the comment is done, back to the music.
    input?.blur();
  }
  async function sendText() {
    const body = text.trim();
    if (!body || sending) return;
    sending = true;
    const ok = await onsend({ body, ...times(), isPrivate: editing ? editing.isPrivate : owner && vis === "private" });
    sending = false;
    if (ok) reset();
  }

  // ---------- Voice ----------
  // The recording's level, drawn across the whole field.
  let levels = $state<number[]>([]);
  let barsW = $state(0);
  const nBars = $derived(Math.max(16, Math.floor(barsW / 5)));
  let rec = $state<"idle" | "hold" | "locked">("idle");
  let recT = $state(0);
  let recorder: VoiceRecorder | null = null;
  let recorded: { blob: Blob; durationS: number } | null = null;
  let starting = false;
  let timer = 0;
  let holdX = 0;

  async function startRec(locked: boolean) {
    if (!canRecord()) return toast("Este browser não consegue gravar notas de voz.");
    fixStart();
    pause();
    recorded = null;
    rec = locked ? "locked" : "hold";
    recT = 0;
    const r = new VoiceRecorder();
    starting = true;
    try {
      await r.start();
    } catch {
      starting = false;
      rec = "idle";
      return toast("Sem acesso ao microfone. Autoriza-o nas definições do browser.");
    }
    starting = false;
    // The finger left while the browser asked for the microphone.
    if ((rec as string) === "idle") return r.cancel();
    recorder = r;
    levels = [];
    timer = window.setInterval(() => {
      recT = recorder?.elapsed ?? recT;
      if (recorder) levels = [...levels.slice(-199), recorder.level()];
      if (recT >= LIMITS.voiceMaxSeconds) void limitReached();
    }, 80);
  }
  async function limitReached() {
    clearInterval(timer);
    if (!recorder) return;
    const r = recorder;
    recorder = null;
    recorded = await r.stop();
    recT = recorded.durationS;
    rec = "locked";
    toast("Chegou a 1 minuto: gravação parada");
  }
  function cancelRec() {
    clearInterval(timer);
    recorder?.cancel();
    recorder = null;
    recorded = null;
    rec = "idle";
    recT = 0;
  }
  async function sendRec() {
    clearInterval(timer);
    if (starting) {
      rec = "idle";
      return;
    }
    const r = recorded ?? (recorder ? await recorder.stop() : null);
    recorder = null;
    recorded = null;
    rec = "idle";
    recT = 0;
    if (!r) return;
    if (r.durationS < 0.8) return toast("Nota demasiado curta. Mantém premido enquanto falas.");
    sending = true;
    const ok = await onsend({ body: "", voice: r, ...times(), isPrivate: owner && vis === "private" });
    sending = false;
    if (ok) reset();
  }
  // Phone: hold to record, slide left to lock, release to send.
  function micDown(e: PointerEvent) {
    if (desktop || rec !== "idle") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    holdX = e.clientX;
    void startRec(false);
  }
  function micMove(e: PointerEvent) {
    if (rec === "hold" && e.clientX - holdX < -60) rec = "locked";
  }
  function micUp() {
    if (rec === "hold") void sendRec();
  }
  $effect(() => () => cancelRec());

  const keep = (e: MouseEvent) => e.preventDefault();
</script>

<div class="composer-wrap">
  {#if editing}
    <div class="reply-banner">
      <span>{@html ICON.pencil}A editar a tua mensagem aos {stampText(editing)}</span>
      <button class="iconbtn sm" type="button" aria-label="Cancelar a edição" onmousedown={keep} onclick={() => oncanceledit?.()}>{@html ICON.close}</button>
    </div>
  {:else if replyTo}
    <div class="reply-banner">
      <span>{@html ICON.reply}{#if replyTo.self}A acrescentar à tua mensagem{:else}A responder a <b>{replyTo.name}</b>{/if} aos {stampText(replyTo.top)}</span>
      <button class="iconbtn sm" type="button" aria-label="Cancelar a resposta" onmousedown={keep} onclick={oncancelreply}>{@html ICON.close}</button>
    </div>
  {/if}
  <div class="composer" class:is-rec={rec !== "idle"}>
    <button class="tchip {fixed ? (fixed.tEnd !== null ? 'range' : 'start') : mode}" type="button" aria-label={chipLabel} disabled={!!fixed} onmousedown={keep} onclick={cycle}>{@html ICON.clock}<span>{chipText}</span></button>
    {#if owner && !editing}
      <button class="vis-toggle" class:is-public={vis === "public"} type="button" onmousedown={keep} onclick={toggleVis}
        aria-label={vis === "public" ? "Comentário público: os convidados veem. Mudar para nota privada." : "Nota privada: só tu vês. Mudar para comentário público."}>
        {@html vis === "public" ? ICON.eyeMd : ICON.lockMd}<span>{vis === "public" ? "Pública" : "Privada"}</span>
      </button>
    {/if}
    <input class="cinput" bind:this={input} bind:value={text} {placeholder} autocomplete="off" enterkeyhint="send" aria-label="Comentário" maxlength={LIMITS.commentMax}
      oninput={() => text && fixStart()} onkeydown={(e) => e.key === "Enter" && !e.isComposing && (e.preventDefault(), void sendText())} />
    {#if rec !== "idle"}
      <div class="reclayer">
        {#if rec === "locked"}<button class="cbtn trash" type="button" aria-label="Apagar gravação" onclick={cancelRec}>{@html ICON.trash}</button>{/if}
        <span class="recdot"></span><span class="mono">{fmtTime(recT)}</span>
        <span class="bars meter" aria-hidden="true" bind:clientWidth={barsW}>{#each { length: nBars } as _, i (i)}<i style="--h:{Math.round(10 + (levels[levels.length - nBars + i] ?? 0) * 90)}"></i>{/each}</span>
        {#if rec === "hold"}<span class="slide-hint">{@html ICON.back}bloquear</span>{/if}
      </div>
    {/if}
    {#if !text.trim() && rec !== "locked" && !editing}
      <button class="cbtn mic" class:is-holding={rec === "hold"} type="button" disabled={sending} aria-label={desktop ? "Gravar nota de voz" : "Mantém premido para gravar"}
        onpointerdown={micDown} onpointermove={micMove} onpointerup={micUp} onpointercancel={micUp} oncontextmenu={(e) => e.preventDefault()}
        onclick={() => desktop && rec === "idle" && void startRec(true)}>{@html ICON.mic}</button>
    {/if}
    {#if text.trim() && rec === "idle"}
      <button class="cbtn" type="button" aria-label="Enviar" disabled={sending} onmousedown={keep} onclick={sendText}>{@html ICON.send}</button>
    {/if}
    {#if rec === "locked"}
      <button class="cbtn" type="button" aria-label="Enviar nota de voz" disabled={sending} onclick={sendRec}>{@html ICON.send}</button>
    {/if}
  </div>
</div>

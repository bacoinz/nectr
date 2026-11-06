import { untrack } from "svelte";
import type { CommentDTO } from "../../shared/api-types";
import { fmtTime } from "../lib/format";
import { seek } from "../lib/player.svelte";
import { toast, toastError } from "../lib/toast.svelte";
import { askName, guest } from "./guest.svelte";
import type { CommentsSource, NewComment } from "./source";

// Comments of the open track: loaded once, then polled while the tab is visible
// (only what changed). Pages render them under the waveform (desktop) or in the
// "Comentários" tab (phone), with markers on the waveform.

const POLL_MS = 15_000;

export interface Thread {
  top: CommentDTO;
  replies: CommentDTO[];
  /** An open request from an earlier version, still to do. */
  carried: boolean;
}

/** A guest request: a top-level comment by a guest (has open/done). */
export const isRequest = (c: CommentDTO) => !c.parentId && c.author.kind === "guest";

/** What a version shows: its own threads plus requests still open from earlier versions. */
export function threadsFor(all: CommentDTO[], v: { id: string; number: number }): Thread[] {
  const tops = all.filter((c) => !c.parentId && (c.versionId === v.id || (isRequest(c) && c.status === "open" && c.versionNumber < v.number)));
  return tops
    .sort((a, b) => a.tStart - b.tStart || a.createdAt - b.createdAt)
    .map((top) => ({ top, replies: all.filter((r) => r.parentId === top.id).sort((a, b) => a.createdAt - b.createdAt), carried: top.versionId !== v.id }));
}

export const stampText = (c: Pick<CommentDTO, "tStart" | "tEnd">) => (c.tEnd !== null ? `${fmtTime(c.tStart)}–${fmtTime(c.tEnd)}` : fmtTime(c.tStart));

const AUTHOR_COLORS = ["#ff9fb2", "#8fd3ff", "#c9adff", "#9be7a6", "#ffc58f", "#7fe3e0", "#ffd36e", "#b6c3ff"];
export function authorColor(c: CommentDTO) {
  if (c.author.kind === "owner") return "var(--honey)";
  let h = 0;
  for (const ch of c.author.name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length]!;
}

export interface ReplyTarget {
  /** The thread's top comment (time and version come from it). */
  top: CommentDTO;
  /** Who is being answered, as shown in the banner. */
  name: string;
  /** Answering (adding to) your own last message. */
  self?: boolean;
}

/** A stretch of the song painted on the waveform: a range comment, or the one being chosen. */
export interface WaveRange {
  start: number;
  end: number;
  color: string;
  strong?: boolean;
}

/**
 * State and actions for a page's comments. `get` returns the source, the open
 * track and version, and `onchange` (owner: refresh counts after a change).
 */
export function useComments(get: () => { source: CommentsSource; trackId: string | null; version: { id: string; number: number } | null; onchange?: () => void }) {
  let byId = $state<Record<string, CommentDTO>>({});
  let since = 0;
  let loadedFor = $state("");
  const ui = $state({
    replyTo: null as ReplyTarget | null,
    focusId: null as string | null,
    /** "Comment here" from a long press on the waveform; n changes every time. */
    startAt: null as { t: number; n: number } | null,
    deleting: null as CommentDTO | null,
    /** One of your messages being edited in the composer. */
    editing: null as CommentDTO | null,
    /** The time being picked in the composer (start, or start–end). */
    draft: null as { start: number; end: number | null } | null,
    filter: "all" as "all" | "open",
  });

  async function load(full = false) {
    const { source, trackId } = get();
    if (!trackId) return;
    try {
      const r = await source.list(trackId, full ? undefined : since || undefined);
      if (get().trackId !== trackId) return;
      const next: Record<string, CommentDTO> = full ? {} : { ...byId };
      for (const c of r.comments) next[c.id] = c;
      for (const id of r.removed) delete next[id];
      for (const c of Object.values(next)) if (c.parentId && !next[c.parentId]) delete next[c.id];
      byId = next;
      since = r.now;
      loadedFor = trackId;
    } catch {
      /* the next poll tries again */
    }
  }

  $effect(() => {
    const { trackId } = get();
    untrack(() => {
      byId = {};
      since = 0;
      ui.replyTo = null;
      ui.editing = null;
      ui.focusId = null;
    });
    if (!trackId) return;
    void untrack(() => load(true));
    const tick = () => document.visibilityState === "visible" && void load();
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  });

  const all = $derived(Object.values(byId));
  const threads = $derived.by(() => {
    const v = get().version;
    return v ? threadsFor(all, v) : [];
  });
  const shown = $derived(ui.filter === "open" ? threads.filter((t) => isRequest(t.top) && t.top.status === "open") : threads);
  // Range comments stay marked on the waveform; the picked one (or the one being chosen) stands out.
  const ranges = $derived.by((): WaveRange[] => {
    const out: WaveRange[] = threads
      .filter((t) => t.top.tEnd !== null)
      .map((t) => ({ start: t.top.tStart, end: t.top.tEnd!, color: authorColor(t.top), strong: ui.focusId === t.top.id }));
    const d = ui.draft;
    if (d) out.push({ start: d.start, end: d.end ?? d.start, color: "var(--accent)", strong: true });
    return out;
  });

  const upsert = (c: CommentDTO) => (byId = { ...byId, [c.id]: c });

  async function send(m: Omit<NewComment, "versionId" | "parentId">): Promise<boolean> {
    const { source, version, onchange } = get();
    if (!version || source.readOnly) return false;
    if (ui.editing) {
      const e = ui.editing;
      try {
        upsert(await source.edit(e.id, m.body));
        ui.editing = null;
        ui.focusId = e.parentId ?? e.id;
        toast("Mensagem editada");
        return true;
      } catch (err) {
        toastError(err);
        return false;
      }
    }
    if (!source.owner && !guest.me && !(await askName("send"))) return false;
    const reply = ui.replyTo;
    try {
      const c = await source.create({ ...m, versionId: version.id, parentId: reply?.top.id ?? null });
      upsert(c);
      ui.replyTo = null;
      ui.focusId = c.parentId ?? c.id;
      const at = fmtTime(c.tStart);
      toast(source.owner && c.isPrivate ? "Nota privada guardada" : reply ? "Resposta enviada" : m.voice ? `Nota de voz enviada aos ${at}` : source.owner ? `Comentário público enviado aos ${at}` : `Comentário enviado aos ${at}`);
      onchange?.();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    }
  }

  async function toggle(c: CommentDTO) {
    const { source, onchange } = get();
    try {
      const next = await source.setStatus(c.id, { status: c.status === "open" ? "done" : "open" });
      upsert(next);
      toast(next.status === "done" ? `Feito em v${next.resolvedInNumber}` : "Reaberto");
      onchange?.();
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(c: CommentDTO) {
    const { source, onchange } = get();
    ui.deleting = null;
    try {
      await source.remove(c.id);
      const next = { ...byId };
      delete next[c.id];
      for (const r of Object.values(next)) if (r.parentId === c.id) delete next[r.id];
      byId = next;
      toast(c.parentId ? "Resposta apagada" : "Comentário apagado");
      onchange?.();
    } catch (e) {
      toastError(e);
    }
  }

  return {
    ui,
    get all() {
      return all;
    },
    get threads() {
      return threads;
    },
    /** Threads after the "Todos / Abertos" filter. */
    get shown() {
      return shown;
    },
    get ranges() {
      return ranges;
    },
    get loaded() {
      return loadedFor === get().trackId;
    },
    send,
    toggle,
    remove,
    /** Jump to a comment: the music goes there and the comment lights up. */
    focus(c: CommentDTO) {
      seek(c.tStart);
      ui.focusId = c.parentId ?? c.id;
    },
    reply(top: CommentDTO, to: CommentDTO) {
      ui.editing = null;
      ui.replyTo = { top, name: to.author.name, self: to.mine };
      ui.focusId = top.id;
    },
    edit(c: CommentDTO) {
      ui.replyTo = null;
      ui.editing = c;
      ui.focusId = c.parentId ?? c.id;
    },
    /** Long press on the waveform: start a comment at that point. */
    commentAt(t: number) {
      ui.replyTo = null;
      ui.startAt = { t, n: Date.now() };
    },
  };
}

export type CommentsState = ReturnType<typeof useComments>;

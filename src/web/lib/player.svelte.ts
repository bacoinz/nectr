// The app's player: one active audio element, plus (on a computer) the other
// versions of the open track kept loaded and following the playhead, so a
// version switch is instant and keeps the second (A/B without a button).
import { untrack } from "svelte";
import { plog, plogTick } from "./playerlog";

export interface Loaded {
  key: string;
  src: string;
  duration: number;
  title: string;
  artist: string;
  artwork: string | null;
  /** Where the mini player leads back to, and its accent colour. */
  href?: string;
  color?: string;
}

const VOLUME_KEY = "nectr.volume";
function savedVolume() {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

export const player = $state({
  key: "" as string,
  /** The slider's position, 0–1 (kept per device); the sound follows its square, as ears do. */
  volume: typeof window === "undefined" ? 1 : savedVolume(),
  muted: false,
  /** What is loaded (for the mini player). */
  item: null as Loaded | null,
  t: 0,
  duration: 0,
  playing: false,
  loop: false,
  /** True while the browser waits for data after a seek or a source change. */
  waiting: false,
  error: null as string | null,
});

let raf = 0;
let synced = 0;

function frame() {
  player.t = audio.currentTime;
  if (player.playing) raf = requestAnimationFrame(frame);
}

/** Volume and mute for one element (all of them share the player's). */
function level(a: HTMLAudioElement) {
  a.volume = player.volume ** 2;
  a.muted = player.muted;
}

/** Every element reports to the player only while it is the active one. */
function makeAudio(): HTMLAudioElement {
  const a = new Audio();
  a.preload = "metadata";
  level(a);
  const on = (type: string, fn: () => void) => a.addEventListener(type, () => a === audio && fn());
  // The diary (Perfil → Diagnóstico do leitor): what the playing element goes through.
  for (const ev of ["loadstart", "play", "playing", "pause", "waiting", "stalled", "suspend", "error", "ended", "emptied", "abort"]) on(ev, () => plog(ev, a));
  on("timeupdate", () => !a.paused && plogTick(a));
  on("play", () => {
    player.playing = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    sessionState();
  });
  on("pause", () => {
    player.playing = false;
    player.t = a.currentTime;
    sessionState();
  });
  on("seeked", sessionState);
  on("ratechange", sessionState);
  // rAF gives a smooth playhead while visible; timeupdate keeps time right when frames are throttled.
  on("timeupdate", () => {
    player.t = a.currentTime;
    if (Date.now() - synced > 2000) follow();
  });
  on("waiting", () => (player.waiting = true));
  on("playing", () => (player.waiting = false));
  on("canplay", () => (player.waiting = false));
  on("loadedmetadata", () => (Number.isFinite(a.duration) && (player.duration = a.duration), sessionState()));
  on("error", () => {
    player.playing = false;
    player.error = "Não foi possível tocar este ficheiro.";
  });
  // At the end: again (loop), else the next track of the list it was played from.
  on("ended", () => {
    if (player.loop) {
      a.currentTime = 0;
      void a.play();
    } else if (!step(1)) {
      player.playing = false;
      player.t = player.duration;
    }
  });
  return a;
}

let audio = typeof Audio !== "undefined" ? makeAudio() : (null as unknown as HTMLAudioElement);

// ---------- Other versions, kept ready ----------
/** What the open page wants ready (key → item), and the loaded elements for it. */
let wanted = new Map<string, Loaded>();
const pool = new Map<string, HTMLAudioElement>();

function release(a: HTMLAudioElement) {
  a.pause();
  a.removeAttribute("src");
  a.load();
}

/** The waiting versions follow the playhead, so the browser buffers where a switch would land. */
function follow(force = false) {
  synced = Date.now();
  for (const a of pool.values()) {
    if (force || Math.abs(a.currentTime - audio.currentTime) > 1.5) {
      try {
        a.currentTime = audio.currentTime;
      } catch {
        /* not ready yet */
      }
    }
  }
}

/**
 * Keeps these items loaded next to the active one (the other versions of the
 * open track). An empty list frees them. Computer only: on a phone it would
 * spend the listener's data.
 */
export function prepare(items: Loaded[]) {
  wanted = new Map(items.map((i) => [i.key, i]));
  for (const [k, a] of pool) if (!wanted.has(k)) (release(a), pool.delete(k));
  for (const it of items) {
    if (it.key === player.key || pool.has(it.key)) continue;
    const a = makeAudio();
    a.preload = "auto";
    a.src = it.src;
    try {
      a.currentTime = audio.currentTime;
    } catch {
      /* before metadata: starts at 0 */
    }
    pool.set(it.key, a);
  }
}

/**
 * Loads a source. `at` keeps the position (version switch); `play` continues
 * playback if it was playing.
 */
export function load(item: Loaded, opts: { at?: number; play?: boolean } = {}) {
  if (player.key === item.key && audio.src.endsWith(item.src)) {
    if (opts.play) play();
    return;
  }
  const resume = opts.play ?? player.playing;
  const at = opts.at ?? 0;
  const ready = pool.get(item.key);
  const old = audio;
  const oldKey = player.key;
  if (ready) {
    // A version kept ready: swap elements, nothing to wait for.
    pool.delete(item.key);
    audio = ready;
    old.pause();
    if (wanted.has(oldKey)) pool.set(oldKey, old);
    else release(old);
    if (Math.abs(audio.currentTime - at) > 0.05) audio.currentTime = at;
    if (Number.isFinite(audio.duration)) player.duration = audio.duration;
    player.playing = false; // the old element's pause event no longer reaches the player
  } else {
    if (wanted.has(oldKey) && oldKey) {
      // Keep the old version ready and start a fresh element for the new one.
      old.pause();
      pool.set(oldKey, old);
      audio = makeAudio();
      player.playing = false;
    }
    audio.src = item.src;
    if (at) audio.addEventListener("loadedmetadata", () => (audio.currentTime = Math.min(at, audio.duration || at)), { once: true });
  }
  plog(`carregar “${item.title}”`, null, ready ? "(já carregada)" : "");
  player.key = item.key;
  player.item = item;
  player.error = null;
  if (!ready) player.duration = item.duration;
  player.t = at;
  if (resume) void audio.play().catch(() => (player.playing = false));
  mediaSession(item);
}

// A play button in a list asks the page that opens next to start playing; a
// plain click on a track only opens it. The wish expires after a few seconds.
let wantAt = 0;
export const wantPlay = () => (wantAt = Date.now());
export function takeWantPlay() {
  const ok = Date.now() - wantAt < 4000;
  wantAt = 0;
  return ok;
}

// The tracks around the one playing (its folder, in order), for next/previous
// and for going on at the end. Set by the page that starts playback.
const queue = $state({ items: [] as Loaded[] });
export function setQueue(items: Loaded[]) {
  queue.items = items;
  // Untracked: pages call this from an effect, which must not come to depend on the queue.
  untrack(sessionActions);
}
function stepTo(d: number): Loaded | undefined {
  const i = queue.items.findIndex((q) => q.href === player.item?.href);
  return i < 0 ? undefined : queue.items[i + d];
}
function step(d: number): boolean {
  const to = stepTo(d);
  if (!to) return false;
  load(to, { at: 0, play: true });
  return true;
}
export const nextTrack = () => step(1);
export const prevTrack = () => step(-1);
/** Whether "next" has somewhere to go (reactive). */
export const hasNext = () => !!stepTo(1);

export function play() {
  void audio.play().catch((e: unknown) => {
    plog("o browser recusou tocar", audio, e instanceof Error ? e.name : String(e));
    player.playing = false;
  });
}
export function pause() {
  audio.pause();
}
export function toggle() {
  player.playing ? pause() : play();
}
export function seek(t: number) {
  const d = player.duration || audio.duration || 0;
  const to = Math.max(0, Math.min(d || t, t));
  audio.currentTime = to;
  player.t = to;
  follow(true);
}
export const skip = (dt: number) => seek(audio.currentTime + dt);

/** 0–1 from the volume slider; moving it up also brings the sound back. */
export function setVolume(v: number) {
  player.volume = Math.max(0, Math.min(1, v));
  if (player.volume > 0) player.muted = false;
  for (const a of [audio, ...pool.values()]) level(a);
  try {
    localStorage.setItem(VOLUME_KEY, String(player.volume));
  } catch {
    /* this visit only */
  }
}
export function toggleMute() {
  if (player.muted || player.volume === 0) {
    player.muted = false;
    // Unmuting at zero would stay silent: back to a useful level.
    if (player.volume === 0) return setVolume(0.6);
  } else player.muted = true;
  for (const a of [audio, ...pool.values()]) level(a);
}
export function stop() {
  prepare([]);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  player.key = "";
  player.item = null;
  player.t = 0;
}

// Lock-screen / notification / headset controls (Media Session API, no dependency):
// title, artist and cover; play/pause, ±10 s, the position bar, previous/next.
const hasSession = () => typeof navigator !== "undefined" && "mediaSession" in navigator;

function mediaSession(item: Loaded) {
  if (!hasSession()) return;
  // Covers are square, up to 1200 px; listing smaller sizes lets the system pick.
  const artwork = item.artwork ? ["192x192", "512x512", "1200x1200"].map((sizes) => ({ src: new URL(item.artwork!, location.href).href, sizes })) : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: "nectr", artwork });
  sessionActions();
  sessionState();
}

function setAction(a: MediaSessionAction, h: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(a, h);
  } catch {
    /* unsupported action */
  }
}

/** The buttons the system shows; next/previous only when there is somewhere to go. */
function sessionActions() {
  if (!hasSession()) return;
  setAction("play", () => (plog("notificação: ▶", audio), play()));
  setAction("pause", () => (plog("notificação: pausa", audio), pause()));
  setAction("stop", () => (plog("notificação: parar", audio), pause()));
  setAction("seekbackward", (d) => skip(-(d.seekOffset ?? 10)));
  setAction("seekforward", (d) => skip(d.seekOffset ?? 10));
  setAction("seekto", (d) => d.seekTime !== undefined && seek(d.seekTime));
  setAction("nexttrack", stepTo(1) ? () => void step(1) : null);
  // Previous: back to the start first (like other players), then the track before.
  setAction("previoustrack", stepTo(-1) ? () => (audio.currentTime > 3 ? seek(0) : void step(-1)) : () => seek(0));
}

/** Playing/paused and the position bar of the system player. */
function sessionState() {
  if (!hasSession() || !audio) return;
  navigator.mediaSession.playbackState = player.playing ? "playing" : "paused";
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(Math.max(0, audio.currentTime), d) });
  } catch {
    /* an older browser */
  }
}

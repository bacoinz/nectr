// A short diary of the player, kept on the device, for tracking down playback
// that stops in the background (Perfil → Diagnóstico do leitor). It records what
// the audio element went through and whether the page was in front or behind.

const KEY = "nectr.playerlog";
const MAX = 150;

let lastSuspend = 0;
let lastTick = 0;

function stamp() {
  const d = new Date();
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Seconds of audio loaded ahead of the playhead. */
function ahead(a: HTMLMediaElement) {
  const t = a.currentTime;
  for (let i = 0; i < a.buffered.length; i++) if (a.buffered.start(i) <= t + 0.5 && a.buffered.end(i) > t) return a.buffered.end(i) - t;
  return 0;
}

export function plog(event: string, a?: HTMLMediaElement | null, extra = "") {
  try {
    if (typeof localStorage === "undefined") return;
    const now = Date.now();
    // "suspend" fires whenever the browser stops fetching: keep one every 10 s.
    if (event === "suspend") {
      if (now - lastSuspend < 10_000) return;
      lastSuspend = now;
    }
    let state = "";
    if (a) {
      const err = a.error ? ` ERRO=${a.error.code}${a.error.message ? `:${a.error.message}` : ""}` : "";
      state = ` t=${a.currentTime.toFixed(1)}/${Number.isFinite(a.duration) ? a.duration.toFixed(0) : "?"} carregado=+${ahead(a).toFixed(0)}s rs=${a.readyState} ns=${a.networkState}${a.paused ? " parado" : ""}${err}`;
    }
    const where = typeof document !== "undefined" && document.visibilityState === "hidden" ? "[atrás]" : "[frente]";
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
    list.push(`${stamp()} ${where} ${event}${state}${extra ? ` ${extra}` : ""}`);
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* storage full or blocked: no diary */
  }
}

/** While playing, one line every 30 s shows whether time still moves. */
export function plogTick(a: HTMLMediaElement) {
  const now = Date.now();
  if (now - lastTick < 30_000) return;
  lastTick = now;
  plog("a tocar", a);
}

export function playerLog(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function clearPlayerLog() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

// The page's own life: in front, behind, frozen, offline.
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => plog(`página ${document.visibilityState === "hidden" ? "foi para trás" : "voltou à frente"}`));
  for (const ev of ["freeze", "resume"]) document.addEventListener(ev, () => plog(`página: ${ev}`));
  for (const ev of ["pagehide", "pageshow"]) addEventListener(ev, () => plog(`página: ${ev}`));
  addEventListener("online", () => plog("rede: online"));
  addEventListener("offline", () => plog("rede: offline"));
}

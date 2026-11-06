// Minimal History API router: exposes the current path and query reactively and
// turns same-origin <a> clicks into client-side navigation.

let path = $state(location.pathname);
let search = $state(location.search);

export const router = {
  get path() {
    return path;
  },
  get query() {
    return new URLSearchParams(search);
  },
};

function sync() {
  path = location.pathname;
  search = location.search;
}

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  sync();
}

/** Matches "/admin/projetos/:id" style patterns; returns the params or null. */
export function match(pattern: string, p = path): Record<string, string> | null {
  const a = pattern.split("/");
  const b = p.replace(/\/+$/, "").split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(":")) params[a[i]!.slice(1)] = decodeURIComponent(b[i]!);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

addEventListener("popstate", sync);

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest("a");
  if (!link || link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href);
  // API and media routes are served by the Worker, not the SPA.
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || /^\/s\/[^/]+\/(audio|download|artwork|api)\b/.test(url.pathname)) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
});

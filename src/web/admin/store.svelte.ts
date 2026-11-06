import type { ArtistResponse, LibraryResponse, MeResponse } from "../../shared/api-types";
import { admin, ApiError } from "../lib/api";

// Shared owner state: who is signed in, the library (rail tree, storage) and
// the artists opened in this session. Pages read from here and call refresh*
// after a mutation, so the rail and the page never disagree.

export const store = $state({
  me: null as MeResponse | null,
  library: null as LibraryResponse | null,
  artists: {} as Record<string, ArtistResponse>,
  /** Set when the Access session expired; the shell then offers a reload. */
  sessionExpired: false,
  /** The fold button's choice while the rail folds by itself (track page, narrow window); null = automatic. */
  railPref: null as boolean | null,
  /** The owner's choice everywhere else, kept per device. */
  railSaved: savedRail(),
  /** "Procurar" (Ctrl/⌘+K, /) and "Ajuda" (?) open over any page. */
  searchOpen: false,
  helpOpen: false,
});

function guard<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof ApiError && e.code === "session_expired") store.sessionExpired = true;
    throw e;
  });
}

export async function refreshMe() {
  store.me = await guard(admin.me());
}

export async function refreshLibrary() {
  store.library = await guard(admin.library());
}

export async function loadArtist(id: string, force = false): Promise<ArtistResponse> {
  if (!force && store.artists[id]) return store.artists[id]!;
  const a = await guard(admin.artist(id));
  store.artists[id] = a;
  return a;
}

/** Most mutations answer with the fresh artist; keep it and update the library around it. */
export function setArtist(a: ArtistResponse) {
  store.artists[a.artist.id] = a;
  void refreshLibrary().catch(() => {});
}

function savedRail(): "mini" | "full" {
  try {
    return localStorage.getItem("nectr.rail") === "mini" ? "mini" : "full";
  } catch {
    return "full";
  }
}

export function saveRail(mini: boolean) {
  store.railSaved = mini ? "mini" : "full";
  try {
    localStorage.setItem("nectr.rail", store.railSaved);
  } catch {
    /* this visit only */
  }
}

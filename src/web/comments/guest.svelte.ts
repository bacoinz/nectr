import type { GuestIdentity } from "../../shared/api-types";
import { api } from "../lib/api";

// The guest's name on this device, per link: asked once (when entering the link,
// or at the latest before the first comment) and kept in localStorage. The
// secret lets this device rename itself and delete its own comments.

export const guest = $state({
  token: "",
  me: null as GuestIdentity | null,
  /** The name card: on arrival, to change the name, or before sending a comment. */
  prompt: null as null | "welcome" | "rename" | "send",
});

const key = (token: string) => `nectr.guest.${token}`;

function read(token: string): GuestIdentity | null {
  try {
    const g = JSON.parse(localStorage.getItem(key(token)) ?? "null") as GuestIdentity | null;
    return g && typeof g.id === "string" && typeof g.secret === "string" ? g : null;
  } catch {
    return null;
  }
}
function save(g: GuestIdentity) {
  try {
    localStorage.setItem(key(guest.token), JSON.stringify(g));
  } catch {
    /* private mode: the name lasts this visit */
  }
}

/** Called once by the guest page. On a link that takes comments, the name comes first. */
export function initGuest(token: string, askOnArrival: boolean) {
  guest.token = token;
  guest.me = read(token);
  if (askOnArrival && !guest.me) guest.prompt = "welcome";
}

let waiting: ((ok: boolean) => void) | null = null;

/** Opens the name card; resolves true once there is a name. */
export function askName(mode: "rename" | "send"): Promise<boolean> {
  waiting?.(false);
  guest.prompt = mode;
  return new Promise((resolve) => (waiting = resolve));
}

export function closeName(ok: boolean) {
  // On arrival the name is required: there is no way around the card.
  if (!ok && guest.prompt === "welcome") return;
  guest.prompt = null;
  waiting?.(ok);
  waiting = null;
}

/** Creates the guest the first time, renames it afterwards (old comments follow). */
export async function saveName(name: string) {
  const S = `/s/${guest.token}/api/guest`;
  if (guest.me) {
    await api(S, { method: "PATCH", json: { name }, headers: { "X-Guest": `${guest.me.id}.${guest.me.secret}` } });
    guest.me = { ...guest.me, name };
  } else {
    guest.me = await api<GuestIdentity>(S, { method: "POST", json: { name } });
  }
  save(guest.me);
}

import { guest } from "../comments/guest.svelte";
import { pushState, refreshPush, type PushState, type PushTarget } from "../lib/push";
import { toast } from "../lib/toast.svelte";

// The bell on a shared link: whether this device gets notifications, the
// dialog, and one gentle offer after the guest's first message.

export function useAlerts(target: () => PushTarget | null) {
  const s = $state({ open: false, on: false, state: null as PushState | null });
  $effect(() => {
    const t = target();
    void guest.me; // a new name re-registers the device, so it hears about replies
    if (!t) return;
    void refreshPush(t)
      .catch(() => {})
      .then(() => pushState(t))
      .then((st) => ((s.state = st), (s.on = st === "on")));
  });
  return {
    get open() {
      return s.open;
    },
    set open(v: boolean) {
      s.open = v;
    },
    get on() {
      return s.on;
    },
    set on(v: boolean) {
      s.on = v;
    },
    /** The bell shows where notifications can work (or need the home screen, on an iPhone). */
    get available() {
      return !!s.state && s.state !== "unsupported" && s.state !== "unconfigured";
    },
    /** After a message is sent: offer notifications once per link and device. */
    offer() {
      const t = target();
      if (!t || s.state !== "off" || s.on) return;
      const key = `nectr.push.offered.${t.scope}`;
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, "1");
      } catch {
        return;
      }
      toast("Queres saber quando te responderem?", { label: "Avisar-me", run: () => (s.open = true) });
    },
  };
}

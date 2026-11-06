import { mount } from "svelte";
import App from "./App.svelte";
import { applyTheme } from "./lib/theme";
import { navigate } from "./router.svelte";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/mockup.css";
import "./styles/layout.css";

// Guest pages keep the dark theme; the owner's choice applies to the owner's pages.
if (!location.pathname.startsWith("/s/")) applyTheme();

mount(App, { target: document.getElementById("app")! });

// Installable app; it only keeps the app's own files, never audio (public/sw.js).
// A tapped notification moves an open window to what it is about (public/sw.js).
navigator.serviceWorker?.addEventListener("message", (e: MessageEvent<{ type?: string; url?: unknown }>) => {
  if (e.data?.type === "open" && typeof e.data.url === "string" && e.data.url.startsWith("/")) navigate(e.data.url);
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

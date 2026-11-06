// Dark by default (the approved design); the owner can choose light, or follow
// the system, in "Perfil". Kept per device.

export type ThemePref = "dark" | "light" | "auto";
const KEY = "nectr.theme";
const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: light)") : null;

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "auto" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(pref: ThemePref = getTheme()) {
  const light = pref === "light" || (pref === "auto" && !!mq?.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f5f3f8" : "#111014");
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* this visit only */
  }
  applyTheme(pref);
}

mq?.addEventListener("change", () => getTheme() === "auto" && applyTheme());

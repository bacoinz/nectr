<script lang="ts">
  import type { GuestGateDTO } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import { api, ApiError } from "../lib/api";
  import { ICON, LOGO } from "../lib/icons";
  import { projStyle } from "./guest";

  // Password page: only for links with a password. Stays valid 12 h on this device.
  let { token, gate, onunlocked }: { token: string; gate: GuestGateDTO; onunlocked: () => void } = $props();

  let password = $state("");
  let error = $state("");
  let busy = $state(false);

  // After too many wrong passwords the server says how long to wait; the lock lives
  // on the server (per connection), this only remembers it across reloads.
  // svelte-ignore state_referenced_locally
  const lockKey = `nectr.lock.${token}`;
  const readLock = () => {
    try {
      return Number(localStorage.getItem(lockKey)) || 0;
    } catch {
      return 0;
    }
  };
  let lockedUntil = $state(readLock());
  let nowMs = $state(Date.now());
  const wait = $derived(Math.max(0, Math.ceil((lockedUntil - nowMs) / 1000)));
  const counting = $derived(wait > 0);
  $effect(() => {
    if (!counting) return;
    const t = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!password || busy || wait) return;
    busy = true;
    error = "";
    try {
      await api(`/s/${token}/api/unlock`, { method: "POST", json: { password } });
      try {
        localStorage.removeItem(lockKey);
      } catch {
        /* storage blocked */
      }
      onunlocked();
    } catch (err) {
      const retry = err instanceof ApiError ? Number((err.body as { retryAfter?: number } | null)?.retryAfter) : 0;
      if (retry > 0) {
        lockedUntil = Date.now() + retry * 1000;
        nowMs = Date.now();
        try {
          localStorage.setItem(lockKey, String(lockedUntil));
        } catch {
          /* storage blocked */
        }
        error = (err as ApiError).message.startsWith("Password incorreta") ? "Password incorreta." : "";
      } else {
        error = err instanceof ApiError ? err.message : "Não foi possível entrar. Tenta outra vez.";
      }
      password = "";
    } finally {
      busy = false;
    }
  }
</script>

<div class="gate-page proj-scope" style={projStyle(gate.hero.color)}>
  <div class="gate" style="--proj:{gate.hero.color}">
    <div class="ph-brand">{@html LOGO(22)}nectr</div>
    <Art color={gate.hero.color} url={gate.hero.artworkUrl} icon={gate.hero.icon} seed={gate.hero.name} />
    <div><p class="ph-title">{gate.hero.name}</p>{#if gate.hero.subtitle}<p class="ph-by">{gate.hero.subtitle}</p>{/if}</div>
    <span class="lock">{@html ICON.lock} Este link está protegido</span>
    <form onsubmit={submit} style="max-width:340px">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" bind:value={password} disabled={wait > 0} autofocus />
      <button class="btn btn-primary" type="submit" disabled={busy || !password || wait > 0}>{wait ? `Espera ${mmss(wait)}` : "Entrar"}</button>
      {#if error}<p role="alert" style="color:var(--rec);font-size:13.5px">{error}</p>{/if}
      {#if wait}<p role="status" style="color:var(--rec);font-size:13.5px">Demasiadas tentativas. Podes tentar outra vez daqui a {mmss(wait)}.</p>{/if}
    </form>
    <p class="faint" style="font-size:13px">Pede a password a quem te enviou o link.</p>
  </div>
</div>

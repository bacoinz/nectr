<script lang="ts">
  import type { GuestGateDTO, GuestInfoDTO } from "../../shared/api-types";
  import LogoDefs from "../components/LogoDefs.svelte";
  import { api, ApiError } from "../lib/api";
  import { viewport } from "../lib/media.svelte";
  import { match, router } from "../router.svelte";
  import Gate from "./Gate.svelte";
  import GuestDesktop from "./GuestDesktop.svelte";
  import GuestMobile from "./GuestMobile.svelte";
  import { guestUrls } from "./guest";
  import { initGuest } from "../comments/guest.svelte";

  let { token }: { token: string } = $props();

  let info = $state<GuestInfoDTO | null>(null);
  let gate = $state<GuestGateDTO | null>(null);
  let failed = $state(false);

  async function fetchInfo() {
    try {
      info = await api<GuestInfoDTO>(`/s/${token}/api/info`);
      gate = null;
      // The name is asked when entering a link that takes comments, once per device.
      initGuest(token, info.link.allowComments);
      document.title = `${info.hero.name} · nectr`;
    } catch (e) {
      if (e instanceof ApiError && e.code === "password_required") gate = (e.body as { gate: GuestGateDTO }).gate;
      else failed = true;
    }
  }
  $effect(() => void fetchInfo());

  // /s/:token/t/:trackId opens a track, /s/:token/f/:folderId a folder; a track link always shows its track.
  const routeTrack = $derived(match("/s/:token/t/:trackId")?.trackId ?? null);
  const routeFolder = $derived(match("/s/:token/f/:folderId")?.folderId ?? null);
  const trackId = $derived(info ? (info.link.type === "track" ? (info.tracks[0]?.id ?? null) : routeTrack) : null);
  // svelte-ignore state_referenced_locally
  const urls = guestUrls(token);
</script>

<LogoDefs />
{#if failed}
  <div class="page-error"><h1>Este link não está disponível</h1><p>Pode ter expirado ou sido desativado. Pede um novo link a quem to enviou.</p></div>
{:else if gate}
  <Gate {token} {gate} onunlocked={fetchInfo} />
{:else if !info}
  <p class="page-loading">A carregar…</p>
{:else if !info.tracks.length}
  <div class="page-error"><h1>{info.hero.name}</h1><p>Ainda não há músicas neste link.</p></div>
{:else if viewport.phone}
  <GuestMobile {urls} {info} {trackId} folderId={routeFolder} versionId={router.query.get("v")} />
{:else}
  <GuestDesktop {urls} {info} {trackId} folderId={routeFolder} versionId={router.query.get("v")} />
{/if}

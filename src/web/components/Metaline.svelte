<script lang="ts">
  import type { GuestVersionDTO } from "../../shared/api-types";
  import { fmtDuration, fmtLabel, kHz, num } from "../lib/format";

  // Condensed file + loudness line. Loudness appears once it has been measured (Phase 3).
  let { v }: { v: GuestVersionDTO } = $props();
</script>

<div class="metaline">
  <span>{fmtLabel(v)}</span><i>·</i><span>{kHz(v.sampleRate)}</span><i>·</i><span>{v.channels === 1 ? "Mono" : "Estéreo"}</span>
  {#if v.format === "wav"}<i>·</i><span>{v.bitrateKbps} kbps</span>{/if}<i>·</i><span>{fmtDuration(v.durationS)}</span>
  {#if v.lufsIntegrated !== null}
    <b></b><span class="hl">{num(v.lufsIntegrated)} LUFS</span>
    {#if v.lufsRange !== null}<i>·</i><span>LRA {num(v.lufsRange)}</span>{/if}
    {#if v.truePeakDbtp !== null}<i>·</i><span class:warn={v.truePeakDbtp > -1}>TP {num(v.truePeakDbtp)} dBTP</span>{/if}
  {/if}
</div>

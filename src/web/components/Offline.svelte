<script lang="ts">
  // A quiet note while the device has no connection; it goes away by itself.
  let online = $state(typeof navigator === "undefined" ? true : navigator.onLine);
</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />

{#if !online}
  <div class="offline-note" role="status">Sem ligação à internet. O que já está a tocar continua; o resto volta quando a ligação voltar.</div>
{/if}

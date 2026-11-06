<script lang="ts">
  import AdminApp from "./admin/AdminApp.svelte";
  import Offline from "./components/Offline.svelte";
  import Toast from "./components/Toast.svelte";
  import GuestApp from "./guest/GuestApp.svelte";
  import Home from "./pages/Home.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import { router } from "./router.svelte";

  const isAdmin = $derived(router.path === "/admin" || router.path.startsWith("/admin/"));
  const token = $derived(/^\/s\/([A-Za-z0-9_-]{22})(\/|$)/.exec(router.path)?.[1] ?? null);
</script>

<svelte:boundary onerror={(e) => console.error(e)}>
  {#if router.path === "/"}
    <Home />
  {:else if isAdmin}
    <AdminApp />
  {:else if token}
    <GuestApp {token} />
  {:else}
    <NotFound />
  {/if}
  {#snippet failed(_error, reset)}
    <div class="page-error">
      <h1>Algo correu mal</h1>
      <p>Esta página teve um problema inesperado. Nada do que guardaste se perdeu.</p>
      <div class="actions">
        <button class="btn" type="button" onclick={reset}>Tentar outra vez</button>
        <button class="btn btn-primary" type="button" onclick={() => location.reload()}>Recarregar</button>
      </div>
    </div>
  {/snippet}
</svelte:boundary>
<Toast />
<Offline />

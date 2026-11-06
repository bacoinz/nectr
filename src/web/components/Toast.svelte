<script lang="ts">
  import { dismissToast, toasts } from "../lib/toast.svelte";
</script>

{#if toasts.current}
  {#key toasts.current.id}
    <div class="toast" role="status" aria-live="polite">
      <span>{toasts.current.message}</span>
      {#if toasts.current.action}
        {@const action = toasts.current.action}
        <!-- Read the action before dismissing: the toast (and this const) is gone afterwards. -->
        <button class="t-action" type="button" onclick={() => { const run = action.run; dismissToast(); run(); }}>{action.label}</button>
      {/if}
    </div>
  {/key}
{/if}

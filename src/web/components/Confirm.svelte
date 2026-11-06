<script lang="ts">
  let { title, body, confirm = "Apagar", danger = true, onconfirm, oncancel }: {
    title: string;
    body: string;
    confirm?: string;
    danger?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
  let ok = $state<HTMLButtonElement>();
  $effect(() => ok?.focus());
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && oncancel()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim is-opening" onclick={(e) => e.target === e.currentTarget && oncancel()}>
  <div class="dialog" role="alertdialog" aria-labelledby="cf-title" aria-describedby="cf-body" style="max-width:460px">
    <div class="dialog-head"><div><h2 class="title-md" id="cf-title">{title}</h2><p id="cf-body">{body}</p></div></div>
    <div class="dialog-foot">
      <button class="btn" type="button" onclick={oncancel}>Cancelar</button>
      <button class="btn" class:danger class:btn-primary={!danger} type="button" bind:this={ok} onclick={onconfirm}>{confirm}</button>
    </div>
  </div>
</div>

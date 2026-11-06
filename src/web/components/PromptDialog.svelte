<script lang="ts">
  import Dialog from "./Dialog.svelte";

  // A few text fields: a name, then optionally a second one-line field (a
  // track's DAW project name) and notes (a version's).
  let { title, subtitle = "", label, value = "", extraLabel = "", extra = "", extraHelp = "", notesLabel = "", notes = "", confirm = "Guardar", onsubmit, onclose }: {
    title: string;
    subtitle?: string;
    label: string;
    value?: string;
    extraLabel?: string;
    extra?: string;
    extraHelp?: string;
    notesLabel?: string;
    notes?: string;
    confirm?: string;
    onsubmit: (value: string, notes: string, extra: string) => Promise<void>;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let v = $state(value);
  // svelte-ignore state_referenced_locally
  let n = $state(notes);
  // svelte-ignore state_referenced_locally
  let x = $state(extra);
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      await onsubmit(v.trim(), n.trim(), x.trim());
      onclose();
    } catch {
      // the caller already showed the error
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {title} {subtitle} {onclose}>
  <form id="prompt-form" onsubmit={submit} style="display:flex;flex-direction:column;gap:16px">
    <div class="field"><label for="pd-value">{label}</label><input class="input" id="pd-value" bind:value={v} maxlength="120" autocomplete="off" /></div>
    {#if extraLabel}
      <div class="field">
        <label for="pd-extra">{extraLabel}</label><input class="input" id="pd-extra" bind:value={x} maxlength="120" autocomplete="off" />
        {#if extraHelp}<p class="help">{extraHelp}</p>{/if}
      </div>
    {/if}
    {#if notesLabel}
      <div class="field"><label for="pd-notes">{notesLabel}</label><textarea class="input" id="pd-notes" rows="3" maxlength="2000" bind:value={n}></textarea></div>
    {/if}
  </form>
  {#snippet footer()}
    <button class="btn" type="button" onclick={onclose}>Cancelar</button>
    <button class="btn btn-primary" type="submit" form="prompt-form" disabled={busy}>{confirm}</button>
  {/snippet}
</Dialog>

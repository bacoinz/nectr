<script lang="ts">
  import Dialog from "../components/Dialog.svelte";
  import ProfileContent from "./ProfileContent.svelte";

  let { onclose }: { onclose: () => void } = $props();
  let content = $state<ProfileContent>();
</script>

<Dialog title="Perfil e resumo" subtitle="O teu nome, a foto e o estado da app." {onclose} wide>
  <ProfileContent bind:this={content} onsaved={onclose} />
  {#snippet footer()}
    <button class="btn" type="button" onclick={onclose}>Fechar</button>
    <button class="btn btn-primary" type="button" onclick={() => content?.save()}>Guardar</button>
  {/snippet}
</Dialog>

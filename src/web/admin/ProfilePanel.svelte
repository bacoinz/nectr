<script lang="ts">
  import { LOGO } from "../lib/icons";
  import ProfileContent from "./ProfileContent.svelte";
  import { store } from "./store.svelte";

  // Owner on the phone: the profile is a tab instead of a dialog.
  let content = $state<ProfileContent>();
</script>

<section class="view is-entering" style="display:flex;flex-direction:column;gap:20px;min-height:100%">
  <h1 class="m-title">Perfil</h1>
  <ProfileContent bind:this={content} />
  <button class="btn btn-primary" type="button" onclick={() => content?.save()}>Guardar</button>
  <button class="btn" type="button" onclick={() => (store.helpOpen = true)}>Ajuda e atalhos</button>
  <div class="m-brandfoot"><div class="ph-brand">{@html LOGO(22)}nectr</div><span>Partilha e revisão de música</span></div>
</section>

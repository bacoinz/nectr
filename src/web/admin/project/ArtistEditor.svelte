<script lang="ts">
  import type { ArtistDTO, ArtistResponse } from "../../../shared/api-types";
  import { PROJECT_COLORS } from "../../../shared/constants";
  import Art from "../../components/Art.svelte";
  import Dialog from "../../components/Dialog.svelte";
  import { admin } from "../../lib/api";
  import { cropImage } from "../../lib/crop.svelte";
  import { toastError } from "../../lib/toast.svelte";

  let { artist, onsaved, onclose }: { artist: ArtistDTO; onsaved: (a: ArtistResponse) => void; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const d = $state({ name: artist.name, description: artist.description, color: artist.color });
  // svelte-ignore state_referenced_locally
  let photoUrl = $state(artist.photoUrl);
  let busy = $state(false);
  let file = $state<HTMLInputElement>();

  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    busy = true;
    try {
      const blob = await cropImage(f, 1200, { title: "Foto do artista" });
      if (!blob) return;
      const res = await admin.putArtistPhoto(artist.id, blob);
      photoUrl = res.artist.photoUrl;
      onsaved(res);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
      if (file) file.value = "";
    }
  }

  async function removePhoto() {
    busy = true;
    try {
      const res = await admin.deleteArtistPhoto(artist.id);
      photoUrl = null;
      onsaved(res);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    busy = true;
    try {
      onsaved(await admin.updateArtist(artist.id, { name: d.name.trim(), description: d.description.trim(), color: d.color }));
      onclose();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title="Editar artista" subtitle="A foto, o nome e a descrição aparecem também a quem abre um link do artista inteiro." {onclose}>
  <div class="pe-art">
    <Art color={d.color} url={photoUrl} seed={d.name} />
    <div class="actions">
      <button class="btn sm" type="button" disabled={busy} onclick={() => file?.click()}>{photoUrl ? "Mudar foto" : "Escolher foto"}</button>
      {#if photoUrl}<button class="linkbtn" type="button" disabled={busy} onclick={removePhoto}>Remover foto</button>{/if}
      <span class="faint" style="font-size:12.5px">JPG, PNG ou WebP. É reduzida para 1200 px antes de ser guardada.</span>
    </div>
    <input type="file" bind:this={file} accept="image/jpeg,image/png,image/webp" hidden onchange={pick} />
  </div>
  <form id="artist-form" onsubmit={save} style="display:flex;flex-direction:column;gap:18px">
    <div class="field"><label for="ae-name">Nome</label><input class="input" id="ae-name" bind:value={d.name} maxlength="120" required autocomplete="off" /></div>
    <div class="field">
      <label for="ae-desc">Descrição <span class="faint">(opcional)</span></label>
      <textarea class="input" id="ae-desc" rows="3" maxlength="2000" bind:value={d.description} placeholder="Uma linha sobre o artista"></textarea>
    </div>
    <div class="field">
      <span class="label">Cor do artista</span>
      <div class="swatches">
        {#each PROJECT_COLORS as c (c)}
          <button class="swatch" type="button" style="--sc:{c}" aria-pressed={c === d.color} aria-label="Cor {c}" onclick={() => (d.color = c)}></button>
        {/each}
      </div>
      <p class="help">Os projetos novos começam com esta cor.</p>
    </div>
  </form>
  {#snippet footer()}
    <button class="btn" type="button" onclick={onclose}>Cancelar</button>
    <button class="btn btn-primary" type="submit" form="artist-form" disabled={busy || !d.name.trim()}>Guardar</button>
  {/snippet}
</Dialog>

<script lang="ts">
  import type { ArtistResponse, TrackDTO } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import Dialog from "../components/Dialog.svelte";
  import { admin } from "../lib/api";
  import { cropImage } from "../lib/crop.svelte";
  import { toastError } from "../lib/toast.svelte";

  // A track's own cover (guests see it on the track and in the player); without
  // one, the track shows its project's.
  let { track, fallback, color, onsaved, onclose }: {
    track: TrackDTO;
    /** The project's cover (or the artist's photo), shown when the track has none. */
    fallback: string | null;
    color: string;
    onsaved: (r: ArtistResponse) => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let url = $state(track.artworkUrl);
  let busy = $state(false);
  let file = $state<HTMLInputElement>();

  async function run(task: () => Promise<ArtistResponse>) {
    busy = true;
    try {
      const r = await task();
      url = r.tracks.find((t) => t.id === track.id)?.artworkUrl ?? null;
      onsaved(r);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
      if (file) file.value = "";
    }
  }
  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    const blob = await cropImage(f, 1200, { title: "Capa da faixa" }).catch((err) => (toastError(err), null));
    if (blob) await run(() => admin.putTrackCover(track.id, blob));
    else if (file) file.value = "";
  }
</script>

<Dialog title="Capa da faixa" subtitle="“{track.title}”: quem ouve vê esta capa na faixa e no leitor. Sem capa própria, aparece a do projeto." {onclose}>
  <div class="pe-art">
    <Art {color} url={url ?? fallback} seed={track.title} cls={url ? "" : "is-fallback"} />
    <div class="actions">
      <button class="btn sm" type="button" disabled={busy} onclick={() => file?.click()}>{url ? "Mudar capa" : "Escolher capa"}</button>
      {#if url}<button class="linkbtn" type="button" disabled={busy} onclick={() => run(() => admin.deleteTrackCover(track.id))}>Remover capa</button>{/if}
      <span class="faint" style="font-size:12.5px">{url ? "Esta faixa tem capa própria." : "Agora mostra a capa do projeto."} JPG, PNG ou WebP; enquadras antes de guardar.</span>
    </div>
    <input type="file" bind:this={file} accept="image/jpeg,image/png,image/webp" hidden onchange={pick} />
  </div>
  {#snippet footer()}
    <button class="btn btn-primary" type="button" onclick={onclose}>Feito</button>
  {/snippet}
</Dialog>

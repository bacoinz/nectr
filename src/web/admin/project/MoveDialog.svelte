<script lang="ts">
  import type { ArtistResponse, FolderDTO } from "../../../shared/api-types";
  import Art from "../../components/Art.svelte";
  import Dialog from "../../components/Dialog.svelte";
  import { admin } from "../../lib/api";
  import { folderIcon } from "../../lib/icons";
  import { toast, toastError } from "../../lib/toast.svelte";
  import { folderSubtree, subfolders } from "./tree";

  let { a, trackIds, folderIds, onmoved, onclose }: { a: ArtistResponse; trackIds: string[]; folderIds: string[]; onmoved: (a: ArtistResponse) => void; onclose: () => void } = $props();

  // A folder cannot go inside itself or one of its subfolders.
  const blocked = $derived(new Set(folderIds.flatMap((id) => [...folderSubtree(a, id)])));
  const rows = $derived.by(() => {
    const out: { f: FolderDTO; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of subfolders(a, parent)) {
        if (blocked.has(f.id)) continue;
        out.push({ f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  let busy = $state(false);
  async function move(to: string | null, label: string) {
    busy = true;
    try {
      onmoved(await admin.move(a.artist.id, { trackIds, folderIds, toFolderId: to }));
      toast(`Movido para ${label}`);
      onclose();
    } catch (e) {
      toastError(e);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title="Mover para…" subtitle={folderIds.length ? "Uma pasta levada para o artista passa a ser um projeto." : "Escolhe o projeto ou a pasta de destino."} {onclose}>
  <div class="share-options">
    <button class="share-option" type="button" disabled={busy} onclick={() => move(null, a.artist.name)}>
      <Art color={a.artist.color} url={a.artist.photoUrl} seed={a.artist.name} /><span><strong>{a.artist.name}</strong><span>{folderIds.length ? "Como projeto" : "Faixas soltas do artista"}</span></span>
    </button>
    {#each rows as { f, depth } (f.id)}
      <button class="share-option" type="button" disabled={busy} style="margin-left:{depth * 22}px;width:calc(100% - {depth * 22}px)" onclick={() => move(f.id, f.name)}>
        {#if f.parentId}<span class="ficon" style="--fc:{f.color}">{@html folderIcon(f.icon)}</span>{:else}<Art color={f.color} url={f.artworkUrl} seed={f.name} />{/if}
        <span><strong>{f.name}</strong><span>{f.parentId ? "Pasta" : `Projeto${f.year ? ` · ${f.year}` : ""}`}</span></span>
      </button>
    {/each}
  </div>
</Dialog>

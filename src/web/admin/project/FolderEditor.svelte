<script lang="ts">
  import type { FolderDTO } from "../../../shared/api-types";
  import { FOLDER_COLORS, FOLDER_ICONS } from "../../../shared/constants";
  import Dialog from "../../components/Dialog.svelte";
  import { admin } from "../../lib/api";
  import { plural } from "../../lib/format";
  import { FOLDER_ICON_SVG, folderIcon } from "../../lib/icons";
  import { toastError } from "../../lib/toast.svelte";

  let { artistId, folder = null, parentId = null, trackCount = 0, onsaved, ondelete, onclose }: {
    artistId: string;
    folder?: FolderDTO | null;
    parentId?: string | null;
    trackCount?: number;
    onsaved: () => void;
    ondelete?: () => void;
    onclose: () => void;
  } = $props();

  // A draft copy of the folder being edited; the props are read once on open.
  // svelte-ignore state_referenced_locally
  let name = $state(folder?.name ?? "Nova pasta");
  // svelte-ignore state_referenced_locally
  let icon = $state(folder?.icon ?? "folder");
  // svelte-ignore state_referenced_locally
  let color = $state(folder?.color ?? FOLDER_COLORS[3]);
  let busy = $state(false);

  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    busy = true;
    try {
      if (folder) await admin.updateFolder(folder.id, { name: name.trim(), icon, color });
      else await admin.createFolder(artistId, { name: name.trim(), parentId, icon, color });
      onsaved();
      onclose();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title={folder ? "Editar pasta" : "Nova pasta"} subtitle="Dentro de um projeto, para demos, versões ao vivo ou o que quiseres partilhar em separado." {onclose}>
  <div class="fpreview">
    <span class="ficon" style="--fc:{color}">{@html folderIcon(icon)}</span>
    <div><strong>{name || "Sem nome"}</strong><span class="faint" style="font-size:13px">{plural(trackCount, "faixa", "faixas")}</span></div>
  </div>
  <form id="folder-form" onsubmit={save} class="field">
    <label for="fe-name">Nome</label>
    <input class="input" id="fe-name" bind:value={name} maxlength="120" autocomplete="off" onfocus={(e) => e.currentTarget.select()} />
  </form>
  <div class="field">
    <span class="label">Ícone</span>
    <div class="icon-grid" style="--fc:{color}">
      {#each FOLDER_ICONS as k (k)}
        <button type="button" aria-pressed={k === icon} aria-label={FOLDER_ICON_SVG[k]![0]} title={FOLDER_ICON_SVG[k]![0]} onclick={() => (icon = k)}>{@html folderIcon(k)}</button>
      {/each}
    </div>
  </div>
  <div class="field">
    <span class="label">Cor</span>
    <div class="swatches">
      {#each FOLDER_COLORS as c (c)}
        <button class="swatch" type="button" style="--sc:{c}" aria-pressed={c === color} aria-label="Cor {c}" onclick={() => (color = c)}></button>
      {/each}
    </div>
  </div>
  {#snippet footer()}
    {#if folder && ondelete}<button class="btn" type="button" style="margin-right:auto" onclick={() => (onclose(), ondelete())}>Apagar pasta</button>{/if}
    <button class="btn" type="button" onclick={onclose}>Cancelar</button>
    <button class="btn btn-primary" type="submit" form="folder-form" disabled={busy || !name.trim()}>{folder ? "Guardar" : "Criar pasta"}</button>
  {/snippet}
</Dialog>

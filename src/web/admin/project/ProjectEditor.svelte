<script lang="ts">
  import type { FolderDTO } from "../../../shared/api-types";
  import { FOLDER_ICONS, KIND_ICONS, PROJECT_COLORS, PROJECT_KINDS } from "../../../shared/constants";
  import Art from "../../components/Art.svelte";
  import Dialog from "../../components/Dialog.svelte";
  import { admin } from "../../lib/api";
  import { cropImage } from "../../lib/crop.svelte";
  import { FOLDER_ICON_SVG, folderIcon } from "../../lib/icons";
  import { KIND_LABEL, type Kind } from "../../lib/kinds";
  import { toastError } from "../../lib/toast.svelte";

  // A project: the artist's top-level folder. A release (album, EP, single) has a
  // cover, year and label; a working project (WIP, live, other) an icon, like the
  // folders inside. Without `project` it creates one.
  let { artistId, project = null, defaultColor, onsaved, onclose }: {
    artistId: string;
    project?: FolderDTO | null;
    defaultColor: string;
    onsaved: (created?: FolderDTO) => void | Promise<void>;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const d = $state({
    kind: (project?.kind ?? "release") as Kind,
    name: project?.name ?? "",
    year: project?.year ? String(project.year) : String(new Date().getFullYear()),
    label: project?.label ?? "",
    description: project?.description ?? "",
    color: project?.color ?? defaultColor,
    icon: project?.icon ?? "disc",
  });
  const release = $derived(d.kind === "release");
  // Switching kind brings that kind's icon, unless one was picked by hand.
  function pickKind(k: Kind) {
    if (d.icon === KIND_ICONS[d.kind]) d.icon = KIND_ICONS[k];
    d.kind = k;
  }
  // svelte-ignore state_referenced_locally
  let artworkUrl = $state(project?.artworkUrl ?? null);
  let busy = $state(false);
  let file = $state<HTMLInputElement>();

  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f || !project) return;
    busy = true;
    try {
      const blob = await cropImage(f, 1200, { title: "Capa do projeto" });
      if (!blob) return;
      // A cover only shows on a release: save the kind first if it just changed.
      if (project.kind !== "release") await admin.updateFolder(project.id, { kind: "release" });
      const res = await admin.putCover(project.id, blob);
      artworkUrl = res.folders.find((x) => x.id === project!.id)?.artworkUrl ?? null;
      await onsaved();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
      if (file) file.value = "";
    }
  }

  async function removeCover() {
    if (!project) return;
    busy = true;
    try {
      await admin.deleteCover(project.id);
      artworkUrl = null;
      await onsaved();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    const year = release && d.year.trim() ? Number(d.year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) return toastError(new Error("O ano tem de ser entre 1900 e 2100."));
    const fields = {
      kind: d.kind,
      name: d.name.trim(),
      description: d.description.trim(),
      color: d.color,
      icon: release ? KIND_ICONS.release : d.icon,
      ...(release ? { year, label: d.label.trim() } : {}),
    };
    busy = true;
    try {
      if (project) {
        await admin.updateFolder(project.id, fields);
        await onsaved();
      } else {
        await onsaved(await admin.createFolder(artistId, { ...fields, parentId: null }));
      }
      onclose();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  const SUBTITLE: Record<Kind, string> = {
    release: "Um álbum, um EP ou um single, com capa. Os detalhes aparecem também a quem abre os links.",
    wip: "Músicas em curso: aparece com um ícone, separada dos álbuns e EPs.",
    live: "Um projeto ao vivo: aparece com um ícone, separado dos álbuns e EPs.",
    other: "Uma pasta de trabalho com o que quiseres, separada dos álbuns e EPs.",
  };
</script>

<Dialog title={project ? "Editar projeto" : "Novo projeto"} subtitle={SUBTITLE[d.kind]} {onclose}>
  <div class="field">
    <span class="label">Tipo</span>
    <div class="seg kind-seg" role="group" aria-label="Tipo de projeto">
      {#each PROJECT_KINDS as k (k)}<button type="button" aria-pressed={d.kind === k} onclick={() => pickKind(k)}>{KIND_LABEL[k]}</button>{/each}
    </div>
  </div>
  {#if release}
    <div class="pe-art">
      <Art color={d.color} url={artworkUrl} seed={d.name || "projeto"} />
      <div class="actions">
        {#if project}
          <button class="btn sm" type="button" disabled={busy} onclick={() => file?.click()}>{artworkUrl ? "Mudar capa" : "Escolher capa"}</button>
          {#if artworkUrl}<button class="linkbtn" type="button" disabled={busy} onclick={removeCover}>Remover capa</button>{/if}
          <span class="faint" style="font-size:12.5px">JPG, PNG ou WebP. Enquadras antes de guardar (fica quadrada, até 1200 px).</span>
        {:else}
          <span class="faint" style="font-size:12.5px">A capa escolhe-se depois de criares o projeto.</span>
        {/if}
      </div>
      <input type="file" bind:this={file} accept="image/jpeg,image/png,image/webp" hidden onchange={pick} />
    </div>
  {:else}
    <div class="field">
      <span class="label">Ícone</span>
      <div class="icon-grid" style="--fc:{d.color}">
        {#each FOLDER_ICONS as k (k)}
          <button type="button" aria-pressed={k === d.icon} aria-label={FOLDER_ICON_SVG[k]![0]} title={FOLDER_ICON_SVG[k]![0]} onclick={() => (d.icon = k)}>{@html folderIcon(k)}</button>
        {/each}
      </div>
    </div>
  {/if}
  <form id="project-form" onsubmit={save} style="display:flex;flex-direction:column;gap:18px">
    <div class="field"><label for="pe-name">Nome</label><input class="input" id="pe-name" bind:value={d.name} maxlength="120" required autocomplete="off" placeholder={release ? "Ex.: Maré Alta" : "Ex.: Ideias 2026"} /></div>
    {#if release}
      <div class="row2">
        <div class="field"><label for="pe-year">Ano</label><input class="input" id="pe-year" bind:value={d.year} inputmode="numeric" maxlength="4" autocomplete="off" /></div>
        <div class="field"><label for="pe-label">Editora <span class="faint">(opcional)</span></label><input class="input" id="pe-label" bind:value={d.label} maxlength="120" autocomplete="off" /></div>
      </div>
    {/if}
    <div class="field">
      <label for="pe-desc">Descrição <span class="faint">(aparece nos links)</span></label>
      <textarea class="input" id="pe-desc" rows="3" maxlength="2000" bind:value={d.description} placeholder={release ? "Créditos, notas para quem ouve, contexto do disco…" : "O que há aqui, para quem ouve…"}></textarea>
    </div>
    <div class="field">
      <span class="label">Cor do projeto</span>
      <div class="swatches">
        {#each PROJECT_COLORS as c (c)}
          <button class="swatch" type="button" style="--sc:{c}" aria-pressed={c === d.color} aria-label="Cor {c}" onclick={() => (d.color = c)}></button>
        {/each}
      </div>
      <p class="help">Dá o tom ao cabeçalho, à waveform e à página de quem ouve.</p>
    </div>
  </form>
  {#snippet footer()}
    <button class="btn" type="button" onclick={onclose}>Cancelar</button>
    <button class="btn btn-primary" type="submit" form="project-form" disabled={busy || !d.name.trim()}>{project ? "Guardar" : "Criar projeto"}</button>
  {/snippet}
</Dialog>

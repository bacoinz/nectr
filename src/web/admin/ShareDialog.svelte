<script lang="ts">
  import type { ArtistResponse, LinkDTO, LinkTargetType, VersionMode } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import Dialog from "../components/Dialog.svelte";
  import { admin } from "../lib/api";
  import { inkFor, plural } from "../lib/format";
  import { folderIcon, ICON } from "../lib/icons";
  import { toast, toastError } from "../lib/toast.svelte";
  import { projectOf, projectsOf, tracksUnder } from "./project/tree";

  // What is shared depends on where "Partilhar" was clicked: a track (or its
  // project), a project or folder, or the whole artist.
  type Scope = "artist" | "folder" | "track";
  let { a, context, onclose }: { a: ArtistResponse; context: { type: Scope; id: string }; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const track = context.type === "track" ? a.tracks.find((t) => t.id === context.id) : undefined;
  // svelte-ignore state_referenced_locally
  const trackProject = track ? projectOf(a, track.folderId) : null;
  // svelte-ignore state_referenced_locally
  let scope = $state<Scope>(context.type);

  const folderOf = (sc: Scope) => (sc === "folder" ? a.folders.find((x) => x.id === (context.type === "folder" ? context.id : trackProject?.id)) : undefined);
  function describe(sc: Scope) {
    if (sc === "track" && track) return { kind: "track" as LinkTargetType, id: track.id, name: track.title, sub: `Faixa · ${plural(track.versions.length, "versão", "versões")}` };
    const f = folderOf(sc);
    if (f) {
      const n = plural(tracksUnder(a, f.id).length, "faixa", "faixas");
      return f.parentId ? { kind: "folder" as LinkTargetType, id: f.id, name: f.name, sub: `Pasta inteira · ${n}` } : { kind: "project" as LinkTargetType, id: f.id, name: f.name, sub: `Projeto inteiro · ${n}` };
    }
    return { kind: "artist" as LinkTargetType, id: a.artist.id, name: a.artist.name, sub: `Artista inteiro · ${plural(projectsOf(a).length, "projeto", "projetos")} · ${plural(a.tracks.length, "faixa", "faixas")}` };
  }
  const target = $derived(describe(scope));
  // The accent follows the project being shared, or the artist.
  const color = $derived((scope === "artist" ? null : scope === "track" ? trackProject : (projectOf(a, folderOf(scope)?.id ?? null) ?? null))?.color ?? a.artist.color);

  let name = $state("");
  let password = $state("");
  let showPw = $state(false);
  let validity = $state<"none" | "7" | "30" | "date">("none");
  let until = $state("");
  let mode = $state<VersionMode>("latest");
  // svelte-ignore state_referenced_locally
  let picked = $state(new Set<string>(track ? track.versions.slice(0, 2).map((v) => v.id) : []));
  let allowDownload = $state(false);
  let showLyrics = $state(true);
  let allowComments = $state(true);
  let allowShare = $state(false);
  let busy = $state(false);
  let created = $state<LinkDTO | null>(null);

  let links = $state<LinkDTO[] | null>(null);
  $effect(() => {
    admin.links().then((r) => (links = r.links)).catch(() => (links = []));
  });
  const activeHere = $derived((links ?? []).filter((l) => l.status === "active" && l.target.type === target.kind && l.target.id === target.id).length);

  function expiresAt(): number | null {
    if (validity === "none") return null;
    if (validity === "date") return until ? new Date(`${until}T23:59:59`).getTime() : null;
    return Date.now() + Number(validity) * 86400_000;
  }

  async function create(e?: SubmitEvent) {
    e?.preventDefault();
    if (!name.trim()) return toast("Dá um nome ao link (por exemplo, para quem é).");
    if (validity === "date" && (!until || new Date(`${until}T23:59:59`).getTime() <= Date.now())) return toast("Escolhe uma data no futuro.");
    if (mode === "selected" && !picked.size) return toast("Escolhe pelo menos uma versão.");
    busy = true;
    try {
      created = await admin.createLink({
        target: { type: scope, id: target.id },
        name: name.trim(),
        password: password || undefined,
        expiresAt: expiresAt(),
        versionMode: scope === "track" ? mode : mode === "selected" ? "latest" : mode,
        versionIds: mode === "selected" ? [...picked] : undefined,
        allowDownload,
        showLyrics,
        allowComments,
        allowShare,
      });
      links = [...(links ?? []), created];
      await copy();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  const fullUrl = $derived(created ? `${location.origin}${created.path}` : "");
  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast("Link copiado");
    } catch {
      toast("Seleciona o link e copia à mão.");
    }
  }
  const projStyle = $derived(`--proj-main:${color};--proj-ink:${inkFor(color)}`);
</script>

{#snippet targetArt(sc: Scope)}
  {@const f = sc === "folder" ? folderOf(sc) : sc === "track" ? trackProject : null}
  {#if f && f.parentId}
    <span class="ficon" style="--fc:{f.color}">{@html folderIcon(f.icon)}</span>
  {:else if f}<Art color={f.color} url={f.artworkUrl} seed={f.name} />
  {:else}<Art color={a.artist.color} url={a.artist.photoUrl} seed={a.artist.name} />{/if}
{/snippet}

<div class="proj-scope" style={projStyle}>
  <Dialog title="Partilhar “{target.name}”" subtitle="Quem tiver o link ouve sem criar conta." {onclose}>
    <form id="share-form" onsubmit={create} style="display:flex;flex-direction:column;gap:18px">
      <div class="field">
        <label for="link-name">Nome do link <span class="faint">(só tu vês)</span></label>
        <input class="input" id="link-name" bind:value={name} maxlength="120" placeholder="Ex.: Editora, Marta, Rádio" autocomplete="off" disabled={!!created} />
      </div>
      <div class="field">
        {#if context.type === "track" && trackProject}
          <span class="label">O que partilhar</span>
          <div class="share-options">
            {#each ["track", "folder"] as const as sc (sc)}
              {@const o = describe(sc)}
              <button class="share-option" type="button" aria-pressed={scope === sc} disabled={!!created} onclick={() => ((scope = sc), sc !== "track" && mode === "selected" && (mode = "latest"))}>
                {@render targetArt(sc)}<span><strong>{o.name}</strong><span>{o.sub}</span></span>
              </button>
            {/each}
          </div>
        {:else}
          <span class="label">Vais partilhar</span>
          <div class="share-what">{@render targetArt(scope)}<div><strong>{target.name}</strong><span>{target.sub}</span></div></div>
        {/if}
      </div>
      <div class="field">
        <span class="label">Versões visíveis</span>
        <div class="seg">
          <button type="button" aria-pressed={mode === "all"} onclick={() => (mode = "all")} disabled={!!created}>Todas</button>
          <button type="button" aria-pressed={mode === "latest"} onclick={() => (mode = "latest")} disabled={!!created}>Só a mais recente</button>
          {#if scope === "track"}<button type="button" aria-pressed={mode === "selected"} onclick={() => (mode = "selected")} disabled={!!created}>Escolher</button>{/if}
        </div>
        {#if scope === "track" && mode === "selected"}
          <div class="pick">
            {#each track!.versions as v (v.id)}
              <label><input type="checkbox" checked={picked.has(v.id)} disabled={!!created} onchange={(e) => { const next = new Set(picked); e.currentTarget.checked ? next.add(v.id) : next.delete(v.id); picked = next; }} /> v{v.number}{v.label ? ` · ${v.label}` : ""}</label>
            {/each}
          </div>
        {/if}
        <p class="help">
          {#if mode === "selected"}Só as versões escolhidas; as novas não aparecem até as juntares.
          {:else if scope === "track"}As versões novas desta faixa aparecem automaticamente.
          {:else}As faixas e versões novas {target.kind === "folder" ? "desta pasta" : target.kind === "project" ? "deste projeto" : "do artista"} aparecem automaticamente.{/if}
        </p>
      </div>
      <div class="row2">
        <div class="field">
          <label for="link-pw">Password <span class="faint">(opcional)</span></label>
          <div class="pw">
            <input class="input mono" id="link-pw" type={showPw ? "text" : "password"} bind:value={password} placeholder="Sem password" autocomplete="new-password" maxlength="200" disabled={!!created} />
            <button class="linkbtn" type="button" onclick={() => (showPw = !showPw)}>{showPw ? "Esconder" : "Mostrar"}</button>
          </div>
        </div>
        <div class="field">
          <label for="link-exp">Validade</label>
          <select class="input" id="link-exp" bind:value={validity} disabled={!!created}>
            <option value="none">Sem validade</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="date">Até uma data…</option>
          </select>
          {#if validity === "date"}<input class="input" type="date" style="margin-top:8px" bind:value={until} min={new Date().toISOString().slice(0, 10)} disabled={!!created} />{/if}
        </div>
      </div>
      <div class="switches">
        <div class="switch-row">
          <strong>Permitir download</strong>
          <button class="switch" type="button" role="switch" aria-checked={allowDownload} aria-label="Permitir download" disabled={!!created} onclick={() => (allowDownload = !allowDownload)}></button>
          <p class="warnnote">{@html ICON.warn}Desativar downloads esconde o botão e impede o descarregamento direto, mas quem consegue ouvir consegue sempre gravar o áudio.</p>
        </div>
        <div class="switch-row">
          <strong>Mostrar letra</strong>
          <button class="switch" type="button" role="switch" aria-checked={showLyrics} aria-label="Mostrar letra" disabled={!!created} onclick={() => (showLyrics = !showLyrics)}></button>
          <p class="help">O ouvinte pode escondê-la no player.</p>
        </div>
        <div class="switch-row">
          <strong>Permitir comentários</strong>
          <button class="switch" type="button" role="switch" aria-checked={allowComments} aria-label="Permitir comentários" disabled={!!created} onclick={() => (allowComments = !allowComments)}></button>
          <p class="help">Texto ou notas de voz até 1 minuto. Desligado, o link fica só para ouvir.</p>
        </div>
        <div class="switch-row">
          <strong>Quem recebe pode partilhar</strong>
          <button class="switch" type="button" role="switch" aria-checked={allowShare} aria-label="Quem recebe pode partilhar" disabled={!!created} onclick={() => (allowShare = !allowShare)}></button>
          <p class="help">Uma faixa ou pasta deste link, num link novo sem download nem password, que acaba com este. Vês cada partilha em Links.</p>
        </div>
      </div>
      {#if links}
        <p class="muted" style="font-size:14px">
          {activeHere ? `${plural(activeHere, "link ativo", "links ativos")} para ${target.kind === "artist" ? "este artista" : target.kind === "project" ? "este projeto" : target.kind === "folder" ? "esta pasta" : "esta faixa"}.` : "Ainda não há links para isto."}
          <a href="/admin/links" onclick={onclose}>Gerir links</a>
        </p>
      {/if}
      {#if created}
        <div class="result"><code>{fullUrl}</code><button class="btn" type="button" onclick={copy}>{@html ICON.copy}Copiar</button></div>
      {/if}
    </form>
    {#snippet footer()}
      {#if created}
        <button class="btn" type="button" onclick={() => ((created = null), (name = ""), (password = ""))}>Criar outro</button>
        <button class="btn btn-primary" type="button" onclick={onclose}>Feito</button>
      {:else}
        <button class="btn" type="button" onclick={onclose}>Cancelar</button>
        <button class="btn btn-primary" type="submit" form="share-form" disabled={busy}>Criar link</button>
      {/if}
    {/snippet}
  </Dialog>
</div>


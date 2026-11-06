<script lang="ts">
  import Art from "../components/Art.svelte";
  import Dialog from "../components/Dialog.svelte";
  import { admin } from "../lib/api";
  import { ago, plural } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { toastError } from "../lib/toast.svelte";
  import { viewport } from "../lib/media.svelte";
  import { navigate } from "../router.svelte";
  import { refreshLibrary, setArtist, store } from "./store.svelte";

  const lib = $derived(store.library);
  const activityText = (k: string) => (k === "reply" ? "respondeu em" : k === "voice" ? "deixou uma nota de voz em" : "comentou em");
  const activityUrl = (a: { artistId: string; trackId: string; versionId: string; id: string }) => `/admin/artistas/${a.artistId}/faixas/${a.trackId}?v=${a.versionId}&c=${a.id}`;
  const totals = $derived(
    lib ? lib.artists.reduce((t, a) => ({ projects: t.projects + a.projectCount, tracks: t.tracks + a.trackCount, versions: t.versions + a.versionCount }), { projects: 0, tracks: 0, versions: 0 }) : null,
  );

  // ---------- The owner's order of the artists ----------
  // Computer: drag a card before or after another. Phone: "Ordenar" shows arrows.
  async function saveOrder(ids: string[]) {
    const l = store.library;
    if (!l) return;
    const before = l.artists;
    l.artists = ids.map((id) => before.find((a) => a.id === id)!);
    try {
      await admin.reorderArtists(ids);
    } catch (err) {
      toastError(err);
      void refreshLibrary();
    }
  }
  let dragId = $state<string | null>(null);
  let dropAt = $state<{ id: string; after: boolean } | null>(null);
  function dragStart(e: DragEvent, id: string) {
    dragId = id;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", id);
  }
  function dragOver(e: DragEvent, id: string) {
    if (!dragId) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = id === dragId ? null : { id, after: e.clientX > r.left + r.width / 2 };
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    if (lib && dragId && dropAt) {
      const ids = lib.artists.map((a) => a.id).filter((x) => x !== dragId);
      ids.splice(ids.indexOf(dropAt.id) + (dropAt.after ? 1 : 0), 0, dragId);
      void saveOrder(ids);
    }
    dragId = dropAt = null;
  }
  const dragEnd = () => (dragId = dropAt = null);
  let ordering = $state(false);
  function nudge(id: string, d: number) {
    if (!lib) return;
    const ids = lib.artists.map((a) => a.id);
    const i = ids.indexOf(id), j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void saveOrder(ids);
  }

  let creating = $state(false);
  let name = $state("");
  let busy = $state(false);
  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    busy = true;
    try {
      const a = await admin.createArtist(name.trim());
      setArtist(a);
      creating = false;
      navigate(`/admin/artistas/${a.artist.id}`);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
</script>

{#if viewport.phone}
  <section class="is-entering" style="padding-bottom:24px">
    <div class="m-head">
      <h2 class="m-title">Biblioteca</h2>
      <div class="m-actions">
        <button class="iconbtn sm" type="button" aria-label="Procurar" onclick={() => (store.searchOpen = true)}>{@html ICON.search}</button>
        {#if lib && lib.artists.length > 1}<button class="iconbtn sm" class:is-on={ordering} type="button" aria-pressed={ordering} aria-label={ordering ? "Acabar de ordenar" : "Ordenar artistas"} onclick={() => (ordering = !ordering)}>{@html ordering ? ICON.check : ICON.reorder}</button>{/if}
        <button class="btn icon-only sm" type="button" aria-label="Novo artista" onclick={() => ((name = ""), (creating = true))}>{@html ICON.plus}</button>
      </div>
    </div>
    {#if !lib}<p class="page-loading">A carregar…</p>
    {:else if !lib.artists.length}<p class="empty">Ainda não há artistas. Toca em + para criar o primeiro.</p>
    {:else}
      {#if ordering}<p class="faint" style="font-size:13px;margin:-4px 0 10px">Usa as setas para mudar a ordem; fica assim também no computador.</p>{/if}
      <div class="m-grid">
        {#each lib.artists as a, i (a.id)}
          {#if ordering}
            <div class="m-card is-ordering">
              <Art color={a.color} url={a.photoUrl} seed={a.name} />
              <span><strong>{a.name}</strong></span>
              <span class="order-btns">
                <button class="iconbtn sm" type="button" aria-label="Mover {a.name} para trás" disabled={i === 0} onclick={() => nudge(a.id, -1)}>{@html ICON.back}</button>
                <button class="iconbtn sm" type="button" aria-label="Mover {a.name} para a frente" disabled={i === lib.artists.length - 1} onclick={() => nudge(a.id, 1)}>{@html ICON.chev}</button>
              </span>
            </div>
          {:else}
            <a class="m-card" href="/admin/artistas/{a.id}" style="text-decoration:none">
              <Art color={a.color} url={a.photoUrl} seed={a.name} />
              <span><strong>{a.name}</strong><span>{plural(a.projectCount, "projeto", "projetos")}</span>{#if a.openRequests}<span class="pending">{a.openRequests} por rever</span>{/if}</span>
            </a>
          {/if}
        {/each}
      </div>
      {#if lib.activity.length}
        <div class="m-section">Atividade recente</div>
        {@render activity()}
      {/if}
    {/if}
  </section>
{:else}
<section class="view is-entering">
  <div class="view-head">
    <div>
      <h1 class="title-xl">Biblioteca</h1>
      {#if lib && totals}
        <p class="sub">{plural(lib.artists.length, "artista", "artistas")} · {plural(totals.projects, "projeto", "projetos")} · {plural(totals.tracks, "faixa", "faixas")} · {plural(totals.versions, "versão", "versões")}</p>
      {/if}
    </div>
    <div class="actions">
      <button class="btn btn-primary" type="button" onclick={() => ((name = ""), (creating = true))}>{@html ICON.plus}Novo artista</button>
    </div>
  </div>

  {#if !lib}
    <p class="page-loading">A carregar…</p>
  {:else if !lib.artists.length}
    <div class="panel empty" style="padding:48px 24px">
      <p style="font-size:16px;color:var(--fg);font-weight:700;margin-bottom:6px">Ainda não há artistas</p>
      <p>Cria um artista e, dentro dele, os projetos (álbuns, EPs, singles) com as músicas.</p>
    </div>
  {:else}
    <div class="lib-layout">
    <div class="grid-projects">
      {#each lib.artists as a (a.id)}
        <a class="project" class:is-dragging={dragId === a.id} class:drop-before={dropAt?.id === a.id && !dropAt.after} class:drop-after={dropAt?.id === a.id && dropAt.after}
          href="/admin/artistas/{a.id}" draggable="true" title="Arrasta para mudar a ordem"
          ondragstart={(e) => dragStart(e, a.id)} ondragover={(e) => dragOver(e, a.id)} ondrop={drop} ondragend={dragEnd}>
          <Art color={a.color} url={a.photoUrl} seed={a.name} />
          <div>
            <h3>{a.name}</h3>
            <p class="meta">{plural(a.projectCount, "projeto", "projetos")} · {plural(a.trackCount, "faixa", "faixas")}</p>
          </div>
          <p class="meta">{#if a.openRequests}<span class="pending">{a.openRequests} por rever</span>{/if}<span class="faint">Atualizado {ago(a.updatedAt)}</span></p>
        </a>
      {/each}
    </div>
    <aside class="panel">
      <div class="activity" style="padding-bottom:4px"><h2>Atividade recente</h2></div>
      {#if lib.activity.length}{@render activity()}{:else}<p class="empty" style="padding:6px 18px 20px;text-align:left">Os comentários dos clientes aparecem aqui.</p>{/if}
    </aside>
    </div>
  {/if}
</section>
{/if}

{#snippet activity()}
  <div class="activity" style="padding-top:4px">
    {#each lib!.activity as a (a.id)}
      <a class="act" href={activityUrl(a)} style="text-decoration:none;color:inherit">
        <span class="dot"></span>
        <p><b>{a.author}</b> {activityText(a.kind)} <b>{a.trackTitle} · v{a.versionNumber}</b><span class="when">{a.artistName} · {ago(a.createdAt)}</span></p>
      </a>
    {/each}
  </div>
{/snippet}

{#if creating}
  <Dialog title="Novo artista" subtitle="Depois crias os projetos dele (álbuns, EPs, singles). A foto e a descrição podem ficar para depois." onclose={() => (creating = false)}>
    <form id="new-artist" onsubmit={create} style="display:flex;flex-direction:column;gap:14px">
      <div class="field"><label for="na-name">Nome do artista</label><input id="na-name" class="input" bind:value={name} maxlength="120" required autocomplete="off" /></div>
    </form>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (creating = false)}>Cancelar</button>
      <button class="btn btn-primary" type="submit" form="new-artist" disabled={busy || !name.trim()}>Criar artista</button>
    {/snippet}
  </Dialog>
{/if}

<script lang="ts">
  import type { CommentDTO, RevisionsResponse, RevisionTrackDTO } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import { stampText } from "../comments/comments.svelte";
  import Composer from "../comments/Composer.svelte";
  import type { NewComment } from "../comments/source";
  import { viewport } from "../lib/media.svelte";
  import { ownerSource } from "../comments/source";
  import VoiceNote from "../comments/VoiceNote.svelte";
  import { api } from "../lib/api";
  import { ago } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { toast, toastError } from "../lib/toast.svelte";
  import { navigate } from "../router.svelte";
  import { refreshLibrary } from "./store.svelte";

  // "Revisões": every client request, grouped by track, like a checklist.
  // A tick marks it done in the newest version (or the one picked); the time opens the track there.
  let data = $state<RevisionsResponse | null>(null);
  let filter = $state<"open" | "closed" | "all">("open");
  $effect(() => {
    api<RevisionsResponse>("/api/admin/revisions").then((r) => (data = r)).catch(toastError);
  });

  const items = $derived(data?.items ?? []);
  const counts = $derived({ open: items.filter((c) => c.status === "open").length, closed: items.filter((c) => c.status === "done").length, all: items.length });
  const keep = (c: CommentDTO) => filter === "all" || (filter === "open" ? c.status === "open" : c.status === "done");
  // Groups follow the latest request; inside a group, the song's order.
  const groups = $derived(
    (data?.tracks ?? [])
      .map((t) => {
        const all = items.filter((c) => c.trackId === t.id);
        return { t, all, shown: all.filter(keep).sort((a, b) => a.tStart - b.tStart), last: Math.max(...all.map((c) => c.createdAt)) };
      })
      .filter((g) => g.shown.length)
      .sort((a, b) => b.last - a.last),
  );

  function replace(c: CommentDTO) {
    if (data) data = { ...data, items: data.items.map((x) => (x.id === c.id ? c : x)) };
    void refreshLibrary().catch(() => {});
  }
  async function toggle(c: CommentDTO) {
    try {
      const next = await ownerSource.setStatus(c.id, { status: c.status === "open" ? "done" : "open" });
      replace(next);
      toast(next.status === "done" ? `Feito em v${next.resolvedInNumber}` : "Reaberto", {
        label: "Anular",
        run: () => void ownerSource.setStatus(c.id, c.status === "open" ? { status: "open" } : { status: "done", resolvedInVersionId: c.resolvedInVersionId ?? undefined }).then(replace).catch(toastError),
      });
    } catch (e) {
      toastError(e);
    }
  }
  async function resolvedIn(c: CommentDTO, versionId: string) {
    try {
      replace(await ownerSource.setStatus(c.id, { status: "done", resolvedInVersionId: versionId }));
    } catch (e) {
      toastError(e);
    }
  }
  // Answering a request right here: the reply joins its conversation.
  let replying = $state<string | null>(null);
  const repliesOf = (c: CommentDTO) => (data?.replies ?? []).filter((r) => r.parentId === c.id);
  async function sendReply(c: CommentDTO, m: Omit<NewComment, "versionId" | "parentId">) {
    try {
      const r = await ownerSource.create({ ...m, versionId: c.versionId, parentId: c.id });
      if (data) data = { ...data, replies: [...data.replies, r] };
      replying = null;
      toast(r.isPrivate ? "Nota privada guardada" : "Resposta enviada");
      return true;
    } catch (e) {
      toastError(e);
      return false;
    }
  }

  const open = (c: CommentDTO, t: RevisionTrackDTO) => navigate(`/admin/artistas/${t.artistId}/faixas/${t.id}?v=${c.versionId}&t=${c.tStart}&c=${c.id}`);
  const where = (t: RevisionTrackDTO) => [t.artistName, t.projectName, t.folderName, `${t.versions.length} ${t.versions.length === 1 ? "versão" : "versões"}`].filter(Boolean).join(" · ");
</script>

<section class="view is-entering">
  <div class="view-head">
    <div>
      <h1 class="title-xl">Revisões</h1>
      <p class="sub">Pedidos dos clientes, por faixa. Clica no tempo para ouvir esse ponto.</p>
    </div>
    <div class="filters">
      <button class="fchip" type="button" aria-pressed={filter === "open"} onclick={() => (filter = "open")}>Abertos<span>{counts.open}</span></button>
      <button class="fchip" type="button" aria-pressed={filter === "closed"} onclick={() => (filter = "closed")}>Resolvidos<span>{counts.closed}</span></button>
      <button class="fchip" type="button" aria-pressed={filter === "all"} onclick={() => (filter = "all")}>Todos<span>{counts.all}</span></button>
    </div>
  </div>

  {#if !data}
    <p class="page-loading">A carregar…</p>
  {:else}
    {#each groups as g (g.t.id)}
      {@const closed = g.all.filter((c) => c.status === "done").length}
      <section class="panel rgroup">
        <div class="rgroup-head">
          <Art color={g.t.color} url={g.t.artworkUrl} seed={g.t.projectName ?? g.t.artistName} />
          <div class="info"><strong>{g.t.title}</strong><span>{where(g.t)}</span></div>
          <div class="progress"><div class="meter"><i style="width:{(closed / g.all.length) * 100}%"></i></div>{closed} de {g.all.length} resolvidos</div>
        </div>
        {#each g.shown as c (c.id)}
          <div class="ritem" class:is-closed={c.status === "done"}>
            <button class="check" type="button" role="checkbox" aria-checked={c.status === "done"} aria-label={c.status === "done" ? "Reabrir" : "Marcar como feito"} onclick={() => toggle(c)}>{@html ICON.checkBold}</button>
            <button class="stamp" type="button" onclick={() => open(c, g.t)}>{stampText(c)}</button>
            <div class="rtext">
              {#if c.voice}<VoiceNote id={c.id} url={ownerSource.voiceUrl(c.id)} durationS={c.voice.durationS} />{/if}
              {#if c.body}<p>{c.body}</p>{/if}
              <p class="by">{[c.author.name, c.via ? `via ${c.via}` : "", `pedido em v${c.versionNumber}`, ago(c.createdAt)].filter(Boolean).join(" · ")}</p>
              {#each repliesOf(c) as r (r.id)}
                <div class="reply">
                  <div class="c-meta"><b>{r.mine ? "Tu" : r.author.name}</b>{#if r.mine}{#if r.isPrivate}<span class="vis-tag">{@html ICON.lockSm}nota privada</span>{:else}<span class="vis-tag is-public">{@html ICON.eyeSm}pública</span>{/if}{/if}<span class="faint">{ago(r.createdAt)}</span></div>
                  {#if r.voice}<VoiceNote id={r.id} url={ownerSource.voiceUrl(r.id)} durationS={r.voice.durationS} />{/if}
                  {#if r.body}<p class="c-body">{r.body}</p>{/if}
                </div>
              {/each}
              {#if replying !== c.id}<button class="linkbtn" type="button" onclick={() => (replying = c.id)}>{@html ICON.reply}Responder</button>{/if}
            </div>
            <div class="rside">
              {#if c.status === "done"}
                <label class="faint" style="font-size:13px">Resolvido em
                  <select class="mini" value={c.resolvedInVersionId ?? ""} onchange={(e) => resolvedIn(c, e.currentTarget.value)}>
                    {#each g.t.versions as v (v.id)}<option value={v.id}>v{v.number}</option>{/each}
                  </select>
                </label>
              {:else}<span class="status open">Aberto</span>{/if}
            </div>
            {#if replying === c.id}
              <div class="ritem-reply">
                <Composer owner desktop={!viewport.phone} duration={0} replyTo={{ top: c, name: c.author.name }} oncancelreply={() => (replying = null)} onsend={(m) => sendReply(c, m)} />
              </div>
            {/if}
          </div>
        {/each}
      </section>
    {:else}
      <div class="panel empty" style="padding:48px 24px">
        <p style="font-size:16px;color:var(--fg);font-weight:700;margin-bottom:6px">{filter === "open" ? "Nada por rever. Bom trabalho." : "Ainda não há pedidos aqui."}</p>
        <p>Os comentários dos clientes nos links aparecem aqui, por faixa.</p>
      </div>
    {/each}
  {/if}
</section>

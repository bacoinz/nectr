<script lang="ts">
  import type { CommentDTO } from "../../shared/api-types";
  import Confirm from "../components/Confirm.svelte";
  import { ICON } from "../lib/icons";
  import { isRequest, stampText, type CommentsState } from "./comments.svelte";
  import VoiceNote from "./VoiceNote.svelte";

  // Threads of the open version: a top comment (time, author, body or voice
  // note, status for requests) and its replies. Every message can be answered,
  // except your own; the owner marks requests done or reopens them.
  let { cm, owner, readOnly = false, phone = false, voiceUrl, empty }: {
    cm: CommentsState;
    owner: boolean;
    readOnly?: boolean;
    phone?: boolean;
    voiceUrl: (id: string) => string;
    empty: string;
  } = $props();

  const who = (c: CommentDTO) => (owner ? (c.mine ? "Tu" : c.author.name) : c.mine ? `${c.author.name} (tu)` : c.author.name);
  const canDelete = (c: CommentDTO) => !readOnly && (owner || c.mine);
  // Anyone else's message can be answered; of your own, only the last one in the thread.
  const canReply = (m: CommentDTO, lastMine: CommentDTO | undefined) => !readOnly && (!m.mine || m.id === lastMine?.id);

  // The comment picked on the waveform scrolls into view.
  $effect(() => {
    const id = cm.ui.focusId;
    if (id) queueMicrotask(() => document.querySelector(`[data-cid="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  });
</script>

{#snippet content(c: CommentDTO)}
  {#if c.voice}<VoiceNote id={c.id} url={voiceUrl(c.id)} durationS={c.voice.durationS} />{/if}
  {#if c.body}<p class="c-body">{c.body}</p>{/if}
{/snippet}

{#snippet visTag(c: CommentDTO)}
  {#if owner && c.author.kind === "owner"}
    {#if c.isPrivate}<span class="vis-tag">{@html ICON.lockSm}nota privada</span>{:else}<span class="vis-tag is-public">{@html ICON.eyeSm}pública</span>{/if}
  {/if}
{/snippet}

<div class={phone ? "" : "clist"}>
  {#each cm.shown as th (th.top.id)}
    {@const c = th.top}
    {@const lastMine = [c, ...th.replies].filter((m) => m.mine).at(-1)}
    <article class={phone ? "pc" : "c"} class:is-focus={cm.ui.focusId === c.id} class:is-mine={phone && c.mine && !owner} data-cid={c.id}>
      <button class="stamp" type="button" onclick={() => cm.focus(c)}>{stampText(c)}</button>
      <div class="c-meta">
        <b>{who(c)}</b>{@render visTag(c)}
        {#if owner && c.via}<span>via {c.via}</span>{/if}
        {#if th.carried}<span class="origin">de v{c.versionNumber}</span>{/if}
        {#if c.editedAt}<span class="faint">editado</span>{/if}
      </div>
      {@render content(c)}
      <div class="c-foot">
        {#if isRequest(c)}<span class="status {c.status}">{c.status === "done" ? `Feito${c.resolvedInNumber ? ` em v${c.resolvedInNumber}` : ""}` : "Aberto"}</span>{/if}
        {#if canReply(c, lastMine)}<button class="linkbtn" type="button" onclick={() => cm.reply(c, c)}>{@html ICON.reply}Responder</button>{/if}
        {#if !readOnly && c.canEdit}<button class="linkbtn" type="button" onclick={() => cm.edit(c)}>Editar</button>{/if}
        {#if owner && !readOnly && isRequest(c)}<button class="linkbtn" type="button" onclick={() => cm.toggle(c)}>{c.status === "open" ? "✓ Feito" : "Reabrir"}</button>{/if}
        {#if canDelete(c)}<button class="linkbtn" type="button" onclick={() => (cm.ui.deleting = c)}>Apagar</button>{/if}
      </div>
      {#each th.replies as r (r.id)}
        <div class="reply" data-cid={r.id}>
          <div class="c-meta"><b>{who(r)}</b>{@render visTag(r)}{#if r.editedAt}<span class="faint">editado</span>{/if}</div>
          {@render content(r)}
          {#if canReply(r, lastMine) || canDelete(r) || (!readOnly && r.canEdit)}
            <div class="r-foot">
              {#if canReply(r, lastMine)}<button class="linkbtn" type="button" onclick={() => cm.reply(c, r)}>{@html ICON.reply}Responder</button>{/if}
              {#if !readOnly && r.canEdit}<button class="linkbtn" type="button" onclick={() => cm.edit(r)}>Editar</button>{/if}
              {#if canDelete(r)}<button class="linkbtn" type="button" onclick={() => (cm.ui.deleting = r)}>Apagar</button>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </article>
  {:else}
    <p class="empty">{cm.ui.filter === "open" && cm.threads.length ? "Não há pedidos abertos nesta versão." : empty}</p>
  {/each}
</div>

{#if cm.ui.deleting}
  {@const d = cm.ui.deleting}
  <Confirm title={d.parentId ? "Apagar esta resposta?" : "Apagar este comentário?"}
    body={d.parentId ? "Deixa de aparecer na conversa." : "As respostas também são apagadas. Quem tem o link deixa de o ver."}
    onconfirm={() => cm.remove(d)} oncancel={() => (cm.ui.deleting = null)} />
{/if}

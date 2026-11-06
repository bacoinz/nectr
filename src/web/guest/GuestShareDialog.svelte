<script lang="ts">
  import type { GuestShareDTO } from "../../shared/api-types";
  import Dialog from "../components/Dialog.svelte";
  import { askName, guest } from "../comments/guest.svelte";
  import { api } from "../lib/api";
  import { ICON } from "../lib/icons";
  import { toast, toastError } from "../lib/toast.svelte";

  // A guest shares one track or folder of this link: a link of its own, without
  // downloads or password, that stops when this one does. The owner sees it.
  let { base, what, onclose }: {
    /** /s/:token/api/shares */
    base: string;
    what: { type: "track" | "folder"; id: string; name: string };
    onclose: () => void;
  } = $props();

  const headers = (): Record<string, string> => (guest.me ? { "X-Guest": `${guest.me.id}.${guest.me.secret}` } : {});
  let to = $state("");
  let busy = $state(false);
  let made = $state<GuestShareDTO | null>(null);
  let mine = $state<GuestShareDTO[]>([]);
  const loadMine = () => api<{ shares: GuestShareDTO[] }>(base, { headers: headers() }).then((r) => (mine = r.shares)).catch(() => {});
  $effect(() => void loadMine());

  const url = (s: GuestShareDTO) => `${location.origin}${s.path}`;
  async function copy(s: GuestShareDTO) {
    try {
      await navigator.clipboard.writeText(url(s));
      toast("Link copiado");
    } catch {
      toast(url(s));
    }
  }
  async function send(s: GuestShareDTO) {
    // The phone's own share sheet, where there is one; otherwise copy.
    if (navigator.share) await navigator.share({ title: s.target.name, url: url(s) }).catch(() => {});
    else await copy(s);
  }

  async function create(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!guest.me && !(await askName("send"))) return;
    busy = true;
    try {
      made = await api<GuestShareDTO>(base, { method: "POST", json: { type: what.type, id: what.id, to: to.trim() }, headers: headers() });
      mine = [made, ...mine.filter((x) => x.id !== made!.id)];
      await copy(made);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
  async function revoke(s: GuestShareDTO) {
    try {
      await api(`${base}/${s.id}`, { method: "DELETE", headers: headers() });
      mine = mine.filter((x) => x.id !== s.id);
      if (made?.id === s.id) made = null;
      toast("Partilha revogada");
    } catch (err) {
      toastError(err);
    }
  }
</script>

<Dialog title="Partilhar {what.type === 'track' ? 'esta faixa' : 'esta pasta'}" subtitle="“{what.name}”: um link só para ouvir, sem download, que deixa de funcionar quando este acabar. Quem te enviou este link vê as partilhas." {onclose}>
  {#if made}
    <div class="result"><code>{url(made)}</code></div>
    <div class="actions">
      <button class="btn btn-primary" type="button" onclick={() => send(made!)}>{@html ICON.share}Enviar</button>
      <button class="btn" type="button" onclick={() => copy(made!)}>{@html ICON.copy}Copiar</button>
    </div>
  {:else}
    <form id="gshare-form" onsubmit={create} class="field">
      <label for="gs-to">Para quem? <span class="faint">(opcional)</span></label>
      <input class="input" id="gs-to" bind:value={to} maxlength="60" autocomplete="off" placeholder="Ex.: Rui" />
      <p class="help">{guest.me ? `Aparece como partilha de ${guest.me.name}.` : "Antes, pedimos-te o nome."}</p>
    </form>
  {/if}
  {#if mine.length}
    <div class="gshares">
      <span class="label">As tuas partilhas neste link</span>
      <ul>
        {#each mine as s (s.id)}
          <li>
            <span><b>{s.target.name}</b>{#if s.name.includes(" para ")}<span class="faint">{s.name.slice(s.name.indexOf(" para ") + 1)}</span>{/if}</span>
            <span class="gshare-actions">
              <button class="linkbtn" type="button" onclick={() => copy(s)}>Copiar</button>
              <button class="linkbtn" type="button" onclick={() => revoke(s)}>Revogar</button>
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#snippet footer()}
    {#if made}<button class="btn btn-primary" type="button" onclick={onclose}>Feito</button>
    {:else}
      <button class="btn" type="button" onclick={onclose}>Cancelar</button>
      <button class="btn btn-primary" type="submit" form="gshare-form" disabled={busy}>Criar link</button>
    {/if}
  {/snippet}
</Dialog>

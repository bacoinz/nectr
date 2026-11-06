<script lang="ts">
  import Dialog from "../components/Dialog.svelte";
  import { disablePush, enablePush, pushState, type PushState, type PushTarget } from "../lib/push";
  import { toast, toastError } from "../lib/toast.svelte";

  // "Avisos" on a shared link (the bell at the top): replies from the owner
  // (links that take comments) and new music on this link.
  let { target, ownerName, comments, phone, onclose, onchange }: {
    target: PushTarget;
    ownerName: string;
    comments: boolean;
    phone: boolean;
    onclose: () => void;
    onchange: (on: boolean) => void;
  } = $props();

  let st = $state<PushState | null>(null);
  let busy = $state(false);
  $effect(() => {
    void pushState(target).then((s) => (st = s));
  });

  async function run(next: () => Promise<PushState>) {
    busy = true;
    try {
      st = await next();
      onchange(st === "on");
      if (st === "on") (toast("Avisos ligados neste dispositivo"), onclose());
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }

  const what = $derived(comments ? `responder aos teus comentários ou carregar músicas novas neste link` : `carregar músicas novas neste link`);
</script>

<Dialog title="Avisos" subtitle="Sabe quando há novidades, sem teres de voltar a abrir o link." {onclose}>
  <p class="alerts-text">Recebe um aviso {phone ? "no telemóvel" : "no computador"} quando {ownerName} {what}. {phone ? "Chega mesmo com o browser fechado." : "Chega enquanto o browser estiver aberto, mesmo sem esta página."}</p>
  {#if st === "on"}
    <p class="alerts-text"><b>Avisos ligados neste dispositivo.</b></p>
  {:else if st === "denied"}
    <p class="alerts-text warn-text">O browser bloqueou os avisos deste site. Permite-os nas definições do site (o cadeado ao lado do endereço) e volta a tentar.</p>
  {:else if st === "ios-install"}
    <p class="alerts-text">No iPhone, os avisos só funcionam com o link no ecrã principal: toca em Partilhar → "Adicionar ao ecrã principal" e abre-o a partir daí.</p>
  {:else if st === "unsupported" || st === "unconfigured"}
    <p class="alerts-text">Este browser não recebe avisos.</p>
  {/if}
  {#snippet footer()}
    {#if st === "on"}
      <button class="btn" type="button" disabled={busy} onclick={() => run(() => disablePush(target))}>Desligar avisos</button>
      <button class="btn btn-primary" type="button" onclick={onclose}>Fechar</button>
    {:else if st === "off"}
      <button class="btn" type="button" onclick={onclose}>Agora não</button>
      <button class="btn btn-primary" type="button" disabled={busy} onclick={() => run(() => enablePush(target))}>Ligar avisos</button>
    {:else}
      <button class="btn btn-primary" type="button" onclick={onclose}>Fechar</button>
    {/if}
  {/snippet}
</Dialog>

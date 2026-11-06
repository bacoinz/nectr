<script lang="ts">
  import type { LinkDTO } from "../../shared/api-types";
  import { admin } from "../lib/api";
  import { bytes, dayMonth, initials, num, plural } from "../lib/format";
  import { cropImage } from "../lib/crop.svelte";
  import { toast, toastError } from "../lib/toast.svelte";
  import { refreshMe, store } from "./store.svelte";
  import { getTheme, setTheme, type ThemePref } from "../lib/theme";
  import { disablePush, enablePush, ownerPush, pushState, testPush, type PushState } from "../lib/push";
  import { clearPlayerLog, playerLog } from "../lib/playerlog";

  // Profile (name shown to clients, photo) and a short overview of the app.
  let { onsaved }: { onsaved?: () => void } = $props();
  let theme = $state<ThemePref>(getTheme());
  const pickTheme = (t: ThemePref) => ((theme = t), setTheme(t));

  // Notifications on this device when a guest writes something.
  let push = $state<PushState | null>(null);
  let pushBusy = $state(false);
  $effect(() => {
    void pushState(ownerPush).then((s) => (push = s));
  });
  async function pushDo(run: () => Promise<unknown>) {
    pushBusy = true;
    try {
      await run();
    } catch (err) {
      toastError(err);
    } finally {
      pushBusy = false;
    }
  }
  const pushOn = () => pushDo(async () => (push = await enablePush(ownerPush)) === "on" && toast("Avisos ativos neste dispositivo"));
  const pushOff = () => pushDo(async () => (push = await disablePush(ownerPush)));
  const pushTest = () => pushDo(async () => (await testPush(), toast("Aviso de teste enviado")));

  // The player's diary on this device, for music that stops by itself.
  let log = $state(playerLog());
  async function copyLog() {
    log = playerLog();
    const text = [`nectr · ${navigator.userAgent}`, ...log].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Registo copiado");
    } catch {
      toast("Não foi possível copiar: seleciona o texto e copia à mão.");
    }
  }
  const clearLog = () => (clearPlayerLog(), (log = []), toast("Registo limpo"));

  // svelte-ignore state_referenced_locally
  let name = $state(store.me?.profile.name ?? "");
  let busy = $state(false);
  let file = $state<HTMLInputElement>();

  let links = $state<LinkDTO[] | null>(null);
  $effect(() => {
    admin.links().then((r) => (links = r.links)).catch(() => (links = []));
  });
  const active = $derived((links ?? []).filter((l) => l.status === "active"));
  const expiringSoon = $derived(active.filter((l) => l.expiresAt && l.expiresAt - Date.now() < 7 * 86400_000));

  const lib = $derived(store.library);
  const totals = $derived(lib ? lib.artists.reduce((t, a) => ({ projects: t.projects + a.projectCount, tracks: t.tracks + a.trackCount, versions: t.versions + a.versionCount }), { projects: 0, tracks: 0, versions: 0 }) : { projects: 0, tracks: 0, versions: 0 });
  const st = $derived(lib?.storage);
  const used = $derived(st ? st.audioBytes + st.trashBytes + st.voiceBytes : 0);
  const share = (n: number) => (st ? Math.min(100, (n / st.limitBytes) * 100) : 0);
  const pct = $derived(share(used));
  const photo = $derived(store.me?.profile.photoUrl ?? null);

  async function pick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    busy = true;
    try {
      const blob = await cropImage(f, 512, { round: true, title: "A tua foto" });
      if (!blob) return;
      await admin.putPhoto(blob);
      await refreshMe();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
      if (file) file.value = "";
    }
  }
  async function removePhoto() {
    busy = true;
    try {
      await admin.deletePhoto();
      await refreshMe();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
  export async function save() {
    if (!name.trim()) return toast("Escreve o teu nome.");
    busy = true;
    try {
      await admin.updateProfile(name.trim());
      await refreshMe();
      toast("Perfil guardado");
      onsaved?.();
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="ov-block">
  <div class="profile-head">
    <span class="avatar-lg" style={photo ? `background-image:url('${photo}')` : ""}>{photo ? "" : initials(name)}</span>
    <div class="actions" style="flex-direction:column;align-items:flex-start;gap:8px">
      <button class="btn sm" type="button" disabled={busy} onclick={() => file?.click()}>{photo ? "Mudar foto" : "Escolher foto"}</button>
      {#if photo}<button class="linkbtn" type="button" disabled={busy} onclick={removePhoto}>Remover foto</button>{/if}
    </div>
    <input type="file" bind:this={file} accept="image/jpeg,image/png,image/webp" hidden onchange={pick} />
  </div>
  <div class="row2">
    <div class="field">
      <label for="pf-name">Nome</label>
      <input class="input" id="pf-name" bind:value={name} maxlength="120" autocomplete="name" />
      <p class="help">É o que os clientes veem nas tuas respostas.</p>
    </div>
    <div class="field">
      <label for="pf-email">Email de acesso</label>
      <input class="input" id="pf-email" value={store.me?.email ?? ""} readonly />
      <p class="help">Vem do Cloudflare Access.</p>
    </div>
  </div>
</div>

<div class="ov-block">
  <h3>Aspeto</h3>
  <div class="seg" role="group" aria-label="Tema">
    <button type="button" aria-pressed={theme === "dark"} onclick={() => pickTheme("dark")}>Escuro</button>
    <button type="button" aria-pressed={theme === "light"} onclick={() => pickTheme("light")}>Claro</button>
    <button type="button" aria-pressed={theme === "auto"} onclick={() => pickTheme("auto")}>Como o sistema</button>
  </div>
  <p class="help" style="margin-top:8px">Só neste dispositivo. Quem abre os teus links vê sempre o tema escuro.</p>
</div>

<div class="ov-block">
  <h3>Avisos</h3>
  <p class="help">Um aviso neste dispositivo quando um convidado comenta, envia uma nota de voz ou responde. No Android chega mesmo com o browser fechado; no computador, com o browser aberto.</p>
  {#if push === "on"}
    <div class="actions" style="margin-top:10px">
      <button class="btn sm" type="button" disabled={pushBusy} onclick={pushTest}>Enviar um teste</button>
      <button class="linkbtn" type="button" disabled={pushBusy} onclick={pushOff}>Desativar neste dispositivo</button>
    </div>
  {:else if push === "off"}
    <button class="btn btn-primary sm" style="margin-top:10px" type="button" disabled={pushBusy} onclick={pushOn}>Ativar neste dispositivo</button>
  {:else if push === "denied"}
    <p class="help warn-text">Este browser bloqueou os avisos da nectr. Permite-os nas definições do site (o cadeado ao lado do endereço) e volta aqui.</p>
  {:else if push === "ios-install"}
    <p class="help">No iPhone, os avisos só funcionam com a nectr no ecrã principal: Partilhar → Adicionar ao ecrã principal, e abre-a a partir daí.</p>
  {:else if push === "unconfigured"}
    <p class="help warn-text">Falta a chave dos avisos no servidor: corre <code>node scripts/push-key.mjs</code> (ver docs/setup.md).</p>
  {:else if push === "unsupported"}
    <p class="help">Este browser não recebe avisos.</p>
  {/if}
</div>

<div class="ov-block">
  <h3>Resumo</h3>
  <div class="stat-grid">
    <div class="stat"><b>{lib?.artists.length ?? 0}</b><span>artistas</span></div>
    <div class="stat"><b>{totals.projects}</b><span>projetos</span></div>
    <div class="stat"><b>{totals.tracks}</b><span>faixas</span></div>
    <div class="stat"><b>{totals.versions}</b><span>versões</span></div>
  </div>
</div>

{#if lib}
  <div class="ov-block">
    <h3>Espaço no R2</h3>
    <div class="segbar">
      <i style="width:{share(lib.storage.audioBytes)}%;background:{pct > 80 ? 'var(--warn)' : 'var(--accent)'}"></i>
      <i style="width:{share(lib.storage.voiceBytes)}%;background:var(--open)"></i>
      <i style="width:{share(lib.storage.trashBytes)}%;background:var(--fg-faint)"></i>
    </div>
    <div class="legend">
      <span><i style="background:var(--accent)"></i>Áudio · {bytes(lib.storage.audioBytes)}</span>
      {#if lib.storage.voiceBytes}<span><i style="background:var(--open)"></i>Notas de voz · {bytes(lib.storage.voiceBytes)}</span>{/if}
      {#if lib.storage.trashBytes && lib.storage.trashUntil}<span><i style="background:var(--fg-faint)"></i>Apagados · {bytes(lib.storage.trashBytes)}, saem até {dayMonth(lib.storage.trashUntil)}</span>{/if}
      <span>Livre · {bytes(Math.max(0, lib.storage.limitBytes - used))} de {num(lib.storage.limitBytes / 1e9, 0)} GB</span>
    </div>
  </div>
{/if}

<div class="ov-block">
  <h3>Por fazer</h3>
  <div class="todo">
    <div class="todo-row"><span>Pedidos dos clientes por rever</span>{#if lib?.openRequests}<a class="linkbtn" href="/admin/revisoes" onclick={() => onsaved?.()}><b>{lib.openRequests}</b></a>{:else}<b>0</b>{/if}</div>
    <div class="todo-row"><span>Links que expiram nos próximos 7 dias</span><b>{expiringSoon.length}</b></div>
    <div class="todo-row"><span>Links ativos</span><b>{active.length}</b></div>
    {#if expiringSoon.length}
      {#each expiringSoon as l (l.id)}<div class="todo-row"><span class="muted">“{l.name}” · {l.target.name}</span><a class="linkbtn" href="/admin/links">Gerir</a></div>{/each}
    {/if}
  </div>
</div>

<div class="ov-block">
  <h3>Diagnóstico do leitor</h3>
  <p class="help">Se a música parar sozinha (por exemplo, com outra app à frente), abre isto logo a seguir, copia o registo e envia-o.</p>
  <details class="plog" ontoggle={(e) => e.currentTarget.open && (log = playerLog())}>
    <summary>Ver o registo ({log.length} {log.length === 1 ? "linha" : "linhas"})</summary>
    <pre>{log.join("\n") || "Ainda vazio: põe uma música a tocar."}</pre>
  </details>
  <div class="actions">
    <button class="btn sm" type="button" onclick={copyLog}>Copiar registo</button>
    <button class="linkbtn" type="button" onclick={clearLog}>Limpar</button>
  </div>
</div>

<p class="faint" style="font-size:12.5px">{plural(lib?.storage.versionCount ?? 0, "versão", "versões")} na biblioteca. O que apagas fica guardado 7 dias (para poderes anular) e depois sai sozinho do armazenamento, com as notas de voz.</p>

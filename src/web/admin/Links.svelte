<script lang="ts">
  import type { LinkDTO, LinkStatus, LinkUpdateRequest } from "../../shared/api-types";
  import Dialog from "../components/Dialog.svelte";
  import { admin } from "../lib/api";
  import { ago, date, plural } from "../lib/format";
  import { ICON } from "../lib/icons";
  import { toast, toastError } from "../lib/toast.svelte";

  let links = $state<LinkDTO[] | null>(null);
  let filter = $state<LinkStatus>("active");
  const load = () => admin.links().then((r) => (links = r.links)).catch(toastError);
  $effect(() => void load());

  // Guests' shares are listed under the link they came from, not on their own.
  const own = $derived(links?.filter((l) => !l.parentId) ?? []);
  const sharesOf = (l: LinkDTO) => (links ?? []).filter((x) => x.parentId === l.id);
  const counts = $derived({
    active: own.filter((l) => l.status === "active").length,
    expired: own.filter((l) => l.status === "expired").length,
    revoked: own.filter((l) => l.status === "revoked").length,
  });
  const rows = $derived(own.filter((l) => l.status === filter));

  async function update(l: LinkDTO, body: LinkUpdateRequest, message?: string) {
    try {
      const next = await admin.updateLink(l.id, body);
      links = links!.map((x) => (x.id === l.id ? next : x));
      if (message) toast(message);
      return next;
    } catch (e) {
      toastError(e);
    }
  }

  const KIND = { artist: "Artista", project: "Projeto", folder: "Pasta", track: "Faixa" } as const;
  const modeLabel = (l: LinkDTO) => (l.versionMode === "all" ? "todas as versões" : l.versionMode === "latest" ? "só a versão mais recente" : `${l.versionIds.length} ${l.versionIds.length === 1 ? "versão escolhida" : "versões escolhidas"}`);
  const DAY = 86400_000;
  function expiryText(l: LinkDTO) {
    if (l.status === "revoked") return { text: `Revogado a ${date(l.revokedAt!)}`, cls: "dead" };
    if (!l.expiresAt) return { text: "Sem validade", cls: "" };
    if (l.status === "expired") return { text: `Expirou a ${date(l.expiresAt)}`, cls: "dead" };
    const days = Math.ceil((l.expiresAt - Date.now()) / DAY);
    return { text: `Expira a ${date(l.expiresAt)}${days <= 7 ? ` · ${days <= 1 ? "amanhã" : `daqui a ${days} dias`}` : ""}`, cls: days <= 7 ? "soon" : "" };
  }

  let pickDateFor = $state<LinkDTO | null>(null);
  let pickedDate = $state("");
  function extend(l: LinkDTO, value: string) {
    if (!value) return;
    if (value === "date") return ((pickedDate = ""), (pickDateFor = l));
    if (value === "none") return void update(l, { expiresAt: null }, "Sem validade");
    const base = l.status === "expired" || !l.expiresAt ? Date.now() : l.expiresAt;
    void update(l, { expiresAt: base + Number(value) * DAY }, l.status === "expired" ? "Link reativado" : `Prolongado ${value} dias`);
  }

  async function copy(l: LinkDTO) {
    try {
      await navigator.clipboard.writeText(`${location.origin}${l.path}`);
      toast("Link copiado");
    } catch {
      toast(`${location.origin}${l.path}`);
    }
  }
  async function revoke(l: LinkDTO) {
    if (await update(l, { revoked: true })) toast("Link revogado", { label: "Anular", run: () => void update(l, { revoked: false }, "Reativado") });
  }

  // "Editar": name, password and visible versions.
  let editing = $state<LinkDTO | null>(null);
  let eName = $state("");
  let ePw = $state("");
  let eRemovePw = $state(false);
  let eMode = $state<"all" | "latest" | "selected">("all");
  function openEdit(l: LinkDTO) {
    editing = l;
    eName = l.name;
    ePw = "";
    eRemovePw = false;
    eMode = l.versionMode;
  }
  async function saveEdit(e: SubmitEvent) {
    e.preventDefault();
    const l = editing!;
    const body: LinkUpdateRequest = { name: eName.trim() };
    if (eRemovePw) body.password = null;
    else if (ePw) body.password = ePw;
    if (eMode !== l.versionMode) body.versionMode = eMode;
    if (await update(l, body, "Link atualizado")) editing = null;
  }
</script>

<section class="view is-entering">
  <div class="view-head">
    <div>
      <h1 class="title-xl">Links</h1>
      <p class="sub">Todos os links partilhados. Os de faixas ou pastas apagadas deixam de aparecer.</p>
    </div>
    <div class="filters">
      <button class="fchip" type="button" aria-pressed={filter === "active"} onclick={() => (filter = "active")}>Ativos<span>{counts.active}</span></button>
      <button class="fchip" type="button" aria-pressed={filter === "expired"} onclick={() => (filter = "expired")}>Expirados<span>{counts.expired}</span></button>
      <button class="fchip" type="button" aria-pressed={filter === "revoked"} onclick={() => (filter = "revoked")}>Revogados<span>{counts.revoked}</span></button>
    </div>
  </div>

  <div class="panel links-list">
    {#if !links}
      <p class="empty">A carregar…</p>
    {:else if !rows.length}
      <p class="empty">{filter === "active" ? "Ainda não há links ativos. Usa “Partilhar” num artista, projeto, pasta ou faixa." : filter === "expired" ? "Nenhum link expirado." : "Nenhum link revogado."}</p>
    {:else}
      <div class="lgrid lhead"><span>Link</span><span>Permissões</span><span>Validade</span><span>Ações</span></div>
      {#each rows as l (l.id)}
        {@const exp = expiryText(l)}
        <article class="lrow2 lgrid" class:is-dead={l.status !== "active"}>
          <div class="lmain">
            <div class="top">
              <strong>{l.name}</strong>
              <span class="target-chip">{KIND[l.target.type]} · {l.target.name}{l.target.type !== "artist" ? ` · ${l.target.artistName}` : ""}</span>
            </div>
            <p class="meta">{modeLabel(l)} · {l.hasPassword ? "com password" : "sem password"} · {l.lastViewedAt ? `último acesso ${ago(l.lastViewedAt)}` : "ainda não foi aberto"}</p>
            {#if l.guests.length}
              <details class="lpeople">
                <summary>{plural(l.guests.length, "pessoa entrou", "pessoas entraram")}: {l.guests.slice(0, 3).map((g) => g.name).join(", ")}{l.guests.length > 3 ? "…" : ""}</summary>
                <ul>
                  {#each l.guests as g (g.id)}
                    <li><b>{g.name}</b><span>entrou a {date(g.createdAt)} · {g.lastSeenAt - g.createdAt > 3600_000 ? `voltou ${ago(g.lastSeenAt)}` : "não voltou desde então"}{g.comments ? ` · ${plural(g.comments, "comentário", "comentários")}` : ""}</span></li>
                  {/each}
                </ul>
                <p class="faint">Cada nome é um dispositivo: a mesma pessoa no telemóvel e no computador conta duas vezes.</p>
              </details>
            {:else}
              <p class="meta faint">{l.allowComments ? "Ainda ninguém deu o nome neste link." : "Só para ouvir: quem abre não precisa de dar o nome, por isso não aparece aqui."}</p>
            {/if}
            {#if sharesOf(l).length}
              {@const shares = sharesOf(l)}
              <details class="lpeople lshares">
                <summary>{plural(shares.length, "partilha feita", "partilhas feitas")} a partir deste link</summary>
                <ul>
                  {#each shares as sh (sh.id)}
                    <li class:is-dead={sh.status !== "active"}>
                      <b>{sh.createdBy ?? "Um convidado"}</b>
                      <span>partilhou {sh.target.type === "track" ? "a faixa" : "a pasta"} “{sh.target.name}” a {date(sh.createdAt)} · {sh.lastViewedAt ? `aberta ${ago(sh.lastViewedAt)}` : "ainda não foi aberta"}{sh.guests.length ? ` · ${plural(sh.guests.length, "pessoa", "pessoas")}: ${sh.guests.map((g) => g.name).join(", ")}` : ""}{sh.status === "revoked" ? " · revogada" : ""}</span>
                      <span class="lshare-actions">
                        {#if sh.status === "revoked"}
                          <button class="linkbtn" type="button" onclick={() => update(sh, { revoked: false }, "Partilha reativada")}>Reativar</button>
                        {:else}
                          <button class="linkbtn" type="button" onclick={() => copy(sh)}>Copiar</button>
                          <button class="linkbtn" type="button" onclick={() => update(sh, { revoked: true }, "Partilha revogada")}>Revogar</button>
                        {/if}
                      </span>
                    </li>
                  {/each}
                </ul>
                <p class="faint">Sem download nem password; seguem as versões, a letra e os comentários deste link e acabam com ele.</p>
              </details>
            {/if}
          </div>
          <div class="perms">
            {#each [["allowDownload", "Download"], ["showLyrics", "Letra"], ["allowComments", "Comentários"], ["allowShare", "Partilhar"]] as const as [k, label] (k)}
              <span class="perm"><button class="switch sm" type="button" role="switch" aria-checked={l[k]} aria-label={label} disabled={l.status === "revoked"} onclick={() => update(l, { [k]: !l[k] })}></button>{label}</span>
            {/each}
          </div>
          <div class="lexp">
            <span class="exp {exp.cls}">{exp.text}</span>
            {#if l.status !== "revoked"}
              <select class="mini" aria-label="Alterar validade" onchange={(e) => (extend(l, e.currentTarget.value), (e.currentTarget.value = ""))}>
                <option value="">{l.status === "expired" ? "Reativar…" : "Alterar validade…"}</option>
                <option value="7">{l.status === "expired" ? "Por mais 7 dias" : "Prolongar 7 dias"}</option>
                <option value="30">{l.status === "expired" ? "Por mais 30 dias" : "Prolongar 30 dias"}</option>
                <option value="none">Sem validade</option>
                <option value="date">Escolher data…</option>
              </select>
            {/if}
          </div>
          <div class="actions">
            {#if l.status === "revoked"}
              <button class="btn sm" type="button" onclick={() => update(l, { revoked: false }, "Link reativado")}>Reativar</button>
            {:else}
              <button class="btn sm" type="button" onclick={() => copy(l)}>Copiar</button>
              <button class="btn sm" type="button" onclick={() => openEdit(l)}>Editar</button>
              <button class="btn sm" type="button" onclick={() => revoke(l)}>Revogar</button>
            {/if}
          </div>
        </article>
      {/each}
    {/if}
  </div>
</section>

{#if pickDateFor}
  {@const l = pickDateFor}
  <Dialog title="Validade de “{l.name}”" subtitle="O link deixa de funcionar no fim do dia escolhido." onclose={() => (pickDateFor = null)}>
    <input class="input" type="date" bind:value={pickedDate} min={new Date(Date.now() + DAY).toISOString().slice(0, 10)} />
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (pickDateFor = null)}>Cancelar</button>
      <button class="btn btn-primary" type="button" disabled={!pickedDate}
        onclick={() => update(l, { expiresAt: new Date(`${pickedDate}T23:59:59`).getTime() }, `Válido até ${date(new Date(`${pickedDate}T12:00:00`).getTime())}`).then((r) => r && (pickDateFor = null))}>Guardar</button>
    {/snippet}
  </Dialog>
{/if}

{#if editing}
  <Dialog title="Editar “{editing.name}”" subtitle="{KIND[editing.target.type]} · {editing.target.name}" onclose={() => (editing = null)}>
    <form id="link-edit" onsubmit={saveEdit} style="display:flex;flex-direction:column;gap:18px">
      <div class="field"><label for="le-name">Nome do link <span class="faint">(só tu vês)</span></label><input class="input" id="le-name" bind:value={eName} maxlength="120" required /></div>
      <div class="field">
        <label for="le-pw">{editing.hasPassword ? "Nova password" : "Password"} <span class="faint">(opcional)</span></label>
        <input class="input mono" id="le-pw" type="text" bind:value={ePw} disabled={eRemovePw} placeholder={editing.hasPassword ? "Deixa vazio para manter a atual" : "Sem password"} autocomplete="off" />
        {#if editing.hasPassword}
          <label class="help" style="display:flex;gap:8px;align-items:center"><input type="checkbox" bind:checked={eRemovePw} /> Remover a password</label>
        {/if}
        <p class="help">Mudar a password pede-a outra vez a quem já tinha entrado.</p>
      </div>
      {#if editing.target.type !== "track" || editing.versionMode !== "selected"}
        <div class="field">
          <span class="label">Versões visíveis</span>
          <div class="seg">
            <button type="button" aria-pressed={eMode === "all"} onclick={() => (eMode = "all")}>Todas</button>
            <button type="button" aria-pressed={eMode === "latest"} onclick={() => (eMode = "latest")}>Só a mais recente</button>
          </div>
        </div>
      {/if}
    </form>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => (editing = null)}>Cancelar</button>
      <button class="btn btn-primary" type="submit" form="link-edit">{@html ICON.check}Guardar</button>
    {/snippet}
  </Dialog>
{/if}

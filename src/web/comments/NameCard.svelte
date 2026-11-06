<script lang="ts">
  import Art from "../components/Art.svelte";
  import { toastError } from "../lib/toast.svelte";
  import { checkGuestName, GUEST_NAME_MAX } from "../../shared/guest-name";
  import { closeName, guest, saveName } from "./guest.svelte";

  // "Olá! Como te chamas?": a card in the middle (computer) or a sheet from the
  // bottom (phone). Also used to change the name and before a first comment.
  let { phone, hero }: { phone: boolean; hero: { name: string; color: string; artworkUrl: string | null } } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(guest.me?.name ?? "");
  let busy = $state(false);
  let problem = $state("");
  let field = $state<HTMLInputElement>();
  const renaming = $derived(guest.prompt === "rename");
  $effect(() => {
    const t = setTimeout(() => field?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const check = checkGuestName(name);
    if (!check.ok) {
      problem = check.message;
      return;
    }
    problem = "";
    busy = true;
    try {
      await saveName(check.name);
      closeName(true);
    } catch (err) {
      toastError(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && guest.prompt !== "welcome" && closeName(false)} />

<div class="{phone ? 'ph-welcome' : 'gwelcome'} is-opening">
  <div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="w-title">
    <Art color={hero.color} url={hero.artworkUrl} seed={hero.name} />
    <h2 class="title-md" id="w-title">{renaming ? "Mudar o nome" : "Olá! Como te chamas?"}</h2>
    <p>
      {renaming
        ? "Os comentários que já fizeste neste dispositivo passam a aparecer com o nome novo."
        : "Antes de ouvir, diz-nos quem és: os teus comentários aparecem com este nome. Fica guardado neste dispositivo, por isso não o voltas a escrever."}
    </p>
    <form onsubmit={submit}>
      <input class="input" bind:this={field} bind:value={name} placeholder="O teu nome" autocomplete="name" aria-label="O teu nome" maxlength={GUEST_NAME_MAX}
        aria-invalid={!!problem} oninput={() => (problem = "")} />
      {#if problem}<p role="alert" style="color:var(--rec);font-size:13.5px;margin:0">{problem}</p>{/if}
      <button class="btn btn-primary" type="submit" disabled={busy || !name.trim()}>{renaming ? "Guardar" : guest.prompt === "send" ? "Continuar" : "Entrar"}</button>
    </form>
    {#if guest.prompt !== "welcome"}<button class="linkbtn" type="button" onclick={() => closeName(false)}>Cancelar</button>{/if}
  </div>
</div>

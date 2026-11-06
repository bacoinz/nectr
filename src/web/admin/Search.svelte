<script lang="ts" module>
  import type { SearchIndexDTO } from "../../shared/api-types";
  // The names of the whole library, kept for a minute between searches.
  let cached: { at: number; idx: SearchIndexDTO } | null = null;
</script>

<script lang="ts">
  import { admin } from "../lib/api";
  import { folderIcon, ICON } from "../lib/icons";
  import { navigate } from "../router.svelte";

  // "Procurar" (Ctrl/⌘+K or /): artists, projects, folders and tracks by name,
  // accents and case ignored, every word has to match. ↑/↓ and Enter to go.
  let { onclose }: { onclose: () => void } = $props();

  let q = $state("");
  let idx = $state<SearchIndexDTO | null>(cached?.idx ?? null);
  let sel = $state(0);
  let input = $state<HTMLInputElement>();
  $effect(() => {
    input?.focus();
    if (cached && Date.now() - cached.at < 60_000) return;
    admin.searchIndex().then((r) => ((idx = r), (cached = { at: Date.now(), idx: r }))).catch(() => {});
  });

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  interface Hit {
    kind: "artist" | "project" | "folder" | "track";
    label: string;
    sub: string;
    href: string;
    icon?: string;
  }

  const groups = $derived.by(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!idx || !words.length) return [];
    const artists = new Map(idx.artists.map((a) => [a.id, a.name]));
    const folders = new Map(idx.folders.map((f) => [f.id, f]));
    const project = (id: string | null) => {
      let f = id ? folders.get(id) : undefined;
      while (f?.parentId) f = folders.get(f.parentId);
      return f;
    };
    // Every word must appear in the name or around it; hits on the name itself come first.
    const rank = (name: string, around: string) => {
      const n = norm(name);
      const all = `${n} ${norm(around)}`;
      if (!words.every((w) => all.includes(w))) return -1;
      return words.filter((w) => n.includes(w)).length;
    };
    const pick = <T,>(list: T[], score: (x: T) => number, max: number) =>
      list.map((x) => [x, score(x)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, max).map(([x]) => x);

    const out: { title: string; hits: Hit[] }[] = [];
    const a = pick(idx.artists, (x) => rank(x.name, ""), 5).map((x): Hit => ({ kind: "artist", label: x.name, sub: "Artista", href: `/admin/artistas/${x.id}` }));
    const projects = idx.folders.filter((f) => !f.parentId);
    const p = pick(projects, (f) => rank(f.name, artists.get(f.artistId) ?? ""), 6).map(
      (f): Hit => ({ kind: "project", label: f.name, sub: `Projeto · ${artists.get(f.artistId) ?? ""}`, href: `/admin/artistas/${f.artistId}/pastas/${f.id}` }),
    );
    const sub = idx.folders.filter((f) => f.parentId);
    const fo = pick(sub, (f) => rank(f.name, `${project(f.id)?.name ?? ""} ${artists.get(f.artistId) ?? ""}`), 5).map(
      (f): Hit => ({ kind: "folder", label: f.name, sub: `Pasta · ${project(f.id)?.name ?? ""} · ${artists.get(f.artistId) ?? ""}`, href: `/admin/artistas/${f.artistId}/pastas/${f.id}` }),
    );
    // A track is also found by its DAW project name, shown after the artist and project.
    const t = pick(idx.tracks, (x) => rank(x.title, `${x.sessionName} ${artists.get(x.artistId) ?? ""} ${project(x.folderId)?.name ?? ""} ${x.folderId ? (folders.get(x.folderId)?.name ?? "") : ""}`), 10).map(
      (x): Hit => ({ kind: "track", label: x.title, sub: [artists.get(x.artistId), project(x.folderId)?.name, x.sessionName].filter(Boolean).join(" · "), href: `/admin/artistas/${x.artistId}/faixas/${x.id}` }),
    );
    if (a.length) out.push({ title: "Artistas", hits: a });
    if (p.length) out.push({ title: "Projetos", hits: p });
    if (fo.length) out.push({ title: "Pastas", hits: fo });
    if (t.length) out.push({ title: "Faixas", hits: t });
    return out;
  });
  const flat = $derived(groups.flatMap((g) => g.hits));
  $effect(() => {
    void q;
    sel = 0;
  });

  function go(h: Hit | undefined) {
    if (!h) return;
    onclose();
    navigate(h.href);
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape") (e.preventDefault(), onclose());
    else if (e.key === "ArrowDown") (e.preventDefault(), (sel = Math.min(flat.length - 1, sel + 1)), scroll());
    else if (e.key === "ArrowUp") (e.preventDefault(), (sel = Math.max(0, sel - 1)), scroll());
    else if (e.key === "Enter") (e.preventDefault(), go(flat[sel]));
  }
  const scroll = () => queueMicrotask(() => document.querySelector(".sr-item.is-sel")?.scrollIntoView({ block: "nearest" }));
  const kindIcon = (k: Hit["kind"]) => (k === "artist" ? ICON.grid : k === "track" ? ICON.music : folderIcon(k === "project" ? "disc" : "folder", 16));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim is-opening search-scrim" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog search-dialog" role="dialog" aria-modal="true" aria-label="Procurar">
    <div class="search-box">
      {@html ICON.search}
      <input bind:this={input} bind:value={q} onkeydown={onkey} placeholder="Procurar artistas, projetos e faixas…" aria-label="Procurar" autocomplete="off" enterkeyhint="go"
        role="combobox" aria-expanded={flat.length > 0} aria-controls="search-results" aria-activedescendant={flat.length ? `sr-${sel}` : undefined} />
      <button class="iconbtn sm" type="button" aria-label="Fechar" onclick={onclose}>{@html ICON.close}</button>
    </div>
    <div class="search-results" id="search-results" role="listbox">
      {#each groups as g (g.title)}
        <div class="sr-group">{g.title}</div>
        {#each g.hits as h (h.href)}
          {@const i = flat.indexOf(h)}
          <button class="sr-item" class:is-sel={i === sel} id="sr-{i}" type="button" role="option" aria-selected={i === sel} onmouseenter={() => (sel = i)} onclick={() => go(h)}>
            <span class="sr-icon">{@html kindIcon(h.kind)}</span>
            <span class="sr-text"><b>{h.label}</b><span>{h.sub}</span></span>
          </button>
        {/each}
      {:else}
        <p class="sr-empty">{!idx ? "A carregar…" : q.trim() ? `Nada encontrado para “${q.trim()}”.` : "Escreve parte de um nome. Ctrl+K (ou /) abre a pesquisa em qualquer página."}</p>
      {/each}
    </div>
  </div>
</div>

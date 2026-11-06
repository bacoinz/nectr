<script lang="ts">
  import type { FolderDTO, TrackDTO, VersionDTO } from "../../shared/api-types";
  import Art from "../components/Art.svelte";
  import Confirm from "../components/Confirm.svelte";
  import Menu, { type MenuItem } from "../components/Menu.svelte";
  import PromptDialog from "../components/PromptDialog.svelte";
  import TrackCoverDialog from "./TrackCoverDialog.svelte";
  import { isRelease, KIND_EYEBROW, KIND_LABEL } from "../lib/kinds";
  import { admin, downloadUrl } from "../lib/api";
  import { date, fmtDuration, fmtLabel, fmtTime, inkFor, kHz, num, plural } from "../lib/format";
  import { folderIcon, ICON } from "../lib/icons";
  import { viewport } from "../lib/media.svelte";
  import { toast, toastError } from "../lib/toast.svelte";
  import { filesFromDrop, startUploads, uploadLabel, uploadsFor, type UploadItem } from "../lib/uploads.svelte";
  import { navigate } from "../router.svelte";
  import { wantPlay } from "../lib/player.svelte";
  import ArtistEditor from "./project/ArtistEditor.svelte";
  import FolderEditor from "./project/FolderEditor.svelte";
  import MoveDialog from "./project/MoveDialog.svelte";
  import ProjectEditor from "./project/ProjectEditor.svelte";
  import { folderPath, latest, projectOf, projectsOf, subfolders, tracksIn, tracksUnder } from "./project/tree";
  import ShareDialog from "./ShareDialog.svelte";
  import { loadArtist, setArtist, store } from "./store.svelte";

  // One page for the three levels: the artist (its projects and loose tracks),
  // a project (album/EP/single: its folders and tracks) and a folder inside a project.
  let { artistId, folderId }: { artistId: string; folderId: string | null } = $props();

  let failed = $state<string | null>(null);
  $effect(() => {
    loadArtist(artistId, true).catch((e) => (failed = e instanceof Error ? e.message : "Artista não encontrado."));
  });
  const refresh = () => loadArtist(artistId, true).then(setArtist);

  const a = $derived(store.artists[artistId]);
  const folder = $derived(a && folderId ? (a.folders.find((f) => f.id === folderId) ?? null) : null);
  const project = $derived(a && folder ? projectOf(a, folder.id) : null);
  const atArtist = $derived(!folder);
  const folders = $derived(a ? subfolders(a, folderId) : []);
  // At the artist level: albums/EPs apart from the working projects (WIP, live…).
  const releases = $derived(atArtist ? folders.filter(isRelease) : folders);
  const workFolders = $derived(atArtist ? folders.filter((f) => !isRelease(f)) : []);
  const tracks = $derived(a ? tracksIn(a, folderId) : []);
  const ups = $derived(uploadsFor(artistId));
  const newUploads = $derived(ups.filter((u) => u.kind === "new" && u.folderId === folderId && !(u.trackId && tracks.some((t) => t.id === u.trackId))));
  const versionUpload = (trackId: string) => ups.find((u) => u.kind === "version" && u.trackId === trackId);
  const color = $derived(project?.color ?? a?.artist.color ?? "#f4b740");
  const projStyle = $derived(`--proj-main:${color};--proj-ink:${inkFor(color)}`);
  const base = $derived(`/admin/artistas/${artistId}`);
  const folderUrl = (id: string) => `${base}/pastas/${id}`;
  const trackUrl = (id: string, v?: string) => `${base}/faixas/${id}${v ? `?v=${v}` : ""}`;
  const fileStem = (name: string) => name.replace(/.(wav|wave|mp3)$/i, "");
  // At the artist level the folders are projects.
  const kindOf = (f: FolderDTO) => (f.parentId ? "pasta" : "projeto");

  // ---------- Columns: reorder by dragging a heading (kept per device) ----------
  const COLS: Record<string, { label: string; r?: boolean; fixed?: boolean }> = {
    num: { label: "#", fixed: true }, name: { label: "Nome" }, dur: { label: "Duração", r: true }, fmt: { label: "Formato" },
    sr: { label: "Sample rate", r: true }, lufs: { label: "LUFS-I", r: true }, tp: { label: "True peak", r: true },
    date: { label: "Atualizado" }, ver: { label: "Versão" }, req: { label: "Pedidos" }, more: { label: "", fixed: true },
  };
  const DEFAULT = Object.keys(COLS);
  const saved = (() => { try { return JSON.parse(localStorage.getItem("nectr.cols") ?? "null") as string[] | null; } catch { return null; } })();
  let cols = $state(saved && saved.length === DEFAULT.length && DEFAULT.every((k) => saved.includes(k)) ? saved : DEFAULT);
  let dragCol = $state<string | null>(null);
  let dropCol = $state<{ key: string; after: boolean } | null>(null);
  function colDrop(key: string) {
    if (!dragCol || !dropCol || dragCol === key) return;
    const next = cols.filter((k) => k !== dragCol);
    next.splice(next.indexOf(dropCol.key) + (dropCol.after ? 1 : 0), 0, dragCol);
    cols = next;
    localStorage.setItem("nectr.cols", JSON.stringify(next));
  }

  // ---------- Versions under their track ----------
  let expanded = $state(new Set<string>());
  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    expanded = next;
  };

  // ---------- Selection: click, Ctrl/⌘+click, Shift+click, rectangle ----------
  let sel = $state(new Set<string>());
  let anchor: string | null = null;
  let zone = $state<HTMLElement>();
  const keysInView = () => [...(zone?.querySelectorAll<HTMLElement>("[data-selkey]") ?? [])].map((r) => r.dataset.selkey!);
  $effect(() => {
    // Drop keys that left the view (moved, deleted, other folder).
    const present = new Set([...folders.map((f) => `f:${f.id}`), ...tracks.map((t) => `t:${t.id}`)]);
    if ([...sel].some((k) => !present.has(k))) sel = new Set([...sel].filter((k) => present.has(k)));
  });

  function rowClick(e: MouseEvent, key: string) {
    if ((e.target as Element).closest("button, a, input, .menu")) return;
    if (suppressClick) return;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(sel);
      next.has(key) ? next.delete(key) : next.add(key);
      sel = next;
      anchor = key;
      return;
    }
    if (e.shiftKey && anchor) {
      const keys = keysInView();
      const [x, y] = [keys.indexOf(anchor), keys.indexOf(key)].sort((m, n) => m - n);
      sel = new Set(keys.slice(x!, y! + 1));
      return;
    }
    sel = new Set();
    anchor = key;
    navigate(key.startsWith("t:") ? trackUrl(key.slice(2)) : folderUrl(key.slice(2)));
  }

  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number; base: Set<string> } | null>(null);
  let suppressClick = false;
  function zoneDown(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest("[data-selkey], button, a, input, .vrow, .page-foot, .menu")) return;
    marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, base: e.ctrlKey || e.metaKey ? new Set(sel) : new Set() };
    if (!e.ctrlKey && !e.metaKey) sel = new Set();
  }
  function winMove(e: PointerEvent) {
    if (!marquee) return;
    marquee.x1 = e.clientX;
    marquee.y1 = e.clientY;
    const [l, r] = [Math.min(marquee.x0, marquee.x1), Math.max(marquee.x0, marquee.x1)];
    const [t, b] = [Math.min(marquee.y0, marquee.y1), Math.max(marquee.y0, marquee.y1)];
    if (r - l < 4 && b - t < 4) return;
    const next = new Set(marquee.base);
    zone?.querySelectorAll<HTMLElement>("[data-selkey]").forEach((row) => {
      const box = row.getBoundingClientRect();
      if (box.right > l && box.left < r && box.bottom > t && box.top < b) next.add(row.dataset.selkey!);
    });
    sel = next;
  }
  function winUp() {
    if (!marquee) return;
    const moved = Math.abs(marquee.x1 - marquee.x0) > 4 || Math.abs(marquee.y1 - marquee.y0) > 4;
    marquee = null;
    if (moved) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false));
    }
  }

  function winKey(e: KeyboardEvent) {
    if ((e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) || document.querySelector(".scrim")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && sel.size) (e.preventDefault(), (confirmDelete = true));
    else if (e.key === "Escape" && sel.size) sel = new Set();
    else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) (e.preventDefault(), (sel = new Set(keysInView())));
  }

  const selTracks = $derived([...sel].filter((k) => k.startsWith("t:")).map((k) => k.slice(2)));
  const selFolders = $derived([...sel].filter((k) => k.startsWith("f:")).map((k) => k.slice(2)));
  const folderWord = (n: number) => (atArtist ? (n === 1 ? "projeto" : "projetos") : n === 1 ? "pasta" : "pastas");
  const countLabel = (nF: number, nT: number) => [nF ? `${nF} ${folderWord(nF)}` : "", nT ? plural(nT, "faixa", "faixas") : ""].filter(Boolean).join(" e ");

  // ---------- Delete with undo ----------
  let confirmDelete = $state(false);
  const deleteBody = $derived.by(() => {
    if (!a) return "";
    const parts: string[] = [];
    if (selTracks.length) parts.push(`As versões ${selTracks.length === 1 ? "da faixa" : "destas faixas"} também são apagadas.`);
    if (selFolders.length) {
      const inside = selFolders.flatMap((id) => tracksUnder(a, id)).length;
      const f = a.folders.find((x) => x.id === selFolders[0]);
      const what = atArtist ? (selFolders.length === 1 ? `O projeto “${f?.name}”` : "Os projetos") : selFolders.length === 1 ? `A pasta “${f?.name}”` : "As pastas";
      parts.push(`${what} e ${inside === 1 ? "a faixa" : `as ${inside} faixas`} lá dentro também ${selFolders.length === 1 && !atArtist ? "são apagadas" : "são apagados"}.`);
    }
    parts.push("Podes anular logo a seguir.");
    return parts.join(" ");
  });
  async function deleteItems(items: { trackIds?: string[]; folderIds?: string[]; versionIds?: string[] }, label: string) {
    try {
      const { batch } = await admin.deleteItems(artistId, items);
      sel = new Set();
      await refresh();
      if (folderId && items.folderIds?.some((id) => folderPath(store.artists[artistId] ?? a!, folderId).some((f) => f.id === id) || id === folderId)) navigate(base);
      toast(label, {
        label: "Anular",
        run: () => admin.restoreItems(artistId, batch).then((r) => (setArtist(r), toast("Reposto"))).catch(toastError),
      });
    } catch (e) {
      toastError(e);
    }
  }
  function doDeleteSelection() {
    confirmDelete = false;
    const nT = selTracks.length, nF = selFolders.length;
    const label = nF && nT ? `${nF + nT} itens apagados` : nF ? `${countLabel(nF, 0)} ${atArtist ? (nF === 1 ? "apagado" : "apagados") : nF === 1 ? "apagada" : "apagadas"}` : nT === 1 ? "1 faixa apagada" : `${nT} faixas apagadas`;
    void deleteItems({ trackIds: selTracks, folderIds: selFolders }, label);
  }

  // ---------- Uploads: + menu, file inputs and drop anywhere ----------
  let plusOpen = $state(false);
  let pickFiles = $state<HTMLInputElement>();
  let pickDir = $state<HTMLInputElement>();
  let versionFor: string | null = null;
  let pickVersion = $state<HTMLInputElement>();
  const upload = (files: File[], ctx: { folderId?: string | null; trackId?: string } = {}) =>
    startUploads(files, { artistId, folderId: ctx.folderId === undefined ? folderId : ctx.folderId, trackId: ctx.trackId }, refresh);

  /** A folder from the computer becomes a project at the artist level, or a folder inside a project. */
  async function uploadDirectory(files: File[], name: string | null) {
    const audio = files.filter((f) => /\.(wav|wave|mp3)$/i.test(f.name));
    const root = name ?? files[0]?.webkitRelativePath.split("/")[0] ?? "Pasta carregada";
    if (!audio.length) return toast(`A pasta “${root}” não tem ficheiros WAV ou MP3.`);
    try {
      const f = await admin.createFolder(artistId, { name: root.slice(0, 120), parentId: folderId });
      await refresh();
      toast(`${atArtist ? "Projeto" : "Pasta"} “${root}” criad${atArtist ? "o" : "a"} com ${plural(audio.length, "música", "músicas")}`);
      upload(audio, { folderId: f.id });
    } catch (e) {
      toastError(e);
    }
  }

  let drop = $state<{ title: string; sub: string } | null>(null);
  let dropRow: HTMLElement | null = null;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
  const FORMATS = "WAV (16/24 bit) ou MP3, até 200 MB cada";
  function dropTarget(e: DragEvent) {
    const row = (e.target instanceof Element ? e.target : null)?.closest<HTMLElement>("[data-selkey]");
    if (row?.dataset.selkey?.startsWith("t:")) {
      const t = a?.tracks.find((x) => x.id === row.dataset.selkey!.slice(2));
      if (t) return { row, trackId: t.id, title: `Larga para criar uma versão nova de “${t.title}”`, sub: `Fica como v${latest(t).number + 1}` };
    }
    if (row?.dataset.selkey?.startsWith("f:")) {
      const f = a?.folders.find((x) => x.id === row.dataset.selkey!.slice(2));
      if (f) return { row, folderId: f.id, title: `Larga para carregar em “${f.name}”`, sub: FORMATS };
    }
    return atArtist
      ? { row: null, title: `Larga para carregar em ${a?.artist.name ?? "artista"}`, sub: `${FORMATS} · uma pasta inteira vira um projeto` }
      : { row: null, title: `Larga para carregar em “${folder!.name}”`, sub: `${FORMATS} · pastas inteiras também` };
  }
  function winDragOver(e: DragEvent) {
    if (versionDrag) {
      // A version dropped anywhere outside its own track becomes a track.
      ghost = { x: e.clientX, y: e.clientY };
      splitHere = !(e.target instanceof Element ? e.target : null)?.closest(`[data-track="${versionDrag.trackId}"]`);
      if (splitHere) e.preventDefault();
      return;
    }
    if (rowDrag) {
      // Rows handle their own dragover; anywhere else drops nothing.
      rowMark = null;
      ghost = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    const t = dropTarget(e);
    if (dropRow !== t.row) {
      dropRow?.classList.remove("is-droptarget");
      dropRow = t.row;
      dropRow?.classList.add("is-droptarget");
    }
    drop = { title: t.title, sub: t.sub };
  }
  function endDrop() {
    drop = null;
    dropRow?.classList.remove("is-droptarget");
    dropRow = null;
  }
  async function winDrop(e: DragEvent) {
    if (versionDrag) {
      e.preventDefault();
      const d = versionDrag, ok = splitHere;
      versionDragEnd();
      if (ok) void splitVersion(d.versionId);
      return;
    }
    if (!hasFiles(e) || !e.dataTransfer) return;
    e.preventDefault();
    const t = dropTarget(e);
    endDrop();
    const { files, folderName } = await filesFromDrop(e.dataTransfer);
    if (t.trackId) upload(files, { trackId: t.trackId });
    else if (folderName && !t.folderId) void uploadDirectory(files, folderName);
    else upload(files, { folderId: t.folderId ?? folderId });
  }

  // ---------- Rows: drag to reorder, onto a folder to move, onto a track to make versions ----------
  let rowDrag: { keys: string[]; kind: "t" | "f" } | null = null;
  let rowMark = $state<{ key: string; where: "above" | "below" | "into" } | null>(null);
  let ghost = $state<{ x: number; y: number } | null>(null);
  function rowDragStart(e: DragEvent, key: string) {
    const keys = sel.has(key) ? [...sel] : [key];
    rowDrag = { keys, kind: key[0] as "t" | "f" };
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/x-nectr-rows", keys.join(","));
  }
  function rowDragOver(e: DragEvent, key: string) {
    if (!rowDrag || hasFiles(e) || rowDrag.keys.includes(key)) return;
    e.preventDefault();
    e.stopPropagation();
    ghost = { x: e.clientX, y: e.clientY };
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const middle = e.clientY - box.top;
    const inMiddle = middle > box.height * 0.25 && middle < box.height * 0.75;
    const onlyTracks = rowDrag.keys.every((k) => k[0] === "t");
    if (key.startsWith("f:") && (rowDrag.kind === "t" || inMiddle)) rowMark = { key, where: "into" };
    else if (key.startsWith("t:") && onlyTracks && inMiddle) rowMark = { key, where: "into" };
    else if (key[0] === rowDrag.kind && rowDrag.keys.every((k) => k[0] === rowDrag!.kind)) rowMark = { key, where: middle < box.height / 2 ? "above" : "below" };
    else rowMark = null;
  }
  function rowDragEnd() {
    rowMark = null;
    rowDrag = null;
    ghost = null;
  }

  // ---------- Versions: drag one out of its track to make it a track of its own ----------
  let versionDrag = $state<{ trackId: string; versionId: string } | null>(null);
  let splitHere = $state(false);
  function versionDragStart(e: DragEvent, t: TrackDTO, v: VersionDTO) {
    e.stopPropagation();
    versionDrag = { trackId: t.id, versionId: v.id };
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/x-nectr-version", v.id);
  }
  function versionDragEnd() {
    versionDrag = null;
    splitHere = false;
    ghost = null;
  }
  async function splitVersion(versionId: string) {
    try {
      const r = await admin.split(artistId, versionId);
      setArtist(r.artist);
      const t = r.artist.tracks.find((x) => x.id === r.trackId);
      toast(`“${t?.title}” passou a ser uma faixa à parte`, {
        label: "Anular",
        run: () => admin.unsplit(artistId, r).then((x) => (setArtist(x), toast("Reposto"))).catch(toastError),
      });
    } catch (e) {
      toastError(e);
    }
  }
  /** What dropping here does, next to the pointer while dragging rows. */
  const ghostText = $derived.by(() => {
    if (versionDrag) return splitHere ? "Passa a ser uma faixa à parte" : "";
    if (!rowMark || !a) return "";
    const n = rowDrag?.keys.length ?? 1;
    if (rowMark.where !== "into") return "Mudar a ordem";
    if (rowMark.key.startsWith("f:")) return `Mover para “${a.folders.find((f) => f.id === rowMark!.key.slice(2))?.name}”`;
    const t = a.tracks.find((x) => x.id === rowMark!.key.slice(2));
    return t ? `${n === 1 ? "Passa a ser" : "Passam a ser"} ${n === 1 ? `a v${latest(t).number + 1}` : "versões"} de “${t.title}”` : "";
  });
  async function rowDrop(e: DragEvent) {
    e.preventDefault();
    const mark = rowMark, drag = rowDrag;
    rowDragEnd();
    if (!mark || !drag || !a) return;
    try {
      if (mark.where === "into" && mark.key.startsWith("t:")) {
        await mergeTracks(drag.keys.map((k) => k.slice(2)), mark.key.slice(2));
      } else if (mark.where === "into") {
        const to = mark.key.slice(2);
        setArtist(await admin.move(artistId, { trackIds: drag.keys.filter((k) => k[0] === "t").map((k) => k.slice(2)), folderIds: drag.keys.filter((k) => k[0] === "f").map((k) => k.slice(2)), toFolderId: to }));
        toast(`Movido para “${a.folders.find((f) => f.id === to)?.name}”`);
      } else {
        const list = drag.kind === "t" ? tracks.map((t) => `t:${t.id}`) : folders.map((f) => `f:${f.id}`);
        const rest = list.filter((k) => !drag.keys.includes(k));
        rest.splice(rest.indexOf(mark.key) + (mark.where === "below" ? 1 : 0), 0, ...drag.keys);
        setArtist(await admin.reorder(artistId, { kind: drag.kind === "t" ? "tracks" : "folders", parentId: folderId, ids: rest.map((k) => k.slice(2)) }));
      }
    } catch (err) {
      toastError(err);
    }
  }
  async function mergeTracks(trackIds: string[], into: string) {
    const titles = trackIds.map((id) => a?.tracks.find((t) => t.id === id)?.title ?? "");
    const r = await admin.merge(artistId, trackIds, into);
    setArtist(r.artist);
    sel = new Set();
    const target = r.artist.tracks.find((t) => t.id === into);
    const nums = (target?.versions ?? []).filter((v) => r.moved.some((m) => m.versionId === v.id)).map((v) => v.number).sort((x, y) => x - y);
    const as = nums.length === 1 ? `a v${nums[0]}` : `as v${nums[0]} a v${nums.at(-1)}`;
    toast(`${trackIds.length === 1 ? `“${titles[0]}” passou a ser` : `${trackIds.length} faixas passaram a ser`} ${as} de “${target?.title}”`, {
      label: "Anular",
      run: () => admin.unmerge(artistId, r).then((x) => (setArtist(x), toast("Reposto"))).catch(toastError),
    });
  }
  const markClass = (key: string) => (rowMark?.key === key ? (rowMark.where === "into" ? "is-droptarget" : `drop-${rowMark.where}`) : "");

  // ---------- Menus and dialogs ----------
  let menuFor = $state<string | null>(null);
  let editingArtist = $state(false);
  let projectEdit = $state<{ project: FolderDTO | null } | null>(null);
  let folderEdit = $state<{ folder: FolderDTO | null } | null>(null);
  let moving = $state(false);
  let sharing = $state<{ type: "artist" | "folder" | "track"; id: string } | null>(null);
  let renaming = $state<TrackDTO | null>(null);
  let coverFor = $state<TrackDTO | null>(null);
  let versionEdit = $state<VersionDTO | null>(null);

  const newFolder = () => (atArtist ? (projectEdit = { project: null }) : (folderEdit = { folder: null }));
  const editFolder = (f: FolderDTO) => (f.parentId ? (folderEdit = { folder: f }) : (projectEdit = { project: f }));
  const plusItems = $derived<MenuItem[]>([
    { label: "Upload de música", hint: atArtist ? "Faixas soltas do artista (WAV/MP3)" : "Um ou vários WAV/MP3", icon: ICON.music, run: () => pickFiles?.click() },
    { label: "Upload de pasta", hint: atArtist ? "Uma pasta do computador vira um projeto" : "Todas as músicas de uma pasta do computador", icon: ICON.folderUp, run: () => pickDir?.click() },
    atArtist
      ? { label: "Novo projeto", hint: "Um álbum, um EP ou um single", icon: ICON.folderPlus, run: newFolder }
      : { label: "Nova pasta", hint: "Para demos, versões ao vivo ou o que quiseres", icon: ICON.folderPlus, run: newFolder },
  ]);

  function trackMenu(t: TrackDTO): MenuItem[] {
    const v = latest(t);
    return [
      { label: "Ouvir", icon: ICON.playSm, run: () => (wantPlay(), navigate(trackUrl(t.id))) },
      { label: "Adicionar versão", icon: ICON.plus, run: () => ((versionFor = t.id), pickVersion?.click()) },
      { label: "Mudar o nome", icon: ICON.pencil, run: () => (renaming = t) },
      { label: "Capa da faixa…", hint: t.artworkUrl ? "Tem capa própria" : "Agora usa a do projeto", icon: ICON.image, run: () => (coverFor = t) },
      { label: "Partilhar faixa", icon: ICON.share, run: () => (sharing = { type: "track", id: t.id }) },
      { label: "Descarregar faixa", hint: `v${v.number} · ficheiro original`, icon: ICON.download, run: () => (location.href = downloadUrl(v.id)) },
      { label: "Mover para…", icon: ICON.folderUp, run: () => ((sel = new Set([`t:${t.id}`])), (moving = true)) },
      ...(t.versions.length > 1 ? [{ label: "Manter apenas a última versão", hint: `Fica a v${v.number}; apaga ${t.versions.length === 2 ? `a v${t.versions[1]!.number}` : `as outras ${t.versions.length - 1}`}`, icon: ICON.layers, danger: true, run: () => (keepLatest = t) }] : []),
      { label: "Apagar faixa", icon: ICON.trash, danger: true, run: () => ((sel = new Set([`t:${t.id}`])), (confirmDelete = true)) },
    ];
  }

  // ---------- Keep only the latest version ----------
  let keepLatest = $state<TrackDTO | null>(null);
  const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}` : (xs[0] ?? ""));
  const keepBody = (t: TrackDTO) => {
    const old = t.versions.slice(1);
    const names = andList([...old].reverse().map((x) => `v${x.number}`));
    return `${old.length === 1 ? `A ${names}` : `As versões ${names}`} de “${t.title}” ${old.length === 1 ? "é apagada" : "são apagadas"}, com os comentários e as notas de voz que tiverem. Fica só a v${latest(t).number}. Podes anular logo a seguir; os ficheiros saem do armazenamento ao fim de 7 dias.`;
  };
  function doKeepLatest() {
    const t = keepLatest;
    keepLatest = null;
    if (t) void deleteItems({ versionIds: t.versions.slice(1).map((x) => x.id) }, `Ficou só a v${latest(t).number}`);
  }
  function folderMenu(f: FolderDTO): MenuItem[] {
    const kind = kindOf(f);
    const n = a ? tracksUnder(a, f.id).length : 0;
    return [
      { label: "Abrir", icon: ICON.chev, run: () => navigate(folderUrl(f.id)) },
      { label: `Editar ${kind}`, hint: f.parentId ? "Nome, ícone e cor" : "Capa, nome, ano e descrição", icon: ICON.pencil, run: () => editFolder(f) },
      { label: `Partilhar ${kind}`, icon: ICON.share, run: () => (sharing = { type: "folder", id: f.id }) },
      { label: "Ver como convidado", icon: ICON.eye, run: () => navigate(`${base}/convidado?scope=${f.id}`) },
      { label: "Mover para…", icon: ICON.folderUp, run: () => ((sel = new Set([`f:${f.id}`])), (moving = true)) },
      { label: `Apagar ${kind}`, hint: n ? `E tudo o que está lá dentro (${plural(n, "faixa", "faixas")})` : undefined, icon: ICON.trash, danger: true, run: () => ((sel = new Set([`f:${f.id}`])), (confirmDelete = true)) },
    ];
  }
  function versionMenu(t: TrackDTO, v: VersionDTO): MenuItem[] {
    return [
      { label: "Ouvir", icon: ICON.playSm, run: () => (wantPlay(), navigate(trackUrl(t.id, v.id))) },
      { label: "Nome e notas", icon: ICON.pencil, run: () => (versionEdit = v) },
      { label: "Descarregar original", icon: ICON.download, run: () => (location.href = downloadUrl(v.id)) },
      ...(t.versions.length > 1 ? [{ label: "Tornar faixa independente", hint: "Também podes arrastá-la para fora da lista", icon: ICON.music, run: () => void splitVersion(v.id) }] : []),
      { label: "Apagar versão", icon: ICON.trash, danger: true, run: () => void deleteItems({ versionIds: [v.id] }, `v${v.number} apagada`) },
    ];
  }

  // Right-click: a row's menu, the selection's when several are selected, or the + menu on empty space.
  let ctx = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  function onContext(e: MouseEvent) {
    const el = e.target as Element;
    if (!a || el.closest("input, textarea, .crumbs a, .proj-info a, .page-foot")) return;
    e.preventDefault();
    menuFor = null;
    plusOpen = false;
    const vkey = el.closest<HTMLElement>("[data-vkey]")?.dataset.vkey;
    const key = el.closest<HTMLElement>("[data-selkey]")?.dataset.selkey;
    let items = plusItems;
    if (vkey) {
      const t = a.tracks.find((x) => x.versions.some((v) => v.id === vkey));
      const v = t?.versions.find((x) => x.id === vkey);
      if (t && v) items = versionMenu(t, v);
    } else if (key && sel.has(key) && sel.size > 1) {
      const what = countLabel(selFolders.length, selTracks.length);
      items = [
        { label: `Mover ${what} para…`, icon: ICON.folderUp, run: () => (moving = true) },
        { label: `Apagar ${what}`, icon: ICON.trash, danger: true, run: () => (confirmDelete = true) },
      ];
    } else if (key) {
      sel = new Set([key]);
      anchor = key;
      const t = key.startsWith("t:") ? a.tracks.find((x) => x.id === key.slice(2)) : undefined;
      const f = key.startsWith("f:") ? a.folders.find((x) => x.id === key.slice(2)) : undefined;
      items = t ? trackMenu(t) : f ? folderMenu(f) : plusItems;
    }
    ctx = { x: e.clientX, y: e.clientY, items };
  }
  const folderStats = (f: FolderDTO) => {
    const ts = a ? tracksUnder(a, f.id) : [];
    return { n: ts.length, dur: ts.reduce((s, t) => s + latest(t).durationS, 0), last: ts.reduce((m, t) => Math.max(m, t.updatedAt), f.updatedAt) };
  };
  const shareHere = () => (sharing = folder ? { type: "folder", id: folder.id } : { type: "artist", id: artistId });
  const previewUrl = $derived(`${base}/convidado${folder ? `?scope=${folder.id}` : ""}`);
</script>

<svelte:window onpointermove={winMove} onpointerup={winUp} onkeydown={winKey} ondragover={winDragOver} ondrop={winDrop} ondragleave={(e) => !e.relatedTarget && endDrop()} />

{#snippet uploadCell(u: UploadItem)}
  <span class="upbar"><i style="--p:{Math.round((u.stage === 'upload' ? u.sent : 1) * 100)}%"></i></span><span class="upstate" class:err={u.stage === "error"}>{uploadLabel(u)}</span>
{/snippet}

{#snippet folderThumb(f: FolderDTO, size: "sm" | "lg")}
  {#if !isRelease(f)}
    <span class="ficon {size === 'sm' ? 'sm' : ''}" style="--fc:{f.color}">{@html folderIcon(f.icon, size === "sm" ? 15 : 20)}</span>
  {:else}
    <Art color={f.color} url={f.artworkUrl} seed={f.name} cls={size === "sm" ? "mini thumb" : ""} />
  {/if}
{/snippet}

{#snippet folderTable(list: FolderDTO[], label: string, kindCol: boolean)}
  <div class="list-label"><span class="section-label">{label}</span><span class="n">{list.length}</span></div>
  <div class="table-wrap">
    <table class="tracks ftable">
      <thead><tr><th data-col="name">Nome</th>{#if atArtist}<th class="r">{kindCol ? "Tipo" : "Ano"}</th>{/if}<th class="r">Faixas</th><th class="r">Duração</th><th>Atualizado</th><th></th></tr></thead>
      <tbody>
        {#each list as f (f.id)}
          {@const s = folderStats(f)}
          <tr data-selkey="f:{f.id}" class="{sel.has(`f:${f.id}`) ? 'is-selected' : ''} {markClass(`f:${f.id}`)}" draggable="true"
            onclick={(e) => rowClick(e, `f:${f.id}`)} ondragstart={(e) => rowDragStart(e, `f:${f.id}`)} ondragover={(e) => rowDragOver(e, `f:${f.id}`)} ondrop={rowDrop} ondragend={rowDragEnd}>
            <td class="name"><span class="fname-cell">{@render folderThumb(f, "sm")}<span>{f.name}</span></span></td>
            {#if atArtist}<td class="r" class:muted={kindCol}>{kindCol ? KIND_LABEL[f.kind] : (f.year ?? "—")}</td>{/if}
            <td class="r">{s.n}</td>
            <td class="r">{fmtTime(s.dur)}</td>
            <td class="muted">{date(s.last)}</td>
            <td><div class="plus-wrap"><button class="iconbtn sm" type="button" aria-label="Mais ações para {kindOf(f)} {f.name}" onclick={() => (menuFor = menuFor === `f:${f.id}` ? null : `f:${f.id}`)}>{@html ICON.dots}</button>{#if menuFor === `f:${f.id}`}<Menu items={folderMenu(f)} onclose={() => (menuFor = null)} />{/if}</div></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

{#snippet phoneFolders(list: FolderDTO[], label: string)}
  {@const aa = a!}
  <div class="m-section">{label}</div>
  <div class="m-list">
    {#each list as f (f.id)}
      <a class="m-row" href={folderUrl(f.id)} style="text-decoration:none">
        {@render folderThumb(f, "sm")}
        <span><span class="t">{f.name}</span><span class="s">{[isRelease(f) && f.year ? String(f.year) : !f.parentId && !isRelease(f) ? KIND_LABEL[f.kind] : "", plural(tracksUnder(aa, f.id).length, "faixa", "faixas")].filter(Boolean).join(" · ")}</span></span>
        <span class="faint">{@html ICON.chev}</span>
      </a>
    {/each}
  </div>
{/snippet}

{#snippet trackCell(key: string, t: TrackDTO, i: number)}
  {@const v = latest(t)}
  {#if key === "num"}<td class="num"><span class="n">{i + 1}</span><button class="ico" type="button" aria-label="Ouvir {t.title}" onclick={() => (wantPlay(), navigate(trackUrl(t.id)))}>{@html ICON.playSm}</button></td>
  {:else if key === "name"}<td class="name" title={t.sessionName ? `${t.title} · projeto no Ableton: ${t.sessionName}` : t.title}>{#if t.artworkUrl}<Art color={color} url={t.artworkUrl} tag="span" cls="thumb inline-thumb" />{/if}{t.title}{#if t.sessionName}<span class="sess">{t.sessionName}</span>{/if}</td>
  {:else if key === "dur"}<td class="r">{fmtDuration(v.durationS)}</td>
  {:else if key === "fmt"}<td class="kind">{fmtLabel(v)}</td>
  {:else if key === "sr"}<td class="r">{kHz(v.sampleRate)}</td>
  {:else if key === "lufs"}<td class="r">{v.lufsIntegrated === null ? "—" : num(v.lufsIntegrated)}</td>
  {:else if key === "tp"}<td class="r" class:warn={v.truePeakDbtp !== null && v.truePeakDbtp > -1}>{v.truePeakDbtp === null ? "—" : `${num(v.truePeakDbtp)} dBTP`}</td>
  {:else if key === "date"}<td class="muted">{date(v.createdAt)}</td>
  {:else if key === "ver"}
    {@const vu = versionUpload(t.id)}
    <td>
      {#if vu}{@render uploadCell(vu)}{:else}
        <button class="vbadge" class:is-open={expanded.has(t.id)} type="button" aria-expanded={expanded.has(t.id)} aria-label="Versões de {t.title}" onclick={() => toggleExpand(t.id)}>{@html ICON.layers}v{v.number}<span class="faint">/ {t.versions.length}</span></button>
      {/if}
    </td>
  {:else if key === "req"}
    <td>{#if t.openRequests}<span class="ccount" title="Pedidos abertos">{@html ICON.commentSm}{t.openRequests}</span>{:else}<span class="ccount none">—</span>{/if}</td>
  {:else}
    <td><div class="plus-wrap"><button class="iconbtn sm" type="button" aria-label="Mais ações" onclick={() => (menuFor = menuFor === `t:${t.id}` ? null : `t:${t.id}`)}>{@html ICON.dots}</button>{#if menuFor === `t:${t.id}`}<Menu items={trackMenu(t)} onclose={() => (menuFor = null)} />{/if}</div></td>
  {/if}
{/snippet}

{#snippet versionCell(key: string, t: TrackDTO, v: VersionDTO, isLatest: boolean)}
  {#if key === "num"}<td class="num vline"></td>
  {:else if key === "name"}<td class="name" title={[v.originalFilename, v.notes].filter(Boolean).join(" · ")}><span class="vname"><b>{v.name ?? fileStem(v.originalFilename)}</b><span class="vnum">v{v.number}{v.label ? ` · ${v.label}` : ""}</span></span>{#if v.notes}<span class="vnotes">{v.notes}</span>{/if}</td>
  {:else if key === "dur"}<td class="r">{fmtDuration(v.durationS)}</td>
  {:else if key === "fmt"}<td class="kind">{fmtLabel(v)}</td>
  {:else if key === "sr"}<td class="r">{kHz(v.sampleRate)}</td>
  {:else if key === "lufs"}<td class="r">{v.lufsIntegrated === null ? "—" : num(v.lufsIntegrated)}</td>
  {:else if key === "tp"}<td class="r" class:warn={v.truePeakDbtp !== null && v.truePeakDbtp > -1}>{v.truePeakDbtp === null ? "—" : `${num(v.truePeakDbtp)} dBTP`}</td>
  {:else if key === "date"}<td class="muted">{date(v.createdAt)}</td>
  {:else if key === "ver"}<td>{#if isLatest}<span class="tag">Atual</span>{/if}</td>
  {:else if key === "req"}<td></td>
  {:else}
    <td><div class="plus-wrap"><button class="iconbtn sm" type="button" aria-label="Mais ações para v{v.number}" onclick={() => (menuFor = menuFor === `v:${v.id}` ? null : `v:${v.id}`)}>{@html ICON.dots}</button>{#if menuFor === `v:${v.id}`}<Menu items={versionMenu(t, v)} onclose={() => (menuFor = null)} />{/if}</div></td>
  {/if}
{/snippet}

{#snippet phoneView()}
  {@const aa = a!}
  {@const back = folder?.parentId ? folderUrl(folder.parentId) : folder ? base : "/admin"}
  {@const backLabel = folder?.parentId ? aa.folders.find((f) => f.id === folder.parentId)?.name : folder ? aa.artist.name : "Biblioteca"}
  <section class="proj-scope is-entering" style="{projStyle};padding-bottom:24px">
    <div class="m-topbar"><a class="m-back" href={back} style="text-decoration:none">{@html ICON.back}{backLabel}</a></div>
    <div class="m-proj">
      {#if folder && !folder.parentId && !isRelease(folder)}<Art color={folder.color} icon={folder.icon} seed={folder.name} />
      {:else if folder}{@render folderThumb(folder, "lg")}{:else}<Art color={aa.artist.color} url={aa.artist.photoUrl} seed={aa.artist.name} />{/if}
      <div style="min-width:0;flex:1">
        <p class="ph-title">{folder?.name ?? aa.artist.name}</p>
        <p class="ph-by">
          {#if !folder}{plural(projectsOf(aa).length, "projeto", "projetos")} · {plural(aa.tracks.length, "faixa", "faixas")}
          {:else}{folder.parentId ? project?.name : aa.artist.name}{!folder.parentId && folder.year ? ` · ${folder.year}` : ""} · {plural(tracksUnder(aa, folder.id).length, "faixa", "faixas")}{/if}
        </p>
      </div>
      <button class="iconbtn sm" type="button" aria-label="Editar" onclick={() => (folder ? editFolder(folder) : (editingArtist = true))}>{@html ICON.pencil}</button>
    </div>
    <div class="m-proj-actions">
      <button class="btn btn-primary sm" type="button" onclick={shareHere}>Partilhar</button>
      <div class="plus-wrap">
        <button class="btn icon-only sm" type="button" aria-label="Adicionar" onclick={() => (plusOpen = !plusOpen)}>{@html ICON.plus}</button>
        {#if plusOpen}<Menu align="left" onclose={() => (plusOpen = false)} items={plusItems.filter((x) => x.label !== "Upload de pasta")} />{/if}
      </div>
    </div>
    {#if releases.length}{@render phoneFolders(releases, atArtist ? "Álbuns e EPs" : "Pastas")}{/if}
    {#if workFolders.length}{@render phoneFolders(workFolders, "Outros projetos")}{/if}
    {#if tracks.length || newUploads.length || !atArtist || !folders.length}
      <div class="m-section">{atArtist ? "Faixas soltas" : "Faixas"}</div>
      <div class="m-list">
        {#each tracks as t, i (t.id)}
          {@const v = latest(t)}
          <a class="m-row" href={trackUrl(t.id)} style="text-decoration:none">
            <span class="mplay" role="presentation" aria-label="Ouvir" onclick={wantPlay}>{@html ICON.playSm}</span>
            <span><span class="t">{t.title}{#if t.sessionName}<span class="sess">{t.sessionName}</span>{/if}</span><span class="s">v{v.number} · {fmtDuration(v.durationS)}{v.lufsIntegrated !== null ? ` · ${num(v.lufsIntegrated)} LUFS` : ""}</span></span>
            {#if t.openRequests}<span class="ccount" title="Pedidos abertos">{@html ICON.commentSm}{t.openRequests}</span>{:else}<span class="faint">{@html ICON.chev}</span>{/if}
          </a>
        {/each}
        {#each newUploads as u (u.key)}
          <div class="m-row"><span class="n"></span><span><span class="t">{u.title}</span><span class="s">{@render uploadCell(u)}</span></span><span></span></div>
        {/each}
        {#if !tracks.length && !newUploads.length}<p class="empty">{atArtist ? "Cria um projeto com o botão + e carrega as músicas lá dentro." : "Ainda não há faixas aqui. Usa o botão + para carregar."}</p>{/if}
      </div>
    {/if}
  </section>
{/snippet}

{#if failed}
  <div class="page-error"><h1>{failed}</h1><a class="btn" href="/admin">Voltar à biblioteca</a></div>
{:else if !a}
  <p class="page-loading">A carregar…</p>
{:else if folderId && !folder}
  <div class="page-error"><h1>Não encontrado</h1><a class="btn" href={base}>Voltar a {a.artist.name}</a></div>
{:else if viewport.phone}
  {@render phoneView()}
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <section class="proj-scope is-entering page-fill" style={projStyle} oncontextmenu={onContext}>
    <div class="proj-head">
      {#if project}
        <Art color={project.color} url={project.artworkUrl} icon={isRelease(project) ? null : project.icon} seed={project.name} />
        <div class="proj-info">
          <span class="eyebrow">{KIND_EYEBROW[project.kind]}</span>
          <h1 class="title-xl">{#if folder?.parentId}<a href={folderUrl(project.id)} style="color:inherit;text-decoration:none">{project.name}</a>{:else}{project.name}{/if}</h1>
          <p>
            <a class="by" href={base} style="color:inherit">{a.artist.name}</a>
            <span class="muted">{project.year ? ` · ${project.year}` : ""}{project.label ? ` · ${project.label}` : ""} · {plural(tracksUnder(a, project.id).length, "faixa", "faixas")}</span>
          </p>
          {#if project.description}<p class="proj-desc muted">{project.description}</p>{/if}
        </div>
        <button class="iconbtn proj-edit" type="button" aria-label="Editar projeto" data-tip="Editar projeto" onclick={() => (projectEdit = { project })}>{@html ICON.pencil}</button>
      {:else}
        <Art color={a.artist.color} url={a.artist.photoUrl} seed={a.artist.name} />
        <div class="proj-info">
          <span class="eyebrow">Artista</span>
          <h1 class="title-xl">{a.artist.name}</h1>
          <p class="muted">{plural(projectsOf(a).length, "projeto", "projetos")} · {plural(a.tracks.length, "faixa", "faixas")} · desde {date(a.artist.createdAt)}</p>
          {#if a.artist.description}<p class="proj-desc muted">{a.artist.description}</p>{/if}
        </div>
        <button class="iconbtn proj-edit" type="button" aria-label="Editar artista" data-tip="Editar artista" onclick={() => (editingArtist = true)}>{@html ICON.pencil}</button>
      {/if}
      <div class="actions">
        <div class="plus-wrap">
          <button class="btn icon-only" type="button" aria-haspopup="menu" aria-expanded={plusOpen} aria-label="Adicionar" onclick={() => (plusOpen = !plusOpen)}>{@html ICON.plusLg}</button>
          {#if plusOpen}<Menu onclose={() => (plusOpen = false)} items={plusItems} />{/if}
        </div>
        <button class="btn btn-primary" type="button" onclick={shareHere}>{@html ICON.share}Partilhar</button>
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="proj-body" bind:this={zone} onpointerdown={zoneDown}>
      <div class="table-tools">
        <nav class="crumbs" aria-label="Onde estás">
          {#if folder}
            <a href={base} style="color:inherit;font-weight:600">{a.artist.name}</a>
            {#each folderPath(a, folderId) as f, i (f.id)}
              {@html ICON.chev}
              {#if i === folderPath(a, folderId).length - 1}
                <strong>{#if f.parentId}<span class="ficon sm" style="--fc:{f.color}">{@html folderIcon(f.icon, 15)}</span>{/if}{f.name}</strong>
              {:else}<a href={folderUrl(f.id)} style="color:inherit;font-weight:600">{f.name}</a>{/if}
            {/each}
            {#if folder.parentId}<button class="iconbtn sm" type="button" aria-label="Editar pasta" onclick={() => (folderEdit = { folder })}>{@html ICON.pencil}</button>{/if}
          {:else}<strong>{a.artist.name}</strong>{/if}
        </nav>
      </div>

      <div class="select-zone">
        {#if releases.length}{@render folderTable(releases, atArtist ? "Álbuns e EPs" : "Pastas", false)}{/if}
        {#if workFolders.length}{@render folderTable(workFolders, "Outros projetos", true)}{/if}

        {#if tracks.length || newUploads.length || !atArtist || !folders.length}
          <div class="list-label"><span class="section-label">{atArtist ? "Faixas soltas" : "Faixas"}</span><span class="n">{tracks.length || ""}</span></div>
          <div class="table-wrap">
            <table class="tracks">
              <thead>
                <tr>
                  {#each cols as k (k)}
                    <th data-col={k} class:r={COLS[k]!.r} class:is-dragging={dragCol === k} class:drop-before={dropCol?.key === k && !dropCol.after} class:drop-after={dropCol?.key === k && dropCol.after}
                      draggable={COLS[k]!.fixed ? undefined : "true"} title={COLS[k]!.fixed ? undefined : "Arrasta para mudar a ordem das colunas"}
                      ondragstart={(e) => { if (COLS[k]!.fixed) return; dragCol = k; e.dataTransfer!.setData("text/x-nectr-col", k); }}
                      ondragover={(e) => { if (!dragCol || COLS[k]!.fixed || k === dragCol) return; e.preventDefault(); const b = e.currentTarget.getBoundingClientRect(); dropCol = { key: k, after: e.clientX > b.left + b.width / 2 }; }}
                      ondrop={(e) => { e.preventDefault(); colDrop(k); }}
                      ondragend={() => ((dragCol = null), (dropCol = null))}>{COLS[k]!.label}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each tracks as t, i (t.id)}
                  <tr data-selkey="t:{t.id}" data-track={t.id} class="{sel.has(`t:${t.id}`) ? 'is-selected' : ''} {expanded.has(t.id) ? 'is-expanded' : ''} {markClass(`t:${t.id}`)}" draggable="true"
                    onclick={(e) => rowClick(e, `t:${t.id}`)} ondragstart={(e) => rowDragStart(e, `t:${t.id}`)} ondragover={(e) => rowDragOver(e, `t:${t.id}`)} ondrop={rowDrop} ondragend={rowDragEnd}>
                    {#each cols as k (k)}{@render trackCell(k, t, i)}{/each}
                  </tr>
                  {#if expanded.has(t.id)}
                    <tr class="vrow vadd vrow-enter" data-track={t.id}>
                      <td class="num vline"><span class="vplus">{@html ICON.plus}</span></td>
                      <td colspan={cols.length - 1}><button class="vadd-btn" type="button" onclick={() => ((versionFor = t.id), pickVersion?.click())}>Adicionar versão</button><span class="faint" style="font-size:12.5px;margin-left:10px">ou larga um ficheiro em cima da faixa</span></td>
                    </tr>
                    {#each t.versions as v, vi (v.id)}
                      <tr class="vrow vrow-enter" class:last={vi === t.versions.length - 1} style="--i:{vi + 1}" data-vkey={v.id} data-track={t.id}
                        draggable={t.versions.length > 1 ? "true" : undefined} ondragstart={(e) => versionDragStart(e, t, v)} ondragend={versionDragEnd} onclick={(e) => !(e.target as Element).closest("button, .menu") && navigate(trackUrl(t.id, v.id))}>
                        {#each cols as k (k)}{@render versionCell(k, t, v, vi === 0)}{/each}
                      </tr>
                    {/each}
                  {/if}
                {/each}
                {#each newUploads as u (u.key)}
                  <tr>
                    {#each cols as k (k)}
                      {#if k === "num"}<td class="num"></td>
                      {:else if k === "name"}<td class="name"><div>{u.title}</div><div>{@render uploadCell(u)}</div></td>
                      {:else}<td class="faint">{k === "more" ? "" : "—"}</td>{/if}
                    {/each}
                  </tr>
                {/each}
                {#if !tracks.length && !newUploads.length}
                  <tr><td colspan={cols.length}><p class="empty">{atArtist ? "Cria um projeto com o botão + (ou larga uma pasta) e carrega as músicas lá dentro." : "Ainda não há faixas aqui. Larga ficheiros WAV ou MP3 nesta janela, ou usa o botão +."}</p></td></tr>
                {/if}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- Stays at the bottom of the window: the selection bar and "view as guest". -->
      <div class="page-foot">
        {#if sel.size}
          <div class="selbar">
            <span>{countLabel(selFolders.length, selTracks.length)} {sel.size === 1 ? (selFolders.length && atArtist ? "selecionado" : "selecionada") : selFolders.length && atArtist && !selTracks.length ? "selecionados" : "selecionadas"}</span>
            <button type="button" onclick={() => (moving = true)}>Mover para…</button>
            <button type="button" class="danger" onclick={() => (confirmDelete = true)}>Apagar</button>
            <button type="button" aria-label="Limpar seleção" onclick={() => (sel = new Set())}>{@html ICON.close}</button>
          </div>
        {/if}
        <a class="fab" href={previewUrl} aria-label="Ver como convidado" data-tip="Ver como convidado">{@html ICON.eye}</a>
      </div>
    </div>
  </section>
{/if}

{#if a}
  <input type="file" bind:this={pickFiles} multiple accept=".wav,.wave,.mp3,audio/wav,audio/x-wav,audio/mpeg" hidden onchange={(e) => (upload([...(e.currentTarget.files ?? [])]), (e.currentTarget.value = ""))} />
  <input type="file" bind:this={pickDir} webkitdirectory multiple hidden onchange={(e) => (void uploadDirectory([...(e.currentTarget.files ?? [])], null), (e.currentTarget.value = ""))} />
  <input type="file" bind:this={pickVersion} accept=".wav,.wave,.mp3,audio/wav,audio/x-wav,audio/mpeg" hidden onchange={(e) => (versionFor && upload([...(e.currentTarget.files ?? [])], { trackId: versionFor }), (e.currentTarget.value = ""))} />
  {#if marquee && (Math.abs(marquee.x1 - marquee.x0) > 4 || Math.abs(marquee.y1 - marquee.y0) > 4)}
    <div class="marquee proj-scope" style="{projStyle};left:{Math.min(marquee.x0, marquee.x1)}px;top:{Math.min(marquee.y0, marquee.y1)}px;width:{Math.abs(marquee.x1 - marquee.x0)}px;height:{Math.abs(marquee.y1 - marquee.y0)}px"></div>
  {/if}
  {#if ctx}<Menu items={ctx.items} at={ctx} onclose={() => (ctx = null)} />{/if}
  {#if ghost && ghostText}<div class="drag-ghost" style="left:{ghost.x}px;top:{ghost.y}px">{ghostText}</div>{/if}
  {#if drop}
    <div class="drop-overlay proj-scope" style="{projStyle};position:fixed"><div><strong>{drop.title}</strong><p>{drop.sub}</p></div></div>
  {/if}

  {#if confirmDelete}
    <Confirm title="Apagar {countLabel(selFolders.length, selTracks.length)}?" body={deleteBody} onconfirm={doDeleteSelection} oncancel={() => (confirmDelete = false)} />
  {/if}
  {#if keepLatest}
    <Confirm title="Manter apenas a v{latest(keepLatest).number}?" body={keepBody(keepLatest)} confirm={keepLatest.versions.length === 2 ? `Apagar a v${keepLatest.versions[1]!.number}` : "Apagar as antigas"} onconfirm={doKeepLatest} oncancel={() => (keepLatest = null)} />
  {/if}
  {#if editingArtist}<ArtistEditor artist={a.artist} onsaved={setArtist} onclose={() => (editingArtist = false)} />{/if}
  {#if projectEdit}
    {@const pe = projectEdit.project}
    <ProjectEditor {artistId} project={pe} defaultColor={a.artist.color} onclose={() => (projectEdit = null)}
      onsaved={async (created) => { await refresh(); if (created) navigate(folderUrl(created.id)); }} />
  {/if}
  {#if folderEdit}
    {@const fe = folderEdit.folder}
    <FolderEditor {artistId} folder={fe} parentId={folderId} trackCount={fe ? tracksUnder(a, fe.id).length : 0} onsaved={refresh}
      ondelete={fe ? () => ((sel = new Set([`f:${fe.id}`])), (confirmDelete = true)) : undefined} onclose={() => (folderEdit = null)} />
  {/if}
  {#if moving}<MoveDialog {a} trackIds={selTracks} folderIds={selFolders} onmoved={(r) => ((sel = new Set()), setArtist(r))} onclose={() => (moving = false)} />{/if}
  {#if sharing}<ShareDialog {a} context={sharing} onclose={() => (sharing = null)} />{/if}
  {#if coverFor}
    {@const ct = coverFor}
    {@const cp = projectOf(a, ct.folderId)}
    <TrackCoverDialog track={ct} fallback={(cp && isRelease(cp) ? cp.artworkUrl : null) ?? a.artist.photoUrl} color={cp?.color ?? a.artist.color} onsaved={setArtist} onclose={() => (coverFor = null)} />
  {/if}
  {#if renaming}
    {@const t = renaming}
    <PromptDialog title="Mudar o nome" label="Nome da faixa" value={t.title} onclose={() => (renaming = null)}
      extraLabel="Nome do projeto no Ableton" extra={t.sessionName} extraHelp="Só tu vês este nome; quem abre os teus links nunca o vê."
      onsubmit={async (title, _notes, session) => { if (!title) throw new Error(); await admin.renameTrack(t.id, title, session).catch((e) => { toastError(e); throw e; }); await refresh(); }} />
  {/if}
  {#if versionEdit}
    {@const v = versionEdit}
    <PromptDialog title="v{v.number}: nome e notas" subtitle="As notas aparecem a quem ouve, em “Sobre esta versão”." label="Nome da versão (ex.: vocals up)" value={v.label} notesLabel="Notas" notes={v.notes}
      onclose={() => (versionEdit = null)}
      onsubmit={async (label, notes) => { await admin.updateVersion(v.id, { label, notes }).catch((e) => { toastError(e); throw e; }); await refresh(); }} />
  {/if}
{/if}

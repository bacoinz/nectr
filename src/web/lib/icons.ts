// Inline SVG icons (own drawings, Lucide-style strokes). Rendered with {@html};
// every string here is a constant, never user input.

const svg = (body: string, size = 20, fill = false) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${body}</svg>`;

export const ICON = {
  play: svg('<path d="M8 5.2v13.6L19 12z"/>', 22, true),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>', 22, true),
  playSm: svg('<path d="M8 5.2v13.6L19 12z"/>', 14, true),
  pauseSm: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>', 14, true),
  start: svg('<rect x="5" y="5.5" width="2.6" height="13" rx="1"/><path d="M19 5.8v12.4L9.2 12z"/>', 20, true),
  next: svg('<path d="M5 5.8v12.4L14.8 12z"/><rect x="16.4" y="5.5" width="2.6" height="13" rx="1"/>', 20, true),
  rew: svg('<path d="M11.6 6.2v11.6L3.6 12zM20.4 6.2v11.6L12.4 12z"/>', 20, true),
  ff: svg('<path d="M12.4 6.2v11.6l8-5.8zM3.6 6.2v11.6l8-5.8z"/>', 20, true),
  zoomIn: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6M11 8v6"/>', 19),
  zoomOut: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6"/>', 19),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 15),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 19),
  commentSm: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 14),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 14),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>', 14),
  back: svg('<path d="m15 18-6-6 6-6"/>', 16),
  chev: svg('<path d="m9 18 6-6-6-6"/>', 14),
  chevDown: svg('<path d="m6 9 6 6 6-6"/>', 14),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 16),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16),
  plusLg: svg('<path d="M12 5v14M5 12h14"/>', 18).replace('stroke-width="2.2"', 'stroke-width="2.4"'),
  dots: svg('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>', 16, true),
  loop: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', 19),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>', 18),
  list: svg('<path d="M10 6h10M10 12h10M10 18h10M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>', 18),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 18),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>', 18),
  volumeLow: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>', 18),
  volumeOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>', 18),
  reorder: svg('<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5"/>', 17),
  bell: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>', 17),
  bellOn: svg('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" fill="currentColor"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>', 17),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 17),
  pencil: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', 17),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 20),
  share: svg('<path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>', 16),
  download: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', 16),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', 18),
  folderUp: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13l3-3 3 3"/>', 18),
  folderPlus: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>', 18),
  warn: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', 15),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>', 16),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', 16),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', 19),
  send: svg('<path d="M4 20.2 21 12 4 3.8l-.1 6.4L15.6 12 3.9 13.8z"/>', 18, true),
  reply: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v1"/>', 14),
  checkBold: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14).replace('stroke-width="2.2"', 'stroke-width="3.2"'),
  lockSm: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 12),
  eyeSm: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 12),
  lockMd: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 15),
  eyeMd: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 15),
  revisions: svg('<path d="M10 6h10M10 12h10M10 18h10M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>', 18),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', 16),
};

/** The nectr drop. Needs the #g-logo gradient from Logo.svelte (rendered once in each shell). */
export const LOGO = (size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8c8 10.5 16 19 16 28a16 16 0 0 1-32 0c0-9 8-17.5 16-28z" fill="url(#g-logo)"/></svg>`;

export const FOLDER_ICON_SVG: Record<string, [label: string, body: string]> = {
  folder: ["Pasta", '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
  disc: ["Álbum", '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'],
  mic: ["Ao vivo", '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'],
  ticket: ["Concerto", '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 7v2M13 11v2M13 15v2"/>'],
  star: ["Destaque", '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'],
  headphones: ["Demos", '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>'],
  note: ["Música", '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'],
  wave: ["Áudio", '<path d="M2 12h3l2-6 3 12 3-9 2 5 2-2h5"/>'],
  heart: ["Favoritos", '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'],
  flame: ["Quente", '<path d="M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3 0-5 1-8z"/>'],
  moon: ["Noite", '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'],
  sun: ["Dia", '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
};

export const folderIcon = (key: string, size = 20) => svg((FOLDER_ICON_SVG[key] ?? FOLDER_ICON_SVG.folder!)[1], size);

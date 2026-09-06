const paths: Record<string, string> = {
  wave: '<path d="M2 9c3-5 6 5 10 0s7 5 10 0M2 15c3-5 6 5 10 0s7 5 10 0"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  suit: '<path d="m8 3-5 4 3 6 2-2v10h3v-7h2v7h3V11l2 2 3-6-5-4-4 3-4-3Z"/>',
  book: '<path d="M12 5v15M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1V4Z"/>',
  fish: '<path d="M3 12c4-7 10-7 14-2l4-4v12l-4-4C13 19 7 19 3 12Z"/><circle cx="8" cy="11" r=".7" fill="currentColor"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 4-2 2 3 3v3l4 1 2-2 4 1 2-3-1-3 2-3-2-3h-3l-2-3-4 1Z"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  oxygen:
    '<rect x="7" y="5" width="10" height="17" rx="4"/><path d="M10 5V2h4v3M7 11h10"/>',
  spear: '<path d="m3 21 15-15m-7 1 9-4-4 9M6 15l3 3"/>',
  scanner:
    '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="4"/><path d="M12 8v4l3 2"/>',
  net: '<circle cx="14" cy="9" r="6"/><path d="m3 21 7-8M10 5l8 8m-7 0 7-8M8 9h12m-6-6v12"/>',
  cutter: '<path d="m4 20 8-8m-3-3 6-6 6 6-6 6-6-6Zm7-5 4 4M3 15l6 6"/>',
  cargo: '<path d="m3 7 9-4 9 4v13H3V7Zm0 0 9 5 9-5M12 12v8M7 5l10 5"/>',
  heart:
    '<path d="M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  sound:
    '<path d="m11 4-5 5H3v6h3l5 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-5 5H3v6h3l5 5V4Zm5 5 6 6m0-6-6 6"/>',
  star: '<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1 3-7Z"/>',
  depth: '<path d="M12 3v18m-5-5 5 5 5-5M3 5h3m-3 5h3m-3 5h3"/>',
  leaf: '<path d="M4 20C0 4 10 2 21 3c1 11-5 18-17 17Zm0 0L17 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  home: '<path d="m2 11 10-8 10 8M5 9v12h14V9M9 21v-7h6v7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
export function icon(name: string, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.fish}</svg>`;
}
export function speciesArt(id: string, color = "#a4d2c5"): string {
  let body = "";
  if (id === "seahorse")
    body =
      '<path d="M72 21c-9-7-24-2-23 8l-13 6 15 4c0 13-17 15-10 28 5 9 22 3 15-6-4-5-10-1-7 2" fill="none" stroke="C" stroke-width="11" stroke-linecap="round"/><path d="m57 18 4-8 5 10m-17 30-12-1 8 12" fill="C"/><circle cx="61" cy="28" r="2.5" fill="#143e44"/>';
  else if (id === "ray" || id === "glowray")
    body =
      '<path d="M57 33C42 36 35 8 9 19c5 7 12 36 40 35l9 2c10 19 33 17 41 24-5-12-28-20-30-27 23 0 27-22 39-33-29-6-36 13-51 13Z" fill="C"/><circle cx="54" cy="39" r="2" fill="#173941"/><circle cx="64" cy="39" r="2" fill="#173941"/><path d="m26 25 17 13m44-13L74 38" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>';
  else if (id === "jellyfish")
    body =
      '<path d="M30 40a30 28 0 0 1 60 0c-13 7-46 7-60 0Z" fill="C"/><path d="M39 44c-10 15 8 16 0 30m13-28c10 17-8 18 1 36m14-36c-9 13 9 22 1 32m13-35c10 13-9 15 1 27" stroke="C" stroke-width="3" fill="none" stroke-linecap="round"/>';
  else if (id === "seaangel")
    body =
      '<path d="M56 25 45 10l4 25C37 20 19 28 24 42c6 15 21 8 28 1l8 29 8-29c7 7 22 14 28-1 5-14-13-22-25-7l4-25-11 15Z" fill="C"/><ellipse cx="60" cy="41" rx="5" ry="15" fill="#ffdba9" opacity=".7"/>';
  else if (id === "crab")
    body =
      '<ellipse cx="60" cy="48" rx="22" ry="16" fill="C"/><path d="M41 42 27 26 22 9l-9 11 5 13 22 17m39-8 14-16 5-17 9 11-5 13-22 17M39 51l-21 8-7 14m29-15-13 14m52-21 21 8 7 14M80 58l13 14" fill="none" stroke="C" stroke-width="6" stroke-linecap="round"/><path d="M51 35v-8m18 8v-8" stroke="C" stroke-width="5"/><circle cx="51" cy="28" r="3" fill="#173941"/><circle cx="69" cy="28" r="3" fill="#173941"/>';
  else if (id === "turtle")
    body =
      '<ellipse cx="58" cy="44" rx="28" ry="18" fill="C"/><ellipse cx="91" cy="43" rx="13" ry="9" fill="C"/><path d="m40 32-9-16 24 13m-12 31-8 13 25-11m17-31 7-11 3 17m-13 21 13 12-1-18" fill="C"/><path d="m40 37 17-8 19 10-2 13-17 7-18-10Z" stroke="#173941" opacity=".3" fill="none" stroke-width="2"/>';
  else if (id === "moray")
    body =
      '<path d="M100 30C83 12 61 40 39 45 22 49 14 43 15 36c-7 30 17 32 38 17 16-11 26-12 41-10l12-7-9-2Z" fill="C"/><circle cx="91" cy="29" r="2.5" fill="#173941"/>';
  else if (id === "puffer" || id === "angler")
    body = `<path d="m35 37-17-9 2 25 15-9" fill="C"/><ellipse cx="65" cy="43" rx="31" ry="27" fill="C"/><path d="m43 24-4-6m23-2v-7m20 14 6-7m8 28h8M65 70v6m-20-12-5 5" stroke="C" stroke-width="3"/><circle cx="78" cy="36" r="4" fill="#173941"/><path d="m81 53 8-1" stroke="#173941" stroke-width="2"/>${id === "angler" ? '<path d="M60 20C62 1 94 0 98 20" fill="none" stroke="C" stroke-width="3"/><circle cx="98" cy="20" r="5" fill="#e0f7bf"/>' : '<g fill="#173941" opacity=".3"><circle cx="52" cy="32" r="2"/><circle cx="48" cy="47" r="2"/><circle cx="61" cy="57" r="2"/><circle cx="68" cy="28" r="2"/></g>'}`;
  else
    body = `<path d="m36 43-21-19v36l21-11C49 72 92 64 106 42 91 17 53 17 36 43Z" fill="C"/><path d="m55 27 10-13 16 12m-23 34 13 12 8-15" fill="C"/><circle cx="88" cy="37" r="3" fill="#173941"/>${id === "clownfish" ? '<path d="m48 33 5 24m21-31 4 34" stroke="#fff8ea" stroke-width="7"/>' : ""}`;
  return `<svg class="species-art" viewBox="0 0 120 86" aria-hidden="true">${body.replaceAll('C"', `${color}"`)}</svg>`;
}

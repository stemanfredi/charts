// Offline areas (ROADMAP, Offline areas): the view saved in this browser, to open without a
// connection: the base map, the relief and land contours, the depths and isobaths, the seamarks.
// The page fetches every file of the area into its cache, at the style's own addresses (style.js),
// and a fresh clipping worker the files of the cut elevation; the service worker (sw.js) answers
// the map from the finished areas. Only the hosts in hosts.js OFFLINE are kept: never Esri's.

import { h } from './dom.js';
import { HOSTS, OFFLINE_PREFIXES } from './hosts.js';
import { OMT_TILEJSON, DEM_TILES, DEM_LAND_MAX, DEM_SEA_MAX } from './catalog.js';
import { FONTS, GLYPHS, SEAMARK_TILES, SEAMARKS_MIN, ISOBATH_MAX } from './style.js';
import { fetchInto, tileUrl } from './net.js';
import { tileXY, MAX_LAT } from './geo.js';
import { ask } from './menu.js';
import { zip, unzip } from './zip.js';
import { startClipWorker } from './clip.js';

// the map's sources an area keeps (style.js): without a connection, theirs fail only beyond the
// saved areas, which is no fault to mark
export const KEPT_SOURCES = new Set(['omt', 'dem', 'dem-sea', 'contours', 'isobaths', 'seamarks']);
// OpenFreeMap's terms for an offline download: at most 3,000 tiles or 50 MB
export const BASE_TILES = 3000;
const BASE_BYTES = 50e6;
export const TOP_MAX = 14; // the base map's tiles stop there; the map magnifies them above
const CONTOUR_MAX = Math.min(ISOBATH_MAX, DEM_LAND_MAX); // the contours and isobaths stop there (style.js)
const RANGES = [0, 256, 512, 768, 1024]; // the fonts' characters for Latin, Greek and Cyrillic
// an area's cache and its manifest (sw.js names them too: the unit tests check they agree)
export const PACK = 'pack-', MANIFEST_FILE = 'pack.json';
const MANIFEST = () => new URL(MANIFEST_FILE, document.baseURI).href;
const putManifest = (cache, m) => cache.put(MANIFEST(), new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } }));
// a new area's cache, named by the time it was begun (savedAreas: one never finished goes after an hour)
const newPack = async () => { const id = `${PACK}${Date.now().toString(36)}`; return { id, cache: await caches.open(id) }; };
const isBaseTile = (url) => url.startsWith(`${HOSTS.openfreemap}/planet/`); // not the fonts, not the description
const MB = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);

// [west, south, east, north] → the tiles of zoom z it covers, margin tiles more on each side
export function tilesIn([w, s, e, n], z, margin = 0) {
  const k = 2 ** z, clamp = (v) => Math.max(0, Math.min(k - 1, v));
  const tx = (lng) => ((lng + 180) / 360) * k; // not wrapped: 180° is the east edge, not tile 0
  const x0 = clamp(Math.floor(tx(w)) - margin), x1 = clamp(Math.floor(tx(e) - 1e-9) + margin);
  const y0 = clamp(Math.floor(tileXY(0, n, z).y) - margin), y1 = clamp(Math.floor(tileXY(0, s, z).y - 1e-9) + margin);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}
// the base map's tiles an area from zoom from to top takes (the number OpenFreeMap's terms count): to
// the contours' last zoom with the ring around the area that their cut reads too
export const baseTiles = (bounds, from, top) => Array.from({ length: Math.max(0, Math.min(top, TOP_MAX) - from + 1) }, (_, i) => tilesIn(bounds, from + i, from + i <= CONTOUR_MAX ? 1 : 0).length).reduce((a, b) => a + b, 0);
// the lowest zoom an area keeps: a few below the view's (lower, the area is a speck, and the
// world's tiles are the largest)
export const fromZoom = (viewZoom) => Math.max(0, Math.min(TOP_MAX, Math.floor(viewZoom)) - 3);
// the map's view as an area: its bounds, cut to the map's world (a view across 180° is cut there; a
// view whose centre is beyond ±180°, a link's, moved by whole turns into the world first)
export function areaOf(map) {
  const b = map.getBounds(), turn = 360 * Math.round((b.getWest() + b.getEast()) / 720);
  const w = Math.max(-180, b.getWest() - turn), e = Math.min(180, b.getEast() - turn);
  return [w, Math.max(-MAX_LAT, b.getSouth()), e > w ? e : 180, Math.min(MAX_LAT, b.getNorth())];
}

// Whether there is a connection: none when the browser says so, or when the service worker's last
// try of the base map's provider failed (a phone with a signal but no data calls itself online).
// onConnection(fn): fn() when that may have changed
let swSays = null;
const listeners = new Set();
export const noConnection = () => navigator.onLine === false || swSays === false;
export const onConnection = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());
if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && 'connection' in e.data) { swSays = e.data.connection; changed(); } });
  navigator.serviceWorker.ready.then(() => navigator.serviceWorker.controller?.postMessage('connection'));
}
for (const e of ['online', 'offline']) window.addEventListener(e, changed);

// the service worker, told the saved areas changed
const sw = () => navigator.serviceWorker?.controller;
const tell = (msg) => sw()?.postMessage(msg);
// one tab at a time saves or opens an area (two would share the providers' limits, and race to replace
// the same area): work run alone, or failing at once while another tab's runs
const alone = (work) => navigator.locks.request('offline-areas', { ifAvailable: true }, (lock) => {
  if (!lock) throw new Error('another tab is saving an area');
  return work();
});
// saved again, only the base map and the seamarks change: taken anew from their providers; the
// elevation and the depths (versioned paths) from the saved areas as before
const CHANGING = [OFFLINE_PREFIXES.openfreemap, OFFLINE_PREFIXES.openseamap];

// Saves the area, zooms from to top, under a new pack-… cache; fresh: the base map and the seamarks
// from the network, not from the saved areas (an area saved again). progress({ done, total, bytes }).
// Resolves to its manifest; throws (the cache deleted) when cancelled, a file could not be had,
// the browser's storage is full, or the base map is over its terms.
// Whoever fetches a file puts it in the area's cache (net.js fetchInto): the page its fonts, base
// tiles and seamarks, then a clipping worker of its own the files the cut elevation reads (its
// caches empty, so each is asked for; the base tiles found in the area). The service worker answers
// from finished areas only, so another tab's map never lands in this one.
async function saveArea({ bounds, from, top, name, fresh = false, signal, progress = () => {} }) {
  if (!sw()) throw new Error('this browser keeps no files for this page');
  if (baseTiles(bounds, from, top) > BASE_TILES) throw new Error(`more than ${BASE_TILES.toLocaleString()} tiles of the base map`);
  const { id, cache } = await newPack();
  // the bytes put in the area as they come, the base map's with its fonts (OpenFreeMap's terms: over
  // them, it stops); the count from the cache, at the end, is the one kept
  let bytes = 0, baseBytes = 0, clip = null;
  const area = { cache, reload: fresh ? CHANGING : [], stored: (n, url) => { bytes += n; if (url.startsWith(OFFLINE_PREFIXES.openfreemap)) baseBytes += n; } };
  const get = async (url) => { const r = await fetchInto(area, url, { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
  const cancel = () => clip?.stop(); // what the worker was doing fails at once
  signal?.addEventListener('abort', cancel);
  try {
    const omt = (await (await get(OMT_TILEJSON)).json()).tiles[0];
    const used = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(`${HOSTS.openfreemap}/fonts/`));
    const glyphs = new Set([...FONTS.flatMap((f) => RANGES.map((r) => GLYPHS.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', `${r}-${r + 255}`))), ...used]);
    const range = (lo, hi, margin = 0) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => tilesIn(bounds, lo + i, margin)).flat();
    const cut = (mode, op) => (t) => () => clip.ask({ mode, op, zxy: t }).then((v) => v?.close?.()); // a picture made only for its files: let go
    // 256 px raster tiles show at map zoom z − 1: from + 1 to top + 1; the contours' 512 px tiles at z
    const base = [...[...glyphs].map((u) => () => get(u)), ...range(from, Math.min(top, TOP_MAX)).map((t) => () => get(tileUrl(omt, ...t)))];
    const seamarks = range(Math.max(from + 1, SEAMARKS_MIN), Math.min(top + 1, 18)).map((t) => () => get(tileUrl(SEAMARK_TILES, ...t)));
    // the cut elevation; for the contours its neighbours too (a contour tile reads 3 × 3)
    const elevation = [
      ...range(from + 1, Math.min(top + 1, DEM_LAND_MAX)).map(cut('land', 'bitmap')),
      ...range(from, Math.min(top, CONTOUR_MAX), 1).map(cut('land', 'contourElevation')),
      ...range(from + 1, Math.min(top + 1, DEM_SEA_MAX)).map(cut('sea', 'bitmap')),
      ...range(from, Math.min(top, CONTOUR_MAX), 1).map(cut('sea', 'contourElevation')),
    ];
    const total = base.length + seamarks.length + elevation.length;
    let done = 0, failed = 0, full = false;
    const stopped = () => signal?.aborted || full || baseBytes > BASE_BYTES;
    // a task tried once more before it counts as failed; the storage full stops everything
    const attempt = (task) => task().catch((err) => { if (err.name === 'QuotaExceededError' || signal?.aborted) throw err; return task(); });
    // tasks n at a time, each until its file has come (the providers' terms: OpenFreeMap 4, OpenSeaMap 2)
    const pool = (tasks, n) => {
      let next = 0;
      return Promise.all(Array.from({ length: n }, async () => {
        while (next < tasks.length && !stopped()) {
          try { await attempt(tasks[next++]); } catch (err) { if (err.name === 'QuotaExceededError') full = true; else if (!signal?.aborted) failed++; }
          progress({ done: ++done, total, bytes });
        }
      }));
    };
    await Promise.all([pool(base, 4), pool(seamarks, 2)]);
    // the cut after the base map, whose tiles it reads from the area: 4 at a time, as its own reads
    // of the base map (a shore at lower zooms) are OpenFreeMap's too
    if (!stopped()) {
      clip = startClipWorker([{ mode: 'sea' }, { template: DEM_TILES, mode: 'land' }].map((init) => ({ ...init, omtTileJson: OMT_TILEJSON, remember: false, keep: { cache: id, reload: area.reload } })), { stored: area.stored });
      await pool(elevation, 4);
    }
    if (signal?.aborted) throw new Error('cancelled');
    if (full) throw new Error('this browser\'s storage is full');
    if (baseBytes > BASE_BYTES) throw new Error(`the base map is over ${MB(BASE_BYTES)} here: choose less detail or a smaller view`);
    if (failed) throw new Error(`${failed} of ${total} could not be fetched`);
    // what it holds, counted from the cache itself: the base map's bytes with its fonts (as above), its tiles alone
    let size = 0, baseSize = 0, tiles = 0;
    for (const req of await cache.keys()) {
      const n = (await (await cache.match(req)).blob()).size;
      size += n;
      if (req.url.startsWith(OFFLINE_PREFIXES.openfreemap)) baseSize += n;
      if (isBaseTile(req.url)) tiles++;
    }
    if (!tiles) throw new Error('nothing of the base map was kept'); // never an empty area listed
    if (baseSize > BASE_BYTES || tiles > BASE_TILES) throw new Error(`the base map is over its ${BASE_TILES.toLocaleString()} tiles or ${MB(BASE_BYTES)} here: choose less detail or a smaller view`);
    const manifest = { name, saved: new Date().toISOString(), bounds, from, top, bytes: size };
    await putManifest(cache, manifest);
    tell('packs');
    return { id, ...manifest };
  } catch (err) {
    cancel(); // before the cache goes: nothing more put in it
    await caches.delete(id);
    throw err;
  } finally {
    cancel();
    signal?.removeEventListener('abort', cancel);
  }
}


// the saved areas, newest first: [{ id, name, saved, bounds, from, top, bytes }]. One whose saving
// never ended (its page closed meanwhile) has no manifest: never listed, its storage given back
// once it is an hour old (younger, another tab may be saving it)
async function savedAreas() {
  if (!('caches' in self)) return [];
  const out = [];
  for (const id of (await caches.keys()).filter((k) => k.startsWith(PACK))) {
    const m = await (await caches.open(id)).match(MANIFEST());
    if (m) out.push({ id, ...(await m.json()) });
    else if (Date.now() - parseInt(id.slice(PACK.length), 36) > 3600e3) await caches.delete(id);
  }
  return out.sort((a, b) => b.saved.localeCompare(a.saved));
}
async function deleteArea(id) { await caches.delete(id); tell('packs'); }
async function renameArea(id, name) {
  const cache = await caches.open(id), manifest = await (await cache.match(MANIFEST())).json();
  await putManifest(cache, { ...manifest, name });
}

// ---- an area as a file: the copy that outlives the browser's storage, and moves to another device ----
// A zip: area.json (what the manifest says, and each file's address and type), the files under
// files/, and README.txt with the credits. The seamarks stay out of files until OpenSeaMap has said
// they may be shared (ROADMAP, Offline areas); opened again, an area has none.
const FORMAT = 'charts-offline-area', KEPT_HOSTS = Object.values(OFFLINE_PREFIXES);
const NOT_IN_FILES = [OFFLINE_PREFIXES.openseamap];
const README = `An area saved by Charts (https://charts.makaw.org) for use without a connection.
Open it there: Open › Open a file…, or drop it on the map.

Map data © OpenStreetMap contributors (ODbL), © OpenMapTiles (CC BY 4.0), served by OpenFreeMap.
Land elevation: Mapzen Terrain Tiles (AWS Open Data; sources and their credits:
https://github.com/tilezen/joerd/blob/main/docs/attribution.md).
Depths: GEBCO Compilation Group (2026) GEBCO 2026 Grid (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa).
Fonts: Noto Sans, SIL Open Font License 1.1.
Not for navigation.
`;
async function areaFile(id) {
  const cache = await caches.open(id), { name, saved, bounds, from, top } = await (await cache.match(MANIFEST())).json(), list = [], files = [];
  for (const req of await cache.keys()) {
    if (req.url === MANIFEST() || NOT_IN_FILES.some((h) => req.url.startsWith(h))) continue;
    const r = await cache.match(req), entry = `files/${list.length}`;
    list.push({ name: entry, url: req.url, type: r.headers.get('content-type') || '' });
    files.push({ name: entry, data: await r.blob() });
  }
  return zip([{ name: 'area.json', data: JSON.stringify({ format: FORMAT, version: 1, name, saved, bounds, from, top, files: list }) }, { name: 'README.txt', data: README }, ...files]);
}
// what an area keeps, by its address (saveArea): the base map's description, a tile, a font's
// glyphs, a depth store's metadata or chunk, on a saved host and written as a browser writes it (no
// ../ to step off it, no query); nothing else is opened from a file
const KEPT_FILE = /(\/\d+\/\d+\/\d+\.(?:pbf|png)|\/fonts\/[^/?#]+\/\d+-\d+\.pbf|\.zarr\/(?:\.zmetadata|\d+\/\w+\/\d+\.\d+))$/;
const canonical = (url) => { try { return new URL(url).href === url; } catch { return false; } };
export const isKeptFile = (url) => typeof url === 'string' && canonical(url) && !/[?#]/.test(url)
  && (url === OMT_TILEJSON || (KEPT_HOSTS.some((h) => url.startsWith(h)) && KEPT_FILE.test(url)));
// what an area.json must say to be opened: its format, a date, an area of the world, zooms an area
// has, and only files an area keeps
const zoomOk = (z) => Number.isInteger(z) && z >= 0 && z <= TOP_MAX;
export const isAreaHead = (a) => a?.format === FORMAT && a.version === 1 && Array.isArray(a.files) && typeof a.saved === 'string' && !Number.isNaN(Date.parse(a.saved))
  && Array.isArray(a.bounds) && a.bounds.length === 4 && a.bounds.every(Number.isFinite) && a.bounds[0] < a.bounds[2] && a.bounds[1] < a.bounds[3]
  && zoomOk(a.from) && zoomOk(a.top) && a.from <= a.top && a.files.every((f) => isKeptFile(f?.url));
// a file of areaFile's opened: a new area of what it holds; the same area opened before (saved at
// the same time, of the same place) replaced. Resolves to its manifest; throws on a file that is
// not one, or holds nothing of the base map
async function openAreaFile(file) {
  if (!sw()) throw new Error('this browser keeps no files for this page');
  const files = await unzip(file), head = files.get('area.json');
  const area = head && (await head().then((b) => JSON.parse(new TextDecoder().decode(b))).catch(() => null));
  if (!isAreaHead(area)) throw new Error('not an offline area of this page');
  const { id, cache } = await newPack();
  try {
    let bytes = 0, tiles = 0;
    for (const f of area.files) {
      const read = files.get(f?.name);
      if (!read) continue;
      const data = await read(); // one file at a time: the whole area is never in memory
      await cache.put(f.url, new Response(data, { headers: f.type ? { 'content-type': String(f.type) } : {} }));
      bytes += data.length;
      if (isBaseTile(f.url)) tiles++;
    }
    if (!tiles) throw new Error('nothing of the base map in it');
    const { name, saved, bounds, from, top } = area, manifest = { name: String(name || 'Area'), saved, bounds, from, top, bytes };
    for (const a of await savedAreas()) if (a.saved === saved && String(a.bounds) === String(bounds)) await caches.delete(a.id);
    await putManifest(cache, manifest);
    tell('packs');
    return { id, ...manifest };
  } catch (err) {
    await caches.delete(id);
    throw err;
  }
}

// ---- the dialog: Download › Offline areas… ---------------------------------------------------------
// map; fit(bounds): the map fitted to an area (Show); icon(name): UI_ICON's svg (draw/icons.js); download(blob, name).
// Returns { open(), openFile(file) (an area's file, from the bar's Open or a drop) }
export function offlineDialog({ map, fit, icon, download }) {
  const el = h('dialog', { class: 'offline', 'aria-labelledby': 'offline-title' });
  document.body.append(el);
  let saving = null; // the AbortController of the area being saved or opened
  // what happened, kept across renders (a live region made anew is not read out); busy while saving
  const status = h('p', { class: 'ostatus', role: 'status' });
  const slug = (t) => t.normalize('NFKD').replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'area';
  const supported = 'serviceWorker' in navigator && 'caches' in self;
  // the year only when it is not this one (as a mail or file list says it)
  const when = (t) => { const d = new Date(t); return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
  const centre = ([w, s, e, n]) => { const la = (s + n) / 2, lo = (w + e) / 2; return `${Math.abs(la).toFixed(2)}°${la < 0 ? 'S' : 'N'} ${Math.abs(lo).toFixed(2)}°${lo < 0 ? 'W' : 'E'}`; };

  // This view: its detail, and Save (named after its centre, renamed in the list); none without a connection
  function thisView() {
    if (noConnection()) return [h('p', { class: 'note' }, 'No connection: saving an area needs one.')];
    const bounds = areaOf(map), view = Math.min(TOP_MAX, Math.max(0, Math.floor(map.getZoom()))), from = fromZoom(map.getZoom());
    const zoom = h('select', { 'aria-label': 'Detail' }, Array.from({ length: TOP_MAX - view + 1 }, (_, i) => h('option', { value: view + i }, `zoom ${view + i}${i ? '' : ', this view'}`)));
    zoom.value = Math.min(TOP_MAX, view + 2);
    const over = h('p', { class: 'note warn' }); // OpenFreeMap's terms: said only when this is beyond them
    const save = h('button', { type: 'button', class: 'small done', onclick: () => saveIt({ bounds, from, top: +zoom.value, name: centre(bounds) }) }, 'Save');
    const recount = () => {
      const beyond = baseTiles(bounds, from, +zoom.value) > BASE_TILES;
      over.textContent = beyond ? 'Too large: choose less detail or a smaller view' : '';
      over.hidden = !beyond;
      save.disabled = beyond || !sw() || !!saving;
    };
    zoom.addEventListener('change', recount);
    recount();
    return [h('h3', {}, 'This view'), h('div', { class: 'orow' }, h('label', {}, 'Detail up to ', zoom), save), over];
  }
  // an area's row: its name shows it on the map, double-clicked (or F2) renames it
  function row(a) {
    let timer = 0;
    const name = h('button', { type: 'button', class: 'dname', title: 'Show it on the map (double-click: rename)', disabled: !!saving,
      onclick: (e) => { clearTimeout(timer); timer = setTimeout(() => { el.close(); fit(a.bounds); }, e.detail ? 250 : 0); }, // a key at once; a click waits for a second one
      ondblclick: () => { clearTimeout(timer); rename(); },
      onkeydown: (e) => { if (e.key === 'F2') { e.preventDefault(); rename(); } } }, a.name);
    function rename() {
      const input = h('input', { class: 'dname', value: a.name, 'aria-label': 'Name' });
      let done = false;
      const finish = async (apply) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (apply && v && v !== a.name) await renameArea(a.id, v);
        await render();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
      input.addEventListener('blur', () => finish(true));
      name.replaceWith(input);
      input.focus();
      input.select();
    }
    return h('li', {}, name,
      h('span', { class: 'val' }, `${when(a.saved)} · zooms ${a.from}–${a.top} · ${MB(a.bytes)}`),
      h('button', { type: 'button', class: 'hact', 'aria-label': `Download ${a.name}`, title: 'Download it as a file: a copy that outlives this browser\'s storage, to open here or on another device (without the seamarks)', disabled: !!saving,
        onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { download(await areaFile(a.id), `offline-area-${slug(a.name)}.zip`); } catch (err) { say(`Not written: ${err.message}.`, true); } b.disabled = false; } }, icon('download')),
      noConnection() ? '' : h('button', { type: 'button', class: 'hact', 'aria-label': `Update ${a.name}`, title: 'Update: save it again, from the providers', disabled: !!saving || !sw(),
        onclick: () => saveIt({ bounds: a.bounds, from: a.from, top: a.top, name: a.name }, a.id) }, icon('update')),
      h('button', { type: 'button', class: 'hact del', 'aria-label': `Delete ${a.name}`, title: 'Delete for good', disabled: !!saving, onclick: async () => {
        if (await ask('Delete the area', `Delete “${a.name}” for good? It cannot be brought back.`, [['yes', 'Delete']])) { await deleteArea(a.id); await refresh(); }
      } }, icon('delete')));
  }
  async function render() {
    const areas = await savedAreas();
    const est = await navigator.storage?.estimate?.().catch(() => null);
    el.replaceChildren(
      h('h2', { id: 'offline-title' }, 'Offline areas'),
      h('p', {}, 'Saved in this browser for use without a connection, as they were when saved: the base map, relief and contours, depths and isobaths, seamarks.'),
      // the reason Save is off: no service worker here, or none answering for this page now (a forced reload)
      !sw() ? h('p', { class: 'note' }, supported ? 'Reload the page to save areas.' : 'This browser keeps no files for this page (a private window, perhaps).') : '',
      ...thisView(),
      status,
      h('h3', {}, 'Saved'),
      areas.length ? h('ul', { class: 'drawings' }, areas.map(row)) : h('p', { class: 'note' }, 'None yet. An area\'s file opens with Open › Open a file….'),
      areas.length && est?.quota ? h('p', { class: 'note' }, `${MB(est.usage || 0)} used of ${MB(est.quota)} this browser allows`) : '',
      h('div', { class: 'fbuttons' }, h('button', { type: 'button', 'data-keep': '', onclick: () => el.close() }, 'Close')));
  }
  // the focus on Save, or Close when Save is off (opened, or drawn again after the focus was lost to it)
  const focusMain = () => (el.querySelector('button.done:not(:disabled)') || el.querySelector('[data-keep]'))?.focus();
  const refresh = async () => { await render(); focusMain(); };
  // what happened; failed: in the warning's colour
  const say = (text, failed = false) => { status.textContent = text; status.classList.toggle('warn', failed); };

  // work(signal, say) run alone (no other tab saving or opening an area) with everything but Close
  // off, its progress said, its failure said as "fail: reason."; cancellable: with a Cancel button
  async function busy(text, cancellable, work, fail) {
    const ac = new AbortController();
    saving = ac;
    for (const b of el.querySelectorAll('button:not([data-keep])')) b.disabled = true;
    const progress = h('span', {}, text);
    status.setAttribute('aria-busy', 'true'); // read out once it is over, not at each step
    say('');
    status.replaceChildren(progress, ...(cancellable ? [' ', h('button', { type: 'button', class: 'small', 'data-keep': '', onclick: () => ac.abort() }, 'Cancel')] : []));
    let said = '';
    try { await alone(() => work(ac.signal, (t) => { progress.textContent = t; })); } catch (err) { said = ac.signal.aborted ? 'Cancelled.' : `${fail}: ${err.message}.`; }
    saving = null;
    status.removeAttribute('aria-busy');
    say(said, !!said && !ac.signal.aborted);
    if (el.open) await refresh();
  }
  // replaces: the id of the area saved again, deleted once the new one is saved
  const saveIt = ({ bounds, from, top, name }, replaces = null) => busy('Saving…', true, async (signal, say) => {
    navigator.storage?.persist?.().catch(() => {}); // asked with the first: the drawings kept too (not waited for: a browser may ask the user)
    await saveArea({ bounds, from, top, name, fresh: !!replaces, signal,
      progress: ({ done, total, bytes }) => say(`Saving… ${Math.round((100 * done) / total)} %, ${MB(bytes)}`) });
    if (replaces) await deleteArea(replaces);
  }, 'Not saved');
  // closing while saving cancels it (the dialog is what shows it); Esc, or a phone's back, does not close it then
  el.addEventListener('cancel', (e) => { if (saving) e.preventDefault(); });
  el.addEventListener('close', () => saving?.abort());
  onConnection(() => { if (el.open && !saving) render(); }); // Save and Update come and go with the connection
  const open = () => { say(''); return render().catch((err) => console.error('offline areas:', err)).then(() => { if (!el.open) { el.showModal(); focusMain(); } }); };
  return {
    open,
    openFile: async (file) => { if (saving) return; await open(); busy('Opening…', false, () => openAreaFile(file), 'Not opened'); },
  };
}

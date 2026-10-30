// Offline areas (ROADMAP, Offline areas): the view saved in this browser, to open without a
// connection: the base map, the relief and land contours, the depths and isobaths, the seamarks.
// The page asks its own tile makers for every tile of the area, a fresh clipping worker for the cut
// elevation (its caches empty, so every file it reads is asked for), and the service worker
// (sw.js) keeps each file of the saved hosts they fetch in the area's cache, a few at a time per
// host. Only the hosts in hosts.js OFFLINE are kept: never Esri's.

import { h } from './dom.js';
import { HOSTS } from './hosts.js';
import { OMT_TILEJSON, DEM_TILES, DEM_LAND_MAX, DEM_SEA_MAX } from './catalog.js';
import { fetchOk } from './net.js';
import { tileXY, MAX_LAT } from './geo.js';
import { ask } from './menu.js';

// OpenFreeMap's terms for an offline download: at most 3,000 tiles or 50 MB
export const BASE_TILES = 3000, BASE_BYTES = 50e6;
export const TOP_MAX = 14; // the base map's tiles stop there; the map magnifies them above
const CONTOUR_MAX = 12; // the contours and isobaths stop there (style.js)
const SEAMARKS_MIN = 9; // the seamarks are drawn from zoom 9 (catalog.js)
const FONTS = ['Noto Sans Regular', 'Noto Sans Italic', 'Noto Sans Bold']; // style.js
const RANGES = [0, 256, 512, 768, 1024]; // the fonts' characters for Latin, Greek and Cyrillic
const PACK = 'pack-', MANIFEST = () => new URL('pack.json', document.baseURI).href;
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
// the base map's tiles an area from zoom from to top takes (the number OpenFreeMap's terms count)
export const baseTiles = (bounds, from, top) => Array.from({ length: Math.max(0, Math.min(top, TOP_MAX) - from + 1) }, (_, i) => tilesIn(bounds, from + i).length).reduce((a, b) => a + b, 0);
// the lowest zoom an area keeps: a few below the view's (lower, the area is a speck, and the
// world's tiles are the largest)
export const fromZoom = (viewZoom) => Math.max(0, Math.min(TOP_MAX, Math.floor(viewZoom)) - 3);
// the map's view as an area: its bounds, cut to the map's world (a view across 180° is cut there)
export function areaOf(map) {
  const b = map.getBounds();
  const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast());
  return [w, Math.max(-MAX_LAT, b.getSouth()), e > w ? e : 180, Math.min(MAX_LAT, b.getNorth())];
}

// the service worker: a message, or a question answered on a port
const sw = () => navigator.serviceWorker?.controller;
const tell = (msg) => sw()?.postMessage(msg);
const askSw = (msg) => new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = (e) => resolve(e.data); sw()?.postMessage(msg, [c.port2]); setTimeout(() => resolve(null), 2000); });

// A clipping worker of its own (clip-worker.js): its caches start empty, so each file the cut reads
// is asked for, and kept
function freshClipper() {
  const w = new Worker(new URL('./clip-worker.js', import.meta.url), { type: 'module' });
  const replies = new Map();
  let seq = 0;
  w.postMessage({ init: { mode: 'sea', omtTileJson: OMT_TILEJSON } });
  w.postMessage({ init: { template: DEM_TILES, mode: 'land', omtTileJson: OMT_TILEJSON } });
  w.onmessage = ({ data }) => {
    const r = replies.get(data.seq);
    replies.delete(data.seq);
    if (data.setup) for (const x of replies.values()) x.reject(new Error(data.error));
    else if (r) data.error ? r.reject(new Error(data.error)) : r.resolve(data.value);
  };
  const run = (mode, op, zxy) => new Promise((resolve, reject) => { const n = ++seq; replies.set(n, { resolve, reject }); w.postMessage({ mode, op, zxy, seq: n }); })
    .then((v) => v?.close?.()); // a picture made only for its files: let go
  return { run, stop: () => w.terminate() };
}

// Saves the area, zooms from to top, under a new pack-… cache; fresh: from the network, not from the saved
// areas (an area saved again). progress({ done, total, bytes }). Resolves to its manifest; throws
// (the cache deleted) when cancelled, a file could not be had, or the base map is over its terms.
export async function saveArea({ bounds, from, top, name, fresh = false, signal, progress = () => {} }) {
  if (!sw()) throw new Error('this browser keeps no files for this page');
  if (baseTiles(bounds, from, top) > BASE_TILES) throw new Error(`more than ${BASE_TILES.toLocaleString()} tiles of the base map`);
  const id = `${PACK}${Date.now().toString(36)}`, cache = await caches.open(id), clip = freshClipper();
  const get = (url) => fetchOk(url, { signal }).then((r) => r.arrayBuffer());
  try {
    tell({ record: id, fresh });
    const omt = (await (await fetchOk(OMT_TILEJSON)).json()).tiles[0];
    const fill = (t, [z, x, y]) => t.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const used = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(`${HOSTS.openfreemap}/fonts/`));
    const glyphs = new Set([...FONTS.flatMap((f) => RANGES.map((r) => `${HOSTS.openfreemap}/fonts/${encodeURIComponent(f)}/${r}-${r + 255}.pbf`)), ...used]);
    const range = (lo, hi, margin = 0) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => tilesIn(bounds, lo + i, margin)).flat();
    // 256 px raster tiles show at map zoom z − 1: from + 1 to top + 1; the contours' 512 px tiles at z
    const tasks = [
      ...[...glyphs].map((u) => () => get(u)),
      ...range(from, Math.min(top, TOP_MAX)).map((t) => () => get(fill(omt, t))),
      ...range(Math.max(from + 1, SEAMARKS_MIN), Math.min(top + 1, 18)).map((t) => () => get(fill(`${HOSTS.openseamap}/seamark/{z}/{x}/{y}.png`, t))),
      // the cut elevation; for the contours its neighbours too (a contour tile reads 3 × 3)
      ...range(from + 1, Math.min(top + 1, DEM_LAND_MAX)).map((t) => () => clip.run('land', 'bitmap', t)),
      ...range(from, Math.min(top, CONTOUR_MAX, DEM_LAND_MAX), 1).map((t) => () => clip.run('land', 'contourElevation', t)),
      ...range(from + 1, Math.min(top + 1, DEM_SEA_MAX)).map((t) => () => clip.run('sea', 'bitmap', t)),
      ...range(from, Math.min(top, CONTOUR_MAX), 1).map((t) => () => clip.run('sea', 'contourElevation', t)),
    ];
    let done = 0, bytes = 0, failed = 0, next = 0, over = false;
    const timer = setInterval(async () => {
      tell({ record: id, fresh }); // again: a service worker started anew has forgotten it
      const st = await askSw({ stats: true });
      if (!st) return;
      bytes = Object.values(st.bytes).reduce((a, b) => a + b, 0);
      if ((st.bytes[`${HOSTS.openfreemap}/`] || 0) > BASE_BYTES) over = true; // over the terms: stop
      progress({ done, total: tasks.length, bytes });
    }, 1000);
    // eight at a time from the page; the service worker holds each host to its own limit
    const worker = async () => {
      while (next < tasks.length && !signal?.aborted && !over) {
        const task = tasks[next++];
        try { await task(); } catch { try { await task(); } catch { if (!signal?.aborted) failed++; } } // once more, then counted
        done++;
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker)).finally(() => clearInterval(timer));
    if (signal?.aborted) throw new Error('cancelled');
    if (over) throw new Error(`the base map is over ${MB(BASE_BYTES)} here: choose less detail or a smaller view`);
    if (failed) throw new Error(`${failed} of ${tasks.length} could not be fetched`);
    // what it holds, counted from the cache itself
    let size = 0, base = 0, baseFiles = 0, files = 0;
    for (const req of await cache.keys()) {
      const n = (await (await cache.match(req)).blob()).size;
      size += n; files++;
      if (req.url.startsWith(`${HOSTS.openfreemap}/`)) { base += n; baseFiles++; }
    }
    if (base > BASE_BYTES || baseFiles > BASE_TILES) throw new Error(`the base map is over its ${BASE_TILES.toLocaleString()} tiles or ${MB(BASE_BYTES)} here: choose less detail or a smaller view`);
    const manifest = { name, saved: new Date().toISOString(), bounds, from, top, files, bytes: size };
    await cache.put(MANIFEST(), new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }));
    return { id, ...manifest };
  } catch (err) {
    await caches.delete(id);
    throw err;
  } finally {
    clip.stop();
    tell({ record: null });
    tell('packs');
  }
}

// the saved areas, newest first: [{ id, name, saved, bounds, top, files, bytes }]
export async function savedAreas() {
  if (!('caches' in self)) return [];
  const out = [];
  for (const id of (await caches.keys()).filter((k) => k.startsWith(PACK))) {
    const m = await (await caches.open(id)).match(MANIFEST());
    if (m) out.push({ id, ...(await m.json()) });
  }
  return out.sort((a, b) => b.saved.localeCompare(a.saved));
}
export async function deleteArea(id) { await caches.delete(id); tell('packs'); }

// ---- the dialog: Download › Offline areas… ---------------------------------------------------------
// map; fit(bounds): the map fitted to an area (Show); deleteIcon(): the bin's svg
export function offlineDialog({ map, fit, deleteIcon }) {
  const el = h('dialog', { class: 'offline', 'aria-labelledby': 'offline-title' });
  document.body.append(el);
  let saving = null; // the AbortController of the area being saved
  const supported = 'serviceWorker' in navigator && 'caches' in self;
  const when = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const centre = ([w, s, e, n]) => { const la = (s + n) / 2, lo = (w + e) / 2; return `${Math.abs(la).toFixed(2)}°${la < 0 ? 'S' : 'N'} ${Math.abs(lo).toFixed(2)}°${lo < 0 ? 'W' : 'E'}`; };

  async function render() {
    const bounds = areaOf(map), view = Math.min(TOP_MAX, Math.max(0, Math.floor(map.getZoom()))), from = fromZoom(map.getZoom());
    const zoom = h('select', { 'aria-label': 'Detail' }, Array.from({ length: TOP_MAX - view + 1 }, (_, i) => h('option', { value: view + i }, `zoom ${view + i}`)));
    zoom.value = Math.min(TOP_MAX, view + 2);
    const count = h('span', { class: 'val' }), status = h('p', { class: 'ostatus', role: 'status' });
    const nameIn = h('input', { type: 'text', value: centre(bounds), 'aria-label': 'Name' }); // the date is beside it in the list
    const save = h('button', { type: 'button', class: 'done' }, 'Save');
    const recount = () => {
      const n = baseTiles(bounds, from, +zoom.value), over = n > BASE_TILES;
      count.textContent = `${n.toLocaleString()} tiles of the base map${over ? `, over its ${BASE_TILES.toLocaleString()}: choose less detail or a smaller view` : ''}`;
      count.classList.toggle('over', over);
      save.disabled = over || !sw() || !!saving;
    };
    zoom.addEventListener('change', recount);
    recount();
    save.onclick = () => run({ bounds, from, top: +zoom.value, name: nameIn.value.trim() || centre(bounds) }, status);
    const areas = await savedAreas();
    const est = await navigator.storage?.estimate?.().catch(() => null);
    el.replaceChildren(
      h('h2', { id: 'offline-title' }, 'Offline areas'),
      h('p', {}, 'Saved in this browser, to open without a connection: the base map, relief and contours, depths and isobaths, seamarks.'),
      !supported ? h('p', {}, 'This browser keeps no files for this page (a private window, perhaps).') : '',
      h('h3', {}, 'This view'),
      h('div', { class: 'orow' }, h('label', {}, 'Detail up to ', zoom), count),
      h('div', { class: 'orow' }, h('label', { class: 'grow' }, 'Name ', nameIn)),
      h('div', { class: 'fbuttons' }, save),
      status,
      h('h3', {}, 'Saved'),
      areas.length ? h('ul', { class: 'drawings' }, areas.map((a) => h('li', {},
        h('button', { type: 'button', class: 'dname', title: 'Show it on the map', onclick: () => { el.close(); fit(a.bounds); } }, a.name),
        h('span', { class: 'val' }, `${when(a.saved)} · zoom ${a.top} · ${MB(a.bytes)}`),
        h('button', { type: 'button', class: 'small', title: 'Save it again, from the providers', disabled: !!saving || !sw(), onclick: () => run({ bounds: a.bounds, from: a.from ?? fromZoom(a.top - 2), top: a.top, name: a.name, replaces: a.id }, status) }, 'Update'),
        h('button', { type: 'button', class: 'hact', 'aria-label': `Delete ${a.name}`, title: 'Delete', onclick: async () => {
          if (await ask('Delete the area', `Delete “${a.name}” from this browser?`, [['yes', 'Delete']])) { await deleteArea(a.id); render(); }
        } }, deleteIcon())))) : h('p', { class: 'val' }, 'None yet.'),
      est?.quota ? h('p', { class: 'val' }, `${MB(est.usage || 0)} used of ${MB(est.quota)} this browser allows`) : '',
      h('div', { class: 'fbuttons' }, h('button', { type: 'button', onclick: () => el.close() }, 'Close')));
  }

  async function run({ bounds, from, top, name, replaces = null }, status) {
    const ac = new AbortController();
    saving = ac;
    for (const b of el.querySelectorAll('button.done, button.small')) b.disabled = true;
    const cancel = h('button', { type: 'button', onclick: () => ac.abort() }, 'Cancel');
    const text = h('span', {}, 'Saving…');
    status.replaceChildren(text, ' ', cancel);
    try {
      await navigator.storage?.persist?.().catch(() => {}); // asked with the first: the drawings kept too
      await saveArea({ bounds, from, top, name, fresh: !!replaces, signal: ac.signal,
        progress: ({ done, total, bytes }) => { text.textContent = `Saving… ${Math.round((100 * done) / total)} %, ${MB(bytes)}`; } });
      if (replaces) await deleteArea(replaces);
      saving = null;
      await render();
    } catch (err) {
      saving = null;
      await render();
      el.querySelector('.ostatus').textContent = ac.signal.aborted ? 'Not saved: cancelled.' : `Not saved: ${err.message}.`;
    }
  }
  // closing while saving cancels it (the dialog is what shows it)
  el.addEventListener('close', () => saving?.abort());
  return { open: () => { render().then(() => el.showModal()); } };
}

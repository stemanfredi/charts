import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA, DEM_LAND, OMT_TILEJSON, OPACITY_PROP, DEPTH_SCHEMES, depthRamp, packBands, NO_DEPTH, buildStyle, defaultDate, gibsTiles } from './catalog.js';
import { clipper } from './clip.js';
import { colourAt, drawRamp, drawClasses, loadColormap, drawColormap } from './legend.js';
import { Measure, MEASURE_LAYERS, summary, fmtDist } from './measure.js';

const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};
const byId = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

// ---- state (mirrored in the URL hash) ---------------------------------------
const state = {
  on: new Set(ITEMS.filter((it) => it.on).map((it) => it.id)),
  variant: Object.fromEntries(ITEMS.filter((it) => it.variants).map((it) => [it.id, Object.keys(it.variants)[0]])),
  opacity: Object.fromEntries(ITEMS.filter((it) => it.opacity != null).map((it) => [it.id, it.opacity])),
  date: defaultDate(),
  open: new Set(['pack', 'base', 'sea']),
  menu: window.innerWidth >= 720,
};
let view = { zoom: 4, center: [12, 41], bearing: 0 };
let measureState = '';
let packParam = '';

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const v = (q.get('v') || '').split('/').map(Number);
  if (v.length >= 3 && v.every(Number.isFinite)) view = { zoom: v[0], center: [v[2], v[1]], bearing: v[3] || 0 };
  if (q.has('on')) state.on = new Set(q.get('on').split(',').filter((id) => byId[id]));
  for (const kv of (q.get('var') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (byId[k]?.variants?.[val]) state.variant[k] = val;
  }
  for (const kv of (q.get('op') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (k in state.opacity && Number.isFinite(+val)) state.opacity[k] = Math.min(1, Math.max(0, +val));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('d') || '')) state.date = q.get('d');
  if (q.has('g')) state.open = new Set(q.get('g').split(','));
  if (q.has('menu')) state.menu = q.get('menu') === '1';
  measureState = q.get('m') || '';
  packParam = q.get('pack') || '';
  return q.get('u');
}

let hashTimer = 0;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const c = map.getCenter();
    const q = new URLSearchParams();
    q.set('v', [map.getZoom().toFixed(2), c.lat.toFixed(5), c.lng.toFixed(5), Math.round(map.getBearing())].join('/'));
    q.set('on', [...state.on].join(','));
    const variants = Object.entries(state.variant).filter(([k, v]) => v !== Object.keys(byId[k].variants)[0]);
    if (variants.length) q.set('var', variants.map((kv) => kv.join(':')).join(','));
    const ops = Object.entries(state.opacity).filter(([k, v]) => v !== byId[k].opacity);
    if (ops.length) q.set('op', ops.map(([k, v]) => `${k}:${v}`).join(','));
    if (state.on.has('gibs')) q.set('d', state.date);
    if (measure.units !== 'km') q.set('u', measure.units);
    const m = measure.serialize();
    if (m) q.set('m', m);
    if (pack.url) q.set('pack', pack.url);
    q.set('g', [...state.open].join(','));
    q.set('menu', state.menu ? '1' : '0');
    history.replaceState(null, '', `#${q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%3B/g, ';').replace(/%7E/g, '~')}`);
  }, 250);
}

const urlUnits = readHash();

// ---- map --------------------------------------------------------------------
// Elevation goes through clip.js (cut to the OSM coastline). worker: false keeps
// maplibre-contour's tile manager on this thread, where its getTile/decodeImage can be
// replaced; the shaded rasters (clip-* protocols) and the contours share one tile cache.
const demOpts = { url: DEM_TILES, encoding: 'terrarium', worker: false, cacheSize: 200 };
const seaDem = new mlcontour.DemSource({ ...demOpts, id: 'sea', maxzoom: DEM_SEA.max });
const landDem = new mlcontour.DemSource({ ...demOpts, id: 'land', maxzoom: DEM_LAND.max });
const seaClip = clipper({ template: DEM_TILES, native: DEM_SEA.native, mode: 'sea', omtTileJson: OMT_TILEJSON });
const landClip = clipper({ template: DEM_TILES, native: DEM_LAND.native, mode: 'land', omtTileJson: OMT_TILEJSON });
for (const [dem, clip] of [[seaDem, seaClip], [landDem, landClip]]) {
  dem.manager.getTile = clip.getTile;
  dem.manager.decodeImage = clip.decodeImage;
  dem.setupMaplibre(maplibregl); // registers the contour protocol
}
maplibregl.addProtocol('clip-sea', seaClip.protocol);
maplibregl.addProtocol('clip-land', landClip.protocol);
const contourOpts = { contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1 };
const style = buildStyle({
  seaDemUrl: 'clip-sea://{z}/{x}/{y}',
  landDemUrl: 'clip-land://{z}/{x}/{y}',
  // zoom → [minor, major] interval in metres
  isobathUrl: seaDem.contourProtocolUrl({ ...contourOpts, thresholds: { 4: [1000, 2000], 6: [200, 1000], 8: [100, 500], 10: [20, 100], 11: [5, 50] } }), // 5 m generated, drawn as 10 m + the 5 m line (catalog.js)
  contourUrl: landDem.contourProtocolUrl({ ...contourOpts, thresholds: { 9: [100, 500], 11: [50, 250], 12: [20, 100] } }),
  date: state.date,
});
style.layers.push(...MEASURE_LAYERS);

const map = new maplibregl.Map({
  container: 'map', style, ...view,
  maxPitch: 0, pitchWithRotate: false, dragRotate: true, touchPitch: false,
  attributionControl: false, fadeDuration: 150,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-left');
const scale = new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' });
map.addControl(scale, 'bottom-left');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

const measure = new Measure(map, (what) => { if (what === 'list') { renderMeasures(); writeHash(); } renderTools(); });
if (urlUnits === 'nm') measure.units = 'nm';

// ---- applying the state to the map ------------------------------------------
const layersOf = {};
for (const l of style.layers) if (l.metadata?.item) (layersOf[l.metadata.item] ||= []).push(l);
const baseDependent = Object.keys(layersOf).filter((k) => layersOf[k].some((l) => l.metadata.base));

function applyItem(id) {
  const it = byId[id];
  const on = state.on.has(id);
  for (const l of layersOf[id] || []) {
    const vis = on && (!l.metadata.variant || l.metadata.variant === state.variant[id])
      && (!l.metadata.base || state.on.has(l.metadata.base)); // e.g. pack fills only over the chart base
    map.setLayoutProperty(l.id, 'visibility', vis ? 'visible' : 'none');
    const prop = OPACITY_PROP[l.type];
    if (it.opacity != null && prop) map.setPaintProperty(l.id, prop, state.opacity[id]);
  }
}
function setOn(id, on) {
  const it = byId[id];
  if (on && GROUPS.find((g) => g.id === it.group).exclusive) {
    for (const other of ITEMS) if (other.group === it.group && other.id !== id && state.on.delete(other.id)) applyItem(other.id);
  }
  on ? state.on.add(id) : state.on.delete(id);
  applyItem(id);
  if (it.group === 'base') { for (const k of baseDependent) applyItem(k); renderLegends(); labelPaint(); }
  if (id === 'graticule') { updateGraticule(); drawLatScale(); }
  if (id === 'depth') { shoreFill(); labelPaint(); }
  renderMenu();
  writeHash();
}
// Under depth shading the water fill takes the shallowest band's colour: the tint stops a
// fraction of a pixel short of the shore (clip.js), and that sliver must not read as white.
function shoreFill() {
  const zmax = style.layers.find((l) => l.id === 'depth').maxzoom; // shading hides itself above this
  map.setPaintProperty('water', 'fill-color', state.on.has('depth') ? ['step', ['zoom'], depthStops()[0][1], zmax, '#ffffff'] : '#ffffff');
}
// the depth colour scheme (Depth shading item's variant) also colours the pack depth areas
const depthStops = () => DEPTH_SCHEMES[state.variant.depth];
// isobaths under the atlas scheme: navy over its pale shallow blues, pale over its dark deep
// blues (one colour can't read on both); the nautical scheme keeps the style's own blue
const ATLAS_SPLIT_M = 200;
const byDepth = (shallow, deep) => ['step', ['abs', ['get', 'ele']], shallow, ATLAS_SPLIT_M, deep];
const ISOBATH_INK = {
  atlas: { line: byDepth('#22436a', '#e3eef8'), text: byDepth('#22436a', '#ffffff'), halo: byDepth('rgba(255,255,255,0.9)', 'rgba(20,45,80,0.85)') },
  nautical: null,
};
function depthColours() {
  map.setPaintProperty('depth', 'color-relief-color', depthRamp(depthStops()));
  labelPaint();
  map.setPaintProperty('pack-bands', 'fill-color', packBands(depthStops()));
  shoreFill();
  renderLegends();
}
// Over satellite, labels flip to light text on a dark halo (dark-on-white reads badly on imagery).
const SAT_LABELS = {
  places: '#ffffff', islands: '#ffffff', 'graticule-labels': '#ffffff',
  'sea-names': '#cfe6ff', 'sea-names-line': '#cfe6ff', 'pack-isobath-labels': '#cfe6ff',
  ...Object.fromEntries(style.layers.filter((l) => l.id.startsWith('isobath-labels')).map((l) => [l.id, '#cfe6ff'])),
};
const chartLabelPaint = {};
for (const l of style.layers) if (SAT_LABELS[l.id]) chartLabelPaint[l.id] = { ...l.paint };
function labelPaint() {
  const sat = state.on.has('sat');
  for (const [id, colour] of Object.entries(SAT_LABELS)) {
    const p = chartLabelPaint[id];
    map.setPaintProperty(id, 'text-color', sat ? colour : p['text-color']);
    map.setPaintProperty(id, 'text-halo-color', sat ? 'rgba(8,16,24,0.85)' : p['text-halo-color']);
    map.setPaintProperty(id, 'text-halo-width', sat ? 1.4 : p['text-halo-width']);
  }
  const ink = state.on.has('depth') && state.on.has('chart') ? ISOBATH_INK[state.variant.depth] : null;
  for (const id of LINE_IDS) {
    const own = id.startsWith('pack') ? null : ink; // pack isobaths carry `d`, not `ele`
    map.setPaintProperty(id, 'line-color', sat ? '#bfe0ff' : own ? own.line : chartLineColour[id]);
  }
  for (const id of Object.keys(SAT_LABELS).filter((k) => /^isobath-labels/.test(k))) {
    if (sat || !ink) continue;
    map.setPaintProperty(id, 'text-color', ink.text);
    map.setPaintProperty(id, 'text-halo-color', ink.halo);
  }
}
const LINE_IDS = style.layers.filter((l) => /^(pack-)?isobaths(-\d+)?$/.test(l.id) && l.type === 'line').map((l) => l.id);
const chartLineColour = Object.fromEntries(LINE_IDS.map((id) => [id, style.layers.find((l) => l.id === id).paint['line-color']]));
function setDate(date) {
  state.date = date;
  for (const k of Object.keys(GIBS)) map.getSource(`gibs-${k}`).setTiles(gibsTiles(k, date));
  writeHash();
  renderLegends();
}

// ---- graticule (WGS 84 lat/lon grid; spacing adapts to the view) -------------
const STEPS = [30, 20, 10, 5, 2, 1, 30 / 60, 20 / 60, 10 / 60, 5 / 60, 2 / 60, 1 / 60];
function fmtAngle(v, pos, neg, step) {
  const hemi = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  let d = Math.floor(a + 1e-9), mnt = Math.round((a - d) * 60);
  if (mnt === 60) { d += 1; mnt = 0; }
  return step >= 1 || mnt === 0 ? `${d}°${hemi}` : `${d}°${String(mnt).padStart(2, '0')}′${hemi}`;
}
function updateGraticule() {
  if (!state.on.has('graticule')) return;
  const b = map.getBounds();
  const span = Math.max(b.getNorth() - b.getSouth(), (b.getEast() - b.getWest()) * Math.cos((map.getCenter().lat * Math.PI) / 180));
  const step = STEPS.find((s) => span / s >= 3) || STEPS[STEPS.length - 1];
  const f = [];
  const s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
  const w = b.getWest(), e = b.getEast();
  const k0 = (x) => Math.round(x * 3600) / 3600;
  // edge labels: meridians along the bottom, parallels along the right (the left edge has the
  // latitude scale); only when north-up, where a screen edge is a parallel or a meridian
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
  const edges = Math.abs(map.getBearing()) < 0.5;
  const latBottom = map.unproject([W / 2, H - 42]).lat, lonRight = map.unproject([W - 8, H / 2]).lng;
  const label = (coord, text, anchor) => f.push({ type: 'Feature', properties: { label: text, anchor }, geometry: { type: 'Point', coordinates: coord } });
  for (let lon = Math.ceil(w / step) * step; lon <= e; lon += step) {
    const L = ((k0(lon) + 540) % 360) - 180;
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, s], [lon, n]] } });
    if (edges) label([lon, latBottom], fmtAngle(L, 'E', 'W', step), 'center');
  }
  for (let lat = Math.ceil(s / step) * step; lat <= n; lat += step) {
    const coords = [];
    for (let x = w; x < e; x += (e - w) / 32) coords.push([x, lat]);
    coords.push([e, lat]);
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    if (edges) label([lonRight, lat], fmtAngle(k0(lat), 'N', 'S', step), 'right');
  }
  map.getSource('graticule').setData({ type: 'FeatureCollection', features: f });
}

// ---- source status: errors per menu item -----------------------------------
const itemsOfSource = {};
for (const l of style.layers) if (l.metadata?.item && l.source) (itemsOfSource[l.source] ||= new Set()).add(l.metadata.item);
const health = {}; // source → {err, ok, msg}
map.on('error', (e) => {
  const src = e.sourceId || e.source?.id;
  if (!src || !itemsOfSource[src]) return console.warn(e.error || e);
  const s = (health[src] ||= { err: 0, ok: 0 });
  s.err++;
  s.msg = e.error?.message || 'request failed';
  renderStatus();
});
map.on('data', (e) => {
  if (e.dataType === 'source' && e.tile && health[e.sourceId]) { health[e.sourceId].ok++; renderStatus(); }
});
map.on('movestart', () => { for (const k in health) delete health[k]; });
function itemStatus(id) {
  for (const l of layersOf[id] || []) {
    if (l.metadata.variant && l.metadata.variant !== state.variant[id]) continue;
    const s = health[l.source];
    if (s?.err) return { cls: s.ok ? 'partial' : 'error', msg: s.ok ? `some tiles failed: ${s.msg}` : `not loading: ${s.msg}` };
  }
  return null;
}

// ---- menu -------------------------------------------------------------------
const menu = $('#menu');
const rows = {};

function itemRow(it) {
  const group = GROUPS.find((g) => g.id === it.group);
  const input = h('input', { type: group.exclusive ? 'radio' : 'checkbox', name: group.exclusive ? `g-${group.id}` : null, id: `i-${it.id}`,
    onchange: (e) => setOn(it.id, e.target.checked) });
  const opacity = it.opacity != null ? h('label', { class: 'opacity' }, h('span', {}, it.id === 'relief' ? 'Strength' : 'Opacity'),
    h('input', { type: 'range', min: 0, max: 1, step: 0.05, oninput: (e) => { state.opacity[it.id] = +e.target.value; applyItem(it.id); writeHash(); } })) : null;
  const info = h('div', { class: 'info', hidden: true }, opacity,
    h('p', {}, h('b', {}, 'Source '), it.info.src),
    h('p', {}, h('b', {}, 'Licence '), it.info.lic),
    h('p', {}, h('b', {}, 'Resolution '), it.info.res),
    it.info.url ? h('p', {}, h('a', { href: it.info.url, target: '_blank', rel: 'noopener noreferrer' }, it.info.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/.*$/, ''))) : null);
  // variant and date are what the item shows, so they sit in the row; opacity and provenance are one click away
  const controls = h('div', { class: 'controls' },
    it.variants ? h('select', { 'aria-label': `${it.label} variant`, onchange: (e) => { state.variant[it.id] = e.target.value; applyItem(it.id); if (it.id === 'depth') depthColours(); writeHash(); renderStatus(); renderLegends(); } },
      Object.entries(it.variants).map(([k, label]) => h('option', { value: k }, label))) : null,
    it.date ? h('input', { type: 'date', 'aria-label': 'Imagery date', max: new Date().toISOString().slice(0, 10), min: '2012-01-01',
      onchange: (e) => e.target.value && setDate(e.target.value) }) : null);
  const row = h('li', { class: 'item' },
    h('div', { class: 'line' },
      input,
      h('label', { for: input.id }, it.label),
      h('span', { class: 'hint' }),
      h('button', { class: 'more', type: 'button', title: opacity ? 'Opacity, source, licence' : 'Source, licence, resolution',
        'aria-label': `Details for ${it.label}`, 'aria-expanded': 'false',
        onclick: (e) => { info.hidden = !info.hidden; e.currentTarget.setAttribute('aria-expanded', String(!info.hidden)); } }, '⋯')),
    controls, info);
  rows[it.id] = { row, input, controls };
  return row;
}

function groupBlock(g) {
  const items = ITEMS.filter((it) => it.group === g.id);
  const all = g.exclusive ? null : h('input', { type: 'checkbox', 'aria-label': `All of ${g.label}`,
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { const want = e.target.checked; for (const it of items) if (state.on.has(it.id) !== want) setOn(it.id, want); } });
  const list = h('ul', {}, items.map(itemRow));
  const det = h('details', { 'data-group': g.id, open: state.open.has(g.id),
    ontoggle: (e) => { e.target.open ? state.open.add(g.id) : state.open.delete(g.id); writeHash(); } },
    h('summary', {}, all, h('span', { class: 'gname' }, g.label), h('span', { class: 'count' })),
    g.pack ? packBox : null, list);
  if (g.pack) det._list = list;
  det._all = all;
  det._items = items;
  return det;
}

// ---- area pack: one GeoJSON file, read in the browser, never uploaded ---------
const pack = { doc: null, url: '' };
const packFile = h('input', { type: 'file', accept: '.geojson,.json,.gz,application/geo+json', hidden: true,
  onchange: (e) => { const f = e.target.files[0]; if (f) openPackFile(f); e.target.value = ''; } });
const packMeta = h('div', { class: 'packmeta' });
const packMsg = h('p', { class: 'note' });
const packBox = h('div', { class: 'packbox' }, packFile, packMeta, packMsg,
  h('div', { class: 'btns' },
    h('button', { type: 'button', id: 'pack-open', onclick: () => packFile.click() }, 'Open pack…'),
    h('button', { type: 'button', id: 'pack-fit', onclick: () => fitPack() }, 'Zoom to pack'),
    h('button', { type: 'button', id: 'pack-close', onclick: () => closePack() }, 'Close'),
    h('button', { type: 'button', id: 'pack-cmd', title: 'Copy the command that builds a pack for the current view',
      onclick: (e) => copyBuildCommand(e.currentTarget) }, 'Build command')));

async function openPackFile(file) {
  try { await loadPack(await file.arrayBuffer(), ''); } catch (err) { packMsg.textContent = `Could not open ${file.name}: ${err.message}`; }
}
async function loadPack(buf, url) {
  let bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  const doc = JSON.parse(new TextDecoder().decode(bytes));
  if (doc?.type !== 'FeatureCollection' || !doc.pack) throw new Error('not an area pack');
  if (doc.pack.version !== 2) throw new Error(`pack format ${doc.pack.version}; rebuild it with the current tools/build_pack.py`);
  const src = map.getSource('pack');
  src.attribution = doc.pack.credits || '';
  src.setData(doc);
  pack.doc = doc;
  pack.url = url;
  packMsg.textContent = '';
  renderPack();
  fitPack();
  writeHash();
}
function closePack() {
  pack.doc = null;
  pack.url = '';
  const src = map.getSource('pack');
  src.attribution = '';
  src.setData({ type: 'FeatureCollection', features: [] });
  renderPack();
  writeHash();
}
function fitPack() {
  if (pack.doc) map.fitBounds(pack.doc.pack.bbox, { padding: 40, bearing: map.getBearing() });
}
function renderPack() {
  const p = pack.doc?.pack;
  packMeta.replaceChildren(...(p ? [
    h('p', {}, h('b', {}, p.name), ` · built ${p.built}`),
    h('p', {}, `Depths: ${p.depth.source}, ${p.depth.resolution}; to ${p.depth.max_m} m`),
    h('p', {}, `Coastline: ${p.land}`),
    h('p', {}, `Contours: ${p.levels_m.join(', ')} m`),
  ] : [h('p', {}, 'A pack replaces the global depth layers inside its frame with gridded bathymetry and the exact coastline. Open one, or drop it on the map: it is read here and never uploaded.')]));
  $('#pack-fit', packBox).hidden = $('#pack-close', packBox).hidden = !p;
  $('#pack-open', packBox).hidden = !!p;
  const det = groupEls.find((g) => g._list);
  det._list.hidden = !p;
  det.querySelector('.gname').textContent = p ? `Area pack · ${p.name}` : 'Area pack';
  renderLegends();
}
async function copyBuildCommand(b) {
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
  const L = map.unproject([0, H / 2]), R = map.unproject([W, H / 2]), c = map.getCenter();
  const halfKm = window.geodesic.Geodesic.WGS84.Inverse(L.lat, L.lng, R.lat, R.lng).s12 / 2000;
  const cmd = `.venv/bin/python tools/build_pack.py area --center=${c.lat.toFixed(5)},${c.lng.toFixed(5)} --half-w-km ${halfKm.toFixed(2)} --aspect ${(H / W).toFixed(3)}`;
  try { await navigator.clipboard.writeText(cmd); flash(b, 'Copied'); } catch { prompt('Build command', cmd); }
}
// drag and drop anywhere on the page
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); document.body.classList.add('drop'); } });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drop');
  const f = e.dataTransfer?.files[0];
  if (f) openPackFile(f);
});
// a pack hosted next to the page: #pack=packs/name.geojson (same origin only)
async function loadPackParam() {
  if (!packParam) return;
  try {
    const u = new URL(packParam, location.href);
    if (u.origin !== location.origin) throw new Error('only packs on this site can be linked');
    const r = await fetch(u);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadPack(await r.arrayBuffer(), packParam);
  } catch (err) { packMsg.textContent = `Could not load ${packParam}: ${err.message}`; }
}

const groupEls = GROUPS.map(groupBlock);
const measureList = h('ul', { class: 'mlist' });
const unitSel = h('select', { 'aria-label': 'Distance units', onchange: (e) => measure.setUnits(e.target.value) },
  h('option', { value: 'km' }, 'km · m'), h('option', { value: 'nm' }, 'nautical miles'));
const measureAll = h('input', { type: 'checkbox', 'aria-label': 'Show all measurements', onclick: (e) => e.stopPropagation(),
  onchange: (e) => measure.setHidden(null, !e.target.checked) });
const measureGroup = h('details', { 'data-group': 'measure', open: state.open.has('measure'),
  ontoggle: (e) => { e.target.open ? state.open.add('measure') : state.open.delete('measure'); writeHash(); } },
  h('summary', {}, measureAll, h('span', { class: 'gname' }, 'Measurements'), h('span', { class: 'count' })),
  h('div', { class: 'mhead' }, h('label', {}, 'Units ', unitSel)),
  measureList,
  h('p', { class: 'note' }, 'Geodesic on WGS 84. Click to add points; double-click or Enter finishes; Backspace undoes; Esc cancels.'));

menu.append(...groupEls, measureGroup,
  h('p', { class: 'note warn' }, 'Not for navigation. Positions, depths and coastlines are from open datasets of varying accuracy.'));

function renderMenu() {
  const z = map.getZoom();
  for (const it of ITEMS) {
    const r = rows[it.id];
    const on = state.on.has(it.id);
    r.input.checked = on;
    r.controls.hidden = !on || !(it.variants || it.date);
    const low = it.minzoom && z < it.minzoom, high = it.maxzoom && z >= it.maxzoom + 1;
    r.row.classList.toggle('dim', !!(on && (low || high)));
    r.row.querySelector('.hint').textContent = !on ? '' : low ? `zoom ${it.minzoom}+` : high ? `zoom ≤ ${it.maxzoom}` : '';
    const sel = r.controls.querySelector('select');
    if (sel) sel.value = state.variant[it.id];
    const rng = r.row.querySelector('input[type=range]');
    if (rng) rng.value = state.opacity[it.id];
    const dt = r.controls.querySelector('input[type=date]');
    if (dt) dt.value = state.date;
  }
  for (const g of groupEls) {
    const n = g._items.filter((it) => state.on.has(it.id)).length;
    g.querySelector('.count').textContent = g._all ? `${n}/${g._items.length}` : '';
    if (g._all) { g._all.checked = n === g._items.length; g._all.indeterminate = n > 0 && n < g._items.length; }
  }
  renderStatus();
  renderLegends();
}

// ---- legends: one canvas per drawn colour layer (copied as-is into the PNG) ----
const legends = $('#legends');
const legendEls = {};
function legendEl(id) {
  return (legendEls[id] ||= h('canvas', { role: 'img', 'data-legend': id }));
}
function renderLegends() {
  const on = (id) => state.on.has(id);
  const want = [];
  if (on('legend')) {
    if (pack.doc && on('pack-depth') && on('chart')) want.push('pack');
    if (on('depth') && on('chart') && map.getZoom() < 13) want.push('depth');
    if (on('gibs') && GIBS[state.variant.gibs].legend) want.push('gibs');
  }
  for (const id of Object.keys(legendEls)) if (!want.includes(id)) legendEls[id].remove();
  for (const id of want) {
    const el = legendEl(id);
    if (id === 'depth') {
      drawRamp(el, 'Depth shading', 'm · approximate (DEM)', depthStops(), { colour: NO_DEPTH, label: 'lakes: no depth · lagoons: shown as 0–5 m' });
      el.setAttribute('aria-label', `Depth shading legend: ${depthStops().map(([d]) => d).join(', ')} metres`);
    } else if (id === 'pack') {
      const p = pack.doc.pack, edges = [0, ...p.levels_m];
      drawClasses(el, 'Pack depth', `m · ${p.depth.source.split(',')[0]}`, edges, edges.map((d) => colourAt(depthStops(), d)), `${Math.round(p.depth.max_m)}`,
        { colour: NO_DEPTH, label: 'water without depth data' });
      el.setAttribute('aria-label', `Pack depth legend: classes from ${edges.join(', ')} metres`);
    } else {
      const g = GIBS[state.variant.gibs], key = `${state.variant.gibs}|${state.date}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        loadColormap(g.legend.colormap)
          .then((cm) => {
            drawColormap(el, g.legend.title, `${g.legend.units} · ${state.date}`, cm);
            el.setAttribute('aria-label', `${g.legend.title} legend, ${g.legend.units}`);
          })
          .catch((err) => { el.dataset.key = ''; el.remove(); console.warn('legend colour map:', err.message); });
      }
    }
    legends.append(el); // keeps the wanted order
  }
}
function renderStatus() {
  for (const it of ITEMS) {
    const st = state.on.has(it.id) ? itemStatus(it.id) : null;
    const r = rows[it.id].row;
    r.classList.toggle('error', st?.cls === 'error');
    r.classList.toggle('partial', st?.cls === 'partial');
    r.title = st ? st.msg : '';
  }
}
function renderMeasures() {
  measureList.replaceChildren(...measure.list.map((x) => h('li', { class: 'item' },
    h('div', { class: 'line' },
      h('input', { type: 'checkbox', checked: !x.hidden, id: `m-${x.id}`, onchange: (e) => measure.setHidden(x.id, !e.target.checked) }),
      h('label', { for: `m-${x.id}` }, summary(x, measure.units)),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Delete measurement', title: 'Delete', onclick: () => measure.remove(x.id) }, '×')),
    x.kind === 'ring' ? h('div', { class: 'controls' }, h('label', { class: 'opacity' }, h('span', {}, `Radius (${measure.units === 'nm' ? 'NM' : 'km'})`),
      h('input', { type: 'number', min: 0, step: 'any', value: +(x.r / (measure.units === 'nm' ? 1852 : 1000)).toFixed(3),
        onchange: (e) => measure.setRadius(x.id, +e.target.value * (measure.units === 'nm' ? 1852 : 1000)) }))) : null)));
  if (!measure.list.length) measureList.append(h('li', { class: 'empty' }, 'None yet. Use the ruler, area or ring tools on the map.'));
  const shown = measure.list.filter((x) => !x.hidden).length;
  measureAll.checked = measure.list.length > 0 && shown === measure.list.length;
  measureAll.indeterminate = shown > 0 && shown < measure.list.length;
  measureAll.disabled = !measure.list.length;
  measureGroup.querySelector('.count').textContent = measure.list.length ? `${shown}/${measure.list.length}` : '';
  unitSel.value = measure.units;
  scale.setUnit(measure.units === 'nm' ? 'nautical' : 'metric');
}

// ---- panel + toolbar --------------------------------------------------------
const panel = $('#panel');
const toggle = $('#toggle');
function setMenu(open) {
  state.menu = open;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  writeHash();
}
toggle.addEventListener('click', () => setMenu(!state.menu));
$('#close').addEventListener('click', () => setMenu(false));

const tools = $('#tools');
function renderTools() {
  for (const b of tools.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(measure.tool === b.dataset.tool));
}
tools.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) measure.tool === b.dataset.tool ? measure.cancel() : measure.start(b.dataset.tool);
  else if (b.id === 'png') exportPng();
  else if (b.id === 'link') copyLink(b);
});
async function copyLink(b) {
  clearTimeout(hashTimer);
  try { await navigator.clipboard.writeText(location.href); flash(b, 'Copied'); } catch { prompt('Copy this link', location.href); }
}
function flash(b, text) {
  const t = b.textContent;
  b.textContent = text;
  setTimeout(() => { b.textContent = t; }, 1200);
}

// cursor position readout
const pos = $('#pos');
const dm = (v, p, n) => { const a = Math.abs(v), d = Math.floor(a); return `${d}°${((a - d) * 60).toFixed(3).padStart(6, '0')}′${v >= 0 ? p : n}`; };
map.on('mousemove', (e) => { pos.textContent = `${dm(e.lngLat.lat, 'N', 'S')}  ${dm(((e.lngLat.lng + 540) % 360) - 180, 'E', 'W')}`; });

// ---- latitude scale: on a Mercator chart, 1′ of latitude = 1 NM wherever you read it ----
const latCanvas = $('#latscale');
const MIN_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200];
// relative change of the map scale between the top and bottom of the view
function scaleVariation() {
  const H = map.getContainer().clientHeight;
  const a = Math.cos((map.unproject([0, 0]).lat * Math.PI) / 180), b = Math.cos((map.unproject([0, H]).lat * Math.PI) / 180);
  return Math.abs(a - b) / Math.min(a, b);
}
function drawLatScale() {
  const show = state.on.has('graticule') && Math.abs(map.getBearing()) < 0.5;
  latCanvas.hidden = !show;
  if (!show) return;
  const top = latCanvas.offsetTop, H = latCanvas.clientHeight, W = latCanvas.clientWidth, dpr = window.devicePixelRatio || 1;
  latCanvas.width = W * dpr;
  latCanvas.height = H * dpr;
  const g = latCanvas.getContext('2d');
  g.scale(dpr, dpr);
  const yOf = (lat) => map.project([map.getCenter().lng, lat]).y - top;
  const lat0 = map.unproject([0, top + H]).lat, lat1 = map.unproject([0, top]).lat;
  const perMin = H / ((lat1 - lat0) * 60);
  const step = MIN_STEPS.find((s) => s * perMin >= 7) || 1200;
  const lstep = MIN_STEPS.find((s) => s >= step && s * perMin >= 46 && (s / step) % 1 === 0) || step * 10;
  g.font = '10px system-ui, sans-serif';
  g.textBaseline = 'middle';
  for (let k = Math.floor((lat0 * 60) / step); k * step <= lat1 * 60; k++) {
    const m0 = k * step, y0 = yOf(m0 / 60), y1 = yOf((m0 + step) / 60);
    g.fillStyle = k % 2 ? '#2b3a46' : '#ffffff';
    g.fillRect(4, Math.min(y0, y1), 5, Math.abs(y1 - y0));
    const lm = Math.round(m0 * 10) / 10;
    if (Math.abs((lm / lstep) - Math.round(lm / lstep)) < 1e-6) {
      const d = Math.floor(Math.abs(lm) / 60 + 1e-9), mm = Math.abs(lm) - d * 60;
      const t = `${d}°${mm.toFixed(step < 1 ? 1 : 0).padStart(step < 1 ? 4 : 2, '0')}′${lm >= 0 ? 'N' : 'S'}`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(t, 12, y0);
      g.fillStyle = '#2b3a46'; g.fillText(t, 12, y0);
      g.fillRect(3, y0 - 0.5, 8, 1);
    }
  }
  g.strokeStyle = '#2b3a46'; g.lineWidth = 1; g.strokeRect(3.5, 0, 6, H);
  latCanvas.title = `Latitude scale: 1′ of latitude = 1 nautical mile, valid anywhere on this chart (ticks every ${step}′)`;
  const v = scaleVariation();
  $('#scalenote').textContent = v > 0.01 ? `scale varies ${(v * 100).toFixed(0)}% top to bottom · use the latitude scale (1′ = 1 NM)` : '';
}
let latRaf = 0;
map.on('move', () => { cancelAnimationFrame(latRaf); latRaf = requestAnimationFrame(drawLatScale); });
window.addEventListener('resize', drawLatScale);

// ---- PNG export: the map canvas plus scale, north arrow and a credit strip ---
function attributionText() {
  const srcs = new Set();
  for (const l of map.getStyle().layers) if (l.source && map.getLayoutProperty(l.id, 'visibility') !== 'none') srcs.add(l.source);
  const parts = [...srcs].map((s) => map.getSource(s)?.attribution).filter(Boolean);
  const tmp = document.createElement('div');
  return [...new Set(parts)].map((p) => { tmp.innerHTML = p; return tmp.textContent; }).join(' · ');
}
function niceLen(m) {
  const p = 10 ** Math.floor(Math.log10(m));
  return [5, 2, 1].map((k) => k * p).find((v) => v <= m) || p;
}
// waits for pending tiles, so a layer switched on a moment ago is in the picture
function exportPng() {
  if (!(map.loaded() && map.areTilesLoaded())) { map.once('idle', exportPng); return; }
  map.once('render', () => {
    const src = map.getCanvas();
    const dpr = src.width / src.clientWidth;
    const lines = wrap(attributionText(), Math.floor(src.clientWidth / 6.2));
    const footer = (22 + lines.length * 14) * dpr;
    const out = h('canvas', { width: src.width, height: src.height + footer });
    const g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    g.scale(dpr, dpr);
    const W = src.clientWidth, H = src.clientHeight;
    // scale bar at the centre latitude (Web Mercator scale varies with latitude)
    const lat = map.getCenter().lat;
    const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const units = measure.units;
    const unitM = units === 'nm' ? 1852 : 1;
    const len = niceLen((120 * mpp) / unitM) * unitM;
    const px = len / mpp;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(10, H - 40, px + 20, 30);
    g.strokeStyle = '#2b3a46';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(20, H - 24); g.lineTo(20, H - 18); g.lineTo(20 + px, H - 18); g.lineTo(20 + px, H - 24); g.stroke();
    g.fillStyle = '#2b3a46';
    g.font = '11px system-ui, sans-serif';
    const v = scaleVariation();
    g.fillText(`${fmtDist(len, units)} at ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}${v > 0.01 ? ` (varies ${(v * 100).toFixed(0)}% top–bottom; 1′ lat = 1 NM)` : ''}`, 20, H - 26);
    if (!latCanvas.hidden) g.drawImage(latCanvas, latCanvas.offsetLeft, latCanvas.offsetTop, latCanvas.clientWidth, latCanvas.clientHeight);
    const box = map.getContainer().getBoundingClientRect();
    for (const el of legends.querySelectorAll('canvas')) {
      const r = el.getBoundingClientRect();
      g.drawImage(el, r.left - box.left, r.top - box.top, r.width, r.height);
    }
    // north arrow
    g.save();
    g.translate(W - 28, 34);
    g.rotate((-map.getBearing() * Math.PI) / 180);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(0, 0, 18, 0, 2 * Math.PI); g.fill();
    g.fillStyle = '#2b3a46'; g.beginPath(); g.moveTo(0, -14); g.lineTo(6, 6); g.lineTo(0, 2); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('N', 0, 15);
    g.restore();
    // credit strip
    g.fillStyle = '#fff'; g.fillRect(0, H, W, footer / dpr);
    g.fillStyle = '#2b3a46'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'left';
    const c = map.getCenter();
    g.fillText(`Centre ${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')} · zoom ${map.getZoom().toFixed(1)} · Web Mercator · exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · NOT FOR NAVIGATION`, 8, H + 15);
    g.fillStyle = '#5d6d79';
    lines.forEach((t, i) => g.fillText(t, 8, H + 30 + i * 14));
    out.toBlob((blob) => {
      const a = h('a', { href: URL.createObjectURL(blob), download: `chart-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });
  map.triggerRepaint();
}
function wrap(text, n) {
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).length > n && line) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

// ---- go ---------------------------------------------------------------------
map.on('load', () => {
  // Raster sources round the zoom when picking tiles; the vector basemap floors it. Floor
  // here too, so the clipped elevation tiles are cut with the coastline the basemap draws
  // (clip.js seaMask). roundZoom is a property of MapLibre's raster tile sources.
  for (const id of ['dem-sea', 'dem']) map.getSource(id).roundZoom = false;
  for (const it of ITEMS) applyItem(it.id);
  depthColours();
  labelPaint();
  measure.load(measureState);
  updateGraticule();
  renderMenu();
  renderMeasures();
  renderPack();
  setMenu(state.menu);
  drawLatScale();
  loadPackParam();
});
map.on('moveend', () => { updateGraticule(); writeHash(); });
let gratRaf = 0;
map.on('move', () => { cancelAnimationFrame(gratRaf); gratRaf = requestAnimationFrame(updateGraticule); }); // edge labels follow the frame
map.on('zoomend', renderMenu);
map.on('dataloading', () => document.body.classList.add('loading'));
map.on('idle', () => document.body.classList.remove('loading'));
window.addEventListener('hashchange', () => location.reload());
window.map = map; // handy from the console

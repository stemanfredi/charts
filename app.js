import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA, DEM_LAND, OMT_TILEJSON, ISOBATH_ZOOMS, OPACITY_PROP, DEPTH_SCHEMES, depthRamp, NO_DEPTH, DENSITY, ESRI_META, esriAttribution, buildStyle, defaultDate, gibsTiles, gibsDomainUrl, domainEnd, densityTiles } from './catalog.js';
import { workerClipper } from './clip.js';
import { drawRamp, loadColormap, drawColormap } from './legend.js';
import { fmtAngle, dm, mercatorVariation, niceLen, wrap, parseLatLon } from './format.js';
import { Measure, MEASURE_LAYERS, summary, measureFeatures } from './measure.js';
import { affine, worldFile, pamXml, stacItem } from './export.js';
import { zip } from './zip.js';
import { viewFeatures } from './vector.js';

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
  period: Object.fromEntries(Object.entries(DENSITY).map(([id, d]) => [id, d.defaultPeriod])), // density datasets
  open: new Set(['base', 'sea']),
  panel: window.innerWidth >= 1200 ? 'layers' : null, // the side panel's view; open beside the map where it leaves room
};
let view = { zoom: 4, center: [12, 41], bearing: 0 };
let measureState = '';

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
  if (DENSITY.traffic.periods.includes(q.get('y'))) state.period.traffic = q.get('y'); // links from before per=
  for (const kv of (q.get('per') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (DENSITY[k]?.periods.includes(val)) state.period[k] = val;
  }
  if (q.has('g')) state.open = new Set(q.get('g').split(',').filter((g) => g === 'measure' || GROUPS.some((x) => x.id === g)));
  if (q.has('menu')) state.panel = { 1: 'layers', measure: 'measure' }[q.get('menu')] || null; // menu=1 from older links: Layers
  measureState = q.get('m') || '';
  return q.get('u');
}

let hashTimer = 0;
let ready = false; // until map load, the URL still holds state not yet applied (m=): leave it alone
function writeHash() {
  clearTimeout(hashTimer);
  if (ready) hashTimer = setTimeout(writeHashNow, 250);
}
function writeHashNow() {
  clearTimeout(hashTimer);
  if (!ready) return;
  const c = map.getCenter();
  const q = new URLSearchParams();
  q.set('v', [map.getZoom().toFixed(2), c.lat.toFixed(5), c.lng.toFixed(5), Math.round(map.getBearing())].join('/'));
  q.set('on', [...state.on].join(','));
  const variants = Object.entries(state.variant).filter(([k, v]) => v !== Object.keys(byId[k].variants)[0]);
  if (variants.length) q.set('var', variants.map((kv) => kv.join(':')).join(','));
  const ops = Object.entries(state.opacity).filter(([k, v]) => v !== byId[k].opacity);
  if (ops.length) q.set('op', ops.map(([k, v]) => `${k}:${v}`).join(','));
  if (state.on.has('gibs')) q.set('d', state.date);
  const per = Object.entries(state.period).filter(([id, v]) => state.on.has(id) && v !== DENSITY[id].defaultPeriod);
  if (per.length) q.set('per', per.map((kv) => kv.join(':')).join(','));
  if (measure.units !== 'km') q.set('u', measure.units);
  const m = measure.serialize();
  if (m) q.set('m', m);
  q.set('g', [...state.open].join(','));
  q.set('menu', state.panel === 'measure' ? 'measure' : state.panel ? '1' : '0');
  history.replaceState(null, '', `#${q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%3B/g, ';').replace(/%7E/g, '~')}`);
}

const urlUnits = readHash();

// ---- map --------------------------------------------------------------------
// Elevation goes through clip.js (cut to the OSM coastline). worker: false keeps
// maplibre-contour's tile manager on this thread, where its getTile/decodeImage can be
// replaced; the shaded rasters (clip-* protocols) and the contours share one tile cache.
const demOpts = { url: DEM_TILES, encoding: 'terrarium', worker: false, cacheSize: 200 };
const seaDem = new mlcontour.DemSource({ ...demOpts, id: 'sea', maxzoom: DEM_SEA.max });
const landDem = new mlcontour.DemSource({ ...demOpts, id: 'land', maxzoom: DEM_LAND.max });
// a water body classified after some of its tiles were drawn: redraw the depth shading
const reloadDepth = () => map.getSource('dem-sea')?.setTiles(['clip-sea://{z}/{x}/{y}']);
const seaClip = workerClipper({ template: DEM_TILES, native: DEM_SEA.native, mode: 'sea', omtTileJson: OMT_TILEJSON, onStale: reloadDepth });
const landClip = workerClipper({ template: DEM_TILES, native: DEM_LAND.native, mode: 'land', omtTileJson: OMT_TILEJSON });
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
  isobathUrl: seaDem.contourProtocolUrl({ ...contourOpts, thresholds: Object.fromEntries(ISOBATH_ZOOMS.map(([z, step, major]) => [z, [step, major]])) }),
  contourUrl: landDem.contourProtocolUrl({ ...contourOpts, thresholds: { 9: [100, 500], 11: [50, 250], 12: [20, 100] } }),
  date: state.date,
  density: Object.fromEntries(Object.keys(DENSITY).map((id) => [id, [state.variant[id], state.period[id]]])),
});
style.layers.push(...MEASURE_LAYERS);

// MapLibre's worker from the pinned, hashed URL in index.html (tools/deps.mjs): a copy the browser
// has checked against the hash, instead of MapLibre's own unchecked import from the CDN. The hash
// is checked here, not by fetch(): Firefox does not hand a fetch with `integrity` the preloaded
// copy (it downloads the worker twice), and Chrome warns about integrity on a fetch preload.
async function verifiedWorker({ href, dataset: { integrity } }) {
  const opts = { referrerPolicy: 'no-referrer' };
  // plain http (a phone on the LAN, npm run serve) has no SubtleCrypto: fetch checks, downloading twice
  if (!crypto.subtle) return (await fetch(href, { ...opts, integrity })).blob();
  const r = await fetch(href, opts);
  if (!r.ok) throw new Error(`MapLibre worker: HTTP ${r.status}`);
  const code = await r.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', code));
  if (`sha384-${btoa(String.fromCharCode(...digest))}` !== integrity) throw new Error(`MapLibre worker: hash mismatch (${href})`);
  return new Blob([code], { type: 'text/javascript' });
}
maplibregl.setWorkerUrl(URL.createObjectURL(await verifiedWorker($('#maplibre-gl-worker'))));

const map = new maplibregl.Map({
  container: 'map', style, ...view,
  maxPitch: 0, pitchWithRotate: false, dragRotate: true, touchPitch: false,
  attributionControl: false, fadeDuration: 150,
  // MapLibre's workers set the page address as the referrer explicitly, past the page's
  // no-referrer meta tag: ask for none on every request it makes
  transformRequest: (url) => ({ url, referrerPolicy: 'no-referrer' }),
});
map.touchZoomRotate.disableRotation();
const small = () => window.innerWidth < 720;

// ---- bottom row: credits, scale note, cursor position, double scale ------------------------
// The scale is double, as on OpenSeaMap: km above the line, nautical miles below. Credits are
// always written out, at every width (Esri: data attribution "always visible"; OSM likewise).
const statusEl = $('#status');
const posEl = h('div', { class: 'pos', id: 'pos', 'aria-live': 'off' });
const scales = ['metric', 'nautical'].map((unit) => new maplibregl.ScaleControl({ maxWidth: 100, unit }));
const scalesEl = h('div', { class: 'scales', id: 'scales' }, scales.map((s) => s.onAdd(map)));
const scaleNoteEl = h('div', { class: 'scalenote', id: 'scalenote' });
const attribution = new maplibregl.AttributionControl({ compact: false });
// credits on the left; the scale note, cursor position and scale grouped on the right
statusEl.append(attribution.onAdd(map), h('div', { class: 'readout' }, scaleNoteEl, posEl, scalesEl));
// the panel, zoom buttons and legends sit above the bottom row, whose height follows its credits
new ResizeObserver(() => document.documentElement.style.setProperty('--status-h', `${statusEl.offsetHeight}px`)).observe(statusEl);

// ---- zoom and compass (the compass only appears when the map is rotated) -------------------
$('#zoom-in').addEventListener('click', () => map.zoomIn());
$('#zoom-out').addEventListener('click', () => map.zoomOut());
const compass = $('#compass');
compass.addEventListener('click', () => map.resetNorth());
function renderCompass() {
  const b = map.getBearing();
  compass.hidden = Math.abs(b) < 0.5;
  compass.firstElementChild.style.transform = `rotate(${-b}deg)`;
}
map.on('rotate', renderCompass);

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
      && (!l.metadata.base || state.on.has(l.metadata.base)); // e.g. depth shading only over the chart base
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
  id === 'gibs' && on ? showGibs() : applyItem(id);
  if (it.group === 'base') { for (const k of baseDependent) applyItem(k); renderLegends(); labelPaint(); creditEsri(); }
  if (id === 'graticule') updateGraticule();
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
// the depth colour scheme is the Depth shading item's variant
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
  shoreFill();
  renderLegends();
}
// Over satellite, labels flip to light text on a dark halo (dark-on-white reads badly on imagery).
const SAT_LABELS = {
  places: '#ffffff', islands: '#ffffff', 'graticule-labels': '#ffffff',
  'sea-names': '#cfe6ff', 'sea-names-line': '#cfe6ff',
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
  for (const id of LINE_IDS) map.setPaintProperty(id, 'line-color', sat ? '#bfe0ff' : ink ? ink.line : chartLineColour[id]);
  for (const id of Object.keys(SAT_LABELS).filter((k) => /^isobath-labels/.test(k))) {
    if (sat || !ink) continue;
    map.setPaintProperty(id, 'text-color', ink.text);
    map.setPaintProperty(id, 'text-halo-color', ink.halo);
  }
}
const LINE_IDS = style.layers.filter((l) => /^isobaths(-\d+)?$/.test(l.id) && l.type === 'line').map((l) => l.id);
const chartLineColour = Object.fromEntries(LINE_IDS.map((id) => [id, style.layers.find((l) => l.id === id).paint['line-color']]));
function setDensity(id) {
  map.getSource(id).setTiles(densityTiles(id, state.variant[id], state.period[id]));
  writeHash();
  renderLegends();
}
// Esri imagery credits: the service's current copyrightText (providers get renamed: Maxar → Vantor)
let esriCredited = false;
async function creditEsri() {
  if (esriCredited || !(state.on.has('sat') && state.variant.sat === 'esri')) return;
  esriCredited = true;
  try {
    const r = await fetch(ESRI_META, { credentials: 'omit' });
    const text = r.ok && (await r.json()).copyrightText;
    if (!text) return;
    const src = map.getSource('esri');
    src.attribution = esriAttribution(text);
    src.setTiles(src.tiles); // a source event makes the attribution control redraw
  } catch { esriCredited = false; } // keep the built-in text; retry on the next switch
}
function setDate(date) {
  state.date = date;
  for (const k of Object.keys(GIBS)) map.getSource(`gibs-${k}`).setTiles(gibsTiles(k, date));
  writeHash();
  renderMenu(); // the date field and the next-day button follow; also redraws the legends
}
// NASA publishes each layer after its own delay (true colour within a day, MUR SST about two):
// ask GIBS for the newest date of the layer shown, and step back to it rather than show nothing
const gibsEnd = {}; // GIBS key → promise of its newest date, or null if unknown
let gibsLast = null; // newest date of the layer shown, once known
function latestGibs(key) {
  return (gibsEnd[key] ||= fetch(gibsDomainUrl(key, shiftDay(today(), -60), today()), { credentials: 'omit' })
    .then((r) => (r.ok ? r.text() : null))
    .then((t) => (t ? domainEnd(t) : null))
    .catch(() => { delete gibsEnd[key]; return null; }));
}
// the NASA layer is drawn only once its date is known, so it never asks for a day not published yet
async function showGibs() {
  await checkGibsDate();
  applyItem('gibs');
}
async function checkGibsDate() {
  if (!state.on.has('gibs')) return;
  const key = state.variant.gibs, end = await latestGibs(key);
  if (key !== state.variant.gibs) return; // switched meanwhile
  gibsLast = end;
  if (end && state.date > end) setDate(end);
  else renderMenu();
}

// ---- graticule (WGS 84 lat/lon grid; spacing adapts to the view) -------------
const STEPS = [30, 20, 10, 5, 2, 1, 30 / 60, 20 / 60, 10 / 60, 5 / 60, 2 / 60, 1 / 60];
function updateGraticule() {
  if (!state.on.has('graticule')) return;
  const b = map.getBounds();
  const span = Math.max(b.getNorth() - b.getSouth(), (b.getEast() - b.getWest()) * Math.cos((map.getCenter().lat * Math.PI) / 180));
  const step = STEPS.find((s) => span / s >= 3) || STEPS[STEPS.length - 1];
  const f = [];
  const s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
  const w = b.getWest(), e = b.getEast();
  const k0 = (x) => Math.round(x * 3600) / 3600;
  // edge labels: meridians along the top, parallels along the left (the controls and the panel
  // are on the right); only when north-up, where a screen edge is a parallel or a meridian.
  // The bottom edge is busy with legends, credits and the scale.
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
  const edges = Math.abs(map.getBearing()) < 0.5;
  const latTop = map.unproject([W / 2, 64]).lat, lonLeft = map.unproject([8, H / 2]).lng;
  const label = (coord, text, anchor) => f.push({ type: 'Feature', properties: { label: text, anchor }, geometry: { type: 'Point', coordinates: coord } });
  for (let lon = Math.ceil(w / step) * step; lon <= e; lon += step) {
    const L = ((k0(lon) + 540) % 360) - 180;
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, s], [lon, n]] } });
    if (edges) label([lon, latTop], fmtAngle(L, 'E', 'W', step), 'top');
  }
  for (let lat = Math.ceil(s / step) * step; lat <= n; lat += step) {
    const coords = [];
    for (let x = w; x < e; x += (e - w) / 32) coords.push([x, lat]);
    coords.push([e, lat]);
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    if (edges) label([lonLeft, lat], fmtAngle(k0(lat), 'N', 'S', step), 'left');
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
map.on('movestart', () => { for (const k in health) delete health[k]; renderStatus(); });
function itemStatus(id) {
  for (const l of layersOf[id] || []) {
    if (l.metadata.variant && l.metadata.variant !== state.variant[id]) continue;
    const s = health[l.source];
    if (s?.err) return { cls: s.ok ? 'partial' : 'error', msg: s.ok ? `some tiles failed: ${s.msg}` : `not loading: ${s.msg}` };
  }
  return null;
}

// ---- small builders ---------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
// a 20 px line icon from SVG path data; a path given as [d, colour] is filled in that colour
function icon(...paths) {
  const s = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) s.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    if (Array.isArray(d)) { p.setAttribute('d', d[0]); p.setAttribute('fill', d[1]); p.setAttribute('stroke', d[1]); } else p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}
const ICON = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4-4'],
  layers: ['M12 3 3 8l9 5 9-5-9-5z', 'm3 13 9 5 9-5'],
  link: ['M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1', 'M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'],
  png: ['M12 3v12M7 10l5 5 5-5', 'M4 19h16'],
  zip: ['M4 4h16v4H4z', 'M5 8v12h14V8', 'M10 12h4'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  compass: [['m12 3 4 9h-8z', '#b42318'], 'm12 21-4-9h8z'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  ruler: ['M3 17 17 3l4 4L7 21z', 'm7 13 2 2M10 10l2 2M13 7l2 2'],
  area: ['m12 3 8 6-3 11H7L4 9z'],
  ring: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 12h.01'],
};
// the page's own buttons name their icon: <i data-icon="…">
for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(icon(...ICON[el.dataset.icon]));
// two or three mutually exclusive buttons (a segmented control)
function seg(label, options, get, set) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label },
    Object.entries(options).map(([v, [text, title]]) => h('button', { type: 'button', 'data-v': v, title, onclick: () => set(v) }, text)));
  el.render = () => { for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.v === get())); };
  return el;
}

// ---- layers panel -----------------------------------------------------------
const menu = $('#menu');
const rows = {};
const segs = [];
function setVariant(id, v) {
  state.variant[id] = v;
  id === 'gibs' ? showGibs() : applyItem(id);
  if (id === 'depth') depthColours();
  if (DENSITY[id]) setDensity(id);
  if (id === 'sat') creditEsri();
  writeHash();
  renderMenu();
}
const shiftDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

// provenance (and the opacity slider) behind an item's ⓘ
function infoBlock(it) {
  const opacity = it.opacity != null ? h('label', { class: 'opacity' }, h('span', {}, it.id === 'relief' ? 'Strength' : 'Opacity'),
    h('input', { type: 'range', min: 0, max: 1, step: 0.05, oninput: (e) => { state.opacity[it.id] = +e.target.value; applyItem(it.id); writeHash(); } })) : null;
  return h('div', { class: 'info', hidden: true }, opacity,
    h('p', {}, h('b', {}, 'Source '), it.info.src),
    h('p', {}, h('b', {}, 'Licence '), it.info.lic),
    h('p', {}, h('b', {}, 'Resolution '), it.info.res),
    it.info.url ? h('p', {}, h('a', { href: it.info.url, target: '_blank', rel: 'noopener noreferrer' }, it.info.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/.*$/, ''))) : null);
}
function moreButton(label, info) {
  return h('button', { class: 'more', type: 'button', title: 'Source, licence, resolution', 'aria-label': `About ${label}`, 'aria-expanded': 'false',
    onclick: (e) => { info.hidden = !info.hidden; e.currentTarget.setAttribute('aria-expanded', String(!info.hidden)); } }, icon(...ICON.info));
}
// what the item shows (scheme, source, period, date) sits under its row while it is on
function controlsOf(it) {
  let variant = null;
  if (it.id === 'depth') {
    variant = seg('Depth colours', { atlas: ['Darker = deeper', it.variants.atlas], nautical: ['Darker = shallower', it.variants.nautical] }, () => state.variant.depth, (v) => setVariant('depth', v));
    segs.push(variant);
  } else if (it.variants) {
    variant = h('select', { class: 'variant', 'aria-label': `${it.label} variant`, onchange: (e) => setVariant(it.id, e.target.value) },
      Object.entries(it.variants).map(([k, label]) => h('option', { value: k }, label)));
  }
  const period = it.density ? h('select', { class: 'period', 'aria-label': `${it.label} period`, onchange: (e) => { state.period[it.id] = e.target.value; setDensity(it.id); } },
    DENSITY[it.id].periods.map((p) => h('option', { value: p }, DENSITY[it.id].periodLabel(p)))) : null;
  const date = it.date ? h('div', { class: 'datestep' },
    h('button', { type: 'button', class: 'prev', 'aria-label': 'Previous day', title: 'Previous day', onclick: () => setDate(shiftDay(state.date, -1)) }, '‹'),
    h('input', { type: 'date', 'aria-label': 'Imagery date', max: today(), min: '2012-01-01', onchange: (e) => e.target.value && setDate(e.target.value) }),
    h('button', { type: 'button', class: 'next', 'aria-label': 'Next day', title: 'Next day', onclick: () => setDate(shiftDay(state.date, 1)) }, '›')) : null;
  const latest = it.date ? h('p', { class: 'note latest' }) : null; // the newest day NASA has published for this layer
  return h('div', { class: 'controls' }, variant, period, date, latest);
}
function itemRow(it) {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: `i-${it.id}`, onchange: (e) => setOn(it.id, e.target.checked) });
  const info = infoBlock(it), controls = controlsOf(it);
  const row = h('li', { class: 'item' },
    h('div', { class: 'line' }, h('label', { class: 'name', for: input.id }, it.label, h('span', { class: 'hint' })), moreButton(it.label, info), input),
    controls, info);
  rows[it.id] = { row, input, controls };
  return row;
}
// Base: two cards (a radio group); the satellite source and the provenance below them
function baseBlock(items) {
  const infos = Object.fromEntries(items.map((it) => [it.id, infoBlock(it)]));
  const more = moreButton('this base', h('div')); // toggles the info of whichever base is shown
  more.onclick = (e) => {
    const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
    e.currentTarget.setAttribute('aria-expanded', String(open));
    for (const [id, el] of Object.entries(infos)) el.hidden = !(open && state.on.has(id));
  };
  const cards = items.map((it) => {
    const card = h('button', { type: 'button', role: 'radio', class: 'basecard', 'data-base': it.id, id: `i-${it.id}`, 'aria-checked': 'false', onclick: () => setOn(it.id, true) },
      h('div', { class: 'thumb' }), h('span', {}, it.label));
    rows[it.id] = { row: card, input: card, controls: controlsOf(it), infos, more };
    return card;
  });
  return h('div', { class: 'base' },
    h('div', { class: 'bases', role: 'radiogroup', 'aria-label': 'Base map' }, cards),
    h('ul', {}, h('li', { class: 'item' }, ...items.map((it) => rows[it.id].controls),
      h('div', { class: 'line' }, h('span', { class: 'name' }, 'Source and licence'), more), ...Object.values(infos))));
}
function groupBlock(g) {
  const items = ITEMS.filter((it) => it.group === g.id);
  const det = h('details', { 'data-group': g.id, open: state.open.has(g.id),
    ontoggle: (e) => { e.target.open ? state.open.add(g.id) : state.open.delete(g.id); writeHash(); } },
    h('summary', {}, h('span', { class: 'gname' }, g.label), h('span', { class: 'count', title: 'Layers on' })),
    g.exclusive ? baseBlock(items) : h('ul', {}, items.map(itemRow)));
  det._items = items;
  det._exclusive = g.exclusive;
  return det;
}
const groupEls = GROUPS.map(groupBlock);
menu.append(...groupEls);

function renderMenu() {
  const z = map.getZoom();
  for (const it of ITEMS) {
    const r = rows[it.id];
    const on = state.on.has(it.id);
    if (it.group === 'base') r.input.setAttribute('aria-checked', String(on));
    else r.input.checked = on;
    r.controls.hidden = !on || !(it.variants || it.date || it.density);
    if (r.infos && r.more.getAttribute('aria-expanded') === 'true') r.infos[it.id].hidden = !on;
    const low = it.minzoom && z < it.minzoom, high = it.maxzoom && z >= it.maxzoom + 1;
    r.row.classList.toggle('dim', !!(on && (low || high)));
    const hint = r.row.querySelector('.hint');
    if (hint) hint.textContent = !on ? '' : low ? `zoom ${it.minzoom}+` : high ? `zoom ≤ ${it.maxzoom}` : '';
    const sel = r.controls.querySelector('select.variant');
    if (sel) sel.value = state.variant[it.id];
    const per = r.controls.querySelector('select.period');
    if (per) per.value = state.period[it.id];
    const rng = (r.infos?.[it.id] || r.row).querySelector('input[type=range]');
    if (rng) rng.value = state.opacity[it.id];
    const dt = r.controls.querySelector('input[type=date]');
    if (dt) {
      const last = gibsLast || today();
      dt.value = state.date;
      dt.max = last;
      r.controls.querySelector('.next').disabled = state.date >= last;
      r.controls.querySelector('.latest').textContent = gibsLast ? `Newest published: ${gibsLast}` : '';
    }
  }
  for (const s of segs) s.render();
  for (const g of groupEls) {
    const n = g._items.filter((it) => state.on.has(it.id)).length;
    g.querySelector('.count').textContent = g._exclusive || !n ? '' : String(n);
  }
  renderStatus();
  renderLegends();
}

// ---- legends: stacked bottom left, one per drawn colour layer (the Legends switch shows them) ----
// The canvases are drawn whenever their layer is (the PNG copies them, switch or not).
const legends = $('#legends');
const legendEls = {};
let legendWant = [];
function legendEl(id) {
  return (legendEls[id] ||= h('canvas', { role: 'img', 'data-legend': id }));
}
function renderLegends() {
  const on = (id) => state.on.has(id);
  const want = [];
  if (on('depth') && on('chart') && map.getZoom() < 13) want.push('depth');
  for (const id of Object.keys(DENSITY)) if (on(id)) want.push(id);
  if (on('gibs') && GIBS[state.variant.gibs].legend) want.push('gibs');
  legendWant = want;
  for (const id of want) {
    const el = legendEl(id);
    if (id === 'depth') {
      drawRamp(el, 'Depth shading', 'm · approximate (DEM)', depthStops(), { colour: NO_DEPTH, label: 'lakes: no depth · lagoons: shown as 0–5 m' });
      el.setAttribute('aria-label', `Depth shading legend: ${depthStops().map(([d]) => d).join(', ')} metres`);
    } else if (DENSITY[id]) {
      const d = DENSITY[id];
      drawRamp(el, d.title, `${d.unit} · ${d.types[state.variant[id]]} · ${d.periodLabel(state.period[id])}`, d.stops);
      el.setAttribute('aria-label', `${d.title} legend: ${d.stops.map(([v]) => v).join(', ')} ${d.unit}`);
    } else {
      const g = GIBS[state.variant.gibs], key = `${state.variant.gibs}|${state.date}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        loadColormap(g.legend.colormap)
          .then((cm) => {
            drawColormap(el, g.legend.title, `${g.legend.units} · ${state.date}`, cm);
            el.setAttribute('aria-label', `${g.legend.title} legend, ${g.legend.units}`);
          })
          .catch((err) => { el.dataset.key = ''; console.warn('legend colour map:', err.message); });
      }
    }
  }
  legends.replaceChildren(...(on('legend') ? want.map((id) => legendEls[id]) : []));
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

// ---- measure view (in the side panel): tools, units, saved measurements -----------------
const TOOL = { ruler: ['Ruler', 'Distance and bearing (R)'], area: ['Area', 'Area and perimeter (A)'], ring: ['Ring', 'Range ring: centre, then radius (C)'] };
const TIP = { ruler: 'Click to add points', area: 'Click to add corners', ring: 'Click the centre, then the edge' };
const measureView = $('#mview');
const toolBtns = Object.entries(TOOL).map(([k, [label, title]]) => h('button', { type: 'button', 'data-tool': k, 'aria-pressed': 'false', title,
  onclick: () => { if (small()) setPanel(null); measure.tool === k ? measure.finish() : measure.start(k); } }, icon(...ICON[k]), label)); // phones: the sheet makes way for the map
const unitSeg = seg('Distance units', { km: ['km · m', 'Kilometres and metres'], nm: ['Nautical miles', 'Nautical miles'] }, () => measure.units, (u) => measure.setUnits(u));
const measureList = h('ul', { class: 'mlist' });
measureView.append(h('div', { class: 'tools3' }, toolBtns), h('h2', {}, 'Units'), unitSeg, h('h2', {}, 'Measurements'), measureList,
  h('p', { class: 'note' }, 'Geodesic on WGS 84. Bearings are true (°T). Double-click or Enter finishes; Backspace undoes; Esc cancels.'));
function renderMeasures() {
  const u = measure.units === 'nm' ? ['NM', 1852] : ['km', 1000];
  measureList.replaceChildren(...measure.list.map((x) => h('li', { class: 'item' },
    h('div', { class: 'line' },
      h('input', { type: 'checkbox', checked: !x.hidden, id: `m-${x.id}`, 'aria-label': 'Show on the map', onchange: (e) => measure.setHidden(x.id, !e.target.checked) }),
      h('label', { class: 'name', for: `m-${x.id}` }, summary(x, measure.units)),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Delete measurement', title: 'Delete', onclick: () => measure.remove(x.id) }, '×')),
    x.kind === 'ring' ? h('div', { class: 'controls' }, h('label', { class: 'opacity' }, h('span', {}, `Radius (${u[0]})`),
      h('input', { type: 'number', min: 0, step: 'any', value: +(x.r / u[1]).toFixed(3), onchange: (e) => measure.setRadius(x.id, +e.target.value * u[1]) }))) : null)));
  if (!measure.list.length) measureList.append(h('li', { class: 'empty' }, 'None yet: pick a tool above.'));
  unitSeg.render();
}

// ---- measuring bar: what is being drawn, the live value, Undo / Done / Cancel ------------------
const mbar = $('#mbar');
const mbarWhat = h('span', { class: 'what' }), mbarVal = h('span', { class: 'val' }), mbarTip = h('span', { class: 'tip' });
mbar.append(mbarWhat, mbarVal, mbarTip,
  h('button', { type: 'button', onclick: () => measure.undo(), title: 'Remove the last point (Backspace)' }, 'Undo'),
  h('button', { type: 'button', class: 'done', onclick: () => measure.finish(), title: 'Finish (Enter, or double-click)' }, 'Done'),
  h('button', { type: 'button', onclick: () => measure.cancel(), title: 'Discard (Esc)' }, 'Cancel'));
function renderTools() {
  for (const b of toolBtns) b.setAttribute('aria-pressed', String(measure.tool === b.dataset.tool));
  $('#b-measure').classList.toggle('active', !!measure.tool);
  mbar.hidden = !measure.tool;
  if (!measure.tool) return;
  const p = measure.preview();
  mbarWhat.textContent = TOOL[measure.tool][0];
  mbarVal.textContent = p.pts.length ? summary(p, measure.units).replace(/^\S+ /, '') : '';
  mbarTip.textContent = TIP[measure.tool];
}

// ---- side panel, link and PNG, about -----------------------------------------------------
// One side panel; the Layers and Measure buttons switch what it shows, and the button of the
// view already shown closes it. It keeps its place and size, so nothing overlaps.
const panel = $('#panel'), panelTitle = $('#panel-title');
const VIEWS = { layers: [$('#b-layers'), menu, 'Layers'], measure: [$('#b-measure'), measureView, 'Measure'] };
function setPanel(view) {
  state.panel = view;
  panel.hidden = !view;
  for (const [v, [btn, el, title]] of Object.entries(VIEWS)) {
    btn.setAttribute('aria-expanded', String(v === view));
    el.hidden = v !== view;
    if (v === view) panelTitle.textContent = title;
  }
  document.body.classList.toggle('menu-open', !!view); // phones: the legend makes way for the sheet
  writeHash();
}
for (const [v, [btn]] of Object.entries(VIEWS)) btn.addEventListener('click', () => setPanel(state.panel === v ? null : v));
$('#close').addEventListener('click', () => setPanel(null));

// Link, PNG and ZIP act at once (no menu): the link button says "Copied" for a moment
$('#link').addEventListener('click', (e) => copyLink(e.currentTarget));
$('#png').addEventListener('click', () => exportPng());
$('#zip').addEventListener('click', () => exportZip());
async function copyLink(b) {
  writeHashNow(); // the link must be the view as it is now
  try { await navigator.clipboard.writeText(location.href); flash(b, 'Copied'); } catch { prompt('Copy this link', location.href); }
}
function flash(b, text) { // the button's own text says it, for a moment
  const label = b.querySelector('span'), was = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = was; }, 1200);
}
const about = $('#about');
for (const b of document.querySelectorAll('[data-about]')) b.addEventListener('click', () => about.showModal());
about.querySelector('[data-close]').addEventListener('click', () => about.close());

// keys: / search, L layers, R / A / C measuring tools (measure.js handles Esc while drawing)
const TOOL_KEY = { r: 'ruler', a: 'area', c: 'ring' };
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || about.open || e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); q.focus(); }
  else if (k === 'l') setPanel(state.panel === 'layers' ? null : 'layers');
  else if (TOOL_KEY[k]) { if (small()) setPanel(null); measure.start(TOOL_KEY[k]); }
});

// phones: the panel is a sheet as tall as its content; drag its handle down to close it
const handle = h('div', { class: 'handle', 'aria-hidden': 'true' });
panel.prepend(handle);
handle.addEventListener('pointerdown', (e) => {
  const y0 = e.clientY;
  handle.setPointerCapture(e.pointerId);
  panel.classList.add('dragging');
  const move = (ev) => { panel.style.transform = `translateY(${Math.max(0, ev.clientY - y0)}px)`; };
  const up = (ev) => {
    handle.removeEventListener('pointermove', move);
    panel.classList.remove('dragging');
    panel.style.transform = '';
    if (ev.clientY - y0 > 80) setPanel(null);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up, { once: true });
});

// ---- search: coordinates are read here; place names go to Photon (OpenStreetMap data) ---------
const PHOTON = 'https://photon.komoot.io/api/';
const q = $('#q'), qClear = $('#q-clear'), results = $('#results'), resultList = results.querySelector('ul');
let hits = [], active = -1, searchCtl = null, searchTimer = 0, pin = null;
const ZOOM_OF = { city: 11, town: 12, village: 13, hamlet: 14, island: 11, sea: 6, ocean: 4, bay: 10, strait: 9 };
function showResults(list) {
  hits = list;
  active = list.length && list[0].go ? 0 : -1;
  resultList.replaceChildren(...(list.length ? list.map((r, i) => h('li', { role: 'option', id: `r-${i}`, 'aria-selected': String(i === active),
    onpointerdown: (e) => e.preventDefault(), // keep the focus in the box
    onclick: () => choose(i) }, r.name, r.where ? h('small', {}, r.where) : null))
    : [h('li', { class: 'none' }, 'No places found')]));
  results.hidden = false;
  q.setAttribute('aria-expanded', 'true');
  q.setAttribute('aria-activedescendant', active >= 0 ? `r-${active}` : '');
}
function hideResults() {
  results.hidden = true;
  q.setAttribute('aria-expanded', 'false');
  q.removeAttribute('aria-activedescendant');
}
function setActive(i) {
  if (!hits.length) return;
  active = (i + hits.length) % hits.length;
  for (const [k, li] of [...resultList.children].entries()) li.setAttribute('aria-selected', String(k === active));
  q.setAttribute('aria-activedescendant', `r-${active}`);
  resultList.children[active]?.scrollIntoView({ block: 'nearest' });
}
function choose(i) {
  const r = hits[i];
  if (!r) return;
  hideResults();
  pin?.remove();
  pin = new maplibregl.Marker({ element: h('div', { class: 'pin', title: r.name }) }).setLngLat(r.at).addTo(map);
  if (r.bounds) map.fitBounds(r.bounds, { padding: 60, maxZoom: 15, bearing: map.getBearing() });
  else map.flyTo({ center: r.at, zoom: Math.max(map.getZoom(), r.zoom) });
  q.blur();
}
async function searchPlaces(text) {
  searchCtl?.abort();
  searchCtl = new AbortController();
  const c = map.getCenter(); // results near the view come first; rounded, the view is not sent exactly
  const url = `${PHOTON}?${new URLSearchParams({ q: text, limit: 7, lang: 'en', lat: c.lat.toFixed(1), lon: c.lng.toFixed(1) })}`;
  try {
    const r = await fetch(url, { signal: searchCtl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { features } = await r.json();
    showResults(features.map((f) => {
      const p = f.properties, e = p.extent; // [west, north, east, south]
      return { go: true, name: p.name || p.street || text, at: f.geometry.coordinates,
        where: [p.osm_value?.replace(/_/g, ' '), p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(' · '),
        bounds: e ? [[e[0], e[3]], [e[2], e[1]]] : null, zoom: ZOOM_OF[p.osm_value] || 14 };
    }));
  } catch (err) {
    if (err.name !== 'AbortError') showResults([{ name: 'Place search is not available right now', where: err.message }]);
  }
}
q.addEventListener('input', () => {
  const text = q.value.trim();
  qClear.hidden = !text;
  clearTimeout(searchTimer);
  if (!text) { searchCtl?.abort(); hideResults(); return; }
  const ll = parseLatLon(text);
  if (ll) { // coordinates: nothing leaves the page
    searchCtl?.abort();
    showResults([{ go: true, name: `${dm(ll.lat, 'N', 'S')}  ${dm(ll.lon, 'E', 'W')}`, where: 'coordinates', at: [ll.lon, ll.lat], zoom: 11 }]);
  } else if (text.length >= 3) searchTimer = setTimeout(() => searchPlaces(text), 300);
  else hideResults();
});
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); if (hits[active]?.go) choose(active); }
  else if (e.key === 'Escape') { if (!results.hidden) hideResults(); else { q.value = ''; qClear.hidden = true; pin?.remove(); pin = null; q.blur(); } }
});
q.addEventListener('focus', () => { if (q.value.trim() && hits.length) showResults(hits); });
q.addEventListener('blur', () => setTimeout(hideResults, 150));
qClear.addEventListener('click', () => { q.value = ''; qClear.hidden = true; hideResults(); pin?.remove(); pin = null; q.focus(); });

// cursor position readout
map.on('mousemove', (e) => { posEl.textContent = `${dm(e.lngLat.lat, 'N', 'S')}  ${dm(((e.lngLat.lng + 540) % 360) - 180, 'E', 'W')}`; });

// ---- scale note: the Mercator scale bar is exact only at the centre latitude ------------
// relative change of the Mercator scale (∝ 1/cos lat) across the view: from the lowest to the
// highest |lat| in view, the lowest being 0 when the view crosses the equator
function scaleVariation() {
  const b = map.getBounds();
  return mercatorVariation(b.getSouth(), b.getNorth());
}
const NOTE_AT = 0.03; // below this the bar is as good as exact for reading a chart; a note would be noise
function scaleNote() {
  const v = scaleVariation();
  scaleNoteEl.textContent = v > NOTE_AT ? `scale varies ${(v * 100).toFixed(0)}% across the view` : '';
}

// ---- PNG export: the map canvas plus scale, north arrow and a credit strip ---
function attributionText() {
  const srcs = new Set();
  for (const l of map.getStyle().layers) if (l.source && map.getLayoutProperty(l.id, 'visibility') !== 'none') srcs.add(l.source);
  const parts = [...srcs].map((s) => map.getSource(s)?.attribution).filter(Boolean);
  // parsed in an inert document: no image loads, no handlers run, whatever the text holds
  return [...new Set(parts)].map((p) => new DOMParser().parseFromString(p, 'text/html').body.textContent).join(' · ');
}
// The map's next frame, after pending tiles (so a layer switched on a moment ago is in the
// picture): fn(canvas) runs while the canvas still holds it, and must read it before awaiting.
let exporting = false; // one export at a time, however often the buttons are clicked
function onFrame(fn) {
  if (exporting) return;
  exporting = true;
  const go = () => {
    map.once('render', async () => {
      try { await fn(map.getCanvas()); } catch (e) { console.error('export failed:', e.message); } finally { exporting = false; }
    });
    map.triggerRepaint();
  };
  if (map.loaded() && map.areTilesLoaded()) go(); else map.once('idle', go);
}
const pngOf = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the browser returned no image'))), 'image/png'));
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// chart-YYYYMMDD-HHMM (UTC): the file names and the STAC id
const exportName = (when) => `chart-${when.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}`;
// the map canvas plus scale, north arrow, legends and a credit strip
function chartCanvas(src, when) {
  const dpr = src.width / src.clientWidth;
  const lines = wrap(attributionText(), Math.floor(src.clientWidth / 6.2));
  const footer = (22 + lines.length * 14) * dpr;
  const out = h('canvas', { width: src.width, height: src.height + footer });
  const g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  g.scale(dpr, dpr);
  const W = src.clientWidth, H = src.clientHeight;
  // double scale bar at the centre latitude (Web Mercator scale varies with latitude), bottom
  // right as on screen: km above a shared line, nautical miles below it
  const lat = map.getCenter().lat;
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const bar = (unitM) => { const len = niceLen((120 * mpp) / unitM) * unitM; return { len, px: len / mpp }; };
  const km = bar(1), nm = bar(1852);
  const v = scaleVariation();
  const kmText = `${km.len < 1000 ? `${+km.len.toPrecision(6)} m` : `${+(km.len / 1000).toPrecision(6)} km`} at ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}${v > NOTE_AT ? ` · scale varies ${(v * 100).toFixed(0)}% across the view` : ''}`;
  const nmText = `${+(nm.len / 1852).toPrecision(6)} NM`;
  g.font = '11px system-ui, sans-serif';
  const bw = Math.max(km.px, nm.px, g.measureText(kmText).width) + 20, line = H - 34;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(W - 10 - bw, H - 58, bw, 48);
  g.strokeStyle = '#2b3a46';
  g.lineWidth = 2;
  for (const [b, tick] of [[km, -6], [nm, 6]]) {
    const bx = W - 20 - b.px;
    g.beginPath(); g.moveTo(bx, line + tick); g.lineTo(bx, line); g.lineTo(bx + b.px, line); g.lineTo(bx + b.px, line + tick); g.stroke();
  }
  g.fillStyle = '#2b3a46';
  g.textAlign = 'right';
  g.fillText(kmText, W - 20, H - 44);
  g.fillText(nmText, W - 20, H - 16);
  g.textAlign = 'left';
  // every legend of the drawn layers, stacked bottom left (as on screen, even with the switch off)
  let ly = H - 10;
  for (const id of [...legendWant].reverse()) {
    const el = legendEls[id], lw = parseFloat(el.style.width), lh = parseFloat(el.style.height);
    if (!lw || !lh) continue; // not drawn yet (the SST colour map still loading)
    ly -= lh;
    g.drawImage(el, 10, ly, lw, lh);
    ly -= 6;
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
  g.fillText(`Centre ${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')} · zoom ${map.getZoom().toFixed(1)} · Web Mercator · exported ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC · NOT FOR NAVIGATION`, 8, H + 15);
  g.fillStyle = '#5d6d79';
  lines.forEach((t, i) => g.fillText(t, 8, H + 30 + i * 14));
  return out;
}
function exportPng() {
  onFrame(async (src) => {
    const when = new Date();
    download(await pngOf(chartCanvas(src, when)), `${exportName(when)}.png`);
  });
}

// ---- ZIP export: the view as GIS data (export.js, zip.js) --------------------------------
// the menu items the view draws: switched on, over their base, in their zoom range
function drawnItems() {
  const z = map.getZoom();
  return ITEMS.filter((it) => (layersOf[it.id] || []).some((l) => map.getLayoutProperty(l.id, 'visibility') === 'visible' && z >= (l.minzoom ?? 0) && z < (l.maxzoom ?? 24)))
    .map((it) => ({ ...it, variant: it.variants?.[state.variant[it.id]], date: it.date && state.date, period: DENSITY[it.id] && state.period[it.id] }));
}
// what the item's vector layers draw, as pieces for vector.js: one query per source layer and
// filter (a line and its casing, or a line and its labels, are the same features). Symbols placed
// along lines are labels of features exported anyway; computed overlays (graticule) are left out.
function vectorPieces(id) {
  const z = map.getZoom(), queries = new Map();
  for (const l of layersOf[id] || []) {
    if (map.getSource(l.source)?.type !== 'vector' || !['line', 'fill', 'symbol'].includes(l.type) || l.layout?.['symbol-placement'] === 'line') continue;
    if (map.getLayoutProperty(l.id, 'visibility') !== 'visible' || z < (l.minzoom ?? 0) || z >= (l.maxzoom ?? 24)) continue;
    queries.set(JSON.stringify([l.source, l['source-layer'], l.filter]), l);
  }
  const pieces = [];
  for (const l of queries.values()) {
    const fs = map.querySourceFeatures(l.source, { sourceLayer: l['source-layer'], filter: l.filter });
    // private MapLibre fields: the tile each copy comes from (lines are cut at its edges); if an
    // upgrade renames them, say so (the smoke test fails on this)
    if (fs.length && !Number.isInteger(fs[0]._z)) console.error('MapLibre: feature tile (_z/_x/_y) missing; exported lines keep their tile overlaps');
    const zmax = Math.max(...fs.map((f) => f._z ?? 0)); // tiles kept from another zoom while loading: not twice
    for (const f of fs) {
      if ((f._z ?? 0) !== zmax) continue;
      pieces.push({ id: f.id, properties: { ...f.properties, layer: l['source-layer'] }, geometry: f.geometry, tile: Number.isInteger(f._z) ? [f._z, f._x, f._y] : null });
    }
  }
  return pieces;
}
const featureCollection = (name, features) => `${JSON.stringify({ type: 'FeatureCollection', name, features })}\n`;

// polygon-clipping (vector.js) loads on the first ZIP export, not with the page: a script from
// the pinned URL in index.html, checked by the browser against its hash (tools/deps.mjs)
let clipLib = null;
const polygonClipping = () => (clipLib ||= new Promise((resolve, reject) => {
  const { content: src, dataset: { integrity } } = $('#polygon-clipping');
  document.head.append(h('script', { src, integrity, crossorigin: 'anonymous', onload: () => resolve(globalThis.polygonClipping),
    onerror: () => { clipLib = null; reject(new Error('polygon-clipping did not load')); } }));
}));
async function exportZip() {
  writeHashNow(); // the item links back to the view as it is now
  let clipping;
  try { clipping = await polygonClipping(); } catch (e) { console.error('ZIP export:', e.message); return; }
  onFrame(async (src) => {
    const when = new Date();
    const plain = h('canvas', { width: src.width, height: src.height });
    plain.getContext('2d').drawImage(src, 0, 0);
    const chart = chartCanvas(src, when);
    const W = src.clientWidth, H = src.clientHeight;
    const corners = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => { const ll = map.unproject(p); return [ll.lng, ll.lat]; });
    const transform = affine(corners, src.width, src.height);
    // vector/<item>.geojson for each item drawn with features in view, and the measurements
    const layers = drawnItems(), vectors = [];
    for (const it of layers) {
      const fs = viewFeatures(vectorPieces(it.id), corners, clipping);
      if (fs.length) vectors.push({ key: it.id, title: it.label, file: `vector/${it.id}.geojson`, data: featureCollection(it.label, fs), n: fs.length, how: 'clipped to the view' });
      it.assets = fs.length ? [it.id] : []; // in item.json: the files that hold this layer as data
    }
    const measured = measureFeatures(measure.list);
    if (measured.length) vectors.push({ key: 'measurements', title: 'Measurements', file: 'vector/measurements.geojson', data: featureCollection('Measurements', measured), n: measured.length, how: 'whole, geodesic values in metres' });
    const item = stacItem({
      id: exportName(when), when, corners, zoom: map.getZoom(), bearing: map.getBearing(), layers,
      attribution: attributionText(), link: location.href,
      assets: {
        map: { href: './map.png', type: 'image/png', title: 'The map as drawn, georeferenced (world file map.pgw, CRS in map.png.aux.xml)', roles: ['visual'],
          'proj:code': 'EPSG:3857', 'proj:shape': [src.height, src.width], 'proj:transform': transform },
        worldfile: { href: './map.pgw', type: 'text/plain', title: 'World file of map.png', roles: ['metadata'] },
        crs: { href: './map.png.aux.xml', type: 'application/xml', title: 'CRS of map.png (GDAL sidecar)', roles: ['metadata'] },
        chart: { href: './chart.png', type: 'image/png', title: 'The map with scale, legends and credits, as the PNG export', roles: ['overview'] },
        ...Object.fromEntries(vectors.map((v) => [v.key, { href: `./${v.file}`, type: 'application/geo+json', title: `${v.title}: ${v.n} feature${v.n === 1 ? '' : 's'}, ${v.how}`, roles: ['data'] }])),
      },
    });
    const [mapPng, chartPng] = await Promise.all([pngOf(plain), pngOf(chart)]);
    download(await zip([
      { name: 'item.json', data: `${JSON.stringify(item, null, 2)}\n` },
      { name: 'map.png', data: mapPng },
      { name: 'map.pgw', data: worldFile(transform) },
      { name: 'map.png.aux.xml', data: pamXml() },
      { name: 'chart.png', data: chartPng },
      ...vectors.map((v) => ({ name: v.file, data: v.data })),
    ], when), `${exportName(when)}.zip`);
  });
}

// ---- go ---------------------------------------------------------------------
map.on('load', () => {
  // Raster sources round the zoom when picking tiles; the vector basemap floors it. Floor
  // here too, so the clipped elevation tiles are cut with the coastline the basemap draws
  // (clip.js seaMask). roundZoom is a property of MapLibre's raster tile sources.
  for (const id of ['dem-sea', 'dem']) {
    const src = map.getSource(id);
    // private MapLibre property: if an upgrade renames it, say so (the smoke test fails on this)
    if (typeof src.roundZoom !== 'boolean') console.error(`MapLibre: ${id}.roundZoom missing; elevation tiles may not match the coastline`);
    src.roundZoom = false;
  }
  for (const it of ITEMS) if (it.id !== 'gibs') applyItem(it.id);
  depthColours();
  labelPaint();
  creditEsri();
  showGibs();
  measure.load(measureState);
  updateGraticule();
  renderMenu();
  renderMeasures();
  ready = true;
  setPanel(state.panel); // also writes the URL, now with everything applied
  scaleNote();
  renderCompass();
});
map.on('moveend', writeHash);
let moveRaf = 0; // once per frame while moving: the graticule's edge labels follow the frame, the scale note the view
map.on('move', () => { cancelAnimationFrame(moveRaf); moveRaf = requestAnimationFrame(() => { updateGraticule(); scaleNote(); }); });
map.on('zoomend', renderMenu);
map.on('dataloading', () => document.body.classList.add('loading'));
map.on('idle', () => document.body.classList.remove('loading'));
window.addEventListener('hashchange', () => location.reload());
window.map = map; // the browser tests drive the map through it; handy from the console too

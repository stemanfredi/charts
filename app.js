import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA, DEM_LAND, OMT_TILEJSON, OPACITY_PROP, DEPTH_SCHEMES, depthRamp, NO_DEPTH, DENSITY, ESRI_META, esriAttribution, buildStyle, defaultDate, gibsTiles, densityTiles } from './catalog.js';
import { workerClipper } from './clip.js';
import { drawRamp, loadColormap, drawColormap } from './legend.js';
import { fmtAngle, dm, mercatorVariation, niceLen, wrap, parseLatLon } from './format.js';
import { Measure, MEASURE_LAYERS, summary } from './measure.js';

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
  menu: window.innerWidth >= 1200, // open beside the map where it leaves room; a button away elsewhere
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
  if (q.has('menu')) state.menu = q.get('menu') === '1';
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
  {
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
    q.set('menu', state.menu ? '1' : '0');
    history.replaceState(null, '', `#${q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%3B/g, ';').replace(/%7E/g, '~')}`);
  }
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
  isobathUrl: seaDem.contourProtocolUrl({ ...contourOpts, thresholds: { 4: [1000, 2000], 6: [200, 1000], 8: [100, 500], 10: [10, 50], 11: [5, 50] } }), // generated finer than drawn: catalog.js keeps 5 m, 10s to 50, then 50s
  contourUrl: landDem.contourProtocolUrl({ ...contourOpts, thresholds: { 9: [100, 500], 11: [50, 250], 12: [20, 100] } }),
  date: state.date,
  density: Object.fromEntries(Object.keys(DENSITY).map((id) => [id, [state.variant[id], state.period[id]]])),
});
style.layers.push(...MEASURE_LAYERS);

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

// ---- status bar: cursor position, double scale, scale note, credits ------------------------
// The scale is double, as on OpenSeaMap: km above the line, nautical miles below. Credits stay
// written out on desktop (Esri: data attribution "always visible"; OSM likewise); phones get
// MapLibre's collapsible (i), which Esri allows on small screens.
const statusEl = $('#status');
const posEl = h('div', { class: 'pos', id: 'pos', 'aria-live': 'off' });
const scaleOpts = { maxWidth: small() ? 90 : 120 };
const scales = [new maplibregl.ScaleControl({ ...scaleOpts, unit: 'metric' }), new maplibregl.ScaleControl({ ...scaleOpts, unit: 'nautical' })];
const scalesEl = h('div', { class: 'scales', id: 'scales' }, scales.map((s) => s.onAdd(map)));
const scaleNoteEl = h('div', { class: 'scalenote', id: 'scalenote' });
const attribution = new maplibregl.AttributionControl({ compact: small() });
statusEl.append(posEl, scalesEl, scaleNoteEl, attribution.onAdd(map));
// the panel, zoom buttons and legend chips sit above the status bar, whose height follows its credits
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
  applyItem(id);
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
  renderLegends();
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
  // The bottom edge is busy with legend chips and the status bar.
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
// a 20 px line icon from SVG path data (same look as the icons in index.html)
function icon(...paths) {
  const s = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) s.setAttribute(k, v);
  for (const d of paths) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
const ICON = {
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  ruler: ['M3 17 17 3l4 4L7 21z', 'm7 13 2 2M10 10l2 2M13 7l2 2'],
  area: ['m12 3 8 6-3 11H7L4 9z'],
  ring: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 12h.01'],
};
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
  applyItem(id);
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
  return h('div', { class: 'controls' }, variant, period, date);
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
    if (dt) { dt.value = state.date; r.controls.querySelector('.next').disabled = state.date >= today(); }
  }
  for (const s of segs) s.render();
  for (const g of groupEls) {
    const n = g._items.filter((it) => state.on.has(it.id)).length;
    g.querySelector('.count').textContent = g._exclusive || !n ? '' : String(n);
  }
  renderStatus();
  renderLegends();
}

// ---- legends: a chip per drawn colour layer; one opens at a time ---------------------
// The canvases are drawn for every legend (the PNG copies them all), shown only when open.
const legends = $('#legends');
const legendEls = {};
let legendWant = [];
let openLegend = small() ? null : 'auto'; // 'auto': the first one, until the user picks
function legendEl(id) {
  return (legendEls[id] ||= h('canvas', { role: 'img', 'data-legend': id }));
}
const gradient = (stops) => `linear-gradient(90deg, ${stops.map(([, c]) => c).join(', ')})`;
function legendChip(id) {
  if (id === 'depth') return ['Depth', gradient(depthStops())];
  if (DENSITY[id]) return [DENSITY[id].title, gradient(DENSITY[id].stops)];
  return [GIBS[state.variant.gibs].legend.title, 'linear-gradient(90deg, #2b001a, #3b4cc0, #2fb5e8, #f6e43c, #d7301f, #6b0200)'];
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
  const shown = openLegend === 'auto' ? want[0] : want.includes(openLegend) ? openLegend : null;
  const chips = h('div', { class: 'chips' }, want.map((id) => {
    const [name, swatch] = legendChip(id);
    return h('button', { type: 'button', class: 'chip', 'aria-expanded': String(id === shown), title: id === shown ? 'Hide legend' : 'Show legend',
      onclick: () => { openLegend = id === shown ? null : id; renderLegends(); } }, h('i', { style: `background:${swatch}` }), name);
  }));
  legends.replaceChildren(...(want.length ? [...(shown ? [legendEls[shown]] : []), chips] : []));
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

// ---- measure popover: tools, units, saved measurements --------------------------------
const TOOL = { ruler: ['Ruler', 'Distance and bearing (R)'], area: ['Area', 'Area and perimeter (A)'], ring: ['Ring', 'Range ring: centre, then radius (C)'] };
const TIP = { ruler: 'Click to add points', area: 'Click to add corners', ring: 'Click the centre, then the edge' };
const measurePop = $('#measure-pop');
const toolBtns = Object.entries(TOOL).map(([k, [label, title]]) => h('button', { type: 'button', 'data-tool': k, 'aria-pressed': 'false', title,
  onclick: () => { closePops(); measure.tool === k ? measure.finish() : measure.start(k); } }, icon(...ICON[k]), label));
const unitSeg = seg('Distance units', { km: ['km · m', 'Kilometres and metres'], nm: ['Nautical miles', 'Nautical miles'] }, () => measure.units, (u) => measure.setUnits(u));
const measureList = h('ul', { class: 'mlist' });
measurePop.append(h('div', { class: 'tools3' }, toolBtns), h('h2', {}, 'Units'), unitSeg, h('h2', {}, 'Measurements'), measureList,
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

// ---- panel, popovers, about ----------------------------------------------------------
const panel = $('#panel');
const bLayers = $('#b-layers');
function setMenu(open) {
  state.menu = open;
  panel.hidden = !open;
  bLayers.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('menu-open', open); // phones: the legend makes way for the sheet
  if (open && small()) closePops();
  writeHash();
}
bLayers.addEventListener('click', () => setMenu(!state.menu));
$('#close').addEventListener('click', () => setMenu(false));

// Measure and Share open beside their button (from the bottom on phones); one at a time
const POPS = { 'b-measure': measurePop, 'b-share': $('#share-pop') };
function closePops() {
  for (const [id, el] of Object.entries(POPS)) { el.hidden = true; $(`#${id}`).setAttribute('aria-expanded', 'false'); }
  document.body.classList.remove('pop-open');
}
function togglePop(id) {
  const el = POPS[id], show = el.hidden;
  closePops();
  if (!show) return;
  if (small()) setMenu(false);
  el.style.top = small() ? '' : `${$(`#${id}`).getBoundingClientRect().top - 2}px`;
  el.hidden = false;
  $(`#${id}`).setAttribute('aria-expanded', 'true');
  document.body.classList.add('pop-open');
}
for (const id of Object.keys(POPS)) $(`#${id}`).addEventListener('click', () => togglePop(id));
// a click elsewhere closes an open popover (not one inside it, nor on its own button)
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.pop, #rail')) closePops();
});
$('#link').addEventListener('click', (e) => copyLink(e.currentTarget));
$('#png').addEventListener('click', () => { closePops(); exportPng(); });
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

// keys: / search, L layers, R / A / C measuring tools, Esc closes a popover (measure.js handles Esc while drawing)
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || about.open || e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') closePops();
  else if (k === '/') { e.preventDefault(); q.focus(); }
  else if (k === 'l') setMenu(!state.menu);
  else if ({ r: 'ruler', a: 'area', c: 'ring' }[k]) { closePops(); measure.start({ r: 'ruler', a: 'area', c: 'ring' }[k]); }
});

// phones: the layers sheet has a handle; drag it to any height, it settles at a third, a half
// or nearly all of the screen; dragged low enough, it closes. A tap steps through the heights.
const handle = h('div', { class: 'handle', 'aria-hidden': 'true' });
panel.prepend(handle);
const SNAPS = [0.3, 0.55, 0.92];
let sheet = 0.55;
function setSheet(f) { sheet = f; panel.style.setProperty('--sheet-h', `${Math.round(f * 100)}vh`); }
handle.addEventListener('pointerdown', (e) => {
  const y0 = e.clientY, h0 = panel.getBoundingClientRect().height;
  let moved = false;
  handle.setPointerCapture(e.pointerId);
  panel.classList.add('dragging');
  const move = (ev) => {
    if (Math.abs(ev.clientY - y0) > 4) moved = true;
    panel.style.setProperty('--sheet-h', `${Math.max(80, h0 + y0 - ev.clientY)}px`);
  };
  const up = (ev) => {
    handle.removeEventListener('pointermove', move);
    panel.classList.remove('dragging');
    const f = (h0 + y0 - ev.clientY) / innerHeight;
    if (!moved) setSheet(SNAPS[(SNAPS.indexOf(sheet) + 1) % SNAPS.length]);
    else if (f < 0.18) { setSheet(0.55); setMenu(false); }
    else setSheet(SNAPS.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a)));
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up, { once: true });
});
setSheet(sheet);

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
const pos = posEl;
map.on('mousemove', (e) => { pos.textContent = `${dm(e.lngLat.lat, 'N', 'S')}  ${dm(((e.lngLat.lng + 540) % 360) - 180, 'E', 'W')}`; });

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
let noteRaf = 0;
map.on('move', () => { cancelAnimationFrame(noteRaf); noteRaf = requestAnimationFrame(scaleNote); });

// ---- PNG export: the map canvas plus scale, north arrow and a credit strip ---
function attributionText() {
  const srcs = new Set();
  for (const l of map.getStyle().layers) if (l.source && map.getLayoutProperty(l.id, 'visibility') !== 'none') srcs.add(l.source);
  const parts = [...srcs].map((s) => map.getSource(s)?.attribution).filter(Boolean);
  const tmp = document.createElement('div');
  return [...new Set(parts)].map((p) => { tmp.innerHTML = p; return tmp.textContent; }).join(' · ');
}
// waits for pending tiles, so a layer switched on a moment ago is in the picture
let exporting = false; // one export at a time, however often PNG is clicked
function exportPng() {
  if (exporting) return;
  exporting = true;
  if (!(map.loaded() && map.areTilesLoaded())) { map.once('idle', () => { exporting = false; exportPng(); }); return; }
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
    // every legend of the drawn layers, stacked bottom left, whichever chip is open on screen
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
    g.fillText(`Centre ${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')} · zoom ${map.getZoom().toFixed(1)} · Web Mercator · exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · NOT FOR NAVIGATION`, 8, H + 15);
    g.fillStyle = '#5d6d79';
    lines.forEach((t, i) => g.fillText(t, 8, H + 30 + i * 14));
    out.toBlob((blob) => {
      exporting = false;
      if (!blob) { console.error('PNG export failed: the browser returned no image'); return; }
      const a = h('a', { href: URL.createObjectURL(blob), download: `chart-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });
  map.triggerRepaint();
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
  for (const it of ITEMS) applyItem(it.id);
  depthColours();
  labelPaint();
  creditEsri();
  measure.load(measureState);
  updateGraticule();
  renderMenu();
  renderMeasures();
  ready = true;
  setMenu(state.menu); // also writes the URL, now with everything applied
  scaleNote();
  renderCompass();
});
map.on('moveend', () => { updateGraticule(); writeHash(); });
let gratRaf = 0;
map.on('move', () => { cancelAnimationFrame(gratRaf); gratRaf = requestAnimationFrame(updateGraticule); }); // edge labels follow the frame
map.on('zoomend', renderMenu);
map.on('dataloading', () => document.body.classList.add('loading'));
map.on('idle', () => document.body.classList.remove('loading'));
window.addEventListener('hashchange', () => location.reload());
window.map = map; // handy from the console

import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA, DEM_LAND, OMT_TILEJSON, OPACITY_PROP, DEPTH_SCHEMES, depthRamp, NO_DEPTH, DENSITY, ESRI_META, esriAttribution, buildStyle, defaultDate, gibsTiles, densityTiles } from './catalog.js';
import { workerClipper } from './clip.js';
import { drawRamp, loadColormap, drawColormap } from './legend.js';
import { fmtAngle, dm, mercatorVariation, niceLen, wrap } from './format.js';
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
  menu: window.innerWidth >= 720,
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
// bottom-right, as in Google Maps; MapLibre stacks later bottom controls above earlier ones:
// attribution at the bottom, then the scale note, the scale bar, the cursor readout, and zoom + compass on top
// credits stay written out on desktop (Esri: data attribution "always visible"; OSM likewise);
// phones get MapLibre's collapsible (i), which Esri allows on small screens
const attribution = new maplibregl.AttributionControl({ compact: window.innerWidth < 720 });
map.addControl(attribution, 'bottom-right');
const scaleNoteEl = h('div', { class: 'maplibregl-ctrl scalenote', id: 'scalenote' });
map.addControl({ onAdd: () => scaleNoteEl, onRemove: () => scaleNoteEl.remove() }, 'bottom-right');
// km above nautical miles as one double scale bar, as on OpenSeaMap (narrow on phones: clears the legend)
const scaleOpts = { maxWidth: window.innerWidth < 720 ? 90 : 140 };
const scales = [new maplibregl.ScaleControl({ ...scaleOpts, unit: 'metric' }), new maplibregl.ScaleControl({ ...scaleOpts, unit: 'nautical' })];
const scalesEl = h('div', { class: 'maplibregl-ctrl scales', id: 'scales' });
map.addControl({
  onAdd: (m) => { scalesEl.append(...scales.map((s) => s.onAdd(m))); return scalesEl; },
  onRemove: () => { for (const s of scales) s.onRemove(); scalesEl.remove(); },
}, 'bottom-right');
const posEl = h('div', { class: 'maplibregl-ctrl pos', id: 'pos', 'aria-live': 'off' });
map.addControl({ onAdd: () => posEl, onRemove: () => posEl.remove() }, 'bottom-right');
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right');

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
  // edge labels: meridians along the top (under the top controls), parallels along the left
  // (right of the panel when it is open beside the map); only when north-up, where a screen
  // edge is a parallel or a meridian. The bottom edge is busy with legend, scale and credits.
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
  const edges = Math.abs(map.getBearing()) < 0.5;
  const left = state.menu && W >= 720 ? panel.getBoundingClientRect().right + 8 : 8;
  const latTop = map.unproject([W / 2, 64]).lat, lonLeft = map.unproject([left, H / 2]).lng;
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
    it.variants ? h('select', { class: 'variant', 'aria-label': `${it.label} variant`, onchange: (e) => {
      state.variant[it.id] = e.target.value;
      applyItem(it.id);
      if (it.id === 'depth') depthColours();
      if (DENSITY[it.id]) setDensity(it.id);
      if (it.id === 'sat') creditEsri();
      writeHash(); renderStatus(); renderLegends();
    } }, Object.entries(it.variants).map(([k, label]) => h('option', { value: k }, label))) : null,
    it.density ? h('select', { class: 'period', 'aria-label': `${it.label} period`, onchange: (e) => { state.period[it.id] = e.target.value; setDensity(it.id); } },
      DENSITY[it.id].periods.map((p) => h('option', { value: p }, DENSITY[it.id].periodLabel(p)))) : null,
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

// a header checkbox inside a 44 px label: tapping near it ticks it instead of folding the group
const hit = (input) => (input ? h('label', { class: 'hit', onclick: (e) => e.stopPropagation() }, input) : null);

function groupBlock(g) {
  const items = ITEMS.filter((it) => it.group === g.id);
  const all = g.exclusive ? null : h('input', { type: 'checkbox', 'aria-label': `All of ${g.label}`,
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { const want = e.target.checked; for (const it of items) if (state.on.has(it.id) !== want) setOn(it.id, want); } });
  const list = h('ul', {}, items.map(itemRow));
  const det = h('details', { 'data-group': g.id, open: state.open.has(g.id),
    ontoggle: (e) => { e.target.open ? state.open.add(g.id) : state.open.delete(g.id); writeHash(); } },
    h('summary', {}, hit(all), h('span', { class: 'gname' }, g.label), h('span', { class: 'count' })),
    list);
  det._all = all;
  det._items = items;
  return det;
}

const groupEls = GROUPS.map(groupBlock);
const measureList = h('ul', { class: 'mlist' });
const unitSel = h('select', { 'aria-label': 'Distance units', onchange: (e) => measure.setUnits(e.target.value) },
  h('option', { value: 'km' }, 'km · m'), h('option', { value: 'nm' }, 'nautical miles'));
const measureAll = h('input', { type: 'checkbox', 'aria-label': 'Show all measurements', onclick: (e) => e.stopPropagation(),
  onchange: (e) => measure.setHidden(null, !e.target.checked) });
const measureGroup = h('details', { 'data-group': 'measure', open: state.open.has('measure'),
  ontoggle: (e) => { e.target.open ? state.open.add('measure') : state.open.delete('measure'); writeHash(); } },
  h('summary', {}, hit(measureAll), h('span', { class: 'gname' }, 'Measurements'), h('span', { class: 'count' })),
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
    r.controls.hidden = !on || !(it.variants || it.date || it.density);
    const low = it.minzoom && z < it.minzoom, high = it.maxzoom && z >= it.maxzoom + 1;
    r.row.classList.toggle('dim', !!(on && (low || high)));
    r.row.querySelector('.hint').textContent = !on ? '' : low ? `zoom ${it.minzoom}+` : high ? `zoom ≤ ${it.maxzoom}` : '';
    const sel = r.controls.querySelector('select.variant');
    if (sel) sel.value = state.variant[it.id];
    const per = r.controls.querySelector('select.period');
    if (per) per.value = state.period[it.id];
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
    if (on('depth') && on('chart') && map.getZoom() < 13) want.push('depth');
    for (const id of Object.keys(DENSITY)) if (on(id)) want.push(id);
    if (on('gibs') && GIBS[state.variant.gibs].legend) want.push('gibs');
  }
  for (const id of Object.keys(legendEls)) if (!want.includes(id)) legendEls[id].remove();
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
}

// ---- panel + toolbar --------------------------------------------------------
const panel = $('#panel');
const toggle = $('#toggle');
function setMenu(open) {
  state.menu = open;
  panel.hidden = !open;
  toggle.hidden = open; // the panel has its own close button, where the toggle was
  document.body.classList.toggle('menu-open', open); // legends move aside / hide (style.css)
  if (ready) updateGraticule(); // latitude labels move right of the panel
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
  // clicking the active tool again means "done" (also the way to finish on touch screens)
  if (b.dataset.tool) measure.tool === b.dataset.tool ? measure.finish() : measure.start(b.dataset.tool);
  else if (b.id === 'png') exportPng();
  else if (b.id === 'link') copyLink(b);
});
async function copyLink(b) {
  writeHashNow(); // the link must be the view as it is now
  try { await navigator.clipboard.writeText(location.href); flash(b, 'Copied'); } catch { prompt('Copy this link', location.href); }
}
function flash(b, text) { // a short bubble under the button; its icon stays
  b.dataset.flash = text;
  setTimeout(() => delete b.dataset.flash, 1200);
}

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
function scaleNote() {
  const v = scaleVariation();
  scaleNoteEl.textContent = v > 0.01 ? `scale varies ${(v * 100).toFixed(0)}% across the view` : '';
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
    const kmText = `${km.len < 1000 ? `${+km.len.toPrecision(6)} m` : `${+(km.len / 1000).toPrecision(6)} km`} at ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}${v > 0.01 ? ` · scale varies ${(v * 100).toFixed(0)}% across the view` : ''}`;
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
});
map.on('moveend', () => { updateGraticule(); writeHash(); });
let gratRaf = 0;
map.on('move', () => { cancelAnimationFrame(gratRaf); gratRaf = requestAnimationFrame(updateGraticule); }); // edge labels follow the frame
map.on('zoomend', renderMenu);
map.on('dataloading', () => document.body.classList.add('loading'));
map.on('idle', () => document.body.classList.remove('loading'));
window.addEventListener('hashchange', () => location.reload());
window.map = map; // handy from the console

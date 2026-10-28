import * as maplibregl from './vendor/maplibre-gl.mjs';
import mlcontour from './vendor/maplibre-contour.mjs';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA_MAX, DEPTH_SOURCES, DEM_LAND_MAX, OMT_TILEJSON, isobathSteps, DEPTH_SCHEMES, NO_DEPTH, DENSITY, ESRI_META, esriAttribution, gibsTiles, gibsDomainUrl, domainEnd, densityTiles, CMEMS, CMEMS_DEPTHS, drawsOf, CLASS_LEGENDS, CLASS_LABELS, EMODNET_DEPTH_STOPS, SEAGRASS } from './catalog.js';
import { buildStyle, depthRamp, OPACITY_PROP, SEA_PICTURES, LOCATION_LAYERS, INK } from './style.js';
import { cmemsTile, partTimes, partLevels, domainOf, cmemsLegend } from './cmems.js';
import { workerClipper } from './clip.js';
import { drawRamp, drawColormap, drawClasses, wmsClasses } from './legend.js';
import { fmtAngle, dm, mercatorVariation, NOTE_AT, exportName } from './format.js';
import { Drawing } from './draw/drawing.js';
import { DRAW_LAYERS } from './draw/layers.js';
import { savedView } from './draw/saving.js';
import { drawView } from './draw/panel.js';
import { profileOf } from './draw/profile.js';
import { circle } from './geodesy.js';
import { norm360, tileXY, TILE, D2R } from './geo.js';
import { fetchOk, lru } from './net.js';
import { $, h, svg, typing, NARROW } from './dom.js';
import { choice } from './fields.js';
import { keyEntry, openKey, keyList } from './keys.js';
import { popup } from './menu.js';
import { createFrame } from './frame.js';
import { search } from './search.js';
import { gisExport } from './gis.js';
import { chartCanvas, chartPng } from './png.js';
import { cmemsValues, emodnetValues, gebcoValues } from './values.js';
import { tidTile, tidAt } from './gebco.js';

const byId = Object.assign(Object.create(null), Object.fromEntries(ITEMS.map((it) => [it.id, it]))); // no inherited names: the link names items
// Ocean data: the layers that change with time, chosen in two menus, colours and arrows. An entry
// is an item at a variant ('waves:height'), in the menus of what it can draw (drawsOf: currents in
// both, speed and direction)
const DATA = ITEMS.filter((it) => it.group === 'data');
const variantsOf = (it) => Object.keys(it.kind === 'gibs' ? GIBS : CMEMS[it.id]);
const drawsOfEntry = (it, v) => (it.kind === 'gibs' ? ['colour'] : drawsOf(CMEMS[it.id][v]));
const entryLabel = (it, v, slot) => (it.kind === 'gibs' ? `NASA ${GIBS[v].label.replace('True colour', 'true colour')}`
  : it.id === 'currents' ? (slot === 'colour' ? 'Current speed' : 'Currents') : CMEMS[it.id][v].label);
const ENTRIES = { colour: [], arrows: [] }; // slot → [{ key, it, label }]
for (const it of DATA) for (const v of variantsOf(it)) for (const slot of drawsOfEntry(it, v)) ENTRIES[slot].push({ key: `${it.id}:${v}`, it, label: entryLabel(it, v, slot) });

const hour = (t) => Math.floor(t / 36e5) * 36e5; // the hour a time falls in (ms)
const dayOf = (t) => new Date(t).toISOString().slice(0, 10); // its day (UTC)

// ---- state (mirrored in the URL hash) ---------------------------------------
const state = {
  on: new Set(ITEMS.filter((it) => it.on).map((it) => it.id)),
  variant: Object.fromEntries(ITEMS.filter((it) => it.variants).map((it) => [it.id, Object.keys(it.variants)[0]])),
  opacity: Object.fromEntries(ITEMS.filter((it) => it.opacity != null).map((it) => [it.id, it.opacity])),
  time: hour(Date.now()), // the map's time: the hour shown (ms), now by default
  depth: 0, // Copernicus layers with depth: metres below the surface (CMEMS_DEPTHS)
  period: Object.fromEntries(Object.entries(DENSITY).map(([id, d]) => [id, d.defaultPeriod])), // density datasets
  colour: '', arrows: '', // Ocean data: the entry drawing colours, the one drawing arrows ('item:variant', '' for none)
  open: new Set(['base', 'sea']),
  layers: null, // the address's menu=1: Layers open (menu=0: not); null: as the frame was left (frame.js)
};
let view = { zoom: 4, center: [12, 41], bearing: 0 };
// the display's units and each leg's bearing beside its length (the switch beside the scale, the
// drawing's inspector): the drawing's lengths and values, labels and exports follow them
const display = { units: 'km', bearings: false };

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const v = (q.get('v') || '').split('/').map(Number);
  if (v.length >= 3 && v.every(Number.isFinite) && Math.abs(v[1]) <= 90) view = { zoom: v[0], center: [v[2], v[1]], bearing: v[3] || 0 }; // a latitude past the pole would throw in MapLibre
  if (q.has('on')) state.on = new Set(q.get('on').split(',').filter((id) => byId[id]));
  for (const kv of (q.get('var') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (Object.hasOwn(byId[k]?.variants ?? {}, val)) state.variant[k] = val;
  }
  for (const kv of (q.get('op') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (Object.hasOwn(state.opacity, k) && Number.isFinite(+val)) state.opacity[k] = Math.min(1, Math.max(0, +val));
  }
  for (const [slot, key] of [['colour', 'col'], ['arrows', 'arr']]) if (ENTRIES[slot].some((e) => e.key === q.get(key))) state[slot] = q.get(key);
  for (const it of DATA) state.on.delete(it.id); // the menus switch them (applyData)
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(q.get('t') || '') ? Date.parse(`${q.get('t')}:00:00Z`) : NaN; // a date that is no date (month 13) is NaN
  if (Number.isFinite(t)) state.time = t;
  if (CMEMS_DEPTHS.includes(+q.get('dz'))) state.depth = +q.get('dz');
  for (const kv of (q.get('per') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (Object.hasOwn(DENSITY, k) && DENSITY[k].periods.includes(val)) state.period[k] = val;
  }
  if (q.has('g')) state.open = new Set(q.get('g').split(',').filter((g) => GROUPS.some((x) => x.id === g)));
  if (q.has('menu')) state.layers = q.get('menu') === '1'; // menu=1: Layers open
  display.bearings = q.get('brg') === '1';
  if (q.get('u') === 'nm') display.units = 'nm';
}

let hashTimer = 0;
let ready = false; // until map load, the URL still holds state not yet applied: leave it alone
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
  q.set('on', [...state.on].filter((id) => byId[id].group !== 'data').join(','));
  for (const [slot, key] of [['colour', 'col'], ['arrows', 'arr']]) if (state[slot]) q.set(key, state[slot]);
  const variants = Object.entries(state.variant).filter(([k, v]) => byId[k].group !== 'data' && v !== Object.keys(byId[k].variants)[0]);
  if (variants.length) q.set('var', variants.map((kv) => kv.join(':')).join(','));
  const ops = Object.entries(state.opacity).filter(([k, v]) => v !== byId[k].opacity);
  if (ops.length) q.set('op', ops.map(([k, v]) => `${k}:${v}`).join(','));
  if (timeOn().length) q.set('t', new Date(state.time).toISOString().slice(0, 13));
  if (depthOn().length && state.depth) q.set('dz', state.depth);
  const per = Object.entries(state.period).filter(([id, v]) => state.on.has(id) && v !== DENSITY[id].defaultPeriod);
  if (per.length) q.set('per', per.map((kv) => kv.join(':')).join(','));
  if (display.units !== 'km') q.set('u', display.units);
  if (display.bearings) q.set('brg', '1');
  q.set('g', [...state.open].join(','));
  q.set('menu', frame.tab === 'layers' ? '1' : '0');
  drawing.saving.viewChanged(); // saved with the drawing, for a page opened without a view
  setHash(q);
}
// the address's state, its separators left readable
const setHash = (q) => history.replaceState(null, '', `#${q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%3B/g, ';').replace(/%7E/g, '~').replace(/%21/g, '!')}`);

// What the app offers, for checking a drawing file's view: layers with their variants and
// periods, the ocean-data entries, the depths
const KNOWN = {
  layers: Object.fromEntries(ITEMS.filter((it) => it.group !== 'data').map((it) => [it.id, { variants: it.variants ? Object.keys(it.variants) : null, periods: DENSITY[it.id]?.periods || null }])),
  data: {},
  depths: CMEMS_DEPTHS,
};
for (const e of [...ENTRIES.colour, ...ENTRIES.arrows]) { const [id, v] = e.key.split(':'); if (!(KNOWN.data[id] ||= []).includes(v)) KNOWN.data[id].push(v); }

// The drawing's saved view comes back only when the address has none (docs/drawing-format.md §10):
// written into the address before anything reads it, so the page loads once with it
if (!new URLSearchParams(location.hash.slice(1)).has('v')) {
  const v = savedView(KNOWN);
  if (v?.center && v.zoom !== null) { const q = new URLSearchParams(location.hash.slice(1)); viewToAddress(v, q); setHash(q); }
}
readHash();
let gibsDay = dayOf(state.time); // NASA daily: the day its sources draw (gibs.show moves it with the time)

// ---- map --------------------------------------------------------------------
// Elevation goes through clip.js (cut to the OSM coastline). worker: false keeps
// maplibre-contour's tile manager on this thread, where its getTile/decodeImage can be
// replaced; the shaded rasters (clip-* protocols) and the contours share the worker's tile cache.
// Its own caches hold copies of those tiles (256 KB each): enough for a screen's contours and
// their neighbours (a contour tile reads 3 × 3 DEM tiles), not hundreds (200 per source: 100 MB)
const demOpts = { url: DEM_TILES, encoding: 'terrarium', worker: false, cacheSize: 64 };
const seaDem = new mlcontour.DemSource({ ...demOpts, id: 'sea', maxzoom: DEM_SEA_MAX });
const landDem = new mlcontour.DemSource({ ...demOpts, id: 'land', maxzoom: DEM_LAND_MAX });
const seaClip = workerClipper({ mode: 'sea', omtTileJson: OMT_TILEJSON });
const landClip = workerClipper({ template: DEM_TILES, mode: 'land', omtTileJson: OMT_TILEJSON });
for (const [dem, clip] of [[seaDem, seaClip], [landDem, landClip]]) {
  dem.manager.getTile = clip.getTile;
  dem.manager.decodeImage = clip.decodeImage;
  dem.setupMaplibre(maplibregl); // registers the contour protocol
}
maplibregl.addProtocol('clip-sea', seaClip.protocol);
maplibregl.addProtocol('clip-land', landClip.protocol);
maplibregl.addProtocol('cmems', cmemsTile);
maplibregl.addProtocol('gebco-tid', tidTile);
// seagrass tiles (tools/seagrass.mjs) exist only where there is seagrass: its index lists them, and
// a tile not listed is empty, asked of nobody (a 404 would be logged as an error)
const seagrassIndex = lru(1); // promise of zoom → Set of x · 2^z + y
const seagrassTiles = () => seagrassIndex('index', () => fetchOk(`${SEAGRASS}/index.json`).then((r) => r.json())
  .then(({ tiles }) => Object.fromEntries(Object.entries(tiles).map(([z, xy]) => [z, new Set(xy.filter((_, k) => !(k % 2)).map((x, k) => x * 2 ** z + xy[2 * k + 1]))]))));
maplibregl.addProtocol('seagrass', async ({ url }, ac) => {
  const [z, x, y] = url.slice('seagrass://'.length).split('/').map(Number);
  if (!(await seagrassTiles())[z]?.has(x * 2 ** z + y)) return { data: new ArrayBuffer(0) };
  const r = await fetchOk(`${SEAGRASS}/${z}/${x}/${y}.pbf`, { signal: ac.signal });
  return { data: await r.arrayBuffer() };
});
const contourOpts = { contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1 };
const style = buildStyle({
  seaDemUrl: 'clip-sea://{z}/{x}/{y}',
  landDemUrl: 'clip-land://{z}/{x}/{y}',
  // zoom → [interval] in metres (isobaths: traced at the steps their depths need, catalog.js)
  isobathUrl: seaDem.contourProtocolUrl({ ...contourOpts, thresholds: isobathSteps() }),
  contourUrl: landDem.contourProtocolUrl({ ...contourOpts, thresholds: { 9: [100, 500], 11: [50, 250], 12: [20, 100] } }),
  date: gibsDay,
  density: Object.fromEntries(Object.keys(DENSITY).map((id) => [id, [state.variant[id], state.period[id]]])),
});
style.layers.push(...DRAW_LAYERS, ...LOCATION_LAYERS); // the drawing above the map, its values on top; the device's location over all

const map = new maplibregl.Map({
  container: 'map', style, ...view,
  maxPitch: 0, pitchWithRotate: false, dragRotate: true, touchPitch: false,
  attributionControl: false, fadeDuration: 150,
  // MapLibre's workers set the page address as the referrer explicitly, past the page's
  // no-referrer meta tag: ask for none on every request it makes
  transformRequest: (url) => ({ url, referrerPolicy: 'no-referrer' }),
});
map.touchZoomRotate.disableRotation();
$('#nostart').remove(); // started (index.html)

// ---- bottom row: credits; scale note, time shown, cursor position, the scale
// One scale bar, in the display's units (the switch beside it); the PNG export draws a double
// one, km and NM (png.js). Credits are always on screen (Esri: data attribution "always visible";
// OSM likewise), on one line: what does not fit ends in "…", and a tap on the line shows it all.
const statusEl = $('#status');
const posEl = h('div', { class: 'pos', id: 'pos', 'aria-live': 'off' });
const shownEl = h('div', { class: 'pos shown', id: 'shown', hidden: true }); // the time (and depth) the layers show
const scale = new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' });
const scaleEl = scale.onAdd(map);
scaleEl.id = 'scale';
// MapLibre writes nautical miles "nm" (the nanometre's symbol): NM, as on charts and in Measure
const scaleUnits = () => { scaleEl.textContent = scaleEl.textContent.replace(/\snm$/, '\u00a0NM'); };
const scaleNoteEl = h('div', { class: 'scalenote', id: 'scalenote' });
const creditsText = h('span', { class: 'credits-text' });
const credits = h('div', { class: 'credits' }, creditsText);
// a tap unfolds them only when they are cut ("…"), and folds them again; the hint says which
const cut = () => creditsText.scrollWidth > creditsText.clientWidth;
function creditsHint() {
  const open = credits.classList.contains('open');
  credits.classList.toggle('foldable', open || cut());
  credits.title = open ? 'Tap to fold the credits' : cut() ? 'Tap for all the credits' : '';
}
credits.addEventListener('pointerenter', creditsHint);
credits.addEventListener('click', (e) => {
  if (!e.target.closest('a') && (credits.classList.contains('open') || cut())) credits.classList.toggle('open');
  creditsHint();
});
// credits on the left; the scale note, time shown, cursor position and scale on the right (not for
// navigation: About and the exports say it)
statusEl.append(credits, h('div', { class: 'readout' }, scaleNoteEl, shownEl, posEl, scaleEl));
// the legends sit above the bottom row, whose height follows its credits
new ResizeObserver(() => { document.documentElement.style.setProperty('--status-h', `${statusEl.offsetHeight}px`); snapLegends(); }).observe(statusEl);

// ---- the compass (it only appears when the map is rotated) -------------------------------------
const compass = $('#compass');
compass.addEventListener('click', () => map.resetNorth());
function renderCompass() {
  const b = map.getBearing();
  compass.hidden = Math.abs(b) < 0.5;
  compass.firstElementChild.style.transform = `rotate(${-b}deg)`;
}
map.on('rotate', renderCompass);

// ---- my location: off until pressed (the browser asks permission the first time). Where the device says
// it is, a circle of its accuracy round it, kept in this page: nothing of it is sent. The first fix
// brings the map there; later ones move the dot only, so a map panned away stays put. Off, or the page
// hidden: the device is no longer asked.
const locate = $('#locate');
let watching = null, located = false;
const showLocation = (fix) => map.getSource('mylocation')?.setData({ type: 'FeatureCollection', features: fix ? [
  { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(fix.at, Math.max(fix.accuracy, 1), 64)] } },
  { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: fix.at } }] : [] });
function watchLocation(on) {
  if (watching != null) navigator.geolocation.clearWatch(watching);
  watching = null;
  if (!on) return;
  watching = navigator.geolocation.watchPosition(({ coords }) => {
    const at = [coords.longitude, coords.latitude];
    showLocation({ at, accuracy: coords.accuracy });
    if (!located) { located = true; map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 13), padding: 0 }); }
  }, (e) => {
    if (e.code !== e.PERMISSION_DENIED) return; // not found yet, or too slow: it keeps trying
    setLocating(false);
    locate.title = 'Location not available: this site is not allowed to know it (the browser\'s site settings)';
  }, { enableHighAccuracy: true, maximumAge: 10000 });
}
function setLocating(on) {
  locate.setAttribute('aria-pressed', String(on));
  locate.title = on ? 'Hide my location' : 'Show my location';
  locate.setAttribute('aria-label', locate.title);
  located = false;
  if (!on) showLocation(null);
  watchLocation(on);
}
const locating = () => locate.getAttribute('aria-pressed') === 'true';
if (!('geolocation' in navigator)) locate.hidden = true;
locate.addEventListener('click', () => setLocating(!locating()));
document.addEventListener('visibilitychange', () => { if (locating()) watchLocation(document.visibilityState === 'visible'); });

function setDisplay(changes) {
  Object.assign(display, changes);
  renderUnits();
  writeHash();
  drawing.render();
  drawing.renderLabels();
  drawPanel.render('doc');
}

// ---- the drawing (draw/drawing.js, draw/document.js; its panel view: draw/panel.js) ---------------------
const entryOf = (key) => { if (!key) return null; const [id, variant] = key.split(':'); return { id, variant: variant ?? null }; };
// the map's view and layers, in the drawing file's terms (docs/drawing-format.md §4)
function viewOf() {
  const c = map.getCenter();
  return {
    center: [+c.lng.toFixed(7), +c.lat.toFixed(7)], zoom: map.getZoom(), bearing: norm360(map.getBearing()),
    layers: [...state.on].filter((id) => byId[id].group !== 'data').map((id) => ({ id,
      ...(byId[id].variants ? { variant: state.variant[id] } : {}), ...(id in state.opacity ? { opacity: state.opacity[id] } : {}), ...(DENSITY[id] ? { period: state.period[id] } : {}) })),
    data: { colour: entryOf(state.colour), arrows: entryOf(state.arrows), time: new Date(state.time).toISOString().replace(/\.\d{3}Z$/, 'Z'), depth: state.depth },
    units: display.units, bearings: display.bearings,
  };
}
// Apply a file's view and measurements (either may be null: left as they are): as the address the
// app writes, then a reload, so the app's own checked reading of the address applies them (no second
// way of applying layers or measurements). The drawing is saved first: it comes back after the reload.
function applyView(v) {
  const q = new URLSearchParams(location.hash.slice(1));
  viewToAddress(v, q);
  drawing.saving.now();
  setHash(q);
  location.reload();
}
function viewToAddress(v, q) {
  const c = v.center || [map.getCenter().lng, map.getCenter().lat];
  q.set('v', [(v.zoom ?? map.getZoom()).toFixed(2), c[1].toFixed(5), c[0].toFixed(5), Math.round(v.bearing > 180 ? v.bearing - 360 : v.bearing)].join('/'));
  if (v.layers) {
    q.set('on', v.layers.map((l) => l.id).join(','));
    const kv = (key) => v.layers.filter((l) => l[key] !== undefined).map((l) => `${l.id}:${l[key]}`).join(',');
    for (const [key, p] of [['variant', 'var'], ['opacity', 'op'], ['period', 'per']]) { const s = kv(key); if (s) q.set(p, s); else q.delete(p); }
  }
  if (v.data) {
    for (const [slot, p] of [['colour', 'col'], ['arrows', 'arr']]) { const e = v.data[slot]; if (e) q.set(p, e.variant ? `${e.id}:${e.variant}` : e.id); else q.delete(p); }
    if (v.data.time) q.set('t', v.data.time.slice(0, 13)); else q.delete('t');
    if (v.data.depth) q.set('dz', v.data.depth); else q.delete('dz');
  }
  if (v.units === 'nm') q.set('u', 'nm'); else q.delete('u');
  if (v.bearings) q.set('brg', '1'); else q.delete('brg');
}
const drawing = new Drawing(map, {
  known: KNOWN, getView: viewOf, units: () => display.units, bearings: () => display.bearings,
  onChange: (what) => {
    if (what === 'drag') return; // what is dragged shows its values on the map
    if (what === 'draft') return drawPanel.render('draft'); // the touch row's Done
    drawPanel.render(what);
  },
});

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
    if (it.opacity != null && prop) map.setPaintProperty(l.id, prop, state.opacity[id] * (l.metadata.opacity ?? 1)); // a layer drawn lighter than its item
  }
}
function setOn(id, on) {
  const it = byId[id];
  if (on && GROUPS.find((g) => g.id === it.group).exclusive) {
    for (const other of ITEMS) if (other.group === it.group && other.id !== id && state.on.delete(other.id)) applyItem(other.id);
  }
  on ? state.on.add(id) : state.on.delete(id);
  refresh(id);
  if (it.group === 'base') { for (const k of baseDependent) applyItem(k); renderLegends(); creditEsri(); }
  if (id === 'graticule') updateGraticule();
  if (id === 'depth') shoreFill();
  labelPaint(); // the isobaths' colour follows what is under them
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
// Isobaths and their labels in what reads on what is under them (contrast 3:1 at least, measured
// against each scheme's colour at each depth): the topmost picture decides.
//   a colour picture (Ocean data, EMODnet, densities, depth sources): dark ink, the one colour that
//     reads across their scales, which run from dark blue to yellow and red
//     (EMODnet depth: as they, but white over its dark blues from 1000 m, both its schemes)
//   satellite: light, on a dark halo
//   atlas shading: navy over its pale blues down to 1500 m, white over its dark blues from 2000 m
//   nautical shading, all pale: a darker blue than on white
//   white water, and the shading's scheme above its zoom (it hides itself there): the style's blue
const LIGHT_HALO = 'rgba(255,255,255,0.9)', DARK_HALO = 'rgba(8,16,24,0.85)';
const ATLAS_SPLIT_M = 2000;
const byDepth = (shallow, deep, at = ATLAS_SPLIT_M) => ['step', ['abs', ['get', 'ele']], shallow, at, deep];
const ISOBATH_INK = {
  picture: { line: 'rgba(43,58,70,0.7)', text: INK, halo: LIGHT_HALO },
  emodnet: { line: byDepth('rgba(43,58,70,0.7)', '#ffffff', 1000), text: byDepth(INK, '#ffffff', 1000), halo: byDepth(LIGHT_HALO, DARK_HALO, 1000) },
  sat: { line: '#bfe0ff', text: '#cfe6ff', halo: DARK_HALO },
  atlas: { line: byDepth('#22436a', '#ffffff'), text: byDepth('#22436a', '#ffffff'), halo: byDepth(LIGHT_HALO, 'rgba(20,45,80,0.85)') },
  nautical: { line: '#3d6a91', text: '#3d6a91', halo: LIGHT_HALO },
};
const PICTURES = new Set(SEA_PICTURES); // drawn above EMODnet depth (style.js)
const isPicture = (id) => state.on.has(id) && (PICTURES.has(id) || (byId[id].group === 'data' && looks[id] !== 'arrows'));
function isobathInk() {
  if (ITEMS.some((it) => isPicture(it.id))) return ISOBATH_INK.picture;
  if (state.on.has('emodnetdepth')) return ISOBATH_INK.emodnet;
  if (state.on.has('depthsource')) return ISOBATH_INK.picture;
  if (state.on.has('sat')) return ISOBATH_INK.sat;
  const plain = { line: chartLineColour[LINE_IDS[0]], text: chartLabelPaint[LABEL_IDS[0]]['text-color'], halo: LIGHT_HALO };
  if (!state.on.has('depth')) return plain;
  const shaded = ISOBATH_INK[state.variant.depth], zmax = style.layers.find((l) => l.id === 'depth').maxzoom;
  return Object.fromEntries(Object.entries(plain).map(([k, v]) => [k, ['step', ['zoom'], shaded[k], zmax, v]]));
}
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
};
const LABEL_IDS = style.layers.filter((l) => l.id.startsWith('isobath-labels')).map((l) => l.id);
const chartLabelPaint = {};
for (const l of style.layers) if (SAT_LABELS[l.id] || LABEL_IDS.includes(l.id)) chartLabelPaint[l.id] = { ...l.paint };
function labelPaint() {
  const sat = state.on.has('sat');
  for (const [id, colour] of Object.entries(SAT_LABELS)) {
    const p = chartLabelPaint[id];
    map.setPaintProperty(id, 'text-color', sat ? colour : p['text-color']);
    map.setPaintProperty(id, 'text-halo-color', sat ? DARK_HALO : p['text-halo-color']);
    map.setPaintProperty(id, 'text-halo-width', sat ? 1.4 : p['text-halo-width']);
  }
  const ink = isobathInk();
  for (const id of LABEL_IDS) {
    map.setPaintProperty(id, 'text-color', ink.text);
    map.setPaintProperty(id, 'text-halo-color', ink.halo);
    map.setPaintProperty(id, 'text-halo-width', ink === ISOBATH_INK.sat ? 1.4 : chartLabelPaint[id]['text-halo-width']);
  }
  for (const id of LINE_IDS) map.setPaintProperty(id, 'line-color', ink.line);
}
const LINE_IDS = style.layers.filter((l) => /^isobaths(-\d+)?$/.test(l.id) && l.type === 'line').map((l) => l.id);
const chartLineColour = Object.fromEntries(LINE_IDS.map((id) => [id, style.layers.find((l) => l.id === id).paint['line-color']]));
// Esri imagery credits: the service's current copyrightText (providers get renamed: Maxar → Vantor)
let esriCredited = false;
async function creditEsri() {
  if (esriCredited || !(state.on.has('sat') && state.variant.sat === 'esri')) return;
  esriCredited = true;
  try {
    const text = (await (await fetchOk(ESRI_META)).json()).copyrightText;
    if (!text) return;
    const src = map.getSource('esri');
    src.attribution = esriAttribution(text);
    renderCredits();
  } catch { esriCredited = false; } // keep the built-in text; retry on the next switch
}
// ---- layers from a data service, by kind (catalog.js item.kind) ------------------------------
// A kind points its item's source at the map's state and says what of that state the item uses;
// the rest of the app asks the kind, never the item's id:
//   show(id)       draws the item as the state says: its source, then its layers' visibility
//   time(id)       'hour' or 'day' if it changes with the map's time; depth(id): drawn at the map's depth
//   range(id)      promise of its datasets' spans, [[start, end]] in ms (null where not known)
//   controls(it)   elements under its row; render(it, el) brings them up to date
//   values(it, box) promise of its values as GeoTIFF over [west, south, east, north], or null:
//                  in the pictures only
//   legend(id)     what its legend is now, or null: { key (drawn again only when it changes), ready
//                  (what it needs first, a promise or a value), paint(el, data) → its aria text }

// NASA publishes each layer after its own delay (true colour within a day): GIBS says the newest
// date of the layer shown, the last day the map's time can take while it is on
const gibsEnd = lru(Infinity); // GIBS key → promise of its newest date, or null if unknown
function latestGibs(key) {
  return gibsEnd(key, () => fetchOk(gibsDomainUrl(key, shiftDay(today(), -60), today())).then((r) => r.text()).then(domainEnd)).catch(() => null);
}

// Copernicus: each dataset at its own step for the hour shown, its time resolution (cmems.js draws
// the tiles)
const cmemsDepth = (id) => !!CMEMS[id][state.variant[id]].depth;
// the time and level the item draws at: { variant, t, depth } as captured: its regional part's, drawn on top
async function cmemsDrawn(id, at) {
  const [times, levels] = await Promise.all([partTimes(id, at.variant, at.t), partLevels(id, at.variant, at.depth)]);
  const k = times.length - 1 - [...times].reverse().findIndex((pt) => pt != null);
  return { time: times[k], level: levels[k] };
}

// a classed layer's classes, from its services' JSON legends (legend.js wmsClasses): a class drawn
// by several (an area, and a point where it is too small) once, with its fill and its symbol; the
// symbols loaded as pictures (one that does not load is left out, its class kept)
const classLegends = lru(Infinity), icons = lru(Infinity);
const iconOf = (url) => icons(url, () => fetchOk(url).then((r) => r.blob()).then(createImageBitmap));
function classesOf(urls) {
  return classLegends(urls.join(' '), async () => {
    const all = (await Promise.all(urls.map((url) => fetchOk(url).then((r) => r.json()).then(wmsClasses)))).flat();
    const byLabel = new Map();
    for (const c of all) {
      const label = CLASS_LABELS[c.label] || c.label, had = byLabel.get(label);
      if (!had) byLabel.set(label, { ...c, label }); else if (c.icon && !had.icon) had.icon = c.icon;
    }
    return Promise.all([...byLabel.values()].map(async ({ icon, ...c }) => ({ ...c, ...(icon && { image: await iconOf(icon).catch(() => undefined) }) })));
  });
}

const KINDS = {
  // EMODnet's depth, drawn by EMODnet (tiles); its values from its Zarr store
  // GEBCO's depths, drawn by the depth shading (clip.js); its values from its Zarr store
  gebco: {
    // the depth shading's legend: while the chart is under it, zoomed out (the shading ends at 13)
    legend: () => (state.on.has('chart') && map.getZoom() < 13 ? { key: state.variant.depth, paint: (el) => {
      drawRamp(el, 'Depth shading', 'm · GEBCO 2026', depthStops(), { colour: NO_DEPTH, label: 'lakes: no depth · lagoons: shown as 0–5 m' });
      return `Depth shading legend: ${depthStops().map(([d]) => d).join(', ')} metres`;
    } } : null),
    values: (it, box) => gebcoValues(box),
  },
  // where GEBCO's depths come from (its type identifier grid, drawn by gebco.js): a classed layer,
  // its codes in the GIS export
  gebcotid: {
    legend: (id) => KINDS.classes.legend(id),
    values: (it, box) => gebcoValues(box, 'tid'),
  },
  emodnet: {
    legend(id) {
      const v = state.variant[id], stops = EMODNET_DEPTH_STOPS[v];
      return { key: v, paint: (el) => { drawRamp(el, byId[id].label, 'm · not linear', stops); return `${byId[id].label} legend: ${stops.map(([d]) => d).join(', ')} metres`; } };
    },
    values: (it, box) => emodnetValues(box),
  },
  // a classed layer its service draws (seabed substrate): its legend, the service's classes and colours
  classes: {
    legend(id) {
      // the URL of its service's legend, the URLs of several, or the classes themselves
      const src = CLASS_LEGENDS[id](state.variant[id]), urls = typeof src === 'string' ? [src] : typeof src[0] === 'string' ? src : null;
      return { key: urls ? urls.join(' ') : `${id}:${state.variant[id]}`, ready: urls ? classesOf(urls) : src,
        paint: (el, cls) => { drawClasses(el, byId[id].label, [byId[id].variants?.[state.variant[id]], byId[id].legendSub].filter(Boolean).join(' · '), cls); return `${byId[id].label} legend: ${cls.map((c) => c.label).join(', ')}`; } };
    },
  },
  // EMODnet and EMSA density: a period of its own (a year or a month), not the map's time
  density: {
    show(id) {
      map.getSource(id).setTiles(densityTiles(id, state.variant[id], state.period[id]));
      applyItem(id);
    },
    controls: (it) => [h('select', { class: 'period', 'aria-label': `${it.label} period`, onchange: (e) => { state.period[it.id] = e.target.value; refresh(it.id); writeHash(); renderMenu(); } },
      DENSITY[it.id].periods.map((p) => h('option', { value: p }, DENSITY[it.id].periodLabel(p))))],
    render(it, el) { $('select.period', el).value = state.period[it.id]; },
    legend(id) {
      const d = DENSITY[id];
      return { key: `${state.variant[id]}|${state.period[id]}`, paint: (el) => { drawRamp(el, d.title, `${d.unit} · ${d.types[state.variant[id]]} · ${d.periodLabel(state.period[id])}`, d.stops); return `${d.title} legend: ${d.stops.map(([v]) => v).join(', ')} ${d.unit}`; } };
    },
  },
  // NASA daily: the day of the time shown (UTC). Drawn only once its newest day is known, and not
  // after it (the time is brought within it), so it never asks for a day not published yet
  gibs: {
    time: () => 'day',
    async show(id) {
      const key = state.variant[id], end = await latestGibs(key), day = dayOf(state.time);
      if (key !== state.variant[id] || !state.on.has(id) || (end && day > end)) return; // switched meanwhile, or not published yet
      if (day !== gibsDay) {
        gibsDay = day;
        for (const k of Object.keys(GIBS)) map.getSource(`gibs-${k}`).setTiles(gibsTiles(k, day));
      }
      applyItem(id);
    },
    range: (id) => latestGibs(state.variant[id]).then((end) => [[null, end && Date.parse(`${end}T23:00:00Z`)]]),
  },
  // Copernicus Marine: the hour shown (daily means: its day), at the depth shown for variables with depth
  cmems: {
    time: (id) => (CMEMS[id][state.variant[id]].daily ? 'day' : 'hour'),
    depth: cmemsDepth,
    show(id) {
      const depth = cmemsDepth(id) ? state.depth : 0; // no new tiles for a depth change it ignores
      map.getSource(`cmems-${id}`).setTiles([`cmems://${id}/${state.variant[id]}/${looks[id] || 'both'}/${state.time}/${depth}/{z}/{x}/{y}`]);
      applyItem(id);
    },
    // each dataset from its first step to the end of its last (a daily mean covers its day, a
    // 3-hourly step three hours)
    range: (id) => Promise.all(CMEMS[id][state.variant[id]].parts.map((p) => domainOf(p).then(({ time }) =>
      [Math.min(...time.map((r) => r.start)), Math.max(...time.map((r) => r.end + Math.max(0, r.step - 36e5)))], () => null))),
    // the colours and unit: the time and depth are the map's, said once beside the coordinates
    legend(id) {
      const v = CMEMS[id][state.variant[id]];
      // '<' below the scale only where values go on below it (not under 0 m, 0 m/s)
      return { key: state.variant[id], ready: cmemsLegend(id, state.variant[id]), paint: (el, cm) => { drawColormap(el, v.label, v.unit, cm, [v.log || v.range[0] + (v.offset || 0) < 0, true], v.log); return `${v.label} legend${v.unit ? `, ${v.unit}` : ''}`; } };
    },
    values: (it, box) => cmemsValues(it.id, it.at, box), // from its datasets' Zarr stores
  },
};
// every item's kind is one of them: a gap is an error on the console, which fails the browser tests
for (const it of ITEMS) if (it.kind && !KINDS[it.kind]) console.error(`${it.id}: kind ${it.kind} is not one of KINDS`);
const kindOf = (id) => KINDS[byId[id].kind];
// draws an item as the state says; a kind with a show() of its own asks its service, only while the item is on
const refresh = (id) => (state.on.has(id) && kindOf(id)?.show ? kindOf(id).show(id) : applyItem(id));
const timeOn = () => ITEMS.filter((it) => state.on.has(it.id) && kindOf(it.id)?.time);
const depthOn = () => ITEMS.filter((it) => state.on.has(it.id) && kindOf(it.id)?.depth?.(it.id));
const hourly = () => timeOn().some((it) => kindOf(it.id).time(it.id) === 'hour');

// ---- Ocean data: one entry drawing colours, one drawing arrows --------------------------------
// The menus' entries switch their items on at their variants, drawing colours, arrows, or both
// (currents chosen in both menus); the group's other items go off. Two colour layers cannot be
// read together, nor two sets of arrows: the menus hold one of each.
const looks = {}; // item → what it draws: 'colour', 'arrows' or 'both'
function applyData() {
  const [ci, cv] = state.colour.split(':'), [ai, av] = state.arrows.split(':');
  for (const it of DATA) {
    const was = state.on.has(it.id) ? `${looks[it.id]}:${state.variant[it.id]}` : '';
    const look = it.id === ci ? (it.id === ai ? 'both' : 'colour') : it.id === ai ? 'arrows' : '';
    if (look) {
      state.on.add(it.id);
      looks[it.id] = look;
      state.variant[it.id] = it.id === ci ? cv : av;
    } else state.on.delete(it.id);
    if ((look && `${look}:${state.variant[it.id]}`) !== was) refresh(it.id);
  }
}

function setDepth(d) {
  state.depth = d;
  for (const it of depthOn()) kindOf(it.id).show(it.id);
  writeHash();
  renderWhen(); // nothing else says the depth
}
function setTime(t) {
  state.time = within(t); // on the hour, at a time every layer on has
  for (const it of timeOn()) kindOf(it.id).show(it.id);
  writeHash();
  renderWhen(); // nothing else says the time
}
// ---- the map's settings: the time and the depth, for every layer that uses them -------------
// Set on one line at the head of the Layers panel, read beside the coordinates. The time is a
// datetime-local field in local time, on the hour (step 3600 s), within the times every layer on
// has (min, max: the browser's calendar greys out the rest, the field's tooltip names them);
// ‹ › step an hour (the finest step on), or a day when only daily layers are on, and stop at
// those times; Now goes to now, or as near as they reach. Every layer draws the time shown at its
// own time resolution: that hour, the 3-hour step holding it, that day.
const when = $('#when'), whenIn = $('input', when), stepBtns = when.querySelectorAll('[data-step]'), depthSel = $('.depthsel', when), shown = shownEl;
const pad = (n) => String(n).padStart(2, '0');
const depthWords = (d) => (d ? `${d} m deep` : 'surface'); // each model at its level nearest the depth chosen
const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const local = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const RANGE = [Date.UTC(2000, 0, 1), Date.UTC(2099, 11, 31, 23)]; // until the layers' own dates are known
let range = RANGE, rangeKey = '';
// the times every layer on has: from the latest first step to the earliest last one of their
// datasets (NASA: to its newest day), on UTC hours, so the field's steps (counted from min) stay
// on the hour. A time outside it (a layer switched on, a link, now) is brought within it.
async function updateRange() {
  const key = timeOn().map((it) => `${it.id}:${state.variant[it.id] || ''}`).join(',');
  if (key === rangeKey) return;
  rangeKey = key;
  const spans = (await Promise.all(timeOn().map((it) => kindOf(it.id).range(it.id)))).flat().filter(Boolean);
  if (key !== rangeKey) return; // the layers changed meanwhile
  const starts = spans.map((s) => s[0]).filter(Number.isFinite), ends = spans.map((s) => s[1]).filter(Number.isFinite);
  const end = ends.length ? hour(Math.min(...ends)) : RANGE[1];
  range = [Math.min(end, starts.length ? hour(Math.max(...starts)) : RANGE[0]), end];
  if (state.time !== within(state.time)) setTime(state.time); else renderWhen();
}
const within = (t) => Math.min(range[1], Math.max(range[0], hour(t)));
// taken as it changes (a day clicked in the calendar, not when the calendar closes). A time typed
// in the field changes with each key (year 0002, 0020, 0202, 2026): only a whole time within the
// field's range is taken
whenIn.addEventListener('input', () => {
  const v = whenIn.validity;
  if (!(v.valueMissing || v.badInput || v.rangeUnderflow || v.rangeOverflow)) setTime(new Date(whenIn.value).getTime());
});
// by the clock, not the field's wall time: an hour is an hour across a change to summer time
for (const b of stepBtns) b.addEventListener('click', () => setTime(state.time + b.dataset.step * (hourly() ? 36e5 : 864e5)));
$('[data-now]', when).addEventListener('click', () => setTime(Date.now()));
$('select', depthSel).append(...CMEMS_DEPTHS.map((d) => h('option', { value: d }, d ? `${d} m` : 'Surface')));
$('select', depthSel).addEventListener('change', (e) => setDepth(+e.target.value));
function renderWhen() {
  const on = timeOn().length > 0, deep = depthOn().length > 0;
  when.hidden = !on;
  shown.hidden = !on;
  if (!on) return;
  updateRange();
  const d = new Date(state.time), hr = hourly();
  whenIn.min = local(range[0]);
  whenIn.max = local(range[1]);
  whenIn.title = `Data: ${fmtDate(range[0])} – ${fmtDate(range[1])}`;
  if (document.activeElement !== whenIn) whenIn.value = local(state.time); // not while a time is typed in it
  for (const b of stepBtns) b.title = `${b.dataset.step < 0 ? 'Earlier' : 'Later'}: one ${hr ? 'hour' : 'day'}`;
  depthSel.hidden = !deep;
  $('select', depthSel).value = state.depth;
  // beside the coordinates: "Today 18:00 · 100 m deep" (each model at its level nearest the depth
  // chosen), or "Wed 21 Oct" when only daily layers are on: their day, in UTC as the products have it
  const tz = hr ? undefined : 'UTC', same = (a) => a.toLocaleDateString('en', { timeZone: tz }) === d.toLocaleDateString('en', { timeZone: tz });
  const part = (o) => d.toLocaleDateString([], { ...o, timeZone: tz });
  const day = same(new Date()) ? 'Today' // "Wed 21 Oct", in this order in every locale
    : `${part({ weekday: 'short' })} ${d.toLocaleDateString('en', { day: 'numeric', timeZone: tz })} ${part({ month: 'short' })}`;
  shown.textContent = [[day, hr ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' '),
    deep ? depthWords(state.depth) : ''].filter(Boolean).join(' · ');
  shown.title = `Time shown: ${d.toLocaleString([], hr ? { dateStyle: 'full', timeStyle: 'short' } : { dateStyle: 'full', timeZone: 'UTC' })}`
    + `${deep ? `; depth: ${state.depth ? `${state.depth} m below the surface, each model at its level nearest it` : 'the surface'}` : ''}. A click: earlier, later`;
}
// ---- graticule (WGS 84 lat/lon grid; spacing adapts to the view) -------------
const STEPS = [30, 20, 10, 5, 2, 1, 30 / 60, 20 / 60, 10 / 60, 5 / 60, 2 / 60, 1 / 60];
function updateGraticule() {
  if (!state.on.has('graticule')) return;
  const b = map.getBounds();
  const span = Math.max(b.getNorth() - b.getSouth(), (b.getEast() - b.getWest()) * Math.cos(map.getCenter().lat * D2R));
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
// a 20 px line icon from SVG path data; a path given as [d, colour] is filled in that colour
const icon = (...paths) => svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  paths.map((d) => (Array.isArray(d) ? svg('path', { d: d[0], fill: d[1], stroke: d[1] }) : svg('path', { d }))));
const ICON = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4-4'],
  link: ['M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1', 'M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'],
  png: ['M4 5h16v14H4z', 'm4 17 5-5 4 4 3-3 4 4', 'M17 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'], // a picture
  zip: ['M4 4h16v4H4z', 'M5 8v12h14V8', 'M10 12h4'],
  compass: [['m12 3 4 9h-8z', '#b42318'], 'm12 21-4-9h8z'],
  locate: ['M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'M12 2v3M12 19v3M2 12h3M19 12h3', ['M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'currentColor']], // a dot in sights
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  ruler: ['M3 17 17 3l4 4L7 21z', 'm7 13 2 2M10 10l2 2M13 7l2 2'],
};
// the page's own buttons name their icon: <i data-icon="…">
for (const el of document.querySelectorAll('[data-icon]')) el.replaceWith(icon(...ICON[el.dataset.icon]));
// the frame (frame.js): the bar, the left panel (Elements, Layers), the right one (Properties)
let drawPanel = null; // the drawing's view (below): told when the frame changes
const frame = createFrame({ left: $('#side'), right: $('#props'), icon, onChange: () => { writeHash(); drawPanel?.render('tool'); },
  tabs: [{ id: 'elements', label: 'Elements', body: $('#dview') }, { id: 'layers', label: h('span', {}, 'Layers ', h('span', { class: 'spin', 'aria-hidden': 'true' })), body: $('#menu') }] });
// ---- layers panel -----------------------------------------------------------
const menu = $('#menu');
const rows = {};
let depthSeg = null; // the depth colours' control: rendered again with the menu
function setVariant(id, v) {
  state.variant[id] = v;
  refresh(id);
  if (id === 'depth') depthColours();
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
// what the item shows (scheme, source, its kind's controls) sits under its row while it is on
function controlsOf(it) {
  let variant = null;
  if (it.id === 'depth') {
    variant = choice('Depth colours', [['atlas', 'Darker = deeper', it.variants.atlas], ['nautical', 'Darker = shallower', it.variants.nautical]], () => state.variant.depth, (v) => setVariant('depth', v));
    depthSeg = variant;
  } else if (it.variants) {
    variant = h('select', { class: 'variant', 'aria-label': `${it.label} variant`, onchange: (e) => setVariant(it.id, e.target.value) },
      Object.entries(it.variants).map(([k, label]) => h('option', { value: k }, label)));
  }
  return h('div', { class: 'controls' }, variant, kindOf(it.id)?.controls?.(it)); // the time and depth: at the panel's head
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
// Ocean data: two menus, colours and arrows, their entries under the sections' headings; the
// source, licence and opacity of what is chosen behind one ⓘ, as for the base
const picks = {}; // slot → its menu
let dataMore = null, dataInfos = {};
function dataBlock(items, sections) {
  dataInfos = Object.fromEntries(items.map((it) => [it.id, infoBlock(it)]));
  dataMore = moreButton('the ocean data shown', h('div'));
  dataMore.onclick = (e) => { e.currentTarget.setAttribute('aria-expanded', String(e.currentTarget.getAttribute('aria-expanded') !== 'true')); renderMenu(); };
  const pick = (slot, label) => {
    picks[slot] = h('select', { 'aria-label': label, onchange: (e) => { state[slot] = e.target.value; applyData(); labelPaint(); writeHash(); renderMenu(); } },
      h('option', { value: '' }, 'None'),
      sections.map((sec) => {
        const es = ENTRIES[slot].filter((e) => e.it.section === sec);
        return es.length ? h('optgroup', { label: sec }, es.map((e) => h('option', { value: e.key }, e.label))) : null;
      }));
    return h('li', { class: 'item pick' }, h('label', { class: 'line' }, h('span', { class: 'name' }, label), picks[slot]));
  };
  return h('ul', {}, pick('colour', 'Colours'), pick('arrows', 'Arrows'),
    h('li', { class: 'item' }, h('div', { class: 'line' }, h('span', { class: 'name' }, 'Source and licence'), dataMore), ...Object.values(dataInfos)));
}
function groupBlock(g) {
  const items = ITEMS.filter((it) => it.group === g.id);
  const det = h('details', { 'data-group': g.id, open: state.open.has(g.id),
    ontoggle: (e) => { e.target.open ? state.open.add(g.id) : state.open.delete(g.id); writeHash(); } },
    h('summary', {}, h('span', { class: 'gname' }, g.label), h('span', { class: 'count', title: 'Layers on' })),
    g.sections ? dataBlock(items, g.sections) : g.exclusive ? baseBlock(items) : h('ul', {}, items.map(itemRow)));
  det._items = items;
  det._exclusive = g.exclusive;
  return det;
}
const groupEls = GROUPS.map(groupBlock);
menu.append(...groupEls);

// the panel and what follows the state (the time line, status marks, legends), after a change of
// what is on or how it is drawn; a step of the time or the depth renders the time line alone, a
// zoom the rows' zoom hints and the legends (renderZoom)
function renderMenu() {
  for (const it of ITEMS) {
    const r = rows[it.id];
    if (!r) continue; // Ocean data: below
    const on = state.on.has(it.id);
    if (it.group === 'base') r.input.setAttribute('aria-checked', String(on));
    else r.input.checked = on;
    r.controls.hidden = !on || !(it.variants || kindOf(it.id)?.controls);
    if (on) kindOf(it.id)?.render?.(it, r.controls);
    if (r.infos && r.more.getAttribute('aria-expanded') === 'true') r.infos[it.id].hidden = !on;
    const sel = r.controls.querySelector('select.variant');
    if (sel) sel.value = state.variant[it.id];
    const rng = (r.infos?.[it.id] || r.row).querySelector('input[type=range]');
    if (rng) rng.value = state.opacity[it.id];
  }
  depthSeg?.render();
  for (const slot in picks) picks[slot].value = state[slot];
  for (const [id, el] of Object.entries(dataInfos)) {
    el.hidden = !(dataMore.getAttribute('aria-expanded') === 'true' && state.on.has(id));
    const rng = el.querySelector('input[type=range]');
    if (rng) rng.value = state.opacity[id];
  }
  renderWhen();
  for (const g of groupEls) {
    const n = g._items.filter((it) => state.on.has(it.id)).length;
    g.querySelector('.count').textContent = g._exclusive || !n ? '' : String(n);
  }
  renderStatus();
  renderZoom();
}
// a layer on, out of its zoom range: greyed out, "zoom 9+"; the legends (depth shading's goes above zoom 12)
function renderZoom() {
  const z = map.getZoom();
  for (const it of ITEMS) {
    const r = rows[it.id];
    if (!r) continue;
    const on = state.on.has(it.id), low = it.minzoom && z < it.minzoom, high = it.maxzoom && z >= it.maxzoom + 1;
    r.row.classList.toggle('dim', !!(on && (low || high)));
    const hint = r.row.querySelector('.hint');
    if (hint) hint.textContent = !on ? '' : low ? `zoom ${it.minzoom}+` : high ? `zoom ≤ ${it.maxzoom}` : '';
  }
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
// a legend painted when what it shows changed (its key); one that needs data first is painted when
// that comes, if still wanted, and the stack laid out again with its size
async function paintLegend(id, el, spec) {
  if (el.dataset.key === spec.key) return;
  el.dataset.key = spec.key;
  const later = !!spec.ready?.then;
  try {
    const data = await spec.ready;
    if (el.dataset.key !== spec.key) return; // switched meanwhile
    el.setAttribute('aria-label', spec.paint(el, data));
    later ? renderLegends() : snapLegends(); // painted after the stack was laid out (await): its size may have changed
  } catch (e) { el.dataset.key = ''; console.warn(`${byId[id].label} legend:`, e.message); }
}
function renderLegends() {
  const want = [];
  for (const it of ITEMS) {
    const spec = state.on.has(it.id) && kindOf(it.id)?.legend?.(it.id);
    if (spec) { paintLegend(it.id, legendEl(it.id), spec); want.push(it.id); }
  }
  legendWant = want;
  legends.replaceChildren(...(state.on.has('legend') ? want.map((id) => legendEls[id]) : []));
  snapLegends();
}
// the stack on whole screen pixels: gaps of whole pixels, and moved by the fraction its place
// falls on (at a display scale of 125% the canvases would otherwise start between two pixels)
function snapLegends() {
  const d = window.devicePixelRatio || 1;
  legends.style.setProperty('--legend-gap', `${Math.round(6 * d) / d}px`);
  legends.style.translate = '';
  const r = legends.getBoundingClientRect();
  legends.style.translate = `${(Math.round(r.left * d) - r.left * d) / d}px ${(Math.round(r.top * d) - r.top * d) / d}px`;
}
window.addEventListener('resize', snapLegends);
// a new display scale (the browser zoomed, a screen of another density): the canvases drawn again for it
(function onScale() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
    for (const el of Object.values(legendEls)) el.dataset.key = '';
    renderLegends();
    onScale();
  }, { once: true });
})();
function renderStatus() {
  const mark = (row, st) => {
    row.classList.toggle('error', st?.cls === 'error');
    row.classList.toggle('partial', st?.cls === 'partial');
    row.title = st ? st.msg : '';
  };
  for (const it of ITEMS) if (rows[it.id]) mark(rows[it.id].row, state.on.has(it.id) ? itemStatus(it.id) : null);
  for (const slot in picks) mark(picks[slot].closest('li'), state[slot] ? itemStatus(state[slot].split(':')[0]) : null);
}

// ---- the distance units for the whole app ----------------------------------------------------
// the units the drawing's lengths and values, its labels and the exports use: a click on the scale
// switches them
scaleEl.title = 'Distance units: a click switches km and NM';
scaleEl.addEventListener('click', () => setDisplay({ units: display.units === 'km' ? 'nm' : 'km' }));
// the time shown, a chip on the bottom row: a click shows its controls in a box over it
const timePop = $('#timepop');
const timeBox = popup(timePop, {
  place: () => {
    const r = shownEl.getBoundingClientRect();
    Object.assign(timePop.style, { right: `${Math.max(8, innerWidth - r.right)}px`, bottom: `${innerHeight - r.top + 6}px` });
  },
});
Object.assign(shownEl, { tabIndex: 0 });
shownEl.setAttribute('role', 'button');
shownEl.addEventListener('click', (e) => timeBox.toggle(shownEl, e));
shownEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shownEl.click(); } });
function renderUnits() {
  scale.setUnit(display.units === 'nm' ? 'nautical' : 'metric');
  scaleUnits();
}

// ---- the view's outputs, in the drawing's ☰ menu: each says how it went on itself ("Copied",
// "Saving…", "Failed"), the menu open meanwhile
const output = (id, iconName, text, title, run) => h('button', { type: 'button', role: 'menuitem', id, title, onclick: (e) => run(e.currentTarget) }, icon(...ICON[iconName]), h('span', {}, text));
const outputs = [output('link', 'link', 'Copy link', 'Copy a link to this exact view', (b) => copyLink(b)),
  output('png', 'png', 'Picture (PNG)', 'Download the view as a picture', (b) => exportPng(b)),
  output('zip', 'zip', 'GIS data (ZIP)', 'Download the view as GIS data: a georeferenced picture, GeoJSON, GeoTIFF', (b) => exportZip(b))];

// ---- the drawing (draw/panel.js): its tools in the bar, the tree, its properties -------------------
drawPanel = drawView($('#dview'), {
  drawing, display, setDisplay, map, icon, known: KNOWN, units: () => display.units,
  measureIcon: ICON.ruler, free: () => free(), bar: $('#bar'), props: $('#props'), frame,
  // the ☰ menu's foot: the view's outputs and About
  menuExtras: (close) => [h('div', { class: 'dsep' }), ...outputs,
    h('button', { type: 'button', role: 'menuitem', class: 'mabout', onclick: () => { close(); $('#about').showModal(); showVersion(); } }, 'About')],
  // an imported drawing added to the list and opened, with its view and layers; one of the list opened
  // where it was drawn
  onImport: (doc) => { const v = doc.view; drawing.saving.add(doc); if (v) applyView(v); },
  openDrawing: (id) => { const v = drawing.saving.open(id); if (v?.center) map.jumpTo({ center: v.center, zoom: v.zoom ?? map.getZoom(), bearing: v.bearing ?? 0 }); },
  download: (text, name, type = 'application/geo+json') => download(new Blob([text], { type }), name),
  profile: (trace) => profileFor(trace),
});

// ---- find a place, about ------------------------------------------------------------------------
// The padding that keeps what the map is fitted to (Zoom to, a place found) in the part not under the
// bar and the panels (a phone's sheet); 60 px of margin all round. Only for fitting: the map itself
// does not move.
function free() {
  const p = { top: 60 + $('#bar').offsetHeight, right: 60, bottom: 60, left: 60 };
  const side = $('#side'), props = $('#props');
  if (NARROW.matches) p.bottom += Math.max(...[side, props].map((e) => (e.hidden ? 0 : innerHeight - e.getBoundingClientRect().top)));
  else {
    if (!side.hidden) p.left += side.getBoundingClientRect().right;
    if (!props.hidden) p.right += innerWidth - props.getBoundingClientRect().left;
  }
  return p;
}
// find a place: the search field behind its lens, shown while it is used (the lens, or /); gone when
// left. The lens in the bar, before Properties; on a phone, whose bar is full, with the map's controls
const findBtn = $('#b-find');
const placeFind = () => (NARROW.matches ? $('#zoom').prepend(findBtn) : frame.rightBtn.before(findBtn));
NARROW.addEventListener?.('change', placeFind);
placeFind();
const setFinding = (on) => { document.body.classList.toggle('finding', on); findBtn.setAttribute('aria-expanded', String(on)); if (on) $('#q').focus(); };
findBtn.addEventListener('click', () => setFinding(!document.body.classList.contains('finding')));
$('#q').addEventListener('blur', () => setTimeout(() => { if (!$('#search').contains(document.activeElement)) setFinding(false); }, 250));

const mapBox = map.getContainer();
mapBox.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
mapBox.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  e.preventDefault();
  drawPanel.importFile(f);
});
async function copyLink(b) {
  writeHashNow(); // the link must be the view as it is now
  try { await navigator.clipboard.writeText(location.href); flash(b, 'Copied'); } catch { prompt('Copy this link', location.href); }
}
// a button's own label and tooltip, kept while it says something else for a moment (flash: the text,
// and why in its tooltip)
const labelOf = (b) => { b.dataset.label ||= b.querySelector('span').textContent; b.dataset.title ||= b.title; return b.dataset; };
function flash(b, text, title = '', ms = 1200) {
  const own = labelOf(b);
  clearTimeout(b.flashTimer);
  b.querySelector('span').textContent = text;
  b.title = title || own.title;
  b.flashTimer = setTimeout(() => { b.querySelector('span').textContent = own.label; b.title = own.title; }, ms);
}
const about = $('#about');
// the version published: version.json, written by the deploy (ci.yml); none on a development copy.
// { commit, date }, or null
async function published() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json();
    return /^[0-9a-f]{40}$/.test(v?.commit) ? v : null;
  } catch { return null; }
}
for (const b of document.querySelectorAll('[data-reload]')) b.addEventListener('click', () => location.reload());
let versionShown = false;
async function showVersion() {
  if (versionShown) return;
  versionShown = true;
  const v = await published();
  if (v) {
    const { commit, date } = v;
    $('#version').replaceChildren('version ', h('a', { href: `https://github.com/stemanfredi/charts/commit/${commit}`, target: '_blank', rel: 'noopener' }, commit.slice(0, 7)), date ? ` of ${String(date).slice(0, 10)}` : '');
  }
}
// Report an issue: a new GitHub issue with this view's link (the area and the layers; never the
// measurements or the drawing), editable before it is submitted
$('#issue').addEventListener('click', (e) => {
  writeHashNow();
  const body = `What happened, and what you expected:\n\n\nThe view (its link shows the area viewed and the layers; delete it if you prefer):\n${location.href}\n`;
  e.currentTarget.href = `https://github.com/stemanfredi/charts/issues/new?body=${encodeURIComponent(body)}`;
});
about.querySelector('[data-close]').addEventListener('click', () => about.close());

// the single keys (keys.js), from anywhere: search, Layers, the column, or a tool
// (draw/drawing.js handles the keys of what is being drawn; draw/panel.js the drawing's own)
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || typing(e.target)) return;
  const k = keyEntry(e.key);
  if (!k?.open && !k?.tool) return;
  if (k.open === 'search') { e.preventDefault(); setFinding(true); }
  else if (k.open === 'elements' || k.open === 'layers') frame.toggleTab(k.open);
  else if (k.open === 'props') frame.setProps(!frame.props);
  else drawPanel.cycle(k.tool[1]); // on, or its next variant
});
// the tooltips and About say the keys
$('#about .keys').replaceChildren(...keyList());
frame.leftBtn.title = `Elements (${openKey('elements')}) and Layers (${openKey('layers')})`;
frame.rightBtn.title = `Properties (${openKey('props')})`;
findBtn.title = `Find a place (${openKey('search')})`;

search(map, maplibregl.Marker, free); // the search box (find a place)

// ---- depth at a point: a click on the sea says its depth and where it comes from --------------
// As the depth shading has it (the sea's clipped tile: GEBCO, cut to the OSM coastline, the
// Caspian from its own surface), rounded towards shallower (16.6 m reads 16 m); while the depth
// shading or the isobaths are on, and not while measuring (a click there adds a point)
const depthPopup = new maplibregl.Popup({ className: 'depthpop', maxWidth: '240px', focusAfterOpen: false });
// The depth profiles read (a line's Depth profile pressed), by trace: the GIS export's seabed lengths
// come from these only, so that an export reads no depth tiles along lines nobody asked about
const profiled = lru(64); // JSON of the trace's coordinates → promise of its profile
const profileFor = (trace) => profiled(JSON.stringify(trace.coords), () => profileOf(trace, depthAt, DEM_SEA_MAX));
// The depth at p ([lng, lat]) as the depth shading has it, read at zoom z: metres, negative below the
// sea surface; NaN on land, lakes, no data. A profile reads many places of few tiles: each tile once.
const depthTiles = lru(64);
async function depthAt([lng, lat], z) {
  const { x: X, y: Y } = tileXY(lng, lat, z), tx = Math.floor(X), ty = Math.floor(Y);
  const m = await depthTiles(`${z}/${tx}/${ty}`, () => seaClip.metres(z, tx, ty));
  return m[Math.floor((Y % 1) * TILE) * TILE + Math.floor((X % 1) * TILE)];
}
map.on('click', async (e) => {
  if (drawing.tool || drawing.picking || drawing.repointing || !(state.on.has('depth') || state.on.has('isobaths'))) return;
  if (drawing.hitAt(e.point).length) return; // a click on a drawing selects it
  const { lng, lat } = e.lngLat, z = Math.min(DEM_SEA_MAX, Math.floor(map.getZoom()) + 1); // 256 px DEM tiles at z show at map zoom z − 1
  const [v, code] = await Promise.all([depthAt([lng, lat], z).catch(() => null), tidAt(lng, lat).catch(() => null)]);
  if (v === null) { depthPopup.setLngLat(e.lngLat).setDOMContent(h('div', {}, h('b', {}, 'Depth not available'), h('small', {}, 'GEBCO 2026 could not be read'))).addTo(map); return; }
  if (!Number.isFinite(v)) { depthPopup.remove(); return; } // land, a lake, inland water: no depth here
  const source = DEPTH_SOURCES.find(({ codes: [a, b] }) => code >= a && code <= b);
  // −1: shallower than 1 m, or sea the data calls dry (clip.js)
  const depth = v >= -1 ? 'Shallow: under 1 m, or not known' : `${Math.floor(-v)} m`;
  depthPopup.setLngLat(e.lngLat).setDOMContent(h('div', {}, h('b', {}, depth),
    h('small', {}, ['GEBCO 2026', source?.label.toLowerCase()].filter(Boolean).join(' · ')))).addTo(map);
});
// cursor position readout
map.on('mousemove', (e) => { posEl.textContent = `${dm(e.lngLat.lat, 'N', 'S')}  ${dm(((e.lngLat.lng + 540) % 360) - 180, 'E', 'W')}`; });

// ---- scale note: the Mercator scale bar is exact only at the centre latitude ------------
// relative change of the Mercator scale (∝ 1/cos lat) across the view: from the lowest to the
// highest |lat| in view, the lowest being 0 when the view crosses the equator
function scaleVariation() {
  const b = map.getBounds();
  return mercatorVariation(b.getSouth(), b.getNorth());
}
function scaleNote() {
  const v = scaleVariation();
  scaleNoteEl.textContent = v > NOTE_AT ? `scale varies ${(v * 100).toFixed(0)}%${NARROW.matches ? '' : ' across the view'}` : ''; // short on a phone: one line
}

// ---- credits, and the exports (PNG: png.js; GIS: below) ----------------------------------------
// the credits of what is drawn: each shown source's own (catalog.js), once, the base map's first
// (OpenStreetMap and Esri ask for theirs to be seen, and a line that does not fit is cut at its end)
const baseSources = new Set(ITEMS.filter((it) => it.group === 'base').flatMap((it) => (layersOf[it.id] || []).map((l) => l.source)));
function creditParts() {
  const srcs = [];
  for (const l of style.layers) if (l.source && map.getLayoutProperty(l.id, 'visibility') !== 'none' && !srcs.includes(l.source)) srcs.push(l.source);
  srcs.sort((a, b) => baseSources.has(b) - baseSources.has(a));
  const parts = [...new Set(srcs.map((s) => map.getSource(s)?.attribution).filter(Boolean))];
  return parts.filter((p) => !parts.some((q) => q !== p && q.includes(p))); // a credit another holds: once
}
// a credit's markup, parsed in an inert document (no image loads, no handlers run)
const parsed = (html) => new DOMParser().parseFromString(html, 'text/html').body;
// as text, for the exports
const attributionText = () => creditParts().map((p) => parsed(p).textContent).join(' · ');
// on screen: their text, and their links (https only) as new links; no other markup is kept, so
// a credit never adds anything to the page but text and links, whoever wrote it
function creditNodes(html) {
  return [...parsed(html).childNodes].map((n) => (n.nodeName === 'A' && /^https:\/\//.test(n.getAttribute('href'))
    ? h('a', { href: n.getAttribute('href'), target: '_blank', rel: 'noopener noreferrer' }, n.textContent) : n.textContent));
}
// once a frame at most, as the layers and sources change
let creditsRaf = 0, creditsKey = null;
function renderCredits() {
  cancelAnimationFrame(creditsRaf);
  creditsRaf = requestAnimationFrame(() => {
    const parts = creditParts(), key = parts.join(' | ');
    if (key === creditsKey) return;
    creditsKey = key;
    creditsText.replaceChildren(...parts.flatMap((p, i) => [...(i ? [' | '] : []), ...creditNodes(p)]));
  });
}
map.on('styledata', renderCredits);
map.on('sourcedata', (e) => { if (!e.tile) renderCredits(); });
// An export from button b: after before() (a library to load), the map's next frame, after pending
// tiles (so a layer switched on a moment ago is in the picture). fn(canvas) runs while the canvas
// still holds it, and must read it before awaiting; it returns what it left out, if anything. The
// button says "Saving…" meanwhile, then "Failed" or "Partial" for a few seconds, its tooltip why.
let exporting = false; // one export at a time, however often the buttons are clicked
async function onFrame(b, fn, before = async () => {}) {
  if (exporting) return;
  exporting = true;
  const label = b.querySelector('span'), own = labelOf(b);
  clearTimeout(b.flashTimer); // a "Failed" still shown: this try replaces it
  b.setAttribute('aria-busy', 'true');
  label.textContent = 'Saving…';
  b.title = own.title;
  const done = (text, title) => {
    b.removeAttribute('aria-busy');
    label.textContent = own.label;
    exporting = false;
    if (text) flash(b, text, title, 5000);
  };
  const failed = (e) => { console.error('export failed:', e.message); done('Failed', `Export failed: ${e.message}`); };
  try { await before(); } catch (e) { failed(e); return; }
  const go = () => {
    drawing.showMarks(false); // the selection's highlight is not part of the picture, nor the device's location
    for (const id of LOCATION_LAYERS.map((l) => l.id)) map.setLayoutProperty(id, 'visibility', 'none');
    map.once('render', async () => {
      try {
        const left = await fn(map.getCanvas());
        done(left?.length ? 'Partial' : '', left?.length ? `Saved without ${left.join('; ')}` : '');
      } catch (e) { failed(e); } finally {
        drawing.showMarks(true);
        for (const id of LOCATION_LAYERS.map((l) => l.id)) map.setLayoutProperty(id, 'visibility', 'visible');
      }
    });
    map.triggerRepaint();
  };
  if (map.loaded() && map.areTilesLoaded()) go(); else map.once('idle', go);
}
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// ---- what the map shows, read once for an export -------------------------------------------
// The only source of what an export says: the view, the time and depth as the reading beside the
// coordinates states them, the credits, each layer drawn with the state it is drawn in (it.at, for
// its kind's values). Read at the moment of capture, so nothing is read after an await.
function snapshot(src) {
  writeHashNow(); // the link is the view as it is now
  const when = new Date(), c = map.getCenter(), W = src.clientWidth, H = src.clientHeight;
  const timed = timeOn().length > 0, hr = hourly(), depth = depthOn().length ? state.depth : null, t = state.time;
  // each layer with what it is drawn with: at (its variant, the time and depth: its values are read at these), and for
  // item.json its period (density), its day (NASA daily), what it draws (colours, arrows: Copernicus)
  const layers = drawnItems().map((it) => ({ ...it, assets: [], at: { variant: state.variant[it.id], t, depth: state.depth },
    period: DENSITY[it.id] ? state.period[it.id] : undefined, date: it.kind === 'gibs' ? gibsDay : undefined, draws: it.kind === 'cmems' ? looks[it.id] : undefined }));
  return {
    when, name: exportName(when, c.lat, c.lng), at: `${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')}`, lat: c.lat,
    zoom: map.getZoom(), bearing: map.getBearing(), link: location.href, credits: attributionText(), layers, legends: legendWant.map((id) => legendEls[id]),
    scaleVariation: scaleVariation(),
    corners: [[0, 0], [W, 0], [W, H], [0, H]].map((p) => { const ll = map.unproject(p); return [ll.lng, ll.lat]; }),
    time: timed ? (hr ? { at: t } : { day: dayOf(t) }) : null, depth,
    // in words: as the reading gives them, with the date and time zone (a daily product's day in UTC)
    timeText: !timed ? '' : hr ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
      : new Date(t).toLocaleDateString([], { dateStyle: 'medium', timeZone: 'UTC' }),
    depthText: depth == null ? '' : depthWords(depth),
    drawText: drawing.offset().length ? 'lines drawn offset, not to scale' : '',
    // for files read elsewhere: in UTC
    dataText: !timed ? '' : `data ${hr ? `at ${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : `of ${dayOf(t)} (UTC)`}${depth == null ? '' : `, ${depthWords(depth)}`}`,
  };
}
function exportPng(b) {
  onFrame(b, async (src) => {
    const s = snapshot(src);
    download(await chartPng(chartCanvas(src, s)), `${s.name}.png`);
  });
}

// ---- GIS export: the view as a zip of GIS data (export.js, zip.js) --------------------------------
// the menu items the view draws: switched on, over their base, in their zoom range
function drawnItems() {
  const z = map.getZoom();
  return ITEMS.filter((it) => (layersOf[it.id] || []).some((l) => map.getLayoutProperty(l.id, 'visibility') === 'visible' && z >= (l.minzoom ?? 0) && z < (l.maxzoom ?? 24)))
    .map((it) => ({ ...it, variant: it.variants?.[state.variant[it.id]] }));
}
const exportZip = gisExport({ map, layersOf, kindOf, drawing, display, profiled, clips: { sea: seaClip, land: landClip }, cmemsDrawn, snapshot, onFrame, download });

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
  applyData();
  for (const it of ITEMS) refresh(it.id);
  depthColours();
  labelPaint();
  creditEsri();
  drawing.addIcons();
  drawing.saving.restore(); // its view, if the address had none, is already in it
  drawing.render();
  drawPanel.render('doc');
  updateGraticule();
  renderMenu();
  renderUnits();
  ready = true;
  if (state.layers !== null) frame.setTab(state.layers ? 'layers' : frame.tab === 'layers' ? 'elements' : frame.tab); // the address's
  writeHash(); // the URL, now with everything applied
  scaleNote();
  scaleUnits();
  renderCompass();
});
map.on('moveend', writeHash);
let moveRaf = 0; // once per frame while moving: the graticule's edge labels follow the frame, the scale note and units the view
map.on('move', () => { cancelAnimationFrame(moveRaf); moveRaf = requestAnimationFrame(() => { updateGraticule(); scaleNote(); scaleUnits(); }); });
map.on('zoomend', renderZoom);
map.on('dataloading', () => document.body.classList.add('loading'));
map.on('idle', () => document.body.classList.remove('loading'));
window.addEventListener('hashchange', () => location.reload());
window.map = map; // the browser tests drive the map through it; handy from the console too
window.drawing = drawing; // likewise the drawing

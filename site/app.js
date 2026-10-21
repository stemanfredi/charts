import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA, DEM_LAND, OMT_TILEJSON, ISOBATH_ZOOMS, DEPTH_SCHEMES, NO_DEPTH, DENSITY, ESRI_META, esriAttribution, gibsTiles, gibsDomainUrl, domainEnd, densityTiles, CMEMS, CMEMS_DEPTHS, drawsOf, CLASS_LEGENDS, CLASS_LABELS, EMODNET_DEPTH_STOPS } from './catalog.js';
import { buildStyle, depthRamp, OPACITY_PROP } from './style.js';
import { cmemsTile, partTimes, partLevels, domainOf, cmemsLegend } from './cmems.js';
import { workerClipper } from './clip.js';
import { drawRamp, drawColormap, drawClasses, wmsClasses } from './legend.js';
import { fmtAngle, dm, mercatorVariation, NOTE_AT, exportName } from './format.js';
import { Measure, MEASURE_LAYERS, summary, measureFeatures } from './measure.js';
import { affine, worldFile, pamXml, stacItem } from './export.js';
import { mercator } from './geo.js';
import { FETCH, memo } from './net.js';
import { gridFor, mosaic, gridTransform, geotiff } from './geotiff.js';
import { zip } from './zip.js';
import { viewFeatures } from './vector.js';
import { $, h } from './dom.js';
import { search } from './search.js';
import { chartCanvas, chartPng, pngOf } from './png.js';
import { cmemsValues, emodnetValues } from './values.js';

const byId = Object.fromEntries(ITEMS.map((it) => [it.id, it]));
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

// ---- state (mirrored in the URL hash) ---------------------------------------
const state = {
  on: new Set(ITEMS.filter((it) => it.on).map((it) => it.id)),
  variant: Object.fromEntries(ITEMS.filter((it) => it.variants).map((it) => [it.id, Object.keys(it.variants)[0]])),
  opacity: Object.fromEntries(ITEMS.filter((it) => it.opacity != null).map((it) => [it.id, it.opacity])),
  time: Math.floor(Date.now() / 36e5) * 36e5, // the map's time: the hour shown (ms), now by default
  date: '', // NASA daily: the day drawn, that of the hour shown (readHash sets it)
  depth: 0, // Copernicus layers with depth: metres below the surface (CMEMS_DEPTHS)
  period: Object.fromEntries(Object.entries(DENSITY).map(([id, d]) => [id, d.defaultPeriod])), // density datasets
  colour: '', arrows: '', // Ocean data: the entry drawing colours, the one drawing arrows ('item:variant', '' for none)
  open: new Set(['base', 'sea']),
  panel: window.innerWidth >= 1200 ? 'layers' : null, // the side panel's view; open beside the map where it leaves room
};
let view = { zoom: 4, center: [12, 41], bearing: 0 };
let measureState = '', measureBearings = false;

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
  for (const [slot, key] of [['colour', 'col'], ['arrows', 'arr']]) if (ENTRIES[slot].some((e) => e.key === q.get(key))) state[slot] = q.get(key);
  for (const it of DATA) state.on.delete(it.id); // the menus switch them (applyData)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(q.get('t') || '')) state.time = Date.parse(`${q.get('t')}:00:00Z`);
  state.date = new Date(state.time).toISOString().slice(0, 10);
  if (CMEMS_DEPTHS.includes(+q.get('dz'))) state.depth = +q.get('dz');
  for (const kv of (q.get('per') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (DENSITY[k]?.periods.includes(val)) state.period[k] = val;
  }
  if (q.has('g')) state.open = new Set(q.get('g').split(',').filter((g) => g === 'measure' || GROUPS.some((x) => x.id === g)));
  if (q.has('menu')) state.panel = { 1: 'layers', measure: 'measure' }[q.get('menu')] || null; // menu=1: Layers
  measureState = q.get('m') || '';
  measureBearings = q.get('brg') === '1';
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
  if (measure.units !== 'km') q.set('u', measure.units);
  if (measure.bearings) q.set('brg', '1');
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
// replaced; the shaded rasters (clip-* protocols) and the contours share the worker's tile cache.
// Its own caches hold copies of those tiles (256 KB each): enough for a screen's contours and
// their neighbours (a contour tile reads 3 × 3 DEM tiles), not hundreds (200 per source: 100 MB)
const demOpts = { url: DEM_TILES, encoding: 'terrarium', worker: false, cacheSize: 64 };
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
maplibregl.addProtocol('cmems', cmemsTile);
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

// ---- bottom row: credits; not for navigation, scale note, time shown, cursor position, double scale
// The scale is double, as on OpenSeaMap: km above the line, nautical miles below. Credits are
// always on screen (Esri: data attribution "always visible"; OSM likewise), on one line: what
// does not fit ends in "…", and a tap on the line shows it all.
const statusEl = $('#status');
const posEl = h('div', { class: 'pos', id: 'pos', 'aria-live': 'off' });
const shownEl = h('div', { class: 'pos shown', id: 'shown', hidden: true }); // the time (and depth) the layers show
const scales = ['metric', 'nautical'].map((unit) => new maplibregl.ScaleControl({ maxWidth: 100, unit }));
const scalesEl = h('div', { class: 'scales', id: 'scales' }, scales.map((s) => s.onAdd(map)));
// MapLibre writes nautical miles "nm" (the nanometre's symbol): NM, as on charts and in Measure
const scaleUnits = () => { for (const el of scalesEl.children) el.textContent = el.textContent.replace(/\snm$/, '\u00a0NM'); };
const scaleNoteEl = h('div', { class: 'scalenote', id: 'scalenote' });
const nfnEl = h('div', { class: 'scalenote nfn' }, 'Not for navigation'); // on every screen (About says why)
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
// credits on the left; not for navigation, the scale note, time shown, cursor position and scale on the right
statusEl.append(credits, h('div', { class: 'readout' }, nfnEl, scaleNoteEl, shownEl, posEl, scalesEl));
// the panel, zoom buttons and legends sit above the bottom row, whose height follows its credits
new ResizeObserver(() => { document.documentElement.style.setProperty('--status-h', `${statusEl.offsetHeight}px`); snapLegends(); }).observe(statusEl);

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
measure.bearings = measureBearings;

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
  refresh(id);
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
  const sat = state.on.has('sat'), ink = state.on.has('depth') && state.on.has('chart') ? ISOBATH_INK[state.variant.depth] : null;
  for (const [id, colour] of Object.entries(SAT_LABELS)) {
    const p = chartLabelPaint[id], inked = !sat && ink && id.startsWith('isobath-labels');
    map.setPaintProperty(id, 'text-color', sat ? colour : inked ? ink.text : p['text-color']);
    map.setPaintProperty(id, 'text-halo-color', sat ? 'rgba(8,16,24,0.85)' : inked ? ink.halo : p['text-halo-color']);
    map.setPaintProperty(id, 'text-halo-width', sat ? 1.4 : p['text-halo-width']);
  }
  for (const id of LINE_IDS) map.setPaintProperty(id, 'line-color', sat ? '#bfe0ff' : ink ? ink.line : chartLineColour[id]);
}
const LINE_IDS = style.layers.filter((l) => /^isobaths(-\d+)?$/.test(l.id) && l.type === 'line').map((l) => l.id);
const chartLineColour = Object.fromEntries(LINE_IDS.map((id) => [id, style.layers.find((l) => l.id === id).paint['line-color']]));
// Esri imagery credits: the service's current copyrightText (providers get renamed: Maxar → Vantor)
let esriCredited = false;
async function creditEsri() {
  if (esriCredited || !(state.on.has('sat') && state.variant.sat === 'esri')) return;
  esriCredited = true;
  try {
    const r = await fetch(ESRI_META, FETCH);
    const text = r.ok && (await r.json()).copyrightText;
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
//   legend(id, el) draws its legend on the canvas el
//   record(it)     promise of what the GIS export records of it, beyond its variant, from it.at:
//                  the state as the view was captured (snapshot)
//   values(it, box) promise of its values as GeoTIFF over [west, south, east, north], or null:
//                  in the pictures only
const variantOf = (id) => state.variant[id] || Object.keys(CMEMS[id])[0];
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// NASA publishes each layer after its own delay (true colour within a day): GIBS says the newest
// date of the layer shown, the last day the map's time can take while it is on
const gibsEnd = {}; // GIBS key → promise of its newest date, or null if unknown
function latestGibs(key) {
  return memo(gibsEnd, key, () => fetch(gibsDomainUrl(key, shiftDay(today(), -60), today()), FETCH)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(domainEnd)).catch(() => null);
}

// Copernicus: each dataset at its own step for the hour shown, its time resolution (cmems.js draws
// the tiles)
const cmemsDepth = (id) => !!CMEMS[id][variantOf(id)].depth;
// the time and level the item draws (now, or at: { variant, t, depth } as captured): its regional part's, drawn on top
async function cmemsDrawn(id, at = { variant: variantOf(id), t: state.time, depth: state.depth }) {
  const [times, levels] = await Promise.all([partTimes(id, at.variant, at.t), partLevels(id, at.variant, at.depth)]);
  const k = times.length - 1 - [...times].reverse().findIndex((pt) => pt != null);
  return { time: times[k], level: levels[k] };
}

// a classed layer's classes, from its services' JSON legends (legend.js wmsClasses): a class drawn
// by several (an area, and a point where it is too small) once, with its fill and its symbol; the
// symbols loaded as pictures (one that does not load is left out, its class kept)
const classLegends = {}, icons = {};
const iconOf = (url) => memo(icons, url, () => fetch(url, FETCH).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then(createImageBitmap));
function classesOf(urls) {
  return memo(classLegends, urls.join(' '), async () => {
    const all = (await Promise.all(urls.map((url) => fetch(url, FETCH).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(wmsClasses)))).flat();
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
  emodnet: {
    show: (id) => applyItem(id),
    legend(id, el) {
      const v = state.variant[id], stops = EMODNET_DEPTH_STOPS[v];
      if (el.dataset.key === v) return;
      el.dataset.key = v;
      drawRamp(el, byId[id].label, 'm · not linear', stops);
      el.setAttribute('aria-label', `${byId[id].label} legend: ${stops.map(([d]) => d).join(', ')} metres`);
    },
    record: async () => ({}),
    values: (it, box) => emodnetValues(box),
  },
  // a classed layer its service draws (seabed substrate): its legend, the service's classes and colours
  classes: {
    show: (id) => applyItem(id),
    legend(id, el) {
      // the URL of its service's legend, the URLs of several, or the classes themselves
      const src = CLASS_LEGENDS[id](state.variant[id]), urls = typeof src === 'string' ? [src] : typeof src[0] === 'string' ? src : null;
      const key = urls ? urls.join(' ') : `${id}:${state.variant[id]}`;
      if (el.dataset.key === key) return;
      el.dataset.key = key;
      (urls ? classesOf(urls) : Promise.resolve(src)).then((cls) => {
        if (el.dataset.key !== key) return; // switched meanwhile
        drawClasses(el, byId[id].label, [byId[id].variants?.[state.variant[id]], byId[id].legendSub].filter(Boolean).join(' · '), cls);
        el.setAttribute('aria-label', `${byId[id].label} legend: ${cls.map((c) => c.label).join(', ')}`);
        renderLegends(); // drawn after the stack was laid out: lay it out again with its size
      }, (e) => { el.dataset.key = ''; console.warn('legend classes:', e.message); });
    },
    record: async () => ({}),
    values: null, // the service draws it
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
    legend(id, el) {
      const d = DENSITY[id], key = `${state.variant[id]}|${state.period[id]}`;
      if (el.dataset.key === key) return; // drawn as it is
      el.dataset.key = key;
      drawRamp(el, d.title, `${d.unit} · ${d.types[state.variant[id]]} · ${d.periodLabel(state.period[id])}`, d.stops);
      el.setAttribute('aria-label', `${d.title} legend: ${d.stops.map(([v]) => v).join(', ')} ${d.unit}`);
    },
    record: async (it) => ({ period: it.at.period }),
    values: null, // EMODnet's WMS serves pictures
  },
  // NASA daily: the day of the time shown (UTC). Drawn only once its newest day is known, and not
  // after it (the time is brought within it), so it never asks for a day not published yet
  gibs: {
    time: () => 'day',
    async show(id) {
      const key = state.variant[id], end = await latestGibs(key), day = dayOf(state.time);
      if (key !== state.variant[id] || !state.on.has(id) || (end && day > end)) return; // switched meanwhile, or not published yet
      if (day !== state.date) {
        state.date = day;
        for (const k of Object.keys(GIBS)) map.getSource(`gibs-${k}`).setTiles(gibsTiles(k, day));
      }
      applyItem(id);
    },
    range: (id) => latestGibs(state.variant[id]).then((end) => [[null, end && Date.parse(`${end}T23:00:00Z`)]]),
    record: async (it) => ({ date: it.at.date }),
    values: null, // imagery
  },
  // Copernicus Marine: the hour shown (daily means: its day), at the depth shown for variables with depth
  cmems: {
    time: (id) => (CMEMS[id][variantOf(id)].daily ? 'day' : 'hour'),
    depth: cmemsDepth,
    show(id) {
      const depth = cmemsDepth(id) ? state.depth : 0; // no new tiles for a depth change it ignores
      map.getSource(`cmems-${id}`).setTiles([`cmems://${id}/${variantOf(id)}/${looks[id] || 'both'}/${state.time}/${depth}/{z}/{x}/{y}`]);
      applyItem(id);
    },
    // each dataset from its first step to the end of its last (a daily mean covers its day, a
    // 3-hourly step three hours)
    range: (id) => Promise.all(CMEMS[id][variantOf(id)].parts.map((p) => domainOf(p).then(({ time }) =>
      [Math.min(...time.map((r) => r.start)), Math.max(...time.map((r) => r.end + Math.max(0, r.step - 36e5)))], () => null))),
    // the colours and unit: the time and depth are the map's, said once beside the coordinates
    legend(id, el) {
      const v = CMEMS[id][variantOf(id)];
      if (el.dataset.key === variantOf(id)) return;
      el.dataset.key = variantOf(id);
      cmemsLegend(id, variantOf(id))
        .then((cm) => {
          // '<' below the scale only where values go on below it (not under 0 m, 0 m/s)
          drawColormap(el, v.label, v.unit, cm, [v.log || v.range[0] + (v.offset || 0) < 0, true], v.log);
          el.setAttribute('aria-label', `${v.label} legend${v.unit ? `, ${v.unit}` : ''}`);
          renderLegends(); // drawn after the stack was laid out: lay it out again with its size
        })
        .catch((err) => { el.dataset.key = ''; console.warn('legend colour map:', err.message); });
    },
    // the time and level it drew (its regional part's: its own step and level)
    async record(it) {
      const { time, level } = await cmemsDrawn(it.id, it.at);
      return { draws: it.at.draws, time: time == null ? undefined : new Date(time).toISOString(), depth: level == null ? undefined : +Math.abs(+level).toFixed(2) };
    },
    values: (it, box) => cmemsValues(it.id, it.at, box), // from its datasets' Zarr stores
  },
};
// every kind says how it is drawn and how it is exported, and every item's kind is one of them: a
// gap is an error on the console, which fails the browser tests
for (const [k, kind] of Object.entries(KINDS)) {
  for (const f of ['show', 'record']) if (typeof kind[f] !== 'function') console.error(`kind ${k}: no ${f}()`);
  if (!('values' in kind)) console.error(`kind ${k}: no values() (null: in the pictures only)`);
}
for (const it of ITEMS) if (it.kind && !KINDS[it.kind]) console.error(`${it.id}: kind ${it.kind} is not one of KINDS`);
const kindOf = (id) => KINDS[byId[id].kind];
// draws an item as the state says; a kind asks its service only while the item is on
const refresh = (id) => (state.on.has(id) && kindOf(id) ? kindOf(id).show(id) : applyItem(id));
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
    const was = state.on.has(it.id) ? `${looks[it.id]}:${variantOf(it.id)}` : '';
    const look = it.id === ci ? (it.id === ai ? 'both' : 'colour') : it.id === ai ? 'arrows' : '';
    if (look) {
      state.on.add(it.id);
      looks[it.id] = look;
      if (it.variants) state.variant[it.id] = it.id === ci ? cv : av;
    } else state.on.delete(it.id);
    if ((look && `${look}:${variantOf(it.id)}`) !== was) refresh(it.id);
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
const depthWords = (d) => (d ? `≈ ${d} m` : 'surface'); // each model at its level nearest the depth chosen
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
  const hour = (t) => Math.floor(t / 36e5) * 36e5, starts = spans.map((s) => s[0]).filter(Number.isFinite), ends = spans.map((s) => s[1]).filter(Number.isFinite);
  const end = ends.length ? hour(Math.min(...ends)) : RANGE[1];
  range = [Math.min(end, starts.length ? hour(Math.max(...starts)) : RANGE[0]), end];
  if (state.time !== within(state.time)) setTime(state.time); else renderWhen();
}
const within = (t) => Math.min(range[1], Math.max(range[0], Math.floor(t / 36e5) * 36e5));
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
  // beside the coordinates: "Today 18:00 · ≈ 100 m" (each model at its level nearest the depth
  // chosen), or "Wed 21" when only daily layers are on: their day, in UTC as the products have it
  const tz = hr ? undefined : 'UTC', same = (a) => a.toLocaleDateString('en', { timeZone: tz }) === d.toLocaleDateString('en', { timeZone: tz });
  const day = same(new Date()) ? 'Today' // "Wed 21" in every locale
    : `${d.toLocaleDateString([], { weekday: 'short', timeZone: tz })} ${d.toLocaleDateString('en', { day: 'numeric', timeZone: tz })}`;
  shown.textContent = [[day, hr ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' '),
    deep ? depthWords(state.depth) : ''].filter(Boolean).join(' · ');
  shown.title = `Time shown: ${d.toLocaleString([], hr ? { dateStyle: 'full', timeStyle: 'short' } : { dateStyle: 'full', timeZone: 'UTC' })}, set in Layers`;
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
  png: ['M4 5h16v14H4z', 'm4 17 5-5 4 4 3-3 4 4', 'M17 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'], // a picture
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
    variant = seg('Depth colours', { atlas: ['Darker = deeper', it.variants.atlas], nautical: ['Darker = shallower', it.variants.nautical] }, () => state.variant.depth, (v) => setVariant('depth', v));
    segs.push(variant);
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
    picks[slot] = h('select', { 'aria-label': label, onchange: (e) => { state[slot] = e.target.value; applyData(); writeHash(); renderMenu(); } },
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
  for (const s of segs) s.render();
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
function renderLegends() {
  const on = (id) => state.on.has(id);
  const want = [];
  if (on('depth') && on('chart') && map.getZoom() < 13) want.push('depth');
  for (const it of ITEMS) if (on(it.id) && kindOf(it.id)?.legend) { kindOf(it.id).legend(it.id, legendEl(it.id)); want.push(it.id); }
  legendWant = want;
  if (want.includes('depth') && legendEl('depth').dataset.key !== state.variant.depth) {
    const el = legendEl('depth');
    el.dataset.key = state.variant.depth;
    drawRamp(el, 'Depth shading', 'm · approximate (DEM)', depthStops(), { colour: NO_DEPTH, label: 'lakes: no depth · lagoons: shown as 0–5 m' });
    el.setAttribute('aria-label', `Depth shading legend: ${depthStops().map(([d]) => d).join(', ')} metres`);
  }
  legends.replaceChildren(...(on('legend') ? want.map((id) => legendEls[id]) : []));
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

// ---- measure view (in the side panel): tools, units, saved measurements -----------------
const TOOL = { ruler: ['Ruler', 'Distance and bearing (R)'], area: ['Area', 'Area and perimeter (A)'], ring: ['Ring', 'Range ring: centre, then radius (C)'] };
const TIP = { ruler: 'Click to add points', area: 'Click to add corners', ring: 'Click the centre, then the edge' };
const measureView = $('#mview');
const toolBtns = Object.entries(TOOL).map(([k, [label, title]]) => h('button', { type: 'button', 'data-tool': k, 'aria-pressed': 'false', title,
  onclick: () => { if (small()) setPanel(null); measure.tool === k ? measure.finish() : measure.start(k); } }, icon(...ICON[k]), label)); // phones: the sheet makes way for the map
const unitSeg = seg('Distance units', { km: ['km · m', 'Kilometres and metres'], nm: ['Nautical miles', 'Nautical miles'] }, () => measure.units, (u) => measure.setUnits(u));
const measureList = h('ul', { class: 'mlist' });
// bearings beside each leg's length: off unless asked for (most measuring is distance)
const brgSwitch = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: 'm-bearings', onchange: (e) => measure.setBearings(e.target.checked) });
measureView.append(h('div', { class: 'tools3' }, toolBtns), h('h2', {}, 'Units'), unitSeg,
  h('div', { class: 'item' }, h('div', { class: 'line' }, h('label', { class: 'name', for: 'm-bearings' }, 'Bearings (°T)'), brgSwitch)),
  h('h2', {}, 'Measurements'), measureList,
  h('p', { class: 'note' }, 'Geodesic on WGS 84; bearings true (°T).', h('span', { class: 'keys-hint' }, ' Double-click or Enter finishes; Backspace undoes; Esc cancels.')));
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
  brgSwitch.checked = measure.bearings;
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
const VIEWS = { layers: [$('#b-layers'), $('#lview'), 'Layers'], measure: [$('#b-measure'), measureView, 'Measure'] };
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

// Link, PNG and GIS act at once (no menu): the link button says "Copied" for a moment
$('#link').addEventListener('click', (e) => copyLink(e.currentTarget));
$('#png').addEventListener('click', (e) => exportPng(e.currentTarget));
$('#zip').addEventListener('click', (e) => exportZip(e.currentTarget));
async function copyLink(b) {
  writeHashNow(); // the link must be the view as it is now
  try { await navigator.clipboard.writeText(location.href); flash(b, 'Copied'); } catch { prompt('Copy this link', location.href); }
}
// a button's own label and tooltip, kept while it says something else
const labelOf = (b) => { b.dataset.label ||= b.querySelector('span').textContent; b.dataset.title ||= b.title; return b.dataset; };
function flash(b, text, title = '', ms = 1200) { // the button's own text says it, for a moment; its tooltip why
  const own = labelOf(b);
  clearTimeout(b.flashTimer);
  b.querySelector('span').textContent = text;
  b.title = title || own.title;
  b.flashTimer = setTimeout(() => { b.querySelector('span').textContent = own.label; b.title = own.title; }, ms);
}
const about = $('#about');
$('#b-about').addEventListener('click', () => about.showModal());
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

const q = search(map, maplibregl.Marker); // the search box: / goes to it

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
  scaleNoteEl.textContent = v > NOTE_AT ? `scale varies ${(v * 100).toFixed(0)}%${small() ? '' : ' across the view'}` : ''; // short on a phone: one line
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
    map.once('render', async () => {
      try {
        const left = await fn(map.getCanvas());
        done(left?.length ? 'Partial' : '', left?.length ? `Saved without ${left.join('; ')}` : '');
      } catch (e) { failed(e); }
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
// its kind's record and values). Read at the moment of capture, so nothing is read after an await.
function snapshot(src) {
  writeHashNow(); // the link is the view as it is now
  const when = new Date(), c = map.getCenter(), W = src.clientWidth, H = src.clientHeight;
  const timed = timeOn().length > 0, hr = hourly(), depth = depthOn().length ? state.depth : null, t = state.time;
  const layers = drawnItems().map((it) => ({ ...it, at: { variant: state.variant[it.id] ?? (CMEMS[it.id] ? variantOf(it.id) : undefined), t, depth: state.depth, period: state.period[it.id], date: state.date, draws: looks[it.id] } }));
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
// raster/<key>.tif: the clipped DEM an item draws, in metres, at the zoom of the tiles on screen
// (256 px DEM tiles at z show at map zoom z − 1, clip.js)
const RASTERS = [
  { key: 'depth', items: ['depth'], clip: seaClip, native: DEM_SEA.native, max: DEM_SEA.max, title: 'Depth',
    description: 'Seabed elevation in metres, negative below sea level, as the depth shading draws it: Terrarium DEM cut to the OSM coastline, pits and tile seams corrected; sea the DEM calls dry is -1. No data on land, lakes and inland water at sea level' },
  { key: 'elevation', items: ['relief', 'contours'], clip: landClip, native: DEM_LAND.native, max: DEM_LAND.max, title: 'Land elevation',
    description: 'Land elevation in metres, as the relief shading and land contours use it: Terrarium DEM (SRTM on land) cut to the OSM coastline. No data in the sea' },
];
const featureCollection = (name, features) => `${JSON.stringify({ type: 'FeatureCollection', name, features })}\n`;

// polygon-clipping (vector.js) loads on the first ZIP export, not with the page: a script from
// the pinned URL in index.html, checked by the browser against its hash (tools/deps.mjs)
const libs = {};
const polygonClipping = () => memo(libs, 'polygon-clipping', () => new Promise((resolve, reject) => {
  const el = $('#polygon-clipping'), { content: src, dataset: { integrity } } = el;
  document.head.append(h('script', { src, integrity, crossorigin: 'anonymous', onload: () => resolve(globalThis.polygonClipping),
    onerror: (e) => { e.target.remove(); reject(new Error('polygon-clipping did not load')); } }));
}));
function exportZip(b) {
  let clipping;
  onFrame(b, async (src) => {
    const s = snapshot(src), { when, name, corners, layers } = s; // the view as captured, however long the rest takes
    const plain = h('canvas', { width: src.width, height: src.height });
    plain.getContext('2d').drawImage(src, 0, 0);
    const chart = chartCanvas(src, s);
    const transform = affine(corners, src.width, src.height);
    // vector/<item>.geojson for each item drawn with features in view, and the measurements
    const vectors = [];
    for (const it of layers) {
      const fs = viewFeatures(vectorPieces(it.id), corners, clipping);
      if (fs.length) vectors.push({ key: `vector/${it.id}`, title: it.label, file: `vector/${it.id}.geojson`, data: featureCollection(it.label, fs), n: fs.length, how: 'clipped to the view' });
      it.assets = fs.length ? [`vector/${it.id}`] : []; // in item.json: the assets that hold this layer as data (keyed by path: a layer may be called chart, as the overview is)
    }
    // raster/<key>.tif for each elevation grid an item drawn reads
    const rasters = [];
    for (const r of RASTERS) {
      if (!layers.some((l) => r.items.includes(l.id))) continue;
      const grid = gridFor(corners.map(mercator), Math.max(0, Math.min(Math.floor(s.zoom + 1), r.max))), n = 2 ** grid.z;
      const tiles = await Promise.all(grid.tiles.map(([tx, ty]) => r.clip.metres(grid.z, ((tx % n) + n) % n, ty)));
      const transform = gridTransform(grid);
      rasters.push({ ...r, file: `raster/${r.key}.tif`, asset: `raster/${r.key}`, data: geotiff(mosaic(grid, tiles), grid.w, grid.h, transform, { description: r.description }), grid, transform });
      for (const l of layers) if (r.items.includes(l.id)) l.assets.push(`raster/${r.key}`);
    }
    // the values of each layer drawn whose kind has them (Copernicus), as the view was captured
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const left = []; // values that could not be read: the rest is saved, the button says what is missing
    const values = (await Promise.all(layers.filter((l) => kindOf(l.id)?.values).map((l) => kindOf(l.id).values(l, box)
      .then((rs) => { l.assets.push(...rs.map((r) => r.key)); return rs; }, (e) => { console.warn(`${l.label} values:`, e.message); left.push(`${l.label} values (${e.message})`); return []; })))).flat();
    for (const l of layers) Object.assign(l, await kindOf(l.id)?.record(l)); // what each drew: period, day, time, depth
    const measured = measureFeatures(measure.list);
    if (measured.length) vectors.push({ key: 'vector/measurements', title: 'Measurements', file: 'vector/measurements.geojson', data: featureCollection('Measurements', measured), n: measured.length, how: 'whole, geodesic values in metres' });
    const item = stacItem({
      id: name, title: `Chart · ${s.at}`, when, data: s.time, corners, zoom: s.zoom, bearing: s.bearing, layers,
      attribution: s.credits, link: s.link,
      assets: {
        map: { href: './map.png', type: 'image/png', title: 'The map as drawn, georeferenced (world file map.pgw, CRS in map.png.aux.xml)', roles: ['visual'],
          'proj:code': 'EPSG:3857', 'proj:shape': [src.height, src.width], 'proj:transform': transform },
        worldfile: { href: './map.pgw', type: 'text/plain', title: 'World file of map.png', roles: ['metadata'] },
        crs: { href: './map.png.aux.xml', type: 'application/xml', title: 'CRS of map.png (GDAL sidecar)', roles: ['metadata'] },
        chart: { href: './chart.png', type: 'image/png', title: 'The map with legends, credits and scale, its details in text fields: the PNG export', roles: ['overview'] },
        ...Object.fromEntries(rasters.map((r) => [r.asset, { href: `./${r.file}`, type: 'image/tiff; application=geotiff', title: `${r.title}: DEM tiles of zoom ${r.grid.z}${r.grid.z > r.native ? `, upsampled from zoom ${r.native}` : ''}, over the view's bounding box`, description: r.description, roles: ['data'],
          'proj:code': 'EPSG:3857', 'proj:shape': [r.grid.h, r.grid.w], 'proj:transform': r.transform, bands: [{ data_type: 'float32', nodata: 'nan', unit: 'm' }] }])),
        ...Object.fromEntries(vectors.map((v) => [v.key, { href: `./${v.file}`, type: 'application/geo+json', title: `${v.title}: ${v.n} feature${v.n === 1 ? '' : 's'}, ${v.how}`, roles: ['data'] }])),
        ...Object.fromEntries(values.map((r) => [r.key, { href: `./${r.file}`, type: 'image/tiff; application=geotiff', title: r.title, description: r.description, roles: ['data'],
          'proj:code': 'EPSG:4326', 'proj:shape': [r.h, r.w], 'proj:transform': r.transform, bands: r.names.map((n, k) => ({ name: n, data_type: 'float32', nodata: 'nan', unit: r.units[k] })) }])),
      },
    });
    const [mapPng, chartFile] = await Promise.all([pngOf(plain), chartPng(chart)]);
    download(await zip([
      { name: 'item.json', data: `${JSON.stringify(item, null, 2)}\n` },
      { name: 'map.png', data: mapPng },
      { name: 'map.pgw', data: worldFile(transform) },
      { name: 'map.png.aux.xml', data: pamXml() },
      { name: 'chart.png', data: chartFile },
      ...vectors.map((v) => ({ name: v.file, data: v.data })),
      ...rasters.map((r) => ({ name: r.file, data: r.data })),
      ...values.map((r) => ({ name: r.file, data: r.data })),
    ], when), `${name}.zip`);
    return left;
  }, async () => { clipping = await polygonClipping(); });
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
  applyData();
  for (const it of ITEMS) refresh(it.id);
  depthColours();
  labelPaint();
  creditEsri();
  measure.load(measureState);
  updateGraticule();
  renderMenu();
  renderMeasures();
  ready = true;
  setPanel(state.panel); // also writes the URL, now with everything applied
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

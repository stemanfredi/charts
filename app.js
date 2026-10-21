import * as maplibregl from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import { GROUPS, ITEMS, GIBS, DEM_TILES, DEM_SEA, DEM_LAND, OMT_TILEJSON, ISOBATH_ZOOMS, OPACITY_PROP, DEPTH_SCHEMES, depthRamp, NO_DEPTH, DENSITY, ESRI_META, esriAttribution, buildStyle, defaultDate, gibsTiles, gibsDomainUrl, domainEnd, densityTiles, CMEMS, CMEMS_DEPTHS, drawsOf, cmemsStacUrl, storedVariables } from './catalog.js';
import { cmemsTile, partTimes, partLevels, domainOf, cmemsLegend, regionOf } from './cmems.js';
import { workerClipper } from './clip.js';
import { drawRamp, drawColormap } from './legend.js';
import { fmtAngle, dm, mercatorVariation, niceLen, parseLatLon, exportName } from './format.js';
import { Measure, MEASURE_LAYERS, summary, measureFeatures } from './measure.js';
import { affine, mercator, worldFile, pamXml, stacItem, pngText } from './export.js';
import { gridFor, mosaic, gridTransform, geotiff } from './geotiff.js';
import { zip } from './zip.js';
import { openStore, timeScale, nearest, cellsOf, readCells } from './zarr.js';
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
  date: defaultDate(), // NASA daily: the day drawn, that of the hour shown or the newest published before it
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
  if (!q.has('col') && !q.has('arr')) fromLayers();
  for (const it of DATA) state.on.delete(it.id); // the menus switch them (applyData)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(q.get('t') || '')) state.time = Date.parse(`${q.get('t')}:00:00Z`);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('d') || '')) state.time = Date.parse(`${q.get('d')}T12:00:00Z`); // NASA date, links from before t=
  state.date = new Date(state.time).toISOString().slice(0, 10);
  if (CMEMS_DEPTHS.includes(+q.get('dz'))) state.depth = +q.get('dz');
  if (DENSITY.traffic.periods.includes(q.get('y'))) state.period.traffic = q.get('y'); // links from before per=
  for (const kv of (q.get('per') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (DENSITY[k]?.periods.includes(val)) state.period[k] = val;
  }
  if (q.has('g')) state.open = new Set(q.get('g').split(',').filter((g) => g === 'measure' || GROUPS.some((x) => x.id === g)));
  if (q.has('menu')) state.panel = { 1: 'layers', measure: 'measure' }[q.get('menu')] || null; // menu=1 from older links: Layers
  measureState = q.get('m') || '';
  measureBearings = q.get('brg') === '1';
  return q.get('u');
}

// links from before the menus switched the layers on (on=waves,currents): the last that draws only
// colours takes the colours, else currents; wind takes the arrows, else currents
function fromLayers() {
  const on = [...state.on].map((id) => byId[id]).filter((it) => it.group === 'data').map((it) => ({ it, v: state.variant[it.id] || variantsOf(it)[0] }));
  const draws = (e) => drawsOfEntry(e.it, e.v).join();
  const pick = (e) => (e ? `${e.it.id}:${e.v}` : '');
  state.colour = pick(on.filter((e) => draws(e) === 'colour').at(-1) || on.find((e) => draws(e) === 'colour,arrows'));
  state.arrows = pick(on.find((e) => draws(e) === 'arrows') || on.find((e) => draws(e) === 'colour,arrows'));
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
const attribution = new maplibregl.AttributionControl({ compact: false });
const credits = h('div', { class: 'credits' }, attribution.onAdd(map));
// a tap unfolds them only when they are cut ("…"), and folds them again; the hint says which
const cut = () => { const t = $('.maplibregl-ctrl-attrib-inner', credits); return !!t && t.scrollWidth > t.clientWidth; };
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
// ---- layers from a data service, by kind (catalog.js item.kind) ------------------------------
// A kind points its item's source at the map's state and says what of that state the item uses;
// the rest of the app asks the kind, never the item's id:
//   show(id)       draws the item as the state says: its source, then its layers' visibility
//   time(id)       'hour' or 'day' if it changes with the map's time; depth(id): drawn at the map's depth
//   range(id)      promise of its datasets' spans, [[start, end]] in ms (null where not known)
//   controls(it)   elements under its row; render(it, el) brings them up to date
//   legend(id, el) draws its legend on the canvas el
//   record(it)     promise of what the GIS export records of it, beyond its variant
const variantOf = (id) => state.variant[id] || Object.keys(CMEMS[id])[0];
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// NASA publishes each layer after its own delay (true colour within a day): GIBS says the newest
// date of the layer shown, the last day the map's time can take while it is on
const gibsEnd = {}; // GIBS key → promise of its newest date, or null if unknown
function latestGibs(key) {
  return (gibsEnd[key] ||= fetch(gibsDomainUrl(key, shiftDay(today(), -60), today()), { credentials: 'omit' })
    .then((r) => (r.ok ? r.text() : null))
    .then((t) => (t ? domainEnd(t) : null))
    .catch(() => { delete gibsEnd[key]; return null; }));
}

// Copernicus: each dataset at its own step for the hour shown, its time resolution (cmems.js draws
// the tiles)
const cmemsDepth = (id) => !!CMEMS[id][variantOf(id)].depth;
// the time and level the item draws: its regional part's, drawn on top
async function cmemsDrawn(id) {
  const [times, levels] = await Promise.all([partTimes(id, variantOf(id), state.time), partLevels(id, variantOf(id), state.depth)]);
  const k = times.length - 1 - [...times].reverse().findIndex((pt) => pt != null);
  return { time: times[k], level: levels[k] };
}

const KINDS = {
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
      const d = DENSITY[id];
      drawRamp(el, d.title, `${d.unit} · ${d.types[state.variant[id]]} · ${d.periodLabel(state.period[id])}`, d.stops);
      el.setAttribute('aria-label', `${d.title} legend: ${d.stops.map(([v]) => v).join(', ')} ${d.unit}`);
    },
    record: async (it) => ({ period: state.period[it.id] }),
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
    record: async () => ({ date: state.date }),
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
      const { time, level } = await cmemsDrawn(it.id);
      return { draws: looks[it.id], time: time == null ? undefined : new Date(time).toISOString(), depth: level == null ? undefined : +Math.abs(+level).toFixed(2) };
    },
  },
};
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
  renderMenu();
}
function setTime(t) {
  state.time = within(t); // on the hour, at a time every layer on has
  for (const it of timeOn()) kindOf(it.id).show(it.id);
  writeHash();
  renderMenu();
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
    deep ? (state.depth ? `≈ ${state.depth} m` : 'surface') : ''].filter(Boolean).join(' · ');
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

function renderMenu() {
  const z = map.getZoom();
  for (const it of ITEMS) {
    const r = rows[it.id];
    if (!r) continue; // Ocean data: below
    const on = state.on.has(it.id);
    if (it.group === 'base') r.input.setAttribute('aria-checked', String(on));
    else r.input.checked = on;
    r.controls.hidden = !on || !(it.variants || kindOf(it.id)?.controls);
    if (on) kindOf(it.id)?.render?.(it, r.controls);
    if (r.infos && r.more.getAttribute('aria-expanded') === 'true') r.infos[it.id].hidden = !on;
    const low = it.minzoom && z < it.minzoom, high = it.maxzoom && z >= it.maxzoom + 1;
    r.row.classList.toggle('dim', !!(on && (low || high)));
    const hint = r.row.querySelector('.hint');
    if (hint) hint.textContent = !on ? '' : low ? `zoom ${it.minzoom}+` : high ? `zoom ≤ ${it.maxzoom}` : '';
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
  if (want.includes('depth')) {
    const el = legendEl('depth');
    drawRamp(el, 'Depth shading', 'm · approximate (DEM)', depthStops(), { colour: NO_DEPTH, label: 'lakes: no depth · lagoons: shown as 0–5 m' });
    el.setAttribute('aria-label', `Depth shading legend: ${depthStops().map(([d]) => d).join(', ')} metres`);
  }
  legends.replaceChildren(...(on('legend') ? want.map((id) => legendEls[id]) : []));
}
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

// ---- search: coordinates are read here; place names go to Photon (OpenStreetMap data) ---------
const PHOTON = 'https://photon.komoot.io/api/';
// what a sea chart is mostly searched for comes first: places, the coast and the sea (capes, bays,
// straits, beaches, harbours), marinas, ferry terminals, lighthouses, piers; then the rest (streets,
// hotels, cafés…), in Photon's order. Nothing is left out.
const SEA_TAGS = ['place', 'natural', 'water', 'waterway', 'leisure:marina', 'leisure:slipway', 'amenity:ferry_terminal',
  'man_made:lighthouse', 'man_made:pier', 'man_made:breakwater', 'landuse:harbour', 'landuse:port'];
// what a result is, in a word: a road of any class is a street; "yes" (a building, an office) says its key
const resultKind = (p) => (p.osm_key === 'highway' ? 'street' : (p.osm_value === 'yes' ? p.osm_key : p.osm_value || '').replace(/_/g, ' '));
const seaFirst = ({ properties: p }) => (SEA_TAGS.some((t) => t === p.osm_key || t === `${p.osm_key}:${p.osm_value}`) ? 0 : 1);
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
  const url = `${PHOTON}?${new URLSearchParams({ q: text, limit: 12, lang: 'en', lat: c.lat.toFixed(1), lon: c.lng.toFixed(1) })}`;
  try {
    const r = await fetch(url, { signal: searchCtl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // the same name, kind and town once (a port's ferry terminals); the sea's first, seven shown
    const seen = new Set();
    const features = (await r.json()).features
      .filter(({ properties: p }) => { const k = `${(p.name || '').toLowerCase()}|${resultKind(p)}|${p.city}`; return !seen.has(k) && seen.add(k); })
      .sort((a, b) => seaFirst(a) - seaFirst(b)).slice(0, 7);
    showResults(features.map((f) => {
      const p = f.properties, e = p.extent; // [west, north, east, south]
      return { go: true, name: p.name || p.street || text, at: f.geometry.coordinates,
        where: [resultKind(p), p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(' · '),
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

// ---- PNG export: the map as on screen, without the controls; its details in the file's text fields
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
// the file names and the STAC id: time and the view's centre (format.js)
const fileName = (when) => { const c = map.getCenter(); return exportName(when, c.lat, c.lng); };
// The map as on screen without the controls, the same size: the credits bottom left (all of
// them: a picture cannot be tapped), the legends above them; bottom right, where it is (centre,
// zoom, projection, the data's time and depth) beside the scale; the north arrow top right. Where
// that leaves the credits too little room (a phone), they take the width, the rest above them. Its details (where, what,
// when, whose) go with it as the PNG's text fields, read now: the view as captured.
function chartCanvas(src, when) {
  const dpr = src.width / src.clientWidth, W = src.clientWidth, H = src.clientHeight;
  const out = h('canvas', { width: src.width, height: src.height });
  const g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  g.scale(dpr, dpr);
  const INK = '#2b3a46', BACK = 'rgba(255,255,255,0.85)';
  const box = (x, y, w, hh) => { g.fillStyle = BACK; g.beginPath(); g.roundRect(x, y, w, hh, 4); g.fill(); };
  g.font = '11px system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  // double scale bar at the centre latitude (Web Mercator scale varies with latitude), bottom
  // right as on screen: km above a shared line, nautical miles below it
  const lat = map.getCenter().lat;
  const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const bar = (unitM) => { const len = niceLen((120 * mpp) / unitM) * unitM; return { len, px: len / mpp }; };
  const km = bar(1), nm = bar(1852);
  const v = scaleVariation();
  const kmText = `${km.len < 1000 ? `${+km.len.toPrecision(6)} m` : `${+(km.len / 1000).toPrecision(6)} km`} at ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}${v > NOTE_AT ? ` · scale varies ${(v * 100).toFixed(0)}% across the view` : ''}`;
  const nmText = `${+(nm.len / 1852).toPrecision(6)} NM`;
  const bw = Math.max(km.px, nm.px, g.measureText(kmText).width) + 20;
  // where it is, and when the data is (as the reading beside the coordinates, with the date and time zone)
  const c = map.getCenter();
  const info = [`${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')}`, `zoom ${map.getZoom().toFixed(1)}`, 'Web Mercator',
    timeOn().length ? (hourly() ? new Date(state.time).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
      : new Date(state.time).toLocaleDateString([], { dateStyle: 'medium', timeZone: 'UTC' })) : '',
    depthOn().length ? shown.textContent.split(' · ').pop() : ''].filter(Boolean).join(' · ');
  // a block of text on its backing, wrapped to width w, its bottom at y, from x (or to x, right):
  // its top
  const block = (text, colour, x, y, w, right = false) => {
    const lines = [];
    for (const item of text.split(' · ')) { // as many items to a line as fit, measured; an item stays whole
      const line = lines.length ? `${lines.at(-1)} · ${item}` : item;
      if (lines.length && g.measureText(line).width <= w - 12) lines[lines.length - 1] = line; else lines.push(item);
    }
    const hh = lines.length * 14 + 6, bw2 = Math.min(w, Math.max(...lines.map((t) => g.measureText(t).width)) + 12), x0 = right ? x - bw2 : x;
    box(x0, y - hh, bw2, hh);
    g.fillStyle = colour;
    lines.forEach((t, n) => g.fillText(t, x0 + 6, y - hh + 15 + n * 14, w - 12));
    return y - hh;
  };
  const infoW = g.measureText(info).width + 12, beside = W - 20 - bw - 12 - infoW - 8;
  let sb = H - 10, top; // the scale's bottom; the bottom of the legends' stack
  if (beside >= 200) { // one row: the credits, where it is, the scale
    top = block(attributionText(), '#5d6d79', 10, H - 10, beside);
    block(info, INK, W - 10 - bw - 8, H - 10, infoW, true);
  } else { // a phone: the credits across the bottom, where it is above them (right), the scale above that
    sb = block(info, INK, W - 10, block(attributionText(), '#5d6d79', 10, H - 10, W - 20) - 6, W - 20, true) - 6;
    top = sb - 48;
  }
  box(W - 10 - bw, sb - 48, bw, 48);
  g.strokeStyle = INK;
  g.lineWidth = 2;
  for (const [b, tick] of [[km, -6], [nm, 6]]) {
    const bx = W - 20 - b.px;
    g.beginPath(); g.moveTo(bx, sb - 24 + tick); g.lineTo(bx, sb - 24); g.lineTo(bx + b.px, sb - 24); g.lineTo(bx + b.px, sb - 24 + tick); g.stroke();
  }
  g.fillStyle = INK;
  g.textAlign = 'right';
  g.fillText(kmText, W - 20, sb - 34);
  g.fillText(nmText, W - 20, sb - 6);
  g.textAlign = 'left';
  // every legend of the drawn layers, stacked above (as on screen, even with the switch off)
  let ly = top - 6;
  for (const id of [...legendWant].reverse()) {
    const el = legendEls[id], lw = parseFloat(el.style.width), lh = parseFloat(el.style.height);
    if (!lw || !lh) continue; // not drawn yet (a colour map still loading)
    ly -= lh;
    g.drawImage(el, 10, ly, lw, lh);
    ly -= 6;
  }
  // north arrow
  g.save();
  g.translate(W - 28, 34);
  g.rotate((-map.getBearing() * Math.PI) / 180);
  g.fillStyle = BACK; g.beginPath(); g.arc(0, 0, 18, 0, 2 * Math.PI); g.fill();
  g.fillStyle = INK; g.beginPath(); g.moveTo(0, -14); g.lineTo(6, 6); g.lineTo(0, 2); g.lineTo(-6, 6); g.closePath(); g.fill();
  g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('N', 0, 15);
  g.restore();
  const at = `${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')}`;
  const data = timeOn().length ? `data ${hourly() ? `at ${new Date(state.time).toISOString().slice(0, 16).replace('T', ' ')} UTC` : `of ${dayOf(state.time)} (UTC)`}${depthOn().length ? `, ≈ ${state.depth} m` : ''}` : '';
  out.fields = {
    Title: `Charts · ${at}`,
    Description: [`Centre ${at}`, `zoom ${map.getZoom().toFixed(2)}`, `bearing ${Math.round(map.getBearing())}°`, 'Web Mercator (EPSG:3857)', data, location.href].filter(Boolean).join(' · '),
    Copyright: attributionText(),
    'Creation Time': when.toUTCString(),
    Software: 'Charts',
    Disclaimer: 'Not for navigation: positions, coastlines and depths come from open datasets of varying accuracy; depths are a coarse elevation model, not soundings.',
  };
  return out;
}
// the picture as a PNG, with the text fields chartCanvas wrote when it drew it
async function chartPng(chart) {
  return new Blob([pngText(new Uint8Array(await (await pngOf(chart)).arrayBuffer()), chart.fields)], { type: 'image/png' });
}
function exportPng() {
  onFrame(async (src) => {
    const when = new Date(), name = fileName(when);
    download(await chartPng(chartCanvas(src, when)), `${name}.png`);
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
// raster/<item>[-<region>].tif: the values a Copernicus layer draws, read from each of its datasets'
// Zarr stores (zarr.js), at the time and level it draws, in the dataset's own latitude/longitude
// grid over the view's bounding box; arrows as two bands, eastward and northward
const FETCH_DATA = { credentials: 'omit', referrerPolicy: 'no-referrer' };
async function fetchBytes(url) {
  const r = await fetch(url, FETCH_DATA);
  if (r.status === 403 || r.status === 404) return null; // a chunk not stored: all land, or a time no longer kept
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
const stores = {}; // part → promise of its store and coordinates
function storeOf(part) {
  return (stores[part] ||= (async () => {
    const r = await fetch(cmemsStacUrl(part), FETCH_DATA);
    if (!r.ok) throw new Error(`catalogue: HTTP ${r.status}`);
    const store = await openStore((await r.json()).assets.timeChunked.href, fetchBytes);
    const [time, lat, lon, elevation] = await Promise.all(['time', 'latitude', 'longitude', 'elevation'].map((c) => (store.meta(c) ? store.coord(c) : null)));
    return { store, times: Array.from(time, timeScale(store.meta('time').attrs.units)), lat, lon, elevation };
  })().catch((e) => { delete stores[part]; throw e; }));
}
// at: { variant, t, depth } as captured; box: [west, south, east, north]
async function cmemsValues(id, at, box) {
  const v = CMEMS[id][at.variant];
  const [times, levels] = await Promise.all([partTimes(id, at.variant, at.t), partLevels(id, at.variant, at.depth)]);
  return (await Promise.all(v.parts.map(async (part, i) => {
    if (times[i] == null) return null;
    const { store, times: ts, lat, lon, elevation } = await storeOf(part);
    const ti = nearest(ts, times[i], 6e4), zi = elevation && levels[i] != null ? nearest(elevation, +levels[i]) : 0;
    const cells = cellsOf(lat, lon, box);
    if (ti < 0 || !cells.rows.length) return null; // not in the store (yet), or not in view
    const names = storedVariables(part), units = names.map((n) => store.meta(n).attrs.units || '');
    const planes = await Promise.all(names.map((n) => readCells(store, n, ti, zi, cells)));
    const region = regionOf(part)?.name || (v.parts.length > 1 ? 'Global' : ''), key = `raster/${id}${region ? `-${region.toLowerCase()}` : ''}`;
    const w = cells.cols.length, h = cells.rows.length;
    const transform = [cells.dlon, 0, cells.west - cells.dlon / 2, 0, -cells.dlat, cells.north + cells.dlat / 2];
    const when = new Date(ts[ti]).toISOString(), level = elevation ? +Math.abs(elevation[zi]).toFixed(2) : null;
    const description = `${part.split('/').slice(0, 2).join(' / ')}: ${names.join(', ')} (${[...new Set(units)].join(', ')}) at ${when}${level != null ? `, ${level} m deep` : ''}; its own grid, EPSG:4326${cells.step > 1 ? `, every ${cells.step}th cell` : ''}, over the view's bounding box. No data: NaN`;
    return { key, file: `${key}.tif`, w, h, transform, names, units, title: `${v.label}${region ? `, ${region}` : ''}: values`, description,
      data: geotiff(planes, w, h, transform, { crs: 4326, bands: names.map((n, k) => ({ description: `${n}, ${when}${level != null ? `, ${level} m` : ''}`, unit: units[k] })) }) };
  }))).filter(Boolean);
}

const RASTERS = [
  { key: 'depth', items: ['depth'], clip: seaClip, native: DEM_SEA.native, max: DEM_SEA.max, title: 'Depth',
    description: 'Seabed elevation in metres, negative below sea level, as the depth shading draws it: Terrarium DEM cut to the OSM coastline, pits and tile seams corrected; sea the DEM calls dry is -1. No data on land, lakes and inland water at sea level' },
  { key: 'elevation', items: ['relief', 'contours'], clip: landClip, native: DEM_LAND.native, max: DEM_LAND.max, title: 'Land elevation',
    description: 'Land elevation in metres, as the relief shading and land contours use it: Terrarium DEM (SRTM on land) cut to the OSM coastline. No data in the sea' },
];
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
  try { clipping = await polygonClipping(); } catch (e) { console.error('GIS export:', e.message); return; }
  onFrame(async (src) => {
    const when = new Date(), name = fileName(when); // the view as captured, however long the rest takes
    const data = timeOn().length ? (hourly() ? { at: state.time } : { day: dayOf(state.time) }) : null, c = map.getCenter();
    const plain = h('canvas', { width: src.width, height: src.height });
    plain.getContext('2d').drawImage(src, 0, 0);
    const chart = chartCanvas(src, when);
    const W = src.clientWidth, H = src.clientHeight;
    const corners = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => { const ll = map.unproject(p); return [ll.lng, ll.lat]; });
    const transform = affine(corners, src.width, src.height);
    // vector/<item>.geojson for each item drawn with features in view, and the measurements
    const layers = drawnItems(), vectors = [];
    for (const it of layers) {
      if (it.kind === 'cmems') it.at = { variant: variantOf(it.id), t: state.time, depth: state.depth }; // read now, used after the awaits
      const fs = viewFeatures(vectorPieces(it.id), corners, clipping);
      if (fs.length) vectors.push({ key: `vector/${it.id}`, title: it.label, file: `vector/${it.id}.geojson`, data: featureCollection(it.label, fs), n: fs.length, how: 'clipped to the view' });
      it.assets = fs.length ? [`vector/${it.id}`] : []; // in item.json: the assets that hold this layer as data (keyed by path: a layer may be called chart, as the overview is)
    }
    // raster/<key>.tif for each elevation grid an item drawn reads
    const rasters = [];
    for (const r of RASTERS) {
      if (!layers.some((l) => r.items.includes(l.id))) continue;
      const grid = gridFor(corners.map(mercator), Math.max(0, Math.min(Math.floor(map.getZoom() + 1), r.max))), n = 2 ** grid.z;
      const tiles = await Promise.all(grid.tiles.map(([tx, ty]) => r.clip.metres(grid.z, ((tx % n) + n) % n, ty)));
      const transform = gridTransform(grid);
      rasters.push({ ...r, file: `raster/${r.key}.tif`, asset: `raster/${r.key}`, data: geotiff(mosaic(grid, tiles), grid.w, grid.h, transform, { description: r.description }), grid, transform });
      for (const l of layers) if (r.items.includes(l.id)) l.assets.push(`raster/${r.key}`);
    }
    // raster/<item>[-<region>].tif: the values of each Copernicus layer drawn, as the view was captured
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const values = (await Promise.all(layers.filter((l) => l.kind === 'cmems').map((l) => cmemsValues(l.id, l.at, box)
      .then((rs) => { l.assets.push(...rs.map((r) => r.key)); return rs; }, (e) => { console.warn(`${l.label} values:`, e.message); return []; })))).flat();
    for (const l of layers) Object.assign(l, await kindOf(l.id)?.record(l)); // what each drew: period, day, time, depth
    const measured = measureFeatures(measure.list);
    if (measured.length) vectors.push({ key: 'vector/measurements', title: 'Measurements', file: 'vector/measurements.geojson', data: featureCollection('Measurements', measured), n: measured.length, how: 'whole, geodesic values in metres' });
    const item = stacItem({
      id: name, title: `Chart · ${dm(c.lat, 'N', 'S')} ${dm(c.lng, 'E', 'W')}`, when, data, corners, zoom: map.getZoom(), bearing: map.getBearing(), layers,
      attribution: attributionText(), link: location.href,
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
map.on('zoomend', renderMenu);
map.on('dataloading', () => document.body.classList.add('loading'));
map.on('idle', () => document.body.classList.remove('loading'));
window.addEventListener('hashchange', () => location.reload());
window.map = map; // the browser tests drive the map through it; handy from the console too

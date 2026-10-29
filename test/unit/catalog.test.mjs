import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, ITEMS, DEPTH_SCHEMES, DEM_TILES, EMODNET_DEPTH_STOPS, domainEnd, gibsDomainUrl, CMEMS, drawsOf } from '../../site/catalog.js';
import { cmemsStyle } from '../../site/cmems.js';
import { buildStyle, SEA_PICTURES } from '../../site/style.js';
import { CSP_HOSTS } from '../../tools/deps.mjs';

const style = buildStyle({ seaDemUrl: 'clip-sea://{z}/{x}/{y}', landDemUrl: 'clip-land://{z}/{x}/{y}', isobathUrl: 'c://a', contourUrl: 'c://b', date: '2026-10-19' });
const NO_LAYERS = new Set(['legend']); // items that drive the page, not style layers

test('every menu item has a group and layers; every item layer has an item', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  const ids = new Set(ITEMS.map((i) => i.id));
  assert.equal(ids.size, ITEMS.length, 'duplicate item id');
  for (const it of ITEMS) {
    assert.ok(groups.has(it.group), `${it.id}: unknown group ${it.group}`);
    assert.ok(it.info?.src && it.info?.lic && it.info?.res, `${it.id}: provenance incomplete`);
    if (!NO_LAYERS.has(it.id)) assert.ok(style.layers.some((l) => l.metadata?.item === it.id), `${it.id}: no layers`);
  }
  for (const l of style.layers) if (l.metadata?.item) assert.ok(ids.has(l.metadata.item), `${l.id}: unknown item`);
});

test('layer ids unique, sources defined, item layers start hidden', () => {
  const seen = new Set();
  for (const l of style.layers) {
    assert.ok(!seen.has(l.id), `duplicate layer ${l.id}`);
    seen.add(l.id);
    if (l.source) assert.ok(style.sources[l.source], `${l.id}: missing source ${l.source}`);
    if (l.metadata?.item) assert.equal(l.layout?.visibility, 'none', `${l.id} not hidden at start`);
  }
});

test('variants: each choice has a layer, except colour schemes', () => {
  for (const it of ITEMS.filter((i) => i.variants && i.id !== 'depth' && !i.kind)) { // density, Copernicus: one layer, a tile URL per choice
    for (const v of Object.keys(it.variants)) {
      assert.ok(style.layers.some((l) => l.metadata?.item === it.id && l.metadata.variant === v), `${it.id}/${v}: no layer`);
    }
  }
  assert.deepEqual(Object.keys(ITEMS.find((i) => i.id === 'depth').variants), Object.keys(DEPTH_SCHEMES));
});

test('every remote source host is allowed by the CSP', () => {
  // a host, or a host and path (CSP: a source ending in / allows what is under it)
  const ok = (u) => CSP_HOSTS.some((h) => (h.endsWith('/') ? u.startsWith(h) : new URL(u).origin === h));
  for (const [id, src] of Object.entries(style.sources)) {
    for (const u of [src.url, ...(src.tiles || [])].filter((x) => x && /^https?:/.test(x))) assert.ok(ok(u), `${id}: ${u} not in CSP_HOSTS (site/hosts.js)`);
  }
  assert.ok(ok(DEM_TILES), 'the DEM (clip.js) not allowed');
  assert.ok(ok(style.glyphs), 'glyph host not allowed');
});

const luminance = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
test('depth schemes: ascending depths; atlas darkens with depth, nautical lightens', () => {
  for (const [name, stops] of Object.entries(DEPTH_SCHEMES)) {
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i][0] > stops[i - 1][0], `${name}: depths not ascending`);
  }
  const L = (name) => DEPTH_SCHEMES[name].map(([, c]) => luminance(c));
  assert.ok(L('atlas').every((v, i, a) => i === 0 || v < a[i - 1]), 'atlas must get darker with depth');
  assert.ok(L('nautical').every((v, i, a) => i === 0 || v > a[i - 1]), 'nautical must get lighter with depth');
});

test('density datasets: "all types" first, codes map to WMS layers and times, sensible defaults', async () => {
  const { DENSITY, densityTiles } = await import('../../site/catalog.js');
  for (const id of Object.keys(DENSITY)) {
    const it = ITEMS.find((i) => i.id === id);
    assert.equal(Object.keys(it.variants)[0], 'all', `${id}: the app's default variant is the first key`);
    assert.equal(it.on, undefined, `${id}: off by default`);
    assert.ok(DENSITY[id].periods.includes(DENSITY[id].defaultPeriod), `${id}: default period listed`);
  }
  assert.match(densityTiles('traffic', 't10', '2021')[0], /layers=vesseldensity_10avg&.*time=2021-01-01T/);
  assert.equal(DENSITY.traffic.defaultPeriod, '2023'); // 2024 is incomplete
  assert.match(densityTiles('routes', 't04', '2026-07')[0], /layers=routedensity_04&.*time=2026-07-01T/);
  assert.equal(DENSITY.routes.defaultPeriod, DENSITY.routes.periods[0], 'routes: newest month by default');
  assert.equal(DENSITY.routes.periods.length, 91); // Jan 2019 … Jul 2026, no gaps
  assert.equal(DENSITY.routes.periodLabel('2026-07'), 'Jul 2026');
});

test('GIBS: the newest date a layer has, from DescribeDomains', () => {
  assert.equal(domainEnd('<Domains><DimensionDomain><Domain>2026-08-20/2026-10-18/P1D</Domain></DimensionDomain></Domains>'), '2026-10-18');
  assert.equal(domainEnd('<Domain>2026-08-20/2026-09-01/P1D,2026-09-03/2026-10-19/P1D</Domain>'), '2026-10-19');
  assert.equal(domainEnd('<Domains></Domains>'), null);
  assert.match(gibsDomainUrl('terra', '2026-08-20', '2026-10-20'), /MODIS_Terra_CorrectedReflectance_TrueColor\/default\/GoogleMapsCompatible_Level9\/all\/2026-08-20--2026-10-20\.xml$/);
});

test('Copernicus: items, variants and parts agree; styles fix the range', () => {
  for (const it of ITEMS.filter((i) => i.kind === 'cmems')) {
    assert.ok(CMEMS[it.id], `${it.id} has datasets`);
    assert.ok(style.layers.some((l) => l.metadata?.item === it.id && l.source === `cmems-${it.id}`));
  }
  for (const v of Object.values(CMEMS).flatMap(Object.values)) {
    for (const p of v.parts) assert.equal(p.split('/').length, 3, `${p}: product/dataset/variable`);
    assert.ok(v.range[0] < v.range[1]);
  }
  assert.equal(cmemsStyle(CMEMS.currents.surface), 'cmap:speed,range:0/1.5,vectorStyle:solidAndVector');
});

test('Copernicus colours and arrows: what each draws, styles, arrows drawn over colours', () => {
  assert.deepEqual(drawsOf(CMEMS.currents.surface), ['colour', 'arrows']);
  assert.deepEqual(drawsOf(CMEMS.wind.observed), ['arrows']);
  assert.deepEqual(drawsOf(CMEMS.waves.height), ['colour']);
  assert.equal(cmemsStyle(CMEMS.currents.surface, 'arrows'), 'cmap:speed,range:0/1.5,vectorStyle:vector');
  assert.equal(cmemsStyle(CMEMS.currents.surface, 'colour'), 'cmap:speed,range:0/1.5');
  assert.equal(cmemsStyle(CMEMS.wind.observed, 'arrows'), 'cmap:thermal,range:0/25,vectorStyle:vector');
  const order = buildStyle({ seaDemUrl: 'x', landDemUrl: 'x', isobathUrl: 'x', contourUrl: 'x', date: '2026-10-21' }).layers.map((l) => l.id).filter((id) => id.startsWith('cmems-'));
  assert.deepEqual(order.slice(-2), ['cmems-currents', 'cmems-wind'], `layers that draw arrows come last: ${order.join(' ')}`);
});

test('every overlay drawn in colours or symbols has a legend, and Europe-only layers say so', () => {
  for (const it of ITEMS.filter((i) => i.tiles || i.kind === 'classes')) {
    const legend = it.kind === 'classes' ? it.legend : it.kind === 'emodnet' ? EMODNET_DEPTH_STOPS : null;
    assert.ok(legend, `${it.id}: no legend`);
    if (it.kind === 'classes') for (const v of Object.keys(it.variants || { all: 1 })) assert.ok(it.legend(v), `${it.id} ${v}: no legend`);
    if (it.tiles) for (const v of Object.keys(it.variants || { all: 1 })) assert.ok(it.tiles[v], `${it.id} ${v}: no tiles`);
  }
  // EMODnet's and EMSA's data cover European seas, but for the UKHO's wrecks (worldwide)
  for (const it of ITEMS) if (it.group !== 'labels' && /EMODnet|EMSA/.test(it.info.src) && !/worldwide/.test(it.info.res)) assert.match(it.label, /\(Europe\)$/, `${it.id}: Europe only, not in its name`);
});

test('the isobaths\' pictures: what lies between EMODnet depth and the isobaths is a sea picture, ocean data or seagrass, and every sea picture is there', () => {
  const group = Object.fromEntries(ITEMS.map((it) => [it.id, it.group]));
  const ids = style.layers.map((l) => l.metadata?.item ?? null);
  const from = ids.lastIndexOf('emodnetdepth'), to = style.layers.findIndex((l) => l.id.startsWith('isobaths'));
  const between = [...new Set(ids.slice(from + 1, to))];
  assert.deepEqual(between.filter((it) => !SEA_PICTURES.includes(it) && group[it] !== 'data' && it !== 'seagrass'), []);
  assert.deepEqual(SEA_PICTURES.filter((it) => !between.includes(it)), []);
});

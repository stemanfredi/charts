import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GROUPS, ITEMS, DEPTH_SCHEMES, buildStyle } from '../../catalog.js';
import { PINS, TILE_HOSTS } from '../../tools/deps.mjs';

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
  for (const it of ITEMS.filter((i) => i.variants && i.id !== 'depth' && i.variantsBy !== 'tiles')) { // tiles: one layer, URL per choice
    for (const v of Object.keys(it.variants)) {
      assert.ok(style.layers.some((l) => l.metadata?.item === it.id && l.metadata.variant === v), `${it.id}/${v}: no layer`);
    }
  }
  assert.deepEqual(Object.keys(ITEMS.find((i) => i.id === 'depth').variants), Object.keys(DEPTH_SCHEMES));
});

test('every remote source host is allowed by the CSP', () => {
  const allowed = new Set([...TILE_HOSTS, 'https://cdn.jsdelivr.net']);
  for (const [id, src] of Object.entries(style.sources)) {
    for (const u of [src.url, ...(src.tiles || [])].filter((x) => x && /^https?:/.test(x))) {
      assert.ok(allowed.has(new URL(u).origin), `${id}: ${new URL(u).origin} not in TILE_HOSTS`);
    }
  }
  assert.ok(allowed.has(new URL(style.glyphs).origin), 'glyph host not allowed');
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

test('test-only GeographicLib matches the version the page loads', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  assert.equal(pkg.devDependencies['geographiclib-geodesic'], PINS.find((p) => p.name === 'geographiclib-geodesic').version);
});

test('vessel density: "all types" is the default, codes map to WMS layers, 2023 by default', async () => {
  const { TRAFFIC, trafficTiles } = await import('../../catalog.js');
  const it = ITEMS.find((i) => i.id === 'traffic');
  assert.equal(Object.keys(it.variants)[0], 'all'); // the app's default variant is the first key
  assert.equal(it.on, undefined, 'off by default');
  assert.match(trafficTiles('t10', 2021)[0], /layers=vesseldensity_10avg&.*time=2021-01-01T/);
  assert.match(trafficTiles('all', 2023)[0], /layers=vesseldensity_allavg&/);
  assert.equal(TRAFFIC.defaultYear, 2023);
  assert.ok(TRAFFIC.years.includes(TRAFFIC.defaultYear));
});

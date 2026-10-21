#!/usr/bin/env node
// Pinned CDN dependencies of index.html.
//
//   node tools/deps.mjs            report pinned vs latest on npm, and newer data periods
//                                  in the EMODnet density WMS than catalog.js lists
//   node tools/deps.mjs --write    fetch the pinned files, recompute SRI hashes and the
//                                  import-map CSP hash, and rewrite the block in index.html
//   node tools/deps.mjs --check    fail if index.html's block differs from what --write
//                                  would produce (hash drift, hand edits, a changed CDN file)
//
// To upgrade: change a version below, run --write, then test the page.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const PINS = [
  { name: 'maplibre-gl', version: '6.15.0', file: 'dist/maplibre-gl.mjs', kind: 'module' },
  { name: 'maplibre-gl', version: '6.15.0', file: 'dist/maplibre-gl.css', kind: 'style' },
  // MapLibre's worker: app.js checks it against this hash and hands MapLibre the verified copy
  // (left alone, MapLibre imports it from the CDN with no integrity check). Preloaded so it
  // downloads alongside MapLibre, once; the hash rides in data-integrity, which only app.js
  // reads (see verifiedWorker there for why neither the preload nor the fetch carries it)
  { name: 'maplibre-gl', version: '6.15.0', file: 'dist/maplibre-gl-worker.mjs', kind: 'worker' },
  { name: 'maplibre-contour', version: '0.1.1', file: 'dist/index.mjs', kind: 'module' },
  { name: 'geographiclib-geodesic', version: '2.2.0', file: 'geographiclib-geodesic.min.js', kind: 'script' },
  // polygon union and clipping for the ZIP export's GeoJSON (vector.js); the bundle carries its
  // two small dependencies. Lazy: app.js loads it on the first ZIP export, from the URL and hash
  // in its <meta>
  { name: 'polygon-clipping', version: '0.15.7', file: 'dist/polygon-clipping.umd.min.js', kind: 'lazy' },
];

// Every host the page may talk to (Content-Security-Policy).
export const TILE_HOSTS = [
  'https://tiles.openfreemap.org', 'https://s3.amazonaws.com', 'https://tiles.maps.eox.at',
  'https://server.arcgisonline.com',
  'https://gibs.earthdata.nasa.gov', 'https://tiles.openseamap.org', 'https://ows.emodnet-humanactivities.eu',
  'https://wmts.marine.copernicus.eu',
];
// Hosts the page calls for data but never draws from (connect-src only).
export const API_HOSTS = [
  'https://photon.komoot.io', // place search (app.js)
  // Copernicus Marine's datasets as data, read on a GIS export (zarr.js): the STAC catalogue that
  // says where each dataset's Zarr store is, and the stores
  'https://stac.marine.copernicus.eu', 'https://s3.waw3-1.cloudferro.com',
];
const CDN = 'https://cdn.jsdelivr.net';

const url = (p) => `${CDN}/npm/${p.name}@${p.version}/${p.file}`;
// CSP sources: the pinned packages' folders only, not all of jsDelivr
const PACKAGES = [...new Set(PINS.map((p) => `${CDN}/npm/${p.name}@${p.version}/`))].join(' ');
const sri = (buf, alg = 'sha384') => `${alg}-${createHash(alg).update(buf).digest('base64')}`;

async function fetchOk(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return Buffer.from(await r.arrayBuffer());
}

async function report() {
  for (const name of [...new Set(PINS.map((p) => p.name))]) {
    const pinned = PINS.find((p) => p.name === name).version;
    const r = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${name}`);
    if (!r.ok) throw new Error(`jsDelivr ${r.status} for ${name}`);
    const { tags } = await r.json();
    console.log(`${name.padEnd(24)} pinned ${pinned.padEnd(8)} latest ${tags.latest}${tags.latest === pinned ? '' : '   ← update available'}`);
    // in GitHub Actions an update shows as a notice on the run, without failing it
    if (tags.latest !== pinned && process.env.GITHUB_ACTIONS) console.log(`::notice title=Dependency update::${name} ${pinned} → ${tags.latest}`);
  }
}

const INDEX = new URL('../index.html', import.meta.url);
const BLOCK = /(<!-- deps:start[^>]*-->)[\s\S]*?(<!-- deps:end -->)/;

// index.html with the deps block regenerated from PINS (fetches the pinned files)
async function regenerate() {
  const hashes = {};
  for (const p of PINS) hashes[url(p)] = sri(await fetchOk(url(p)));
  const modules = PINS.filter((p) => p.kind === 'module');
  const importmap = JSON.stringify({
    imports: Object.fromEntries(modules.map((p) => [p.name, url(p)])),
    integrity: Object.fromEntries(modules.map((p) => [url(p), hashes[url(p)]])),
  });
  const csp = [
    "default-src 'none'",
    `script-src 'self' ${PACKAGES} '${sri(Buffer.from(importmap), 'sha256')}'`,
    `style-src 'self' ${PACKAGES} 'unsafe-inline'`,
    `img-src 'self' data: blob: ${TILE_HOSTS.join(' ')}`,
    `connect-src 'self' ${PACKAGES} ${TILE_HOSTS.join(' ')} ${API_HOSTS.join(' ')}`,
    "worker-src 'self' blob:", 'child-src blob:', // 'self': clip-worker.js; blob: MapLibre's verified worker
    "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join('; ');
  const tags = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    ...PINS.filter((p) => p.kind === 'style').map((p) => `<link rel="stylesheet" href="${url(p)}" integrity="${hashes[url(p)]}" crossorigin="anonymous">`),
    ...PINS.filter((p) => p.kind === 'worker').map((p) => `<link rel="preload" as="fetch" id="${p.name}-worker" href="${url(p)}" data-integrity="${hashes[url(p)]}" crossorigin="anonymous">`),
    `<script type="importmap">${importmap}</script>`,
    ...PINS.filter((p) => p.kind === 'script').map((p) => `<script src="${url(p)}" integrity="${hashes[url(p)]}" crossorigin="anonymous"></script>`),
    ...PINS.filter((p) => p.kind === 'lazy').map((p) => `<meta name="lazy-script" id="${p.name}" content="${url(p)}" data-integrity="${hashes[url(p)]}">`),
  ];
  const html = await readFile(INDEX, 'utf8');
  if (!BLOCK.test(html)) throw new Error('deps markers not found in index.html');
  return { html, next: html.replace(BLOCK, (_, a, b) => `${a}\n${tags.map((t) => `  ${t}`).join('\n')}\n  ${b}`) };
}

// newest period the WMS offers for each density dataset vs the newest one catalog.js lists
async function dataReport() {
  const { DENSITY, DENSITY_WMS } = await import('../catalog.js');
  const r = await fetch(`${DENSITY_WMS}?service=WMS&request=GetCapabilities&version=1.3.0`);
  if (!r.ok) throw new Error(`EMODnet capabilities ${r.status}`);
  const xml = await r.text();
  for (const [id, d] of Object.entries(DENSITY)) {
    const name = d.layer('all');
    const i = xml.indexOf(`<Name>${name}</Name>`);
    const times = (/name="time"[^>]*>([^<]*)/.exec(xml.slice(i, xml.indexOf('</Layer>', i))) || [])[1] || '';
    const newest = times.match(/\d{4}-\d{2}/g)?.sort().at(-1);
    const listed = [...d.periods].sort().at(-1);
    const offered = id === 'traffic' ? newest?.slice(0, 4) : newest;
    const newer = offered && offered > listed;
    console.log(`${d.title.padEnd(24)} listed to ${listed.padEnd(8)} WMS offers to ${offered}${newer ? '   ← newer data: update catalog.js' : ''}`);
    if (newer && process.env.GITHUB_ACTIONS) console.log(`::notice title=Newer ${d.title}::the WMS has ${offered}; catalog.js lists to ${listed}`);
  }
}

async function write() {
  const { next } = await regenerate();
  await writeFile(INDEX, next);
  console.log('index.html updated:', [...new Set(PINS.map((p) => `${p.name}@${p.version}`))].join(', '));
}

async function check() {
  const { html, next } = await regenerate();
  if (html !== next) {
    console.error('index.html deps block is out of date: run node tools/deps.mjs --write');
    process.exit(1);
  }
  console.log('index.html deps block matches the pins and the CDN files');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv;
  if (a.includes('--write')) await write();
  else if (a.includes('--check')) await check();
  else { await report(); await dataReport(); }
}

#!/usr/bin/env node
// Pinned CDN dependencies of index.html.
//
//   node tools/deps.mjs            report pinned vs latest on npm
//   node tools/deps.mjs --write    fetch the pinned files, recompute SRI hashes and the
//                                  import-map CSP hash, and rewrite the block in index.html
//
// To upgrade: change a version below, run --write, then test the page.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const PINS = [
  { name: 'maplibre-gl', version: '6.15.0', file: 'dist/maplibre-gl.mjs', kind: 'module' },
  { name: 'maplibre-gl', version: '6.15.0', file: 'dist/maplibre-gl.css', kind: 'style' },
  { name: 'maplibre-contour', version: '0.1.1', file: 'dist/index.mjs', kind: 'module' },
  { name: 'geographiclib-geodesic', version: '2.2.0', file: 'geographiclib-geodesic.min.js', kind: 'script' },
];

// Every host the page may talk to (Content-Security-Policy).
const TILE_HOSTS = [
  'https://tiles.openfreemap.org', 'https://s3.amazonaws.com', 'https://tiles.maps.eox.at',
  'https://server.arcgisonline.com',
  'https://gibs.earthdata.nasa.gov', 'https://tiles.openseamap.org',
];
const CDN = 'https://cdn.jsdelivr.net';

const url = (p) => `${CDN}/npm/${p.name}@${p.version}/${p.file}`;
const sri = (buf, alg = 'sha384') => `${alg}-${createHash(alg).update(buf).digest('base64')}`;

async function fetchOk(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return Buffer.from(await r.arrayBuffer());
}

async function report() {
  for (const name of [...new Set(PINS.map((p) => p.name))]) {
    const pinned = PINS.find((p) => p.name === name).version;
    const tags = (await (await fetch(`https://data.jsdelivr.com/v1/packages/npm/${name}`)).json()).tags;
    console.log(`${name.padEnd(24)} pinned ${pinned.padEnd(8)} latest ${tags.latest}${tags.latest === pinned ? '' : '   ← update available'}`);
  }
}

async function write() {
  const hashes = {};
  for (const p of PINS) hashes[url(p)] = sri(await fetchOk(url(p)));
  const modules = PINS.filter((p) => p.kind === 'module');
  const importmap = JSON.stringify({
    imports: Object.fromEntries(modules.map((p) => [p.name, url(p)])),
    integrity: Object.fromEntries(modules.map((p) => [url(p), hashes[url(p)]])),
  });
  const csp = [
    "default-src 'none'",
    `script-src 'self' ${CDN} '${sri(Buffer.from(importmap), 'sha256')}'`,
    `style-src 'self' ${CDN} 'unsafe-inline'`,
    `img-src 'self' data: blob: ${TILE_HOSTS.join(' ')}`,
    `connect-src 'self' ${CDN} ${TILE_HOSTS.join(' ')}`,
    `worker-src blob: ${CDN}`, 'child-src blob:',
    "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join('; ');
  const tags = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    ...PINS.filter((p) => p.kind === 'style').map((p) => `<link rel="stylesheet" href="${url(p)}" integrity="${hashes[url(p)]}" crossorigin="anonymous">`),
    `<script type="importmap">${importmap}</script>`,
    ...PINS.filter((p) => p.kind === 'script').map((p) => `<script src="${url(p)}" integrity="${hashes[url(p)]}" crossorigin="anonymous"></script>`),
  ];
  const file = new URL('../index.html', import.meta.url);
  const html = await readFile(file, 'utf8');
  const block = /(<!-- deps:start[^>]*-->)[\s\S]*?(<!-- deps:end -->)/;
  if (!block.test(html)) throw new Error('deps markers not found in index.html');
  await writeFile(file, html.replace(block, (_, a, b) => `${a}\n${tags.map((t) => `  ${t}`).join('\n')}\n  ${b}`));
  console.log('index.html updated:', PINS.map((p) => `${p.name}@${p.version}`).join(', '));
}

await (process.argv.includes('--write') ? write() : report());

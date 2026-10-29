#!/usr/bin/env node
// EMODnet Seabed Habitats' seagrass (the Essential Ocean Variable, 2025) as vector tiles for Charts:
// its WMS takes a minute or more a tile, so the data is cut into tiles once and published as plain
// files at geodata.makaw.org/seagrass-2025/{z}/{x}/{y}.pbf (README: Hosting the data yourself); the
// page reads them through its seagrass:// handler (app.js), asking only for the tiles the index lists.
//
//   node tools/seagrass.mjs download DIR       the product's zip into DIR, unzipped into DIR/shp (needs unzip)
//   node tools/seagrass.mjs build DIR          DIR/tiles/seagrass-2025/: tiles, zooms 7–13, and
//                                              index.json, the tiles there are (the page reads it)
//
// Europe only: the product's Caribbean part (west of 50° W) is CC BY-NC, the rest CC BY 4.0.
// Each meadow (polygon) and each survey point gets one class, from its habitat fields: the species'
// names in English, French or Italian, and EUNIS codes (classOf). One layer, "seagrass": polygons
// and points, property c (catalog.js SEAGRASS_CLASSES). Cut a zoom-5 region at a time (geojson-vt,
// then vt-pbf), so that memory holds one region's features, not Europe's.
import { openSync, readSync, closeSync, mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { tileXY } from '../site/geo.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

export const RELEASE = 'seagrass-2025';
const ZIP = 'https://files.emodnet-seabedhabitats.eu/data/SeagrassBeds_EOV_2025.zip';
const MINZ = 7, MAXZ = 13, REGION_Z = 5, WEST = -50;

// one class from a feature's habitat text: dead Posidonia "matte" only where no living meadow is
// named with it (Italian mosaics of living and dead count as Posidonia)
export function classOf(text) {
  const t = text.toLowerCase();
  if (/posidonia|1120|a5\.535|mb252/.test(t)) return /dead|mort[ea]|matte/.test(t) && !/viv[ae]|live|mosaic/.test(t) ? 'matte' : 'posidonia';
  if (/cymodocea/.test(t)) return 'cymodocea';
  if (/zostera|znol|zmar|a5\.533|a2\.611/.test(t)) return 'zostera';
  return 'other';
}
const POLYGON_FIELDS = ['habsubtype', 'eunis_code', 'eunis_name', 'anxi_name', 'hab_origin'];
const POINT_FIELDS = ['seabedtype', 'seabedty_2', 'sourcehabi'];

// ---- shapefile reading (the two files it needs: .shp geometry, .dbf attributes) ------------------
function dbfReader(path, names) {
  const fd = openSync(path, 'r'), h = Buffer.alloc(32);
  readSync(fd, h, 0, 32, 0);
  const n = h.readUInt32LE(4), headerLen = h.readUInt16LE(8), recLen = h.readUInt16LE(10), fields = {};
  const desc = Buffer.alloc(headerLen);
  readSync(fd, desc, 0, headerLen, 0);
  for (let o = 32, off = 1; desc[o] !== 0x0d; o += 32) { fields[desc.toString('latin1', o, o + 11).replace(/\0.*$/, '')] = [off, desc[o + 16]]; off += desc[o + 16]; }
  const want = names.map((k) => fields[k]), BATCH = 2000, buf = Buffer.alloc(recLen * BATCH);
  let at = -1;
  return { n, text(i) { // the wanted fields of record i, joined; records are read in batches, in order
    const b = Math.floor(i / BATCH);
    if (b !== at) { readSync(fd, buf, 0, buf.length, headerLen + b * BATCH * recLen); at = b; }
    const r = (i % BATCH) * recLen;
    return want.map(([o, l]) => buf.toString('utf8', r + o, r + o + l).trim()).filter((s) => s && s !== 'NULL').join(' | ');
  }, close: () => closeSync(fd) };
}
// every record of a .shp: polygons (type 5) as rings of [lon, lat], points (type 1) as [lon, lat]
function* shapes(path) {
  const fd = openSync(path, 'r'), size = statSync(path).size, head = Buffer.alloc(8);
  for (let pos = 100, i = 0; pos < size; i++) {
    readSync(fd, head, 0, 8, pos);
    const len = head.readInt32BE(4) * 2, rec = Buffer.alloc(len);
    readSync(fd, rec, 0, len, pos + 8);
    pos += 8 + len;
    const type = rec.readInt32LE(0);
    if (type === 1) yield { i, point: [rec.readDoubleLE(4), rec.readDoubleLE(12)] };
    else if (type === 5) {
      const parts = rec.readInt32LE(36), count = rec.readInt32LE(40), rings = [];
      for (let p = 0; p < parts; p++) {
        const a = rec.readInt32LE(44 + p * 4), b = p + 1 < parts ? rec.readInt32LE(48 + p * 4) : count, ring = [];
        for (let k = a; k < b; k++) { const o = 44 + parts * 4 + k * 16; ring.push([rec.readDoubleLE(o), rec.readDoubleLE(o + 8)]); }
        rings.push(ring);
      }
      yield { i, rings, bbox: [rec.readDoubleLE(4), rec.readDoubleLE(12), rec.readDoubleLE(20), rec.readDoubleLE(28)] };
    } else yield { i }; // a null shape
  }
  closeSync(fd);
}

// ---- tiles -------------------------------------------------------------------------------------
const tileX = (lon, z) => Math.floor(tileXY(lon, 0, z).x);
const tileY = (lat, z) => Math.floor(tileXY(0, Math.max(-85, Math.min(85, lat)), z).y);

// a shapefile's polygons are rings, outer ones clockwise and holes anticlockwise: GeoJSON wants
// each outer ring followed by its holes, so a polygon of several outer rings becomes several
function polygons(rings) {
  const area = (r) => r.reduce((s, [x, y], k) => { const [x2, y2] = r[(k + 1) % r.length]; return s + (x2 - x) * (y2 + y); }, 0);
  const out = [];
  for (const r of rings) {
    if (r.length < 4) continue;
    if (area(r) > 0 || !out.length) out.push([r]); else out.at(-1).push(r); // clockwise: an outer ring
  }
  return out;
}

// survey points are drawn from zoom POINTS_Z (style.js), and repeated surveys put tens of thousands
// at a few stations (63,000 in one tile off the Solent): none below it, and from it one of a class
// per pixel (8 of a tile's 4096 units: tiles are drawn at 512 px)
const POINTS_Z = 10, PIXEL = 8;
function onePerPixel(features, z) {
  const seen = new Set();
  return features.filter((f) => {
    if (f.type !== 1) return true;
    if (z < POINTS_Z) return false;
    const [px, py] = f.geometry[0], k = `${f.tags.c} ${Math.round(px / PIXEL)} ${Math.round(py / PIXEL)}`;
    return !seen.has(k) && seen.add(k);
  });
}

async function build(dir) {
  const shp = join(dir, 'shp'), out = join(dir, 'tiles', RELEASE), counts = {}, regions = new Map();
  const add = (feature, bbox) => { // into every zoom-5 region its bounding box touches
    const [x0, x1, y0, y1] = [tileX(bbox[0], REGION_Z), tileX(bbox[2], REGION_Z), tileY(bbox[3], REGION_Z), tileY(bbox[1], REGION_Z)];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x}/${y}`; if (!regions.has(k)) regions.set(k, []); regions.get(k).push(feature); }
  };
  for (const [name, fields] of [['seagrass_polygons_2025', POLYGON_FIELDS], ['seagrass_points_2025', POINT_FIELDS]]) {
    const dbf = dbfReader(join(shp, `${name}.dbf`), fields);
    let n = 0;
    for (const s of shapes(join(shp, `${name}.shp`))) {
      if (++n % 100000 === 0) console.log(`${name}: ${n} of ${dbf.n}`);
      const c = classOf(dbf.text(s.i));
      if (s.point) {
        if (s.point[0] < WEST) continue;
        counts[`point ${c}`] = (counts[`point ${c}`] || 0) + 1;
        add({ type: 'Feature', properties: { c }, geometry: { type: 'Point', coordinates: s.point } }, [...s.point, ...s.point]);
      } else if (s.rings) {
        if (s.bbox[2] < WEST) continue;
        const ps = polygons(s.rings);
        if (!ps.length) continue;
        counts[`polygon ${c}`] = (counts[`polygon ${c}`] || 0) + 1;
        add({ type: 'Feature', properties: { c }, geometry: ps.length === 1 ? { type: 'Polygon', coordinates: ps[0] } : { type: 'MultiPolygon', coordinates: ps } }, s.bbox);
      }
    }
    dbf.close();
  }
  console.log(counts);
  let tiles = 0, bytes = 0, largest = 0;
  const index = {}; // zoom → [x, y, x, y, …] of the tiles written
  for (const [k, features] of regions) {
    const [rx, ry] = k.split('/').map(Number);
    // maxZoom one past the last written: geojson-vt simplifies every zoom but its last, and drops
    // shapes smaller than a few units there; kept at zoom 13, the slivers that overlaying surveys
    // left (half the rings around Scilly, under a square metre) made 8 MB tiles
    const cut = geojsonvt({ type: 'FeatureCollection', features }, { maxZoom: MAXZ + 1, indexMaxZoom: MINZ, indexMaxPoints: 0, buffer: 64 });
    for (let z = MINZ; z <= MAXZ; z++) {
      const f = 2 ** (z - REGION_Z);
      for (let x = rx * f; x < (rx + 1) * f; x++) {
        for (let y = ry * f; y < (ry + 1) * f; y++) {
          const t = cut.getTile(z, x, y);
          if (!t) continue;
          t.features = onePerPixel(t.features, z);
          if (!t.features.length) continue;
          const pbf = vtpbf.fromGeojsonVt({ seagrass: t }, { version: 2 });
          mkdirSync(join(out, `${z}`, `${x}`), { recursive: true });
          writeFileSync(join(out, `${z}`, `${x}`, `${y}.pbf`), pbf);
          (index[z] ||= []).push(x, y);
          tiles++; bytes += pbf.length; largest = Math.max(largest, pbf.length);
        }
      }
    }
    console.log(`region ${k}: ${features.length} features; ${tiles} tiles so far, ${(bytes / 1e6).toFixed(0)} MB`);
  }
  // the page reads index.json first and asks only for the tiles listed (a missing tile would be a
  // 404, which the browser logs as an error however the page handles it)
  writeFileSync(join(out, 'index.json'), JSON.stringify({ source: ZIP, minzoom: MINZ, maxzoom: MAXZ, counts, bytes, built: new Date().toISOString(), tiles: index }));
  console.log(`${tiles} tiles, ${(bytes / 1e6).toFixed(0)} MB, the largest ${(largest / 1e3).toFixed(0)} kB`);
}

async function download(dir) {
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, ZIP.split('/').pop());
  if (!existsSync(zip)) {
    const r = await fetch(ZIP);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(zip));
  }
  execFileSync('unzip', ['-o', '-q', zip, '-d', join(dir, 'shp')], { stdio: 'inherit' });
}

const [cmd, dir] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cmd === 'download' && dir) await download(dir);
  else if (cmd === 'build' && dir) await build(dir);
  else { console.error('usage: node tools/seagrass.mjs download|build DIR'); process.exit(1); }
}

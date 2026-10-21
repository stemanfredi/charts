// Layers as data (the GIS export): the values a layer draws, read from its datasets' Zarr stores
// (zarr.js) and written as GeoTIFF (geotiff.js), over the view's bounding box [west, south, east,
// north]. Each returns [{ key, file, w, h, transform, names, units, title, description, data }].
import { CMEMS, cmemsStacUrl, storedVariables, EMODNET_DTM } from './catalog.js';
import { partTimes, partLevels, regionOf } from './cmems.js';
import { openStore, timeScale, nearest, cellsOf, readCells } from './zarr.js';
import { geotiff } from './geotiff.js';
import { FETCH, memo } from './net.js';

// a store's file, or null where the store says 403 or 404: a public bucket answers 403, not 404, for
// a file it does not hold, so either means a chunk not stored (all land, or a time no longer kept).
// A store that is not public fails at its metadata (zarr.js openStore), not with empty rasters.
async function fetchBytes(url) {
  const r = await fetch(url, FETCH);
  if (r.status === 403 || r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const stores = {}; // part (or EMODNET_DTM) → promise of its store and coordinates
function storeOf(part) {
  return memo(stores, part, async () => {
    const r = await fetch(cmemsStacUrl(part), FETCH);
    if (!r.ok) throw new Error(`catalogue: HTTP ${r.status}`);
    const store = await openStore((await r.json()).assets.timeChunked.href, fetchBytes);
    const [time, lat, lon, elevation] = await Promise.all(['time', 'latitude', 'longitude', 'elevation'].map((c) => (store.meta(c) ? store.coord(c) : null)));
    return { store, times: Array.from(time, timeScale(store.meta('time').attrs.units)), lat, lon, elevation };
  });
}
// raster/<item>[-<region>].tif: the values a Copernicus layer draws, read from each of its datasets'
// Zarr stores (zarr.js), at the time and level it draws, in the dataset's own latitude/longitude
// grid over the view's bounding box; arrows as two bands, eastward and northward
// at: { variant, t, depth } as captured
export async function cmemsValues(id, at, box) {
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

// raster/emodnet-depth.tif: EMODnet Bathymetry's elevation over the view's bounding box, in its own
// grid; a view needing more than 16 of its ~2 MB chunks (wider than about 4° × 4°) is left out:
// zoom in to export it
const dtmStore = () => memo(stores, EMODNET_DTM, async () => {
  const store = await openStore(EMODNET_DTM, fetchBytes);
  const [lat, lon] = await Promise.all([store.coord('latitude'), store.coord('longitude')]);
  return { store, lat, lon };
});
export async function emodnetValues(box) {
  const { store, lat, lon } = await dtmStore(), m = store.meta('elevation'), cells = cellsOf(lat, lon, box);
  if (!cells.rows.length) return [];
  const blocks = new Set(cells.rows.map((r) => Math.floor(r / m.chunks[0]))).size * new Set(cells.cols.map((c) => Math.floor(c / m.chunks[1]))).size;
  if (blocks > 16) { console.warn(`EMODnet depth values: ${blocks} chunks of about 2 MB for this view; zoom in to export them`); return []; }
  const w = cells.cols.length, h = cells.rows.length, key = 'raster/emodnet-depth';
  const transform = [cells.dlon, 0, cells.west - cells.dlon / 2, 0, -cells.dlat, cells.north + cells.dlat / 2];
  const description = `EMODnet Bathymetry DTM 2024: elevation (m, negative below the sea surface; vertical reference lowest astronomical tide), its own grid (1/16 arc-minute), EPSG:4326${cells.step > 1 ? `, every ${cells.step}th cell` : ''}, over the view's bounding box. No data: NaN. Not for navigation`;
  return [{ key, file: `${key}.tif`, w, h, transform, names: ['elevation'], units: ['m'], title: 'EMODnet depth: values', description,
    data: geotiff([await readCells(store, 'elevation', 0, 0, cells)], w, h, transform, { crs: 4326, bands: [{ description: 'elevation, EMODnet DTM 2024', unit: 'm' }] }) }];
}

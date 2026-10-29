// Layers as data (the GIS export): the values a layer draws, read from its datasets' Zarr stores
// (zarr.js) and written as GeoTIFF (geotiff.js), over the view's bounding box [west, south, east,
// north]. Each returns [{ key, file, w, h, transform, names, units, title, description, data }].
import { CMEMS, EMODNET_DTM, GEBCO, GEBCO_TID } from './catalog.js';
import { partTimes, partLevels, regionOf, cmemsStacUrl, storedVariables, partOf } from './cmems.js';
import { openStore, timeScale, nearest, cellsOf, readCells } from './zarr.js';
import { geotiff } from './geotiff.js';
import { fetchOk, fetchBytes, lru } from './net.js';

// a store's file, or null where the store says 403 or 404: a public bucket answers 403, not 404, for
// a file it does not hold, so either means a chunk not stored (all land, or a time no longer kept).
// A store that is not public fails at its metadata (zarr.js openStore), not with empty rasters.
// One raster record of the export: the cells' grid (cellsOf) as a GeoTIFF of planes, EPSG:4326
function rasterOf(cells, key, { title, description, names, units, planes, bands }) {
  const w = cells.cols.length, h = cells.rows.length, transform = [cells.dlon, 0, cells.west - cells.dlon / 2, 0, -cells.dlat, cells.north + cells.dlat / 2];
  return { key, file: `${key}.tif`, w, h, transform, names, units, title, description, data: geotiff(planes, w, h, transform, { crs: 4326, bands }) };
}

const stores = lru(Infinity); // part (or EMODNET_DTM) → promise of its store and coordinates
function storeOf(part) {
  return stores(part, async () => {
    const r = await fetchOk(cmemsStacUrl(part));
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
    const when = new Date(ts[ti]).toISOString(), level = elevation ? +Math.abs(elevation[zi]).toFixed(2) : null;
    const description = `${partOf(part).id.replace('/', ' / ')}: ${names.join(', ')} (${[...new Set(units)].join(', ')}) at ${when}${level != null ? `, ${level} m deep` : ''}; its own grid, EPSG:4326${cells.step > 1 ? `, every ${cells.step}th cell` : ''}, over the view's bounding box. No data: NaN`;
    return rasterOf(cells, key, { title: `${v.label}${region ? `, ${region}` : ''}: values`, description, names, units, planes,
      bands: names.map((n, k) => ({ description: `${n}, ${when}${level != null ? `, ${level} m` : ''}`, unit: units[k] })) });
  }))).filter(Boolean);
}

// raster/emodnet-depth.tif: EMODnet Bathymetry's elevation over the view's bounding box, in its own
// grid; a view needing more than 16 of its ~2 MB chunks (wider than about 4° × 4°) is left out:
// zoom in to export it
const dtmStore = () => stores(EMODNET_DTM, async () => {
  const store = await openStore(EMODNET_DTM, fetchBytes);
  const [lat, lon] = await Promise.all([store.coord('latitude'), store.coord('longitude')]);
  return { store, lat, lon };
});
export async function emodnetValues(box) {
  const { store, lat, lon } = await dtmStore(), m = store.meta('elevation'), cells = cellsOf(lat, lon, box);
  if (!cells.rows.length) return [];
  const blocks = new Set(cells.rows.map((r) => Math.floor(r / m.chunks[0]))).size * new Set(cells.cols.map((c) => Math.floor(c / m.chunks[1]))).size;
  if (blocks > 16) throw new Error(`${blocks} chunks of about 2 MB for this view: zoom in to export them`);
  const description = `EMODnet Bathymetry DTM 2024: elevation (m, negative below the sea surface; vertical reference lowest astronomical tide), its own grid (1/16 arc-minute), EPSG:4326${cells.step > 1 ? `, every ${cells.step}th cell` : ''}, over the view's bounding box. No data: NaN. Not for navigation`;
  return [rasterOf(cells, 'raster/emodnet-depth', { title: 'EMODnet depth: values', description, names: ['elevation'], units: ['m'],
    planes: [await readCells(store, 'elevation', 0, 0, cells)], bands: [{ description: 'elevation, EMODnet DTM 2024', unit: 'm' }] })];
}

// raster/gebco-depth.tif: GEBCO's elevation over the view's bounding box, in its own grid, at the
// finest level that needs at most 16 of its chunks (level 0, GEBCO's 15″ cells, for views up to
// several degrees across; a coarser one, means of 2^k × 2^k cells, for wider views: never left out).
// raster/gebco-source.tif: its type identifier codes, the same way (a coarser level: the most
// common code of the cells below). The coordinates follow from the grids' regular spacing, so none
// are downloaded.
const GEBCO_GRIDS = {
  elevation: { url: GEBCO, key: 'raster/gebco-depth', title: 'GEBCO depth: values', unit: 'm', band: 'elevation, GEBCO 2026',
    what: (grid) => `elevation (m, negative below mean sea level), ${grid}` },
  tid: { url: GEBCO_TID, key: 'raster/gebco-source', title: 'GEBCO depth sources: type identifier codes', unit: '', band: 'type identifier, GEBCO 2026',
    what: (grid) => `type identifier: how each cell's depth was obtained (0 land, 10–17 surveyed, 40–47 estimated, 70–72 other grids or unknown; the codes in GEBCO's documentation), ${grid}` },
};
export async function gebcoValues(box, variable = 'elevation') {
  const g = GEBCO_GRIDS[variable], store = await stores(g.url, () => openStore(g.url, fetchBytes));
  for (let k = 0; ; k++) {
    const name = `${k}/${variable}`, m = store.meta(name);
    if (!m) throw new Error('no level of the grid fits this view');
    const [H, W] = m.shape, cs = 180 / H;
    const cells = cellsOf(Float64Array.from({ length: H }, (_, i) => 90 - (i + 0.5) * cs), Float64Array.from({ length: W }, (_, i) => -180 + (i + 0.5) * cs), box);
    if (!cells.rows.length) return [];
    const blocks = new Set(cells.rows.map((r) => Math.floor(r / m.chunks[0]))).size * new Set(cells.cols.map((c) => Math.floor(c / m.chunks[1]))).size;
    if (blocks > 16 || cells.step > 1) continue;
    const grid = !k ? 'its own grid (15″ cells)' : variable === 'tid' ? `level ${k} of its grid (the most common code of ${2 ** k} × ${2 ** k} of its 15″ cells)` : `level ${k} of its grid (means of ${2 ** k} × ${2 ** k} of its 15″ cells)`;
    const description = `GEBCO 2026 Grid (GEBCO Compilation Group): ${g.what(grid)}, EPSG:4326, over the view's bounding box. No data: NaN. Not for navigation`;
    return [rasterOf(cells, g.key, { title: g.title, description, names: [variable], units: [g.unit], planes: [await readCells(store, name, 0, 0, cells)], bands: [{ description: g.band, unit: g.unit }] })];
  }
}

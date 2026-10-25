// The GIS export: the view as a zip of GIS data (export.js, zip.js): the map as a georeferenced
// PNG, one GeoJSON per vector layer drawn, the elevation grids and the data layers' values as
// GeoTIFF, the drawing as drawn and as its file, and a STAC Item that says what each is. What the
// map shows comes from app.js snapshot(), read when the view is captured.
import { DEM_SEA, DEM_LAND } from './catalog.js';
import { affine, worldFile, pamXml, stacItem } from './export.js';
import { gridFor, mosaic, gridTransform, geotiff } from './geotiff.js';
import { zip } from './zip.js';
import { viewFeatures } from './vector.js';
import { exportFeatures } from './draw/features.js';
import { lineTrace } from './draw/lines.js';
import { mercator } from './geo.js';
import { memo } from './net.js';
import { $, h } from './dom.js';
import { chartCanvas, chartPng, pngOf } from './png.js';

// deps: map, layersOf (item → its style layers), kindOf (item → its kind, with values()), drawing,
// display, profiled (the depth profiles read, by trace), clips { sea, land } (the clippers, for the
// elevation grids), cmemsDrawn(id, at) (a Copernicus layer's time and level as drawn), snapshot(src),
// onFrame(button, fn, before), download(blob, name). Returns exportZip(button).
export function gisExport({ map, layersOf, kindOf, drawing, display, profiled, clips, cmemsDrawn, snapshot, onFrame, download }) {
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
    { key: 'depth', items: ['depth'], clip: clips.sea, native: DEM_SEA.native, max: DEM_SEA.max, title: 'Depth',
      description: 'Seabed elevation in metres, negative below sea level, as the depth shading draws it: Terrarium DEM cut to the OSM coastline, pits and tile seams corrected; sea the DEM calls dry is -1. No data on land, lakes and inland water at sea level' },
    { key: 'elevation', items: ['relief', 'contours'], clip: clips.land, native: DEM_LAND.native, max: DEM_LAND.max, title: 'Land elevation',
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
        if (fs.length) it.assets.push(`vector/${it.id}`); // in item.json: the assets that hold this layer as data (keyed by path: a layer may be called chart, as the overview is)
      }
      const left = []; // what could not be read: the rest is saved, the button says what is missing
      // raster/<key>.tif for each elevation grid an item drawn reads
      const rasters = [];
      for (const r of RASTERS) {
        if (!layers.some((l) => r.items.includes(l.id))) continue;
        const grid = gridFor(corners.map(mercator), Math.max(0, Math.min(Math.floor(s.zoom + 1), r.max))), n = 2 ** grid.z;
        try {
          const tiles = await Promise.all(grid.tiles.map(([tx, ty]) => r.clip.metres(grid.z, ((tx % n) + n) % n, ty)));
          const gt = gridTransform(grid);
          rasters.push({ ...r, file: `raster/${r.key}.tif`, asset: `raster/${r.key}`, data: geotiff(mosaic(grid, tiles), grid.w, grid.h, gt, { description: r.description }), grid, transform: gt });
          for (const l of layers) if (r.items.includes(l.id)) l.assets.push(`raster/${r.key}`);
        } catch (e) { console.warn(`${r.title}:`, e.message); left.push(`${r.title} (${e.message})`); }
      }
      // the values of each layer drawn whose kind has them (Copernicus), as the view was captured
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const values = (await Promise.all(layers.filter((l) => kindOf(l.id)?.values).map((l) => kindOf(l.id).values(l, box)
        .then((rs) => { l.assets.push(...rs.map((r) => r.key)); return rs; }, (e) => { console.warn(`${l.label} values:`, e.message); left.push(`${l.label} values (${e.message})`); return []; })))).flat();
      // a Copernicus layer's time and level as drawn (its regional part's: its own step and level)
      for (const l of layers.filter((l) => l.kind === 'cmems')) {
        const { time, level } = await cmemsDrawn(l.id, l.at);
        Object.assign(l, { time: time == null ? undefined : new Date(time).toISOString(), depth: level == null ? undefined : +Math.abs(+level).toFixed(2) });
      }
      // the drawing: its visible elements as drawn (radii and outlines as polygons), and its file, to import again
      const drawn = exportFeatures(drawing.doc, display.units);
      // a line's length along the seabed (profile.js; a lower bound, the grid's relief), where its depth
      // profile was read as it is now drawn
      await Promise.all(drawn.filter((x) => x.properties.kind === 'line').map(async (f) => {
        const line = drawing.doc.lines.find((x) => x.id === f.properties.id), prof = profiled.peek(JSON.stringify(lineTrace(drawing.doc, line).coords));
        try { if (prof) f.properties.seabed_length_m = Math.round((await prof).seabed * 1000) / 1000; } catch { /* no depths: left out */ }
      }));
      if (drawn.length) vectors.push({ key: 'vector/drawings', title: 'Drawings', file: 'vector/drawings.geojson', data: featureCollection('Drawings', drawn), n: drawn.length, how: 'whole, geodesic values in metres' });
      const drawingFile = drawing.isEmpty() ? null : drawing.text();
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
          ...(drawingFile ? { drawing: { href: './drawing.geojson', type: 'application/geo+json', title: 'The drawing, editable: Charts, Import (GeoJSON, with what the app needs to edit it)', roles: ['data'] } } : {}),
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
        ...(drawingFile ? [{ name: 'drawing.geojson', data: drawingFile }] : []),
        ...rasters.map((r) => ({ name: r.file, data: r.data })),
        ...values.map((r) => ({ name: r.file, data: r.data })),
      ], when), `${name}.zip`);
      return left;
    }, async () => { clipping = await polygonClipping(); });
  }
  return exportZip;
}

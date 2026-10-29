// The map's style, from the catalogue: every source, and every layer in draw order. A layer belongs
// to a menu item through metadata.item; layers of a hidden item are set to visibility:none, and
// MapLibre requests no tiles for a source whose layers are all hidden.
import { DEM_SEA_MAX, DEM_LAND_MAX, OMT_TILEJSON, DENSITY, densityTiles, OVERLAYS, OVERLAY_MAXZOOM, OVERLAY_CREDIT, OVERLAY_FAINT, HA_CREDIT, GIBS, gibsTiles, CMEMS, ITEMS, DEPTH_SCHEMES, ISOBATH_ZOOMS, DEPTH_LEVELS, isMajorIsobath, NO_DEPTH, NO_DEPTH_M, SEAGRASS_ZOOMS, SEAGRASS_CLASSES } from './catalog.js';
import { HOSTS } from './hosts.js';
import { escapeHtml } from './format.js';

// Esri's credit: theirs, with the text its service gives (ESRI_META), escaped (it is set as markup)
export const esriAttribution = (copyrightText) => `Powered by <a href="https://www.esri.com">Esri</a> · ${escapeHtml(copyrightText)}`;

// the map's ink, for what is written on it and beside it (the legends, the picture's text)
export const INK = '#2b3a46', SOFT = '#5d6d79';
const C = {
  land: '#f1ebdc', sea: '#ffffff', ink: INK, inkSoft: SOFT,
  noDepth: NO_DEPTH,
  water: '#a9cbe3', waterText: '#2f6690', building: '#d9d1c1', buildingEdge: '#b7ac98',
  road: '#c9bea9', roadMajor: '#b3a68e', boundary: '#8a6f8f', grid: '#6b8193',
  isobath: DEPTH_SCHEMES.atlas.at(-1)[1], contour: '#a88a62', // isobaths on white: the deepest blue of the depth shading
};
const FONT = ['Noto Sans Regular'], FONT_I = ['Noto Sans Italic'], FONT_B = ['Noto Sans Bold'];
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name']];
const HALO = { 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.2 };

const ARROWS_LAST = (id) => ({ solidAndVector: 1, vector: 2 })[Object.values(CMEMS[id])[0].vector] || 0;

// ---- sources ----------------------------------------------------------------
function sources({ seaDemUrl, landDemUrl, isobathUrl, contourUrl, date, density = {} }) {
  // credits: the names each provider asks for, short enough for one line; what each layer is
  // made from is behind its ⓘ
  const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · <a href="https://openfreemap.org">OpenFreeMap</a>';
  const ATTR_DEM = '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a>'; // its sources' credits there
  const ATTR_GEBCO = '<a href="https://www.gebco.net">GEBCO 2026 Grid</a>'; // the sea's depths (gebco.js)
  const s = {
    omt: { type: 'vector', url: OMT_TILEJSON, attribution: ATTR_OSM },
    'dem-sea': { type: 'raster-dem', tiles: [seaDemUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_SEA_MAX, attribution: ATTR_GEBCO },
    dem: { type: 'raster-dem', tiles: [landDemUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_LAND_MAX, attribution: ATTR_DEM },
    seagrass: { type: 'vector', tiles: ['seagrass://{z}/{x}/{y}'], minzoom: SEAGRASS_ZOOMS[0], maxzoom: SEAGRASS_ZOOMS[1], bounds: [-50, 25, 45, 72],
      attribution: '<a href="https://emodnet.ec.europa.eu/en/seabed-habitats">EMODnet Seabed Habitats</a>' },
    isobaths: { type: 'vector', tiles: [isobathUrl], maxzoom: 12, attribution: ATTR_GEBCO }, // 512 px tiles: z12 is cut with the z12 coastline
    contours: { type: 'vector', tiles: [contourUrl], maxzoom: DEM_LAND_MAX, attribution: ATTR_DEM },
    eox16: { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
      tiles: [`${HOSTS.eox}/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`] },
    eox24: { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0',
      tiles: [`${HOSTS.eox}/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg`] },
    // Esri asks for "Powered by Esri" plus the service's own copyrightText (app.js refreshes it from
    // ESRI_META; this is the text it had on 2026-10-20)
    esri: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: esriAttribution('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'),
      tiles: [`${HOSTS.esri}/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`] },
    // the grid is 1 km: beyond zoom 10 the map overzooms instead of asking for more tiles
    traffic: { type: 'raster', tileSize: 256, maxzoom: 10, tiles: densityTiles('traffic', ...(density.traffic || ['all', DENSITY.traffic.defaultPeriod])),
      attribution: HA_CREDIT },
    routes: { type: 'raster', tileSize: 256, maxzoom: 10, tiles: densityTiles('routes', ...(density.routes || ['all', DENSITY.routes.defaultPeriod])),
      attribution: '<a href="https://www.emsa.europa.eu/">EMSA</a> (CC BY 4.0) via ' + HA_CREDIT },
    seamarks: { type: 'raster', tileSize: 256, minzoom: 6, maxzoom: 18, attribution: '© <a href="https://openseamap.org">OpenSeaMap</a> contributors (CC BY-SA)',
      tiles: [`${HOSTS.openseamap}/seamark/{z}/{x}/{y}.png`] },
    ...Object.fromEntries(Object.entries(OVERLAYS).flatMap(([item, vs]) => Object.entries(vs).map(([v, tiles]) => [`ov-${item}-${v}`,
      { type: 'raster', tileSize: 256, maxzoom: OVERLAY_MAXZOOM[item] ?? 18, tiles, attribution: OVERLAY_CREDIT[item] || HA_CREDIT }]))),
    // GEBCO's type identifier grid, coloured by gebco.js (gebco-tid://); level 0 from zoom 8, then magnified
    'gebco-tid': { type: 'raster', tileSize: 256, maxzoom: 10, tiles: ['gebco-tid://{z}/{x}/{y}'], attribution: ATTR_GEBCO },
    graticule: empty(),
    // the drawing (draw/drawing.js): what never depends on the zoom, what may, the marks (selection, the
    // line being drawn)
    draw: empty(),
    drawzoom: empty(),
    drawover: empty(),
    drawlabel: empty(), // its labels, drawn again as the map moves
    drawvalue: empty(), // the values shown (lengths, areas, radii)
    mylocation: empty(), // the device's location, when shown (app.js)
  };
  // tiles set by app.js once the hour is known (cmems:// is cmems.js's tile handler)
  for (const id of Object.keys(CMEMS)) {
    s[`cmems-${id}`] = { type: 'raster', tileSize: 512, maxzoom: 10, tiles: [], attribution: '<a href="https://marine.copernicus.eu">Copernicus Marine Service</a>' };
  }
  for (const [k, g] of Object.entries(GIBS)) {
    s[`gibs-${k}`] = { type: 'raster', tileSize: 256, maxzoom: g.level, tiles: gibsTiles(k, date),
      attribution: '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>' };
  }
  return s;
}

// ---- layers, bottom to top --------------------------------------------------
// a pier line's width in pixels at each zoom: PIER_M metres (pixels of 512 px tiles at 45°, where most
// of the map's use is: 55 346 / 2^z metres; nearer the poles a line reads a little wider), at least
// a pixel; plus `extra` pixels (the outline's)
const PIER_M = 3, PIER_OUTLINE_PX = 0.6;
const pierWidth = (extra) => ['interpolate', ['linear'], ['zoom'],
  ...[13, 14, 15, 16, 17, 18, 19, 20, 22].flatMap((z) => [z, +(Math.max(1, (PIER_M * 2 ** z) / 55346) + extra).toFixed(2)])];
const m = (item, variant) => ({ metadata: variant ? { item, variant } : { item } });
// an overlay's layers, one per variant (OVERLAYS), from its item's minzoom; a variant drawn lighter
// than the item's opacity says so (OVERLAY_FAINT: app.js multiplies the opacity by it)
const overlayLayers = (items) => items.flatMap((item) => {
  const vs = Object.keys(OVERLAYS[item]), minzoom = ITEMS.find((it) => it.id === item).minzoom;
  return vs.map((v) => {
    const l = { ...raster(`ov-${item}-${v}`, item, vs.length > 1 ? v : undefined), ...(minzoom && { minzoom }) };
    if (OVERLAY_FAINT[`${item}:${v}`]) l.metadata.opacity = OVERLAY_FAINT[`${item}:${v}`];
    return l;
  });
});
const raster = (id, item, variant) => ({ id, type: 'raster', source: id, ...m(item, variant), paint: { 'raster-fade-duration': 150 } });

// Positive elevations stay transparent so land is never tinted from the DEM: clip.js sends land
// as +1 m and water without a depth source (lakes above sea level) as NO_DEPTH_M (grey).
export function depthRamp(stops) {
  return ['interpolate', ['linear'], ['elevation'], -11000, stops[stops.length - 1][1],
    ...[...stops].reverse().flatMap(([d, c]) => [-Math.max(d, 0.1), c]), 0, 'rgba(255,255,255,0)',
    NO_DEPTH_M - 1, 'rgba(221,227,231,0)', NO_DEPTH_M, C.noDepth];
}

// the isobaths drawn from each zoom where lines are added (catalog.js ISOBATHS), one layer each
// (filters can't use zoom): [minzoom, maxzoom, depths]
const ISOBATH_RANGES = ISOBATH_ZOOMS.map(([z, ds], k, a) => [z, a[k + 1]?.[0] ?? 24, ds]);
const SEAGRASS_COLOUR = ['match', ['get', 'c'], ...SEAGRASS_CLASSES.flatMap(({ c, colour }) => [c, colour]), SEAGRASS_CLASSES.at(-1).colour];
const DEPTH = ['abs', ['get', 'ele']];
const isobathFilter = (depths) => ['all', ['<', ['get', 'ele'], 0], ['in', DEPTH, ['literal', depths]]];
const MAJOR = ['in', DEPTH, ['literal', DEPTH_LEVELS.filter(isMajorIsobath)]];

function layers() {
  const L = [
    { id: 'bg', type: 'background', paint: { 'background-color': C.land } },

    raster('eox16', 'sat', 'eox16'), raster('eox24', 'sat', 'eox24'), raster('esri', 'sat', 'esri'),

    // land relief and contours sit under the sea fill: the vector coastline cuts them sharply
    { id: 'relief', type: 'hillshade', source: 'dem', ...m('relief'),
      paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#3d4b55', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#5d6d79' } },

    { id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 9, ...m('contours'),
      filter: ['>', ['get', 'ele'], 0],
      paint: { 'line-color': C.contour, 'line-width': ['match', ['get', 'level'], 1, 0.8, 0.4] } },
    // Shore line drawn UNDER the water fill at twice its width: where two water polygons meet
    // (sea and a harbour basin, a lagoon and its canals; OSM draws a straight line between pier
    // heads) both fills cover it; where water meets land, the land-side half stays as the shore.
    // Ponds (irrigation tanks, cisterns, small reservoirs) get no shore line: a 20 m pond inside a
    // 2 px ring reads as a dark dot on land; they show as water fill alone, as on most maps.
    { id: 'coastline', type: 'line', source: 'omt', 'source-layer': 'water', ...m('coastline'),
      filter: ['in', ['get', 'class'], ['literal', ['ocean', 'dock', 'lake', 'river']]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': C.ink,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, ['match', ['get', 'class'], 'ocean', 0.8, 0.5], 12, ['match', ['get', 'class'], ['ocean', 'dock'], 2.2, 1.4]],
      } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', ...m('chart'),
      filter: ['!=', ['get', 'class'], 'swimming_pool'],
      // depth shading covers the open sea only (clip.js); inland water has no depth source
      paint: { 'fill-color': C.sea } }, // one water surface; depth shading marks what has no depth
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, ...m('chart'),
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal', 'stream']]],
      paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] } },

    // colour fills are chart-only: over satellite the image shows the water; isobaths still draw
    { id: 'depth', type: 'color-relief', source: 'dem-sea', maxzoom: 13, metadata: { item: 'depth', base: 'chart' }, paint: { 'color-relief-color': depthRamp(DEPTH_SCHEMES.atlas) } },
    raster('gebco-tid', 'depthsource'),
    ...overlayLayers(['emodnetdepth', 'substrate']),
    ...Object.keys(GIBS).map((k) => raster(`gibs-${k}`, 'gibs', k)),
    // colours, then the layers that can draw arrows (currents, then wind), whose arrows go over them
    ...Object.keys(CMEMS).sort((a, b) => ARROWS_LAST(a) - ARROWS_LAST(b)).map((id) => raster(`cmems-${id}`, id)),
    raster('traffic', 'traffic'), raster('routes', 'routes'), ...overlayLayers(['worlddensity']),
    // seagrass: meadows as fills, a thin edge of their colour once they are large enough to need
    // one; survey points as dots from zoom 10, where they no longer merge into smudges
    { id: 'seagrass', type: 'fill', source: 'seagrass', 'source-layer': 'seagrass', ...m('seagrass'),
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': SEAGRASS_COLOUR, 'fill-outline-color': SEAGRASS_COLOUR } },
    { id: 'seagrass-points', type: 'circle', source: 'seagrass', 'source-layer': 'seagrass', minzoom: 10, ...m('seagrass'),
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-color': SEAGRASS_COLOUR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 3.5],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0, 13, 0.6] } },

    // drawn at every zoom: above the DEM's zoom 12 the lines are magnified, not refined; above every
    // picture that colours the sea, under what stands in it (piers, zones, cables, wrecks, seamarks).
    // Their colour follows what is under them (app.js isobathInk). The shelf and every 1000 m a
    // little wider: not so much that they outweigh the rest (their labels say which they are)
    ...ISOBATH_RANGES.map(([z0, z1, depths], k) => ({ id: k ? `isobaths-${k}` : 'isobaths', type: 'line', source: 'isobaths', 'source-layer': 'contours',
      minzoom: z0, maxzoom: z1, ...m('isobaths'), filter: isobathFilter(depths),
      paint: { 'line-color': C.isobath, 'line-width': ['case', MAJOR, 0.8, 0.55] } })),

    // Piers and breakwaters as land at about their true width (the shore line under the water
    // fill would otherwise half-hide anything narrower than itself), above every water layer
    { id: 'piers', type: 'fill', source: 'omt', 'source-layer': 'transportation', minzoom: 12, metadata: { item: 'coastline', base: 'chart' }, // over satellite the image shows the piers
      filter: ['all', ['==', ['get', 'class'], 'pier'], ['==', ['geometry-type'], 'Polygon']],
      paint: { 'fill-color': C.land, 'fill-outline-color': C.ink } },
    // Piers mapped as lines (pontoons, jetties) at about their true width, PIER_M: as narrow as a
    // marina's pontoons are, with boats between them, not a comb of land; never under a pixel, and
    // from zoom 13, where a marina's pontoons can be told apart. A thin ink outline, the same at
    // every zoom, as mapped areas have
    { id: 'pier-lines-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, metadata: { item: 'coastline', base: 'chart' }, // over satellite the image shows the piers
      filter: ['all', ['==', ['get', 'class'], 'pier'], ['==', ['geometry-type'], 'LineString']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 14, C.inkSoft, 15, C.ink], 'line-width': pierWidth(PIER_OUTLINE_PX * 2) } }, // while a pier is a pixel wide, a softer outline: not a dark hatching
    { id: 'pier-lines', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, metadata: { item: 'coastline', base: 'chart' }, // over satellite the image shows the piers
      filter: ['all', ['==', ['get', 'class'], 'pier'], ['==', ['geometry-type'], 'LineString']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': C.land, 'line-width': pierWidth(0) } },

    { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6, ...m('roads'),
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], C.roadMajor, C.road],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'],
          6, ['match', ['get', 'class'], ['motorway', 'trunk'], 0.7, 'primary', 0.4, 0.2],
          16, ['match', ['get', 'class'], ['motorway', 'trunk'], 6, ['primary', 'secondary'], 4.5, 2]],
      } },
    { id: 'buildings', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, ...m('buildings'),
      paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingEdge } },

    { id: 'boundaries', type: 'line', source: 'omt', 'source-layer': 'boundary', ...m('boundaries'),
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': C.boundary, 'line-dasharray': [3, 2],
        'line-width': ['match', ['get', 'admin_level'], 2, 1.1, 0.5], 'line-opacity': ['match', ['get', 'admin_level'], 2, 0.8, 0.45] } },

    ...overlayLayers(['maritime', 'protected', 'military', 'windfarms', 'platforms', 'pipelines', 'cables', 'wrecks']),
    { ...raster('seamarks', 'seamarks'), minzoom: 9 },

    { id: 'graticule', type: 'line', source: 'graticule', ...m('graticule'), filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': C.grid, 'line-width': 0.5, 'line-opacity': 0.55 } },

    ...ISOBATH_RANGES.map(([z0, z1, depths], k) => ({ id: k ? `isobath-labels-${k}` : 'isobath-labels', type: 'symbol', source: 'isobaths', 'source-layer': 'contours',
      minzoom: Math.max(6, z0), maxzoom: z1, ...m('isobaths'), filter: isobathFilter(depths),
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', DEPTH], ' m'],
        // coarse contours wiggle: allow more bend and place often, or long stretches go unlabelled;
        // zoomed in, where lines run close along a coast, each label further along its line and
        // kept clear of its neighbours' (padding), so fewer of them crowd together
        'text-font': FONT, 'text-size': 10, 'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 8, 220, 13, 600], 'text-max-angle': 55,
        'text-padding': ['interpolate', ['linear'], ['zoom'], 8, 2, 13, 24] },
      paint: { 'text-color': C.isobath, ...HALO } })),
    { id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 11, ...m('contours'),
      filter: ['all', ['>', ['get', 'ele'], 0], ['==', ['get', 'level'], 1]],
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
        'text-font': FONT, 'text-size': 10, 'symbol-spacing': 320 },
      paint: { 'text-color': C.contour, ...HALO } },

    // a sea's name runs along a line across it: repeat it rarely, and not at harbour zooms,
    // where the line spans many screens and the name would appear every few hundred pixels
    { id: 'sea-names-line', type: 'symbol', source: 'omt', 'source-layer': 'water_name', maxzoom: 12, ...m('seanames'),
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT_I, 'text-size': 13, 'text-letter-spacing': 0.15,
        'symbol-spacing': 1200 },
      paint: { 'text-color': C.waterText, ...HALO } },
    { id: 'sea-names', type: 'symbol', source: 'omt', 'source-layer': 'water_name', ...m('seanames'),
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': NAME, 'text-font': FONT_I, 'text-max-width': 8, 'text-letter-spacing': 0.15,
        'text-size': ['match', ['get', 'class'], 'ocean', 16, 'sea', 14, 12] },
      paint: { 'text-color': C.waterText, ...HALO } },

    { id: 'islands', type: 'symbol', source: 'omt', 'source-layer': 'place', ...m('places'),
      filter: ['in', ['get', 'class'], ['literal', ['island', 'islet']]],
      layout: { 'text-field': NAME, 'text-font': FONT_I, 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': C.ink, ...HALO } },
    { id: 'places', type: 'symbol', source: 'omt', 'source-layer': 'place', ...m('places'),
      filter: ['!', ['in', ['get', 'class'], ['literal', ['island', 'islet', 'continent', 'state', 'province']]]],
      layout: { 'text-field': NAME, 'text-max-width': 8, 'symbol-sort-key': ['get', 'rank'],
        'text-font': ['match', ['get', 'class'], ['country', 'city'], ['literal', FONT_B], ['literal', FONT]],
        'text-size': ['match', ['get', 'class'], 'country', 13, 'state', 11, 'city', 14, 'town', 12, 'village', 11, 10],
        'text-transform': ['match', ['get', 'class'], ['country', 'state'], 'uppercase', 'none'],
        'text-letter-spacing': ['match', ['get', 'class'], ['country', 'state'], 0.12, 0] },
      paint: { 'text-color': ['match', ['get', 'class'], ['country', 'state'], C.inkSoft, C.ink], ...HALO } },

    // one label per line, at the frame edge (points placed by app.js updateGraticule)
    { id: 'graticule-labels', type: 'symbol', source: 'graticule', ...m('graticule'),
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 10,
        'text-anchor': ['get', 'anchor'], 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': C.grid, ...HALO } },
  ];
  // Every layer starts hidden; the app shows what the URL / defaults ask for.
  for (const l of L) if (l.metadata) l.layout = { ...l.layout, visibility: 'none' };
  return L;
}

// the device's location, above everything: how sure it is (a circle of its accuracy), then the dot
export const LOCATION_LAYERS = [
  { id: 'mylocation-accuracy', type: 'fill', source: 'mylocation', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#1f5f86', 'fill-opacity': 0.15, 'fill-outline-color': '#1f5f86' } },
  { id: 'mylocation', type: 'circle', source: 'mylocation', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 7, 'circle-color': '#1f5f86', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } },
];

// the colour pictures drawn above EMODnet depth and under the isobaths (layers() puts them there):
// over one, the isobaths take a dark ink (app.js isobathInk). Ocean data is the same; seagrass, whose
// meadows leave the depth shading seen round them, is not
export const SEA_PICTURES = ['substrate', 'traffic', 'routes', 'worlddensity'];

// a GeoJSON source with nothing in it yet
const empty = () => ({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

export function buildStyle(opts) {
  return {
    version: 8,
    glyphs: `${HOSTS.openfreemap}/fonts/{fontstack}/{range}.pbf`,
    sources: sources(opts),
    layers: layers(),
  };
}

// Paint property that an item's opacity slider drives, per layer type.
export const OPACITY_PROP = {
  raster: 'raster-opacity', fill: 'fill-opacity', line: 'line-opacity', symbol: 'text-opacity', circle: 'circle-opacity',
  'color-relief': 'color-relief-opacity', hillshade: 'hillshade-exaggeration',
};

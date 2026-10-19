// Layer catalog: every source, every style layer (in draw order), and the menu
// items that switch them. A style layer belongs to a menu item through
// metadata.item; layers of a hidden item are set to visibility:none, and
// MapLibre requests no tiles for a source whose layers are all hidden.

export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Terrarium carries bathymetry only up to zoom 10: above that most seas read 0 m
// (SRTM fills water with 0). Sea layers read zoom ≤ 10 tiles and overzoom; land
// layers use zoom 12 (~30 m SRTM).
export const DEM_SEA_MAXZOOM = 10;
export const DEM_LAND_MAXZOOM = 12;

const C = {
  land: '#f1ebdc', sea: '#ffffff', ink: '#2b3a46', inkSoft: '#5d6d79',
  water: '#a9cbe3', waterText: '#2f6690', building: '#d9d1c1', buildingEdge: '#b7ac98',
  road: '#c9bea9', roadMajor: '#b3a68e', boundary: '#8a6f8f', grid: '#6b8193',
  isobath: '#5b8db5', contour: '#a88a62',
};
const FONT = ['Noto Sans Regular'], FONT_I = ['Noto Sans Italic'], FONT_B = ['Noto Sans Bold'];
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name']];
const HALO = { 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.2 };

// Day to show for NASA GIBS: yesterday (UTC), the most recent complete day.
export function defaultDate() {
  return new Date(Date.now() - 864e5).toISOString().slice(0, 10);
}

export const GIBS = {
  terra: { label: 'True colour · MODIS Terra', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', level: 9, ext: 'jpg', res: '250 m' },
  viirs: { label: 'True colour · VIIRS NOAA-20', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', level: 9, ext: 'jpg', res: '250 m' },
  sst:   { label: 'Sea surface temperature · MUR', layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', level: 7, ext: 'png', res: '1 km' },
  chl:   { label: 'Chlorophyll-a · MODIS Aqua', layer: 'MODIS_Aqua_L2_Chlorophyll_A', level: 7, ext: 'png', res: '1 km' },
};
export function gibsTiles(key, date) {
  const g = GIBS[key];
  return [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${g.layer}/default/${date}/GoogleMapsCompatible_Level${g.level}/{z}/{y}/{x}.${g.ext}`];
}

// ---- menu -------------------------------------------------------------------
// exclusive: items in the group behave as radio buttons.
// minzoom / maxzoom: outside them the item is greyed out with a hint and draws nothing.
// opacity: default value of the item's slider (absent = no slider).
// variants: alternatives inside one item; only the chosen variant's layers draw.
export const GROUPS = [
  { id: 'base', label: 'Base', exclusive: true },
  { id: 'sea', label: 'Sea' },
  { id: 'land', label: 'Land' },
  { id: 'imagery', label: 'Daily imagery' },
  { id: 'labels', label: 'Labels & grid' },
];

export const ITEMS = [
  { id: 'chart', group: 'base', label: 'Chart', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap (OpenMapTiles schema)', lic: 'ODbL · © OpenStreetMap contributors', res: 'Coastline from OSM water polygons; generalised below zoom 7', url: 'https://openfreemap.org' } },
  { id: 'sat', group: 'base', label: 'Satellite', opacity: 1,
    variants: { eox16: 'Sentinel-2 2016 · EOX (CC BY)', eox24: 'Sentinel-2 2024 · EOX (non-commercial)', esri: 'Esri World Imagery (check terms)' },
    info: { src: 'EOX Sentinel-2 cloudless, or Esri World Imagery', lic: 'EOX 2016: CC BY 4.0 · EOX 2024: CC BY-NC-SA 4.0 · Esri: Esri terms of use', res: 'Sentinel-2: 10 m · Esri: up to ~0.5 m, varies', url: 'https://s2maps.eu' } },

  { id: 'depth', group: 'sea', label: 'Depth shading', on: true, opacity: 1, maxzoom: 12,
    info: { src: 'AWS Terrain Tiles (Terrarium): ETOPO1 and GEBCO-class seabed, NOAA coastal DEMs', lic: 'Open data, attribution per source', res: 'Seabed ~1–2 km in open sea, finer in US and some European waters. Drawn from the DEM, so near the coast it does not follow the OSM coastline exactly. Off above zoom 12: the data has no more detail', url: 'https://registry.opendata.aws/terrain-tiles/' } },
  { id: 'isobaths', group: 'sea', label: 'Isobaths', on: true, opacity: 1, minzoom: 4, maxzoom: 12,
    info: { src: 'Contoured in your browser from the Terrarium DEM (maplibre-contour)', lic: 'As DEM', res: 'Interval by zoom: 1000/200/100/20 m. As coarse as the DEM beneath: smoothed shapes, not surveyed soundings. Off above zoom 12', url: 'https://github.com/onthegomap/maplibre-contour' } },
  { id: 'emodnet', group: 'sea', label: 'EMODnet bathymetry', opacity: 0.85,
    info: { src: 'EMODnet Bathymetry DTM base layer (WMTS)', lic: 'CC BY 4.0 · EMODnet Bathymetry Consortium', res: '1/16′ (~115 m) in European seas; GEBCO elsewhere. Raster includes its own land rendering', url: 'https://emodnet.ec.europa.eu/en/bathymetry' } },
  { id: 'gebco', group: 'sea', label: 'GEBCO bathymetry', opacity: 0.85,
    info: { src: 'GEBCO latest global grid (WMS)', lic: 'Public domain, attribution requested · GEBCO Compilation Group', res: '15″ (~450 m) global. Raster includes land topography', url: 'https://www.gebco.net' } },
  { id: 'seamarks', group: 'sea', label: 'Seamarks', minzoom: 9, opacity: 1,
    info: { src: 'OpenSeaMap seamark overlay', lic: 'CC BY-SA 2.0 · OpenSeaMap contributors', res: 'Crowd-sourced; completeness varies. Not an official chart', url: 'https://openseamap.org' } },

  { id: 'coastline', group: 'land', label: 'Coastline', on: true,
    info: { src: 'OSM water polygons via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Survey-grade at zoom ≥ 10 where OSM is mapped; generalised below', url: 'https://osmdata.openstreetmap.de/data/water-polygons.html' } },
  { id: 'relief', group: 'land', label: 'Relief shading', on: true, opacity: 0.3,
    info: { src: 'Hillshade from the Terrarium DEM (land and seabed)', lic: 'As DEM', res: 'Land: SRTM 30 m; seabed ~1–2 km, shown to zoom 10', url: 'https://registry.opendata.aws/terrain-tiles/' } },
  { id: 'contours', group: 'land', label: 'Land contours', minzoom: 9, opacity: 1,
    info: { src: 'Contoured in your browser from the Terrarium DEM', lic: 'As DEM', res: 'SRTM 30 m; interval by zoom', url: 'https://github.com/onthegomap/maplibre-contour' } },
  { id: 'roads', group: 'land', label: 'Roads', on: true, minzoom: 6, opacity: 1,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Minor roads appear from zoom 12', url: 'https://openfreemap.org' } },
  { id: 'buildings', group: 'land', label: 'Buildings', on: true, minzoom: 13, opacity: 1,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Footprints as mapped in OSM; coverage varies by country', url: 'https://openfreemap.org' } },

  { id: 'gibs', group: 'imagery', label: 'NASA daily', opacity: 0.9, date: true,
    variants: Object.fromEntries(Object.entries(GIBS).map(([k, g]) => [k, g.label])),
    info: { src: 'NASA EOSDIS GIBS (WMTS)', lic: 'NASA open data; attribution requested', res: 'True colour 250 m, to zoom 9 · SST and chlorophyll 1 km, to zoom 7. Clouds and swath gaps are real', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' } },

  { id: 'places', group: 'labels', label: 'Place names', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'English name where tagged, else local name', url: 'https://openfreemap.org' } },
  { id: 'seanames', group: 'labels', label: 'Sea names', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Oceans, seas, bays, straits as tagged in OSM', url: 'https://openfreemap.org' } },
  { id: 'boundaries', group: 'labels', label: 'Boundaries', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Land boundaries only; maritime claims are not drawn', url: 'https://openfreemap.org' } },
  { id: 'graticule', group: 'labels', label: 'Graticule', on: true,
    info: { src: 'Computed in your browser (WGS 84)', lic: '—', res: 'Spacing adapts to zoom, down to 1′', url: '' } },
];

// ---- sources ----------------------------------------------------------------
function sources({ seaDemUrl, landDemUrl, isobathUrl, contourUrl, date }) {
  const ATTR_OSM = '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const ATTR_DEM = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen/AWS Terrain Tiles</a>';
  const s = {
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: ATTR_OSM },
    'dem-sea': { type: 'raster-dem', tiles: [seaDemUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_SEA_MAXZOOM, attribution: ATTR_DEM },
    dem: { type: 'raster-dem', tiles: [landDemUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_LAND_MAXZOOM, attribution: ATTR_DEM },
    isobaths: { type: 'vector', tiles: [isobathUrl], maxzoom: DEM_SEA_MAXZOOM, attribution: ATTR_DEM },
    contours: { type: 'vector', tiles: [contourUrl], maxzoom: DEM_LAND_MAXZOOM, attribution: ATTR_DEM },
    eox16: { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'] },
    eox24: { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'] },
    esri: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
    emodnet: { type: 'raster', tileSize: 256, maxzoom: 12, attribution: '<a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry Consortium</a>',
      tiles: ['https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png'] },
    gebco: { type: 'raster', tileSize: 256, maxzoom: 12, attribution: '<a href="https://www.gebco.net">GEBCO Compilation Group</a>, GEBCO grid',
      tiles: ['https://wms.gebco.net/mapserv?service=WMS&version=1.3.0&request=GetMap&layers=GEBCO_LATEST&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png'] },
    seamarks: { type: 'raster', tileSize: 256, minzoom: 6, maxzoom: 18, attribution: 'Seamarks: <a href="https://openseamap.org">OpenSeaMap</a>',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'] },
    graticule: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    measure: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  };
  for (const [k, g] of Object.entries(GIBS)) {
    s[`gibs-${k}`] = { type: 'raster', tileSize: 256, maxzoom: g.level, tiles: gibsTiles(k, date),
      attribution: 'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a>' };
  }
  return s;
}

// ---- layers, bottom to top --------------------------------------------------
const m = (item, variant) => ({ metadata: variant ? { item, variant } : { item } });
const raster = (id, item, variant) => ({ id, type: 'raster', source: id, ...m(item, variant), paint: { 'raster-fade-duration': 150 } });

// Terrarium depth bands: chart convention, shallow water darkest blue, deep water white.
// Positive elevations stay transparent so land is never tinted from the DEM.
const DEPTH_RAMP = ['interpolate', ['linear'], ['elevation'],
  -11000, 'rgba(255,255,255,0)', -2000, 'rgba(236,244,250,1)', -200, '#dbeaf5', -50, '#c9e0f1',
  -20, '#b6d5ec', -5, '#a3c9e6', -0.1, '#97c1e2', 0, 'rgba(151,193,226,0)'];

function layers() {
  const L = [
    { id: 'bg', type: 'background', paint: { 'background-color': C.land } },

    raster('eox16', 'sat', 'eox16'), raster('eox24', 'sat', 'eox24'), raster('esri', 'sat', 'esri'),

    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', ...m('chart'),
      filter: ['!=', ['get', 'class'], 'swimming_pool'], paint: { 'fill-color': C.sea } },
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, ...m('chart'),
      filter: ['in', ['get', 'class'], ['literal', ['river', 'canal', 'stream']]],
      paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] } },

    { id: 'depth', type: 'color-relief', source: 'dem-sea', maxzoom: 13, ...m('depth'), paint: { 'color-relief-color': DEPTH_RAMP } },
    raster('emodnet', 'emodnet'), raster('gebco', 'gebco'),
    ...Object.keys(GIBS).map((k) => ({ ...raster(`gibs-${k}`, 'gibs', k), source: `gibs-${k}` })),

    { id: 'relief', type: 'hillshade', source: 'dem', ...m('relief'),
      paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#3d4b55', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#5d6d79' } },

    { id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 9, ...m('contours'),
      filter: ['>', ['get', 'ele'], 0],
      paint: { 'line-color': C.contour, 'line-width': ['match', ['get', 'level'], 1, 0.8, 0.4] } },
    { id: 'isobaths', type: 'line', source: 'isobaths', 'source-layer': 'contours', minzoom: 4, maxzoom: 13, ...m('isobaths'),
      filter: ['<', ['get', 'ele'], 0],
      paint: { 'line-color': C.isobath, 'line-width': ['match', ['get', 'level'], 1, 0.9, 0.45] } },

    { id: 'coastline', type: 'line', source: 'omt', 'source-layer': 'water', ...m('coastline'),
      filter: ['in', ['get', 'class'], ['literal', ['ocean', 'lake', 'river']]],
      paint: { 'line-color': C.ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 12, 1.1] } },

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

    { ...raster('seamarks', 'seamarks'), minzoom: 9 },

    { id: 'graticule', type: 'line', source: 'graticule', ...m('graticule'),
      paint: { 'line-color': C.grid, 'line-width': 0.5, 'line-opacity': 0.55 } },

    { id: 'isobath-labels', type: 'symbol', source: 'isobaths', 'source-layer': 'contours', minzoom: 6, maxzoom: 13, ...m('isobaths'),
      filter: ['all', ['<', ['get', 'ele'], 0], ['==', ['get', 'level'], 1]],
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['abs', ['get', 'ele']]], ' m'],
        'text-font': FONT, 'text-size': 10, 'symbol-spacing': 320, 'text-max-angle': 30 },
      paint: { 'text-color': C.isobath, ...HALO } },
    { id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 11, ...m('contours'),
      filter: ['all', ['>', ['get', 'ele'], 0], ['==', ['get', 'level'], 1]],
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
        'text-font': FONT, 'text-size': 10, 'symbol-spacing': 320 },
      paint: { 'text-color': C.contour, ...HALO } },

    { id: 'sea-names-line', type: 'symbol', source: 'omt', 'source-layer': 'water_name', ...m('seanames'),
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT_I, 'text-size': 13, 'text-letter-spacing': 0.15 },
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

    { id: 'graticule-labels', type: 'symbol', source: 'graticule', ...m('graticule'),
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': FONT,
        'text-size': 10, 'symbol-spacing': 420 },
      paint: { 'text-color': C.grid, ...HALO } },
  ];
  // Every layer starts hidden; the app shows what the URL / defaults ask for.
  for (const l of L) if (l.metadata) l.layout = { ...l.layout, visibility: 'none' };
  return L;
}

export function buildStyle(opts) {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: sources(opts),
    layers: layers(),
  };
}

// Paint property that an item's opacity slider drives, per layer type.
export const OPACITY_PROP = {
  raster: 'raster-opacity', fill: 'fill-opacity', line: 'line-opacity', symbol: 'text-opacity',
  'color-relief': 'color-relief-opacity', hillshade: 'hillshade-exaggeration',
};

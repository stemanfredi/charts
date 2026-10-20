import { NO_DEPTH_M } from './clip.js';

// Layer catalog: every source, every style layer (in draw order), and the menu
// items that switch them. A style layer belongs to a menu item through
// metadata.item; layers of a hidden item are set to visibility:none, and
// MapLibre requests no tiles for a source whose layers are all hidden.

export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
// Terrarium carries bathymetry only up to zoom 10: above that most seas read 0 m
// (SRTM fills water with 0). `native` is the zoom read from the server, `max` the
// zoom served after clipping to the OSM coastline (clip.js), upsampled in between.
// sea max 13: depth shading shows up to map zoom 13, and a 256 px tile at z shows at map zoom
// z − 1 and is cut with the OSM coastline of that zoom; capped at 12, map zoom 12 was cut with the
// zoom-11 coastline, where small islands do not exist yet, and they vanished under the tint
export const DEM_SEA = { native: 10, max: 13 };
export const DEM_LAND = { native: 12, max: 12 }; // no upsampling: slopes of an upsampled DEM shade in facets
export const OMT_TILEJSON = 'https://tiles.openfreemap.org/planet';

const C = {
  land: '#f1ebdc', sea: '#ffffff', ink: '#2b3a46', inkSoft: '#5d6d79',
  // water without depth data (lakes above sea level): never white, which reads as deep
  noDepth: '#dde3e7',
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

// Shipping density from EMODnet Human Activities (WMS, keyless, CORS), on a 1 km grid over
// EU and neighbouring seas. Two datasets, each with ship types (keys prefixed 't', because
// integer-like object keys such as '10' would be sorted ahead of 'all'), a period and the
// colour stops the service publishes (GetLegendGraphic, format=application/json).
const STOPS = [[0, '#0b2c7a'], [0.5, '#20998f'], [2, '#00db00'], [5, '#ffff00'], [10, '#eda113'], [20, '#dd3a1b'], [100, '#9b1800']];
const months = (from, to) => { // 'YYYY-MM' inclusive, newest first
  const out = [];
  for (let [y, m] = to.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` >= from; m === 1 ? (y--, m = 12) : m--) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
};
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
export const DENSITY = {
  // EMODnet vessel density: hours ships spend per km², annual averages of monthly totals
  traffic: {
    title: 'Vessel density', unit: 'h/km² per month',
    types: { all: 'All ship types', t09: 'Cargo', t10: 'Tanker', t08: 'Passenger', t01: 'Fishing', t05: 'Pleasure craft',
      t04: 'Sailing', t06: 'High-speed craft', t07: 'Tug and towing', t02: 'Service', t03: 'Dredging, underwater ops',
      t11: 'Military, law enforcement', t00: 'Other', t12: 'Unknown' },
    periods: [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017].map(String),
    defaultPeriod: '2023', // 2024 is thinner: the AIS provider lost satellite data from June 2024
    periodLabel: (p) => (p === '2024' ? `${p} (incomplete)` : p),
    layer: (type) => `vesseldensity_${type.replace(/^t/, '')}avg`, time: (p) => `${p}-01-01`, stops: STOPS,
  },
  // EMSA route density: number of ship routes crossing each 1 km cell, monthly totals
  routes: {
    title: 'Route density', unit: 'routes per 1 km cell per month',
    types: { all: 'All ship types', t01: 'Cargo', t04: 'Tanker', t03: 'Passenger', t02: 'Fishing', t05: 'Other' },
    periods: months('2019-01', '2026-07'), // newest month in the WMS on 2026-10-20; npm run deps reports newer ones
    get defaultPeriod() { return this.periods[0]; },
    periodLabel: (p) => `${MONTHS[+p.slice(5) - 1]} ${p.slice(0, 4)}`,
    layer: (type) => `routedensity_${type.replace(/^t/, '')}`, time: (p) => `${p}-01`, stops: STOPS,
  },
};
export const DENSITY_WMS = 'https://ows.emodnet-humanactivities.eu/wms';
export function densityTiles(id, type, period) {
  const d = DENSITY[id];
  return [`${DENSITY_WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${d.layer(type)}&styles=`
    + `&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true&time=${d.time(period)}T00:00:00.000Z`];
}

export const ESRI_META = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json';
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const esriAttribution = (copyrightText) => `Powered by <a href="https://www.esri.com">Esri</a> · ${escapeHtml(copyrightText)}`;

export const GIBS = {
  terra: { label: 'True colour · MODIS Terra', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', level: 9, ext: 'jpg', res: '250 m' },
  viirs: { label: 'True colour · VIIRS NOAA-20', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', level: 9, ext: 'jpg', res: '250 m' },
  sst:   { label: 'Sea surface temperature · MUR', layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', level: 7, ext: 'png', res: '1 km',
    legend: { title: 'Sea surface temperature', units: '°C', colormap: 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml' } },
  chl:   { label: 'Chlorophyll-a · MODIS Aqua', layer: 'MODIS_Aqua_L2_Chlorophyll_A', level: 7, ext: 'png', res: '1 km' },
};
export function gibsTiles(key, date) {
  const g = GIBS[key];
  return [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${g.layer}/default/${date}/GoogleMapsCompatible_Level${g.level}/{z}/{y}/{x}.${g.ext}`];
}
// NASA publishes each layer after its own delay (true colour within a day, MUR SST about two days):
// GIBS DescribeDomains lists the dates a layer has between from and to (YYYY-MM-DD)
export function gibsDomainUrl(key, from, to) {
  const g = GIBS[key];
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/${g.layer}/default/GoogleMapsCompatible_Level${g.level}/all/${from}--${to}.xml`;
}
// the newest date in a DescribeDomains reply: <Domain>start/end/P1D[,start/end/P1D…]</Domain>
export function domainEnd(xml) {
  const ends = [...(/<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1] || '').matchAll(/\d{4}-\d{2}-\d{2}\/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  return ends.length ? ends.sort().at(-1) : null;
}

// ---- menu -------------------------------------------------------------------
// exclusive: items in the group behave as radio buttons.
// minzoom / maxzoom: outside them the item is greyed out with a hint and draws nothing.
// opacity: default value of the item's slider (absent = no slider).
// variants: alternatives inside one item; only the chosen variant's layers draw.
export const GROUPS = [
  { id: 'base', label: 'Base', exclusive: true },
  { id: 'sea', label: 'Sea' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'land', label: 'Land' },
  { id: 'imagery', label: 'Daily imagery' },
  { id: 'labels', label: 'Labels & grid' },
];

export const ITEMS = [
  { id: 'chart', group: 'base', label: 'Chart', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap (OpenMapTiles schema)', lic: 'ODbL · © OpenStreetMap contributors', res: 'Coastline from OSM water polygons; generalised below zoom 7', url: 'https://openfreemap.org' } },
  { id: 'sat', group: 'base', label: 'Satellite', opacity: 1,
    variants: { esri: 'Esri World Imagery (Esri terms)', eox16: 'Sentinel-2 2016 · EOX (CC BY)', eox24: 'Sentinel-2 2024 · EOX (non-commercial)' }, // first = default
    info: { src: 'Esri World Imagery (default), or EOX Sentinel-2 cloudless', lic: 'EOX 2016: CC BY 4.0 · EOX 2024: CC BY-NC-SA 4.0 · Esri: Esri terms of use', res: 'Sentinel-2: 10 m · Esri: up to ~0.5 m, varies', url: 'https://s2maps.eu' } },

  { id: 'depth', group: 'sea', label: 'Depth shading', on: true, opacity: 1, maxzoom: 12,
    variants: { atlas: 'Darker = deeper (atlas)', nautical: 'Darker = shallower (nautical chart)' },
    info: { src: 'AWS Terrain Tiles (Terrarium): ETOPO1 and GEBCO-class seabed, NOAA coastal DEMs', lic: 'Open data, attribution per source', res: 'Seabed ~1–2 km in open sea, finer in US and some European waters. Cut to the OSM coastline, so land below sea level is never tinted; sea the DEM calls dry is shown as the shallowest class. Inland water is classified once per water body from the DEM at its shore: at sea level (limans, lagoons, harbour basins) it is shown flat in the shallowest class, depth unknown; lakes above it are grey, no depth data. Caspian depths are measured from its surface (−28 m), not from sea level. Off above zoom 12: the data has no more detail', url: 'https://registry.opendata.aws/terrain-tiles/' } },
  { id: 'isobaths', group: 'sea', label: 'Isobaths', on: true, opacity: 1, minzoom: 4,
    info: { src: 'Contoured in your browser from the Terrarium DEM (maplibre-contour)', lic: 'As DEM', res: 'Spacing widens with depth and tightens with zoom: 5 m, every 10 m to 50 m, 50 m to 200 m, then 500/200/100 m to 3000 m and 1000/500 m below ( indicative only, the seabed data is ~1–2 km in open sea). As coarse as the DEM beneath: smoothed shapes, not surveyed soundings. Traced on the DEM cut to the OSM coastline (to zoom 12, about 38 m per pixel). Above zoom 12 the same lines are magnified: they can stop short of the coast or cross it by a few pixels', url: 'https://github.com/onthegomap/maplibre-contour' } },
  { id: 'traffic', group: 'shipping', label: 'Vessel density', opacity: 0.85, density: true, variantsBy: 'tiles',
    variants: DENSITY.traffic.types,
    info: { src: 'EMODnet Human Activities vessel density (Cogea), from AIS bought from CLS, ORBCOMM and vesseltracker.com', lic: 'EMODnet open data, no access constraints; attribution requested', res: '1 km grid, annual averages of hours per km² per month, 2017–2024. EU and neighbouring seas only. 2024 is incomplete (satellite AIS lost from June). Not real time', url: 'https://emodnet.ec.europa.eu/en/human-activities' } },
  { id: 'routes', group: 'shipping', label: 'Route density', opacity: 0.85, density: true, variantsBy: 'tiles',
    variants: DENSITY.routes.types,
    info: { src: 'EMSA route density, via EMODnet Human Activities: ship tracks rebuilt from terrestrial and satellite AIS, counting the routes that cross each cell', lic: 'CC BY 4.0 · European Maritime Safety Agency (EMSA)', res: '1 km grid, monthly totals since January 2019, about 3 months behind. EU and neighbouring seas only. Counts passages, not time spent (see Vessel density for hours)', url: 'https://www.emsa.europa.eu/related-operational-projects/traffic-density-maps.html' } },
  { id: 'seamarks', group: 'sea', label: 'Seamarks', minzoom: 9, opacity: 1,
    info: { src: 'OpenSeaMap seamark overlay', lic: 'CC BY-SA 2.0 · OpenSeaMap contributors', res: 'Crowd-sourced; completeness varies. Not an official chart', url: 'https://openseamap.org' } },

  { id: 'coastline', group: 'land', label: 'Coastline', on: true,
    info: { src: 'OSM water polygons via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Survey-grade at zoom ≥ 10 where OSM is mapped; generalised below', url: 'https://osmdata.openstreetmap.de/data/water-polygons.html' } },
  { id: 'relief', group: 'land', label: 'Relief shading', on: true, opacity: 0.3,
    info: { src: 'Hillshade from the Terrarium DEM (land and seabed)', lic: 'As DEM', res: 'SRTM 30 m, land only: the DEM is cut to the OSM coastline', url: 'https://registry.opendata.aws/terrain-tiles/' } },
  { id: 'contours', group: 'land', label: 'Land contours', minzoom: 9, opacity: 1,
    info: { src: 'Contoured in your browser from the Terrarium DEM', lic: 'As DEM', res: 'SRTM 30 m; interval by zoom', url: 'https://github.com/onthegomap/maplibre-contour' } },
  { id: 'roads', group: 'land', label: 'Roads', on: true, minzoom: 6, opacity: 1,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Minor roads appear from zoom 12', url: 'https://openfreemap.org' } },
  { id: 'buildings', group: 'land', label: 'Buildings', on: true, minzoom: 13, opacity: 1,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Footprints as mapped in OSM; coverage varies by country', url: 'https://openfreemap.org' } },

  { id: 'gibs', group: 'imagery', label: 'NASA daily', opacity: 0.9, date: true,
    variants: Object.fromEntries(Object.entries(GIBS).map(([k, g]) => [k, g.label])),
    info: { src: 'NASA EOSDIS GIBS (WMTS)', lic: 'NASA open data; attribution requested', res: 'True colour 250 m, to zoom 9 · SST and chlorophyll 1 km, to zoom 7. Clouds and swath gaps are real', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' } },

  { id: 'legend', group: 'labels', label: 'Legends', on: true,
    info: { src: 'Drawn from the same colour stops as the map; SST from NASA GIBS’s published colour map; vessel and route density from the stops their WMS publishes', lic: '—', res: 'Shown bottom left for every colour layer that is drawn; the PNG always includes them', url: 'https://nasa-gibs.github.io/gibs-api-docs/' } },
  { id: 'places', group: 'labels', label: 'Place names', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'English name where tagged, else local name', url: 'https://openfreemap.org' } },
  { id: 'seanames', group: 'labels', label: 'Sea names', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Oceans, seas, bays, straits as tagged in OSM', url: 'https://openfreemap.org' } },
  { id: 'boundaries', group: 'labels', label: 'Boundaries', on: true,
    info: { src: 'OpenStreetMap via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Land boundaries only; maritime claims are not drawn', url: 'https://openfreemap.org' } },
  { id: 'graticule', group: 'labels', label: 'Graticule', on: true,
    info: { src: 'Computed in your browser (WGS 84)', lic: '—', res: 'Spacing adapts to zoom, down to 1′. With the map north-up, longitudes are labelled along the top edge and latitudes along the left', url: '' } },
];

// ---- sources ----------------------------------------------------------------
function sources({ seaDemUrl, landDemUrl, isobathUrl, contourUrl, date, density = {} }) {
  const ATTR_OSM = '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const ATTR_DEM = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen/AWS Terrain Tiles</a>';
  const s = {
    omt: { type: 'vector', url: OMT_TILEJSON, attribution: ATTR_OSM },
    'dem-sea': { type: 'raster-dem', tiles: [seaDemUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_SEA.max, attribution: ATTR_DEM },
    dem: { type: 'raster-dem', tiles: [landDemUrl], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_LAND.max, attribution: ATTR_DEM },
    isobaths: { type: 'vector', tiles: [isobathUrl], maxzoom: 12, attribution: ATTR_DEM }, // 512 px tiles: z12 is cut with the z12 coastline
    contours: { type: 'vector', tiles: [contourUrl], maxzoom: DEM_LAND.max, attribution: ATTR_DEM },
    eox16: { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless 2016 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2016), CC BY 4.0',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'] },
    eox24: { type: 'raster', tileSize: 256, maxzoom: 14, attribution: 'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'] },
    // Esri asks for "Powered by Esri" plus the service's own copyrightText (app.js refreshes it from
    // ESRI_META; this is the text it had on 2026-10-20)
    esri: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: esriAttribution('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'),
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
    // the grid is 1 km: beyond zoom 10 the map overzooms instead of asking for more tiles
    traffic: { type: 'raster', tileSize: 256, maxzoom: 10, tiles: densityTiles('traffic', ...(density.traffic || ['all', DENSITY.traffic.defaultPeriod])),
      attribution: 'Vessel density: <a href="https://emodnet.ec.europa.eu/en/human-activities">EMODnet Human Activities</a> (Cogea; AIS: CLS, ORBCOMM, vesseltracker.com)' },
    routes: { type: 'raster', tileSize: 256, maxzoom: 10, tiles: densityTiles('routes', ...(density.routes || ['all', DENSITY.routes.defaultPeriod])),
      attribution: 'Route density: <a href="https://www.emsa.europa.eu/">EMSA</a> via <a href="https://emodnet.ec.europa.eu/en/human-activities">EMODnet Human Activities</a>, CC BY 4.0' },
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

// Depth colour schemes ([depth m, colour] stops, shared by the depth shading and its legend). atlas: darker = deeper, as on atlases and ocean maps (default);
// nautical: darker = shallower, as on nautical charts (IHO S-52), where shallow water is the hazard.
export const DEPTH_SCHEMES = {
  atlas: [[0, '#dceefa'], [5, '#cfe6f7'], [20, '#bcdbf2'], [50, '#a5cdec'], [200, '#86b9e2'], [2000, '#5189c4'], [6000, '#335f97']],
  nautical: [[0, '#97c1e2'], [5, '#a3c9e6'], [20, '#b6d5ec'], [50, '#c9e0f1'], [200, '#dbeaf5'], [2000, '#ecf4fa']],
};
// Positive elevations stay transparent so land is never tinted from the DEM: clip.js sends land
// as +1 m and water without a depth source (lakes above sea level) as NO_DEPTH_M (grey).
export function depthRamp(stops) {
  return ['interpolate', ['linear'], ['elevation'], -11000, stops[stops.length - 1][1],
    ...[...stops].reverse().flatMap(([d, c]) => [-Math.max(d, 0.1), c]), 0, 'rgba(255,255,255,0)',
    NO_DEPTH_M - 1, 'rgba(221,227,231,0)', NO_DEPTH_M, C.noDepth];
}

// Isobaths are generated at a regular interval per zoom (app.js); drawn with nautical spacing
// that widens with depth and tightens with zoom, so steep deep slopes don't fill with lines and
// zoomed-in slopes aren't empty: 5 m, every 10 m to 50 m, every 50 m to 200 m, then per zoom
// range (filters can't use zoom, so one layer per range): [minzoom, maxzoom, step to 3000 m, step below].
const DEPTH = ['abs', ['get', 'ele']];
const ISOBATH_RANGES = [[4, 10, 500, 1000], [10, 12, 200, 500], [12, 24, 100, 500]];
const isobathFilter = (mid, deep) => ['all', ['<', ['get', 'ele'], 0], ['any',
  ['==', DEPTH, 5],
  ['all', ['<=', DEPTH, 50], ['==', ['%', DEPTH, 10], 0]],
  ['all', ['<=', DEPTH, 200], ['==', ['%', DEPTH, 50], 0]],
  ['all', ['<=', DEPTH, 3000], ['==', ['%', DEPTH, mid], 0]],
  ['==', ['%', DEPTH, deep], 0]]];

export const NO_DEPTH = C.noDepth;

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
    { id: 'coastline', type: 'line', source: 'omt', 'source-layer': 'water', ...m('coastline'),
      filter: ['!=', ['get', 'class'], 'swimming_pool'],
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
    ...Object.keys(GIBS).map((k) => ({ ...raster(`gibs-${k}`, 'gibs', k), source: `gibs-${k}` })),

    // drawn at every zoom: above the DEM's zoom 12 the lines are magnified, not refined
    ...ISOBATH_RANGES.map(([z0, z1, mid, deep], k) => ({ id: k ? `isobaths-${k}` : 'isobaths', type: 'line', source: 'isobaths', 'source-layer': 'contours',
      minzoom: z0, maxzoom: z1, ...m('isobaths'), filter: isobathFilter(mid, deep),
      paint: { 'line-color': C.isobath, 'line-width': ['match', ['get', 'level'], 1, 0.9, 0.45] } })),

    // Piers and breakwaters as land at about their true width (the shore line under the water
    // fill would otherwise half-hide anything narrower than itself), above every water layer
    { id: 'piers', type: 'fill', source: 'omt', 'source-layer': 'transportation', minzoom: 12, metadata: { item: 'coastline', base: 'chart' }, // over satellite the image shows the piers
      filter: ['all', ['==', ['get', 'class'], 'pier'], ['==', ['geometry-type'], 'Polygon']],
      paint: { 'fill-color': C.land, 'fill-outline-color': C.ink } },
    { id: 'pier-lines-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, metadata: { item: 'coastline', base: 'chart' }, // over satellite the image shows the piers
      filter: ['all', ['==', ['get', 'class'], 'pier'], ['==', ['geometry-type'], 'LineString']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': C.ink, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 1.5, 18, 36] } },
    { id: 'pier-lines', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, metadata: { item: 'coastline', base: 'chart' }, // over satellite the image shows the piers
      filter: ['all', ['==', ['get', 'class'], 'pier'], ['==', ['geometry-type'], 'LineString']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': C.land, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 0.5, 18, 32] } },

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

    raster('traffic', 'traffic'), raster('routes', 'routes'),
    { ...raster('seamarks', 'seamarks'), minzoom: 9 },

    { id: 'graticule', type: 'line', source: 'graticule', ...m('graticule'), filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': C.grid, 'line-width': 0.5, 'line-opacity': 0.55 } },

    ...ISOBATH_RANGES.map(([z0, z1, mid, deep], k) => ({ id: k ? `isobath-labels-${k}` : 'isobath-labels', type: 'symbol', source: 'isobaths', 'source-layer': 'contours',
      minzoom: Math.max(6, z0), maxzoom: z1, ...m('isobaths'), filter: isobathFilter(mid, deep),
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', DEPTH], ' m'],
        // coarse contours wiggle: allow more bend and place often, or long stretches go unlabelled
        'text-font': FONT, 'text-size': 10, 'symbol-spacing': 220, 'text-max-angle': 55 },
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

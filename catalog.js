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
};
// (sea surface temperature and chlorophyll come from Copernicus: gap-free, with Mediterranean detail)
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

// ---- Copernicus Marine (WMTS, keyless, CORS) --------------------------------------------
// Each item shows one variable; its parts are datasets drawn in order into one tile (cmems.js):
// the global model, then the regional one over it where it has data (Mediterranean 4.2 km), so
// the detail is regional and the coverage global, in one layer with one opacity. Colour ranges
// are fixed, so a colour means the same at every hour; legends come from the service.
export const CMEMS_WMTS = 'https://wmts.marine.copernicus.eu/teroWmts';
const GLO_WAV = 'GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411';
const MED_WAV = 'MEDSEA_ANALYSISFORECAST_WAV_006_017/cmems_mod_med_wav_anfc_4.2km_PT1H-i_202311';
const GLO_CUR = 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211';
const MED_CUR = 'MEDSEA_ANALYSISFORECAST_PHY_006_013/cmems_mod_med_phy-cur_anfc_4.2km-2D_PT1H-m_202511';
const WIND = 'WIND_GLO_PHY_L4_NRT_012_004/cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H_202207';
// water properties: daily means, at depth (the 3D datasets) or one value per point (2D)
const GLO_TEM = 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m_202406';
const GLO_SAL = 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m_202406';
const GLO_2D = 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy_anfc_0.083deg_P1D-m_202406';
const MED_TEM = 'MEDSEA_ANALYSISFORECAST_PHY_006_013/cmems_mod_med_phy-tem_anfc_4.2km_P1D-m_202511';
const MED_SAL = 'MEDSEA_ANALYSISFORECAST_PHY_006_013/cmems_mod_med_phy-sal_anfc_4.2km_P1D-m_202511';
const MED_MLD = 'MEDSEA_ANALYSISFORECAST_PHY_006_013/cmems_mod_med_phy-mld_anfc_4.2km_P1D-m_202511';
// satellite observations, daily
const GLO_SST = 'SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001/METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2';
const MED_SST = 'SST_MED_SST_L4_NRT_OBSERVATIONS_010_004/SST_MED_SST_L4_NRT_OBSERVATIONS_010_004_a_V2_202311';
const MED_SSTA = 'SST_MED_SST_L4_NRT_OBSERVATIONS_010_004/SST_MED_SSTA_L4_NRT_OBSERVATIONS_010_004_b_202607';
const GLO_CHL = 'OCEANCOLOUR_GLO_BGC_L4_NRT_009_102/cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D_202311';
const MED_CHL = 'OCEANCOLOUR_MED_BGC_L4_NRT_009_142/cmems_obs-oc_med_bgc-plankton_nrt_l4-gapfree-multi-1km_P1D_202207';
const SLA = 'SEALEVEL_GLO_PHY_L4_NRT_008_046/cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D_202506';
// water quality: biogeochemistry models, daily, at depth
const GLO_BIO = 'GLOBAL_ANALYSISFORECAST_BGC_001_028/cmems_mod_glo_bgc-bio_anfc_0.25deg_P1D-m_202311';
const GLO_CAR = 'GLOBAL_ANALYSISFORECAST_BGC_001_028/cmems_mod_glo_bgc-car_anfc_0.25deg_P1D-m_202311';
const GLO_NUT = 'GLOBAL_ANALYSISFORECAST_BGC_001_028/cmems_mod_glo_bgc-nut_anfc_0.25deg_P1D-m_202311';
const MED_BIO = 'MEDSEA_ANALYSISFORECAST_BGC_006_014/cmems_mod_med_bgc-bio_anfc_4.2km_P1D-m_202511';
const MED_CAR = 'MEDSEA_ANALYSISFORECAST_BGC_006_014/cmems_mod_med_bgc-car_anfc_4.2km_P1D-m_202511';
const MED_NUT = 'MEDSEA_ANALYSISFORECAST_BGC_006_014/cmems_mod_med_bgc-nut_anfc_4.2km_P1D-m_202511';
// item → variant → { label, unit, range, cmap, vector (arrows drawn by the service: 'solidAndVector' over the colours,
//   'vector' alone, coloured by speed; what the variant can draw: colours, arrows or both, see drawsOf),
//   parts: [dataset/variable],
//   daily (daily means), depth (drawn at the depth chosen, each dataset at its nearest level),
//   log (logarithmic colours), offset (added to the data's values for the legend: Kelvin → °C) }
// Ranges serve the global and the regional model alike, so a colour means the same everywhere.
// No sea level: the models' sea surface height (zos) carries each model's own mean offset (the
// Mediterranean model reads −0.4 m in the Mediterranean and +0.8 m in its Atlantic box beside it),
// which the tile service cannot subtract, so its colours changed at model edges for no physical reason.
export const CMEMS = {
  waves: {
    height: { label: 'Significant wave height', unit: 'm', range: [0, 6], cmap: 'amp', parts: [`${GLO_WAV}/VHM0`, `${MED_WAV}/VHM0`] },
    period: { label: 'Peak wave period', unit: 's', range: [0, 16], cmap: 'tempo', parts: [`${GLO_WAV}/VTPK`, `${MED_WAV}/VTPK`] },
  },
  currents: { surface: { label: 'Surface current', unit: 'm/s', range: [0, 1.5], cmap: 'speed', vector: 'solidAndVector', parts: [`${GLO_CUR}/sea_water_velocity`, `${MED_CUR}/sea_water_velocity`] } },
  sst: {
    measured: { label: 'Sea surface temperature', unit: '°C', range: [273.15, 303.15], offset: -273.15, cmap: 'thermal', daily: true, parts: [`${GLO_SST}/analysed_sst`, `${MED_SST}/analysed_sst`] },
    anomaly: { label: 'Sea surface temperature anomaly', unit: '°C', range: [-3, 3], cmap: 'balance', daily: true, parts: [`${MED_SSTA}/sst_anomaly`] },
  },
  chl: { observed: { label: 'Chlorophyll', unit: 'mg/m³', range: [0.01, 10], log: true, cmap: 'algae', daily: true, parts: [`${GLO_CHL}/CHL`, `${MED_CHL}/CHL`] } },
  sla: { observed: { label: 'Sea level anomaly', unit: 'm', range: [-0.3, 0.3], cmap: 'balance', daily: true, parts: [`${SLA}/sla`] } },
  bgc: {
    o2: { label: 'Dissolved oxygen', unit: 'mmol/m³', range: [0, 350], cmap: 'matter', daily: true, depth: true, parts: [`${GLO_BIO}/o2`, `${MED_BIO}/o2`] },
    ph: { label: 'pH', unit: '', range: [7.6, 8.2], cmap: 'viridis', daily: true, depth: true, parts: [`${GLO_CAR}/ph`, `${MED_CAR}/ph`] },
    no3: { label: 'Nitrate', unit: 'mmol/m³', range: [0.01, 30], log: true, cmap: 'matter', daily: true, depth: true, parts: [`${GLO_NUT}/no3`, `${MED_NUT}/no3`] },
    nppv: { label: 'Primary production', unit: 'mg C/m³/day', range: [0, 10], cmap: 'algae', daily: true, depth: true, parts: [`${GLO_BIO}/nppv`, `${MED_BIO}/nppv`] },
  },
  // wind as arrows alone, over the chart and the waves: thermal starts dark, so light winds stay visible
  temperature: {
    depth: { label: 'Temperature', unit: '°C', range: [0, 30], cmap: 'thermal', daily: true, depth: true, parts: [`${GLO_TEM}/thetao`, `${MED_TEM}/thetao`] },
    bottom: { label: 'Bottom temperature', unit: '°C', range: [0, 30], cmap: 'thermal', daily: true, parts: [`${GLO_2D}/tob`, `${MED_TEM}/bottomT`] },
  },
  salinity: { depth: { label: 'Salinity', unit: 'PSU', range: [32, 40], cmap: 'haline', daily: true, depth: true, parts: [`${GLO_SAL}/so`, `${MED_SAL}/so`] } },
  mld: { depth: { label: 'Mixed layer depth', unit: 'm', range: [0, 200], cmap: 'plasma', daily: true, parts: [`${GLO_2D}/mlotst`, `${MED_MLD}/mlotst`] } },
  wind: { observed: { label: 'Wind (satellite)', unit: 'm/s', range: [0, 25], cmap: 'thermal', vector: 'vector', parts: [`${WIND}/wind`] } },
};
// what a variant can draw: ['colour'], ['arrows'] or both (its colours, its arrows coloured by speed)
export const drawsOf = (v) => ({ solidAndVector: ['colour', 'arrows'], vector: ['arrows'] })[v.vector] || ['colour'];
// the service's style for a variant drawing `look` ('colour', 'arrows', or 'both': all it can)
export function cmemsStyle(v, look = 'both') {
  const vector = look === 'colour' ? null : look === 'arrows' ? 'vector' : v.vector;
  return `cmap:${v.cmap},range:${v.range.join('/')}${v.log ? ',logScale' : ''}${vector ? `,vectorStyle:${vector}` : ''}`;
}
// 512 px tiles (the @2x matrix set): arrows at a readable spacing, and sharp on high-density screens
export function cmemsTileUrl(part, style, time, z, x, y, level = null) {
  return `${CMEMS_WMTS}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(part)}&STYLE=${encodeURIComponent(style)}`
    + `&TILEMATRIXSET=EPSG:3857@2x&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/png&TIME=${time}${level === null ? '' : `&ELEVATION=${level}`}`;
}
export const cmemsLegendUrl = (part, style) => `${CMEMS_WMTS}?SERVICE=WMTS&REQUEST=GetLegend&LAYER=${encodeURIComponent(part)}&STYLE=${encodeURIComponent(style)}&FORMAT=application/json`;
// one dataset's own capabilities (~100 kB, not the 67 MB of the whole service): its time steps
export const cmemsCapsUrl = (part) => `${CMEMS_WMTS}/${part.split('/').slice(0, 2).join('/')}?SERVICE=WMTS&REQUEST=GetCapabilities`;

const ARROWS_LAST = (id) => ({ solidAndVector: 1, vector: 2 })[Object.values(CMEMS[id])[0].vector] || 0;

// ISO 8601 duration (P1D, PT1H, PT900S, PT10800S, PT15M) → milliseconds
export function durationMs(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d);
  if (!m) return NaN;
  return (((+(m[1] || 0) * 24 + +(m[2] || 0)) * 60 + +(m[3] || 0)) * 60 + +(m[4] || 0)) * 1000;
}
// The time dimension of `variable` in a WMTS capabilities document: its <Value>s, each
// start/end/step or one instant → [{ start, end, step }] in ms (step 0 for an instant)
export function timeDomain(xml, variable) {
  const id = xml.indexOf(`/${variable}</ows:Identifier>`);
  if (id < 0) return [];
  const layer = xml.slice(id, xml.indexOf('</Layer>', id));
  const dim = /<ows:Identifier>time<\/ows:Identifier>([\s\S]*?)<\/Dimension>/.exec(layer)?.[1] || '';
  return [...dim.matchAll(/<Value>([^<]*)<\/Value>/g)].flatMap(([, v]) => v.split(',')).map((v) => {
    const [a, b, step] = v.trim().split('/');
    return b ? { start: Date.parse(a), end: Date.parse(b), step: durationMs(step) } : { start: Date.parse(a), end: Date.parse(a), step: 0 };
  }).filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end));
}
// the dataset's time to draw for the time t (ms): the last step at or before t, or null if t is
// outside every range
export function snapTime(domain, t) {
  let best = null;
  for (const r of domain) {
    if (t < r.start || t > r.end + (r.step || 0)) continue;
    const s = r.step ? Math.min(r.end, r.start + Math.floor((t - r.start) / r.step) * r.step) : r.start;
    if (s <= t && (best === null || s > best)) best = s;
  }
  return best;
}
export const domainEndMs = (domain) => Math.max(...domain.map((r) => r.end));
// depths offered for the 3D variables, metres below the surface (0: the model's top level)
export const CMEMS_DEPTHS = [0, 10, 20, 50, 100, 200, 500, 1000];
// the depth levels of `variable` in a WMTS capabilities document, as listed (elevation, m, ≤ 0)
export function depthLevels(xml, variable) {
  const id = xml.indexOf(`/${variable}</ows:Identifier>`);
  if (id < 0) return [];
  const layer = xml.slice(id, xml.indexOf('</Layer>', id));
  const dim = /<ows:Identifier>elevation<\/ows:Identifier>([\s\S]*?)<\/Dimension>/.exec(layer)?.[1] || '';
  return [...dim.matchAll(/<Value>([^<]*)<\/Value>/g)].map((m) => m[1]).filter((v) => Number.isFinite(+v));
}
// the level nearest to depth (m below the surface): one of levels, or null if there are none
export const nearestLevel = (levels, depth) => (levels.length ? levels.reduce((a, b) => (Math.abs(-b - depth) < Math.abs(-a - depth) ? b : a)) : null);

// ---- menu -------------------------------------------------------------------
// exclusive: items in the group behave as radio buttons.
// minzoom / maxzoom: outside them the item is greyed out with a hint and draws nothing.
// opacity: default value of the item's slider (absent = no slider).
// variants: alternatives inside one item; only the chosen variant's layers draw.
// section: in the Ocean data group, the heading its entries go under in the menus.
export const GROUPS = [
  { id: 'base', label: 'Base', exclusive: true },
  // the layers that change with time, chosen in two menus: one for colours, one for arrows
  // (app.js); their sections head the menus' entries
  { id: 'data', label: 'Ocean data', sections: ['Sea state', 'Water column', 'Satellite'] },
  { id: 'sea', label: 'Sea' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'land', label: 'Land' },
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
  { id: 'traffic', group: 'shipping', label: 'Vessel density', opacity: 0.85, kind: 'density',
    variants: DENSITY.traffic.types,
    info: { src: 'EMODnet Human Activities vessel density (Cogea), from AIS bought from CLS, ORBCOMM and vesseltracker.com', lic: 'EMODnet open data, no access constraints; attribution requested', res: '1 km grid, annual averages of hours per km² per month, 2017–2024. EU and neighbouring seas only. 2024 is incomplete (satellite AIS lost from June). Not real time', url: 'https://emodnet.ec.europa.eu/en/human-activities' } },
  { id: 'routes', group: 'shipping', label: 'Route density', opacity: 0.85, kind: 'density',
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

  // Copernicus Marine: one hour for all, forecasts about 9 days ahead (cmems.js)
  { id: 'waves', group: 'data', section: 'Sea state', label: 'Waves', opacity: 0.85, kind: 'cmems',
    variants: Object.fromEntries(Object.entries(CMEMS.waves).map(([k, v]) => [k, v.label])),
    info: { src: 'Copernicus Marine Service: Mediterranean wave forecast (MEDSEA_ANALYSISFORECAST_WAV_006_017) over the global one (GLOBAL_ANALYSISFORECAST_WAV_001_027)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Mediterranean 4.2 km, hourly; elsewhere 1/12° (~9 km), every 3 hours. Model analysis and forecast, about 9 days ahead. Not for navigation', url: 'https://marine.copernicus.eu' } },
  { id: 'currents', group: 'data', section: 'Sea state', label: 'Currents', opacity: 0.85, kind: 'cmems',
    info: { src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global surface currents (GLOBAL_ANALYSISFORECAST_PHY_001_024, with tides and wave drift)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Surface, hourly. Mediterranean 4.2 km (with tides); elsewhere 1/12° (~9 km). Arrows show the direction the water flows. Model forecast, about 9 days ahead', url: 'https://marine.copernicus.eu' } },
  { id: 'wind', group: 'data', section: 'Sea state', label: 'Wind', opacity: 0.85, kind: 'cmems',
    info: { src: 'Copernicus Marine Service: global ocean wind from satellite scatterometers, blended with a weather model (WIND_GLO_PHY_L4_NRT_012_004)', lic: 'Copernicus Marine Service licence: free, attribution required', res: '0.125° (~14 km), hourly, 10 m above the sea. An observation, not a forecast: published about a day late. The time shown goes no later than its latest observation. Arrows show where the wind blows to', url: 'https://marine.copernicus.eu' } },

  { id: 'temperature', group: 'data', section: 'Water column', label: 'Temperature', opacity: 0.85, kind: 'cmems',
    variants: Object.fromEntries(Object.entries(CMEMS.temperature).map(([k, v]) => [k, v.label === 'Temperature' ? 'At the depth chosen' : 'At the seabed'])),
    info: { src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global one (GLOBAL_ANALYSISFORECAST_PHY_001_024)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Potential temperature, daily means. Mediterranean 4.2 km, 141 levels; elsewhere 1/12° (~9 km), 50 levels: each at its level nearest the depth chosen. Model analysis and forecast, about 9 days ahead', url: 'https://marine.copernicus.eu' } },
  { id: 'salinity', group: 'data', section: 'Water column', label: 'Salinity', opacity: 0.85, kind: 'cmems',
    info: { src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global one (GLOBAL_ANALYSISFORECAST_PHY_001_024)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Practical salinity (PSU), daily means, at the level nearest the depth chosen. Mediterranean 4.2 km; elsewhere 1/12° (~9 km). Model analysis and forecast', url: 'https://marine.copernicus.eu' } },
  { id: 'mld', group: 'data', section: 'Water column', label: 'Mixed layer depth', opacity: 0.85, kind: 'cmems',
    info: { src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global one (GLOBAL_ANALYSISFORECAST_PHY_001_024)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Depth of the well-mixed surface layer (density criterion), daily means. Shallow in summer, deep in winter. Mediterranean 4.2 km; elsewhere 1/12°. Model analysis and forecast', url: 'https://marine.copernicus.eu' } },

  { id: 'sst', group: 'data', section: 'Satellite', label: 'Sea surface temperature', opacity: 0.85, kind: 'cmems',
    variants: { measured: 'Measured', anomaly: 'Anomaly (Mediterranean)' },
    info: { src: 'Copernicus Marine Service: satellite sea surface temperature, Mediterranean (SST_MED_SST_L4_NRT_OBSERVATIONS_010_004) over the global OSTIA analysis (SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Daily, gap-filled from several satellites. Mediterranean 1/16° (~4 km); elsewhere 0.05° (~5 km). Anomaly: against the 1991–2020 climatology of the day, Mediterranean only (marine heatwaves show in red). The time shown goes no later than its latest day', url: 'https://marine.copernicus.eu' } },
  { id: 'chl', group: 'data', section: 'Satellite', label: 'Chlorophyll', opacity: 0.85, kind: 'cmems',
    info: { src: 'Copernicus Marine Service: ocean colour, gap-free, Mediterranean (OCEANCOLOUR_MED_BGC_L4_NRT_009_142) over the global one (OCEANCOLOUR_GLO_BGC_L4_NRT_009_102)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Chlorophyll-a, daily, cloud gaps filled. Mediterranean 1 km; elsewhere 4 km. Logarithmic colours. Only the last two weeks or so are kept. The time shown goes no later than its latest day', url: 'https://marine.copernicus.eu' } },
  { id: 'sla', group: 'data', section: 'Satellite', label: 'Sea level anomaly', opacity: 0.85, kind: 'cmems',
    info: { src: 'Copernicus Marine Service: satellite altimetry, all missions merged (SEALEVEL_GLO_PHY_L4_NRT_008_046)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Sea surface height above its 1993–2012 mean, daily, 0.125° (~14 km). Eddies and large-scale highs and lows; tides and storm surge removed. The time shown goes no later than its latest day', url: 'https://marine.copernicus.eu' } },
  { id: 'bgc', group: 'data', section: 'Water column', label: 'Water quality', opacity: 0.85, kind: 'cmems',
    variants: Object.fromEntries(Object.entries(CMEMS.bgc).map(([k, v]) => [k, v.label])),
    info: { src: 'Copernicus Marine Service: Mediterranean biogeochemistry forecast (MEDSEA_ANALYSISFORECAST_BGC_006_014) over the global one (GLOBAL_ANALYSISFORECAST_BGC_001_028)', lic: 'Copernicus Marine Service licence: free, attribution required', res: 'Daily means at the level nearest the depth chosen. Mediterranean 4.2 km; elsewhere 0.25° (~28 km). Nitrate in logarithmic colours. Model analysis and forecast, about 9 days ahead', url: 'https://marine.copernicus.eu' } },

  { id: 'gibs', group: 'data', section: 'Satellite', label: 'NASA daily', opacity: 0.9, kind: 'gibs',
    variants: Object.fromEntries(Object.entries(GIBS).map(([k, g]) => [k, g.label])),
    info: { src: 'NASA EOSDIS GIBS (WMTS)', lic: 'NASA open data; attribution requested', res: 'True colour, 250 m, to zoom 9. A picture of the day as the satellite saw it: clouds and swath gaps are real. The time shown goes no later than its newest published day', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' } },

  { id: 'legend', group: 'labels', label: 'Legends', on: true,
    info: { src: 'Drawn from the same colour stops as the map; Copernicus from the colour maps its service publishes; vessel and route density from the stops their WMS publishes', lic: '—', res: 'Shown bottom left for every colour layer that is drawn; the PNG always includes them', url: '' } },
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
  // credits: the names each provider asks for, short enough for one line; what each layer is
  // made from is behind its ⓘ
  const ATTR_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · <a href="https://openfreemap.org">OpenFreeMap</a>';
  const ATTR_DEM = '<a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>';
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
      attribution: '<a href="https://emodnet.ec.europa.eu/en/human-activities">EMODnet Human Activities</a>' },
    routes: { type: 'raster', tileSize: 256, maxzoom: 10, tiles: densityTiles('routes', ...(density.routes || ['all', DENSITY.routes.defaultPeriod])),
      attribution: '<a href="https://www.emsa.europa.eu/">EMSA</a> (CC BY 4.0) via <a href="https://emodnet.ec.europa.eu/en/human-activities">EMODnet Human Activities</a>' },
    seamarks: { type: 'raster', tileSize: 256, minzoom: 6, maxzoom: 18, attribution: '<a href="https://openseamap.org">OpenSeaMap</a>',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'] },
    graticule: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    measure: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
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

// Isobaths, in one table: what each zoom traces (maplibre-contour thresholds, app.js), draws (the
// style filters below) and cleans up in the DEM (levelsFor, used by clip.js). Nautical spacing
// that widens with depth and tightens with zoom, so steep deep slopes don't fill with lines and
// zoomed-in slopes aren't empty: 5 m, every 10 m to 50 m, every 50 m to 200 m, then every `mid`
// to 3000 m and every `deep` below. Traced finer than drawn: a line is drawn if it is both.
// [from zoom, traced every m, thicker line every m, mid, deep]
export const ISOBATH_ZOOMS = [
  [4, 1000, 2000, 500, 1000],
  [6, 200, 1000, 500, 1000],
  [8, 100, 500, 500, 1000],
  [10, 10, 50, 200, 500],
  [11, 5, 50, 200, 500],
  [12, 5, 50, 100, 500],
];
const drawnAt = (d, [, step, , mid, deep]) => d % step === 0
  && (d === 5 || (d <= 50 && d % 10 === 0) || (d <= 200 && d % 50 === 0) || (d <= 3000 && d % mid === 0) || d % deep === 0);
const range = (a, b, step) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, k) => a + k * step);
// every depth an isobath is drawn at, at some zoom
export const DEPTH_LEVELS = range(5, 11000, 5).filter((d) => ISOBATH_ZOOMS.some((row) => drawnAt(d, row)));
// the depths drawn from DEM tiles of zoom z: the native zoom serves every map zoom above it
export function levelsFor(z) {
  if (z >= DEM_SEA.native) return DEPTH_LEVELS;
  const row = ISOBATH_ZOOMS.findLast(([z0]) => z0 <= z) || ISOBATH_ZOOMS[0];
  return DEPTH_LEVELS.filter((d) => drawnAt(d, row));
}
// the same rule as drawnAt as a style filter; one layer per run of zooms with the same spacing
// (filters can't use zoom): [minzoom, maxzoom, mid, deep]
const ISOBATH_RANGES = ISOBATH_ZOOMS.filter((r, k, a) => !k || r[3] !== a[k - 1][3] || r[4] !== a[k - 1][4])
  .map((r, k, a) => [r[0], a[k + 1]?.[0] ?? 24, r[3], r[4]]);
const DEPTH = ['abs', ['get', 'ele']];
const isobathFilter = (mid, deep) => ['all', ['<', ['get', 'ele'], 0], ['any',
  ['==', DEPTH, 5],
  ['all', ['<=', DEPTH, 50], ['==', ['%', DEPTH, 10], 0]],
  ['all', ['<=', DEPTH, 200], ['==', ['%', DEPTH, 50], 0]],
  ['all', ['<=', DEPTH, 3000], ['==', ['%', DEPTH, mid], 0]],
  ['==', ['%', DEPTH, deep], 0]]];

export const NO_DEPTH = C.noDepth;
// value the sea tiles carry for water without a depth source (clip.js); depthRamp paints it grey
export const NO_DEPTH_M = 9000;

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
    ...Object.keys(GIBS).map((k) => ({ ...raster(`gibs-${k}`, 'gibs', k), source: `gibs-${k}` })),
    // colours, then the layers that can draw arrows (currents, then wind), whose arrows go over them
    ...Object.keys(CMEMS).sort((a, b) => ARROWS_LAST(a) - ARROWS_LAST(b)).map((id) => raster(`cmems-${id}`, id)),

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

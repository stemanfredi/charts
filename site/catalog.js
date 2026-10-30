// The catalogue: every data source, what each menu item shows and where it comes from (ITEMS,
// GROUPS), and the datasets behind them. style.js builds the map's style from it.

import { HOSTS } from './hosts.js';

// the land's elevation (SRTM); the sea's depths are GEBCO's (gebco.js). Both cut to the OSM
// coastline (clip.js), up to these zooms of 256 px tiles. Sea 13: depth shading shows up to map
// zoom 13, and a tile at z shows at map zoom z − 1 and is cut with the OSM coastline of that zoom;
// capped at 12, map zoom 12 was cut with the zoom-11 coastline, where small islands do not exist
// yet, and they vanished under the tint. Land 12: the DEM's own last zoom
export const DEM_TILES = `${HOSTS.terrain}/terrarium/{z}/{x}/{y}.png`;
export const DEM_SEA_MAX = 13, DEM_LAND_MAX = 12;
export const OMT_TILEJSON = `${HOSTS.openfreemap}/planet`;

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
    title: 'Vessel density (Europe)', unit: 'h/km² per month',
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
    title: 'Route density (Europe)', unit: 'routes per 1 km cell per month',
    types: { all: 'All ship types', t01: 'Cargo', t04: 'Tanker', t03: 'Passenger', t02: 'Fishing', t05: 'Other' },
    periods: months('2019-01', '2026-07'), // newest month in the WMS on 2026-10-20; npm run deps reports newer ones
    get defaultPeriod() { return this.periods[0]; },
    periodLabel: (p) => `${MONTHS[+p.slice(5) - 1]} ${p.slice(0, 4)}`,
    layer: (type) => `routedensity_${type.replace(/^t/, '')}`, time: (p) => `${p}-01`, stops: STOPS,
  },
};
// a WMS layer as 256 px Web Mercator tiles; more: further parameters (&time=…)
const wms = (base, layers, style = '', more = '') => [`${base}?service=WMS&version=1.3.0&request=GetMap&layers=${layers}&styles=${style}`
  + `&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true${more}`];
export const HA_WMS = `${HOSTS.emodnetHumanActivities}/wms`;
export const HA_CREDIT = '<a href="https://emodnet.ec.europa.eu/en/human-activities">EMODnet Human Activities</a>';
export const densityTiles = (id, type, period) => wms(HA_WMS, DENSITY[id].layer(type), '', `&time=${DENSITY[id].time(period)}T00:00:00.000Z`);

// EMODnet layers drawn by EMODnet's own services (tiles, WMS), as they come: item → variant → tiles.
// Depth (EMODnet Bathymetry's model, about 115 m in European waters: the styles that leave land to
// the chart), seabed substrate (EMODnet Geology, 1:250k, Folk classes: its legend from the
// service, each item's legend), and what is built, sunk or set aside at sea (EMODnet Human Activities).
const GEOLOGY_WMS = `${HOSTS.emodnetGeology}/geoserver/gtk/wms`;
const MR_WMS = `${HOSTS.vliz}/geoserver/MarineRegions/wms`;
// Marine Regions' zones, drawn landward first, with their fills (its legends name each "Single symbol")
const MR_ZONES = [['eez_internal_waters', 'Internal waters', '#3D9EFF'], ['eez_archipelagic_waters', 'Archipelagic waters', '#7ABDFF'],
  ['eez_12nm', 'Territorial sea (12 NM)', '#0B6A67'], ['eez_24nm', 'Contiguous zone (24 NM)', '#0D827E']];
const FOLK = { folk5: 'folk_5_substrate_class', folk7: 'folk_7_substrate_class' }; // the substrate's styles by variant
const bathy = (style) => [`${HOSTS.emodnetBathymetry}/latest/${style}/web_mercator/{z}/{x}/{y}.png`];
// An item drawn from its provider's tiles says so on its entry: tiles (per variant), tileMaxzoom (the
// zoom its tiles stop at; 18 as WMS, any), credit (its attribution; EMODnet Human Activities' when
// none), faint (a variant drawn lighter than the item's opacity), and for kind 'classes' legend(variant):
// the URL of its service's legend, the URLs of several, or the classes themselves
// EMODnet Bathymetry's model as data (GIS export): its Zarr store, as EDITO's catalogue lists it
// (collection emodnet-elevation, DTM 2024): elevation in metres, 1/16 arc-minute, chunks of ~1°
export const EMODNET_DTM = `${HOSTS.cloudferro}/emodnet/emodnet_bathymetry/14157/bathymetry_dtm_2024.zarr`;
// GEBCO 2026 (15″ cells, the world) as a multiscale Zarr store, built by tools/gebco.mjs and
// published on the project's data host: the sea's depths (gebco.js, clip.js); its type identifier grid beside it (tid.zarr)
export const GEBCO = `${HOSTS.geodata}/gebco-2026/elevation.zarr`;
export const GEBCO_TID = `${HOSTS.geodata}/gebco-2026/tid.zarr`;
// EMODnet Seabed Habitats' seagrass (2025, Europe) as vector tiles, built by tools/seagrass.mjs and
// published on the project's data host: its WMS takes a minute or more a tile. One layer, "seagrass": meadows (polygons)
// and survey points, each of one class (property c)
export const SEAGRASS = `${HOSTS.geodata}/seagrass-2025`;
export const SEAGRASS_ZOOMS = [7, 13]; // the zooms its tiles exist at; above, the last magnified
export const SEAGRASS_CLASSES = [
  { c: 'posidonia', label: 'Posidonia oceanica', colour: '#1e6b3a' },
  { c: 'matte', label: 'Dead Posidonia (matte)', colour: '#a08a5e' },
  { c: 'cymodocea', label: 'Cymodocea', colour: '#8bc34a' },
  { c: 'zostera', label: 'Zostera (eelgrass)', colour: '#1f9e8f' },
  { c: 'other', label: 'Other or not named', colour: '#9aa36a' },
];
// where GEBCO's depths come from, by its type identifier codes (codes [from, to], inclusive); land
// (0) and no data (127) are not drawn
export const DEPTH_SOURCES = [
  { label: 'Surveyed', codes: [10, 17], colour: '#2f9e44' },
  { label: 'Estimated', codes: [40, 47], colour: '#f08c00' },
  { label: 'Other grids, unknown', codes: [70, 72], colour: '#868e96' },
];
// a classed layer's legend for a variant: the URL of its WMS's JSON legend, or the URLs of several
// (legend.js wmsClasses), or its classes [{ label, colour, … }] where the service gives them as
// pictures only
const haLegend = (...layers) => layers.map((l) => `${HA_WMS}?service=WMS&request=GetLegendGraphic&version=1.0.0&format=application/json&layer=${l}`);
// names shortened where the service's own are too long to read in a legend
export const CLASS_LABELS = {
  'Wreck showing any portion of hull or superstructure': 'Hull or superstructure showing',
  'Wreck showing mast/masts': 'Masts showing', 'Distributed remains of wreck': 'Scattered remains',
};
// EMODnet depth's legend, as its WMS draws it (a picture only: GetLegendGraphic); its colours at its
// marks, in metres, not linear in depth
export const EMODNET_DEPTH_STOPS = {
  multicolour: [[0, '#ff5f64'], [10, '#ff0007'], [50, '#ded634'], [150, '#bedc30'], [450, '#71e044'], [1000, '#3cc6bf'], [2000, '#3144d6'], [3500, '#31315f'], [6000, '#000038']],
  rainbow: [[0, '#db000e'], [5, '#ff0911'], [40, '#d4dc1f'], [200, '#3ac845'], [500, '#33b6c3'], [3000, '#326cc4'], [4800, '#382a93'], [5500, '#8547bc'], [6000, '#bf00dc']],
};
export const ESRI_META = `${HOSTS.esri}/ArcGIS/rest/services/World_Imagery/MapServer?f=json`;

export const GIBS = {
  terra: { label: 'True colour · MODIS Terra', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', level: 9, ext: 'jpg' },
  viirs: { label: 'True colour · VIIRS NOAA-20', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', level: 9, ext: 'jpg' },
};
export function gibsTiles(key, date) {
  const g = GIBS[key];
  return [`${HOSTS.gibs}/wmts/epsg3857/best/${g.layer}/default/${date}/GoogleMapsCompatible_Level${g.level}/{z}/{y}/{x}.${g.ext}`];
}
// NASA publishes each layer after its own delay (true colour within a day, MUR SST about two days):
// GIBS DescribeDomains lists the dates a layer has between from and to (YYYY-MM-DD)
export function gibsDomainUrl(key, from, to) {
  const g = GIBS[key];
  return `${HOSTS.gibs}/wmts/epsg3857/best/1.0.0/${g.layer}/default/GoogleMapsCompatible_Level${g.level}/all/${from}--${to}.xml`;
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
  temperature: {
    depth: { label: 'Temperature', unit: '°C', range: [0, 30], cmap: 'thermal', daily: true, depth: true, parts: [`${GLO_TEM}/thetao`, `${MED_TEM}/thetao`] },
    bottom: { label: 'Bottom temperature', unit: '°C', range: [0, 30], cmap: 'thermal', daily: true, parts: [`${GLO_2D}/tob`, `${MED_TEM}/bottomT`] },
  },
  salinity: { depth: { label: 'Salinity', unit: 'PSU', range: [32, 40], cmap: 'haline', daily: true, depth: true, parts: [`${GLO_SAL}/so`, `${MED_SAL}/so`] } },
  mld: { depth: { label: 'Mixed layer depth', unit: 'm', range: [0, 200], cmap: 'plasma', daily: true, parts: [`${GLO_2D}/mlotst`, `${MED_MLD}/mlotst`] } },
  // wind as arrows alone, over the chart and the waves: thermal starts dark, so light winds stay visible
  wind: { observed: { label: 'Wind (satellite)', unit: 'm/s', range: [0, 25], cmap: 'thermal', vector: 'vector', parts: [`${WIND}/wind`] } },
};
// what a variant can draw: ['colour'], ['arrows'] or both (its colours, its arrows coloured by speed)
export const drawsOf = (v) => ({ solidAndVector: ['colour', 'arrows'], vector: ['arrows'] })[v.vector] || ['colour'];

// an item's variants from its datasets: key → label (the menu's and the link's)
// depths offered for the 3D variables, metres below the surface (0: the model's top level)
export const CMEMS_DEPTHS = [0, 10, 20, 50, 100, 200, 500, 1000];
// ---- menu -------------------------------------------------------------------
// exclusive: items in the group behave as radio buttons.
// minzoom / maxzoom: outside them the item is greyed out with a hint and draws nothing.
// opacity: default value of the item's slider (absent = no slider).
// variants: alternatives inside one item; only the chosen variant's layers draw.
// section: in the Ocean data group, the heading its entries go under in the menus.
export const GROUPS = [
  // the foundation first (the base, the sea's depths and marks), then what lies on it, then what is written over it
  { id: 'base', label: 'Base', exclusive: true },
  { id: 'sea', label: 'Sea' },
  // the layers that change with time, chosen in two menus: one for colours, one for arrows
  // (app.js); their sections head the menus' entries
  { id: 'data', label: 'Ocean data', sections: ['Sea state', 'Water column', 'Satellite'] },
  { id: 'shipping', label: 'Shipping' },
  { id: 'uses', label: 'Uses & areas' }, // EMODnet Human Activities
  { id: 'land', label: 'Land' },
  { id: 'labels', label: 'Labels & grid' },
];

// what most of one provider's layers share: their licence and where to read more
// a Copernicus Marine product's page, which its licence asks to cite: each layer's ⓘ links to its global
// product's (the regional ones are named in its source)
const product = (id) => `https://data.marine.copernicus.eu/product/${id}/description`;
const COPERNICUS = { lic: 'Copernicus Marine Service licence: free, attribution required ("Generated using E.U. Copernicus Marine Service Information"; the products are named above)', url: 'https://marine.copernicus.eu' };
const EMODNET_LIC = 'EMODnet open data, CC BY 4.0: attribution required';
const GEBCO_LIC = 'GEBCO terms: free to use and redistribute, with attribution';
const HUMAN_ACTIVITIES = { lic: EMODNET_LIC, url: 'https://emodnet.ec.europa.eu/en/human-activities' };
const OSM = { lic: 'ODbL · © OpenStreetMap contributors', url: 'https://openfreemap.org' };

export const ITEMS = [
  { id: 'chart', group: 'base', label: 'Chart', on: true,
    info: { ...OSM, src: 'OpenStreetMap via OpenFreeMap (OpenMapTiles schema)', res: 'Coastline from OSM water polygons; generalised below zoom 7' } },
  { id: 'sat', group: 'base', label: 'Satellite', opacity: 1,
    variants: { esri: 'Esri World Imagery (Esri terms)', eox16: 'Sentinel-2 2016 · EOX (CC BY)', eox24: 'Sentinel-2 2024 · EOX (non-commercial)' }, // first = default
    info: { src: 'Esri World Imagery (default), or EOX Sentinel-2 cloudless', lic: 'EOX 2016: CC BY 4.0 · EOX 2024: CC BY-NC-SA 4.0 · Esri: Esri terms of use', res: 'Sentinel-2: 10 m · Esri: up to ~0.5 m, varies', url: 'https://s2maps.eu' } },

  { id: 'depth', group: 'sea', label: 'Depth shading', on: true, opacity: 1, maxzoom: 12, kind: 'gebco',
    variants: { atlas: 'Darker = deeper (atlas)', nautical: 'Darker = shallower (nautical chart)' },
    info: { src: 'GEBCO 2026 Grid (GEBCO Compilation Group), read as a Zarr store from geodata.makaw.org (tools/gebco.mjs)', lic: GEBCO_LIC, res: 'GEBCO\'s cells of 15 arc-seconds (about 460 m), worldwide: about a quarter of the seabed from surveys, the rest interpolated or predicted from satellite gravity (in Europe, EMODnet depth is finer: its own layer). Cut to the OSM coastline, so land below sea level is never tinted; sea the grid calls dry is shown as the shallowest class. Inland water is classified once per water body from the grid at its shore: at sea level (limans, lagoons, harbour basins) it is shown flat in the shallowest class, depth unknown; lakes above it are grey, no depth data. Caspian depths are measured from its surface (−28 m), not from sea level. Off above zoom 12: the data has no more detail', url: 'https://www.gebco.net' } },
  { id: 'isobaths', group: 'sea', label: 'Isobaths', on: true, opacity: 1, minzoom: 2,
    info: { src: 'Contoured in your browser from GEBCO 2026 (maplibre-contour)', lic: 'As GEBCO', res: 'At the depths nautical charts use, more of them as you zoom in: 3000 and 5000 m from zoom 2 (ridges, trenches, abyssal plains); 200 m (the shelf edge) and every 1000 m from zoom 4; 20, 50, 100 and 500 m from zoom 6; 10, 30, 300, 1500 and 2500 m from zoom 8; 5 m from zoom 10. Indicative only: GEBCO\'s cells are about 460 m, many of them interpolated where there are no surveys. As coarse as the grid beneath: smoothed shapes, not surveyed soundings. Traced on the depths cut to the OSM coastline (to zoom 12, about 38 m per pixel). Above zoom 12 the same lines are magnified: they can stop short of the coast or cross it by a few pixels', url: 'https://github.com/onthegomap/maplibre-contour' } },
  { id: 'depthsource', group: 'sea', label: 'Depth sources (GEBCO)', opacity: 0.6, kind: 'gebcotid', legendSub: 'where the depths come from',
    legend: () => DEPTH_SOURCES.map(({ label, colour }) => ({ label, colour })), // GEBCO's type identifier grid, by group (gebco.js draws it)
    info: { src: 'GEBCO 2026 type identifier grid (GEBCO Compilation Group), read as a Zarr store from geodata.makaw.org (tools/gebco.mjs)', lic: GEBCO_LIC, res: 'For each of GEBCO\'s 15″ cells (about 460 m), how its depth was obtained: surveyed (multibeam, single-beam, seismic, lidar, soundings), estimated (predicted from satellite gravity, interpolated, from chart contours), or taken from another grid or of unknown origin. Zoomed out, each cell shows the most common source of the cells it covers (the less certain on a tie). The depth shading and isobaths are only as good as their source here. Its codes go in the GIS export', url: 'https://www.gebco.net' } },
  { id: 'emodnetdepth', group: 'sea', label: 'EMODnet depth (Europe)', opacity: 1, kind: 'emodnet',
    variants: { multicolour: 'Multicolour', rainbow: 'Rainbow' },
    tiles: { multicolour: bathy('mean_multicolour'), rainbow: bathy('mean_rainbowcolour') }, tileMaxzoom: 12, credit: '<a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry</a>',
    info: { src: 'EMODnet Bathymetry digital terrain model, drawn by EMODnet (tiles); its values go in the GIS export', lic: EMODNET_LIC, res: 'About 115 m (1/16 arc-minute) in European seas, from surveys where there are, a coarser model elsewhere; no data outside Europe. Mean depth, in EMODnet\'s own colours (its legend: not linear in depth). Referenced to lowest astronomical tide. Not for navigation', url: 'https://emodnet.ec.europa.eu/en/bathymetry' } },
  { id: 'substrate', group: 'sea', label: 'Seabed substrate (Europe)', opacity: 0.8, kind: 'classes',
    variants: { folk5: 'Folk 5 classes', folk7: 'Folk 7 classes' },
    tiles: Object.fromEntries(Object.entries(FOLK).map(([v, style]) => [v, wms(GEOLOGY_WMS, 'seabed_substrate_250k', style)])), credit: '<a href="https://emodnet.ec.europa.eu/en/geology">EMODnet Geology</a>',
    legend: (variant) => `${GEOLOGY_WMS}?service=WMS&request=GetLegendGraphic&version=1.0.0&format=application/json&layer=seabed_substrate_250k&style=${FOLK[variant]}`,
    info: { src: 'EMODnet Geology seabed substrate (WMS)', lic: EMODNET_LIC, res: '1:250 000, European seas; what the seabed is made of (mud, sand, coarse sediment, mixed, rock), in Folk classes. Compiled from national surveys: varies by country', url: 'https://emodnet.ec.europa.eu/en/geology' } },
  { id: 'seagrass', group: 'sea', label: 'Seagrass (Europe)', opacity: 0.8, minzoom: SEAGRASS_ZOOMS[0], kind: 'classes', legendSub: 'meadows; dots: where surveys found it',
    legend: () => SEAGRASS_CLASSES.map(({ label, colour }) => ({ label, colour })),
    info: { src: 'EMODnet Seabed Habitats, seagrass cover (Essential Ocean Variable), 2025: maps of meadows and survey points from national agencies, OSPAR and research, cut into tiles at geodata.makaw.org (tools/seagrass.mjs)', lic: `${EMODNET_LIC} (its Caribbean part, CC BY-NC, is left out)`, res: 'European seas, from zoom 7; as mapped by each survey, so complete in some places (French and Italian coasts) and absent in others. The species from each map\'s own habitat names. Anchoring on Posidonia oceanica is banned or restricted in much of the Mediterranean: check the local rules', url: 'https://emodnet.ec.europa.eu/en/seabed-habitats' } },
  { id: 'traffic', group: 'shipping', label: 'Vessel density (Europe)', opacity: 0.85, kind: 'density',
    variants: DENSITY.traffic.types,
    info: { src: 'EMODnet Human Activities vessel density (Cogea), from AIS bought from CLS, ORBCOMM and vesseltracker.com', lic: 'EMODnet open data, no access constraints; attribution requested', res: '1 km grid, annual averages of hours per km² per month, 2017–2024. EU and neighbouring seas only. 2024 is incomplete (satellite AIS lost from June). Not real time', url: 'https://emodnet.ec.europa.eu/en/human-activities' } },
  { id: 'worlddensity', group: 'shipping', label: 'Vessel density (world)', opacity: 0.85, kind: 'classes', legendSub: 'AIS positions per cell, 2015–2020',
    tiles: { all: [`${HOSTS.arcgisTiles}/tiles/iQ1dY19aHwbSDYIF/arcgis/rest/services/Shipping_density_all_vessels_2015_to_2020/MapServer/tile/{z}/{y}/{x}`] }, tileMaxzoom: 10, // the World Bank's tiles (with the IMF): world, all vessels, coarse
    credit: '<a href="https://datacatalog.worldbank.org/search/dataset/0037580">World Bank Group, IMF</a> (CC BY 4.0)',
    // AIS positions per cell, as the World Bank's tile service colours them (its legend's swatches)
    legend: () => [['< 100 k', '#1b0c42'], ['100–250 k', '#4c0c6b'], ['250–500 k', '#791c6e'], ['0.5–1 M', '#a62d61'], ['1–5 M', '#cf4447'],
      ['5–10 M', '#ee6925'], ['10–15 M', '#fc9b06'], ['15–25 M', '#f8d13c'], ['25–60 M', '#fdffa5']].map(([label, colour]) => ({ label, colour })),
    info: { src: 'World Bank Group and IMF, Global Shipping Traffic Density (all vessels), from the World Bank\'s tile service', lic: 'CC BY 4.0', res: 'World, Jan 2015 to Feb 2021 (the tiles say 2015–2020), all vessels: AIS positions counted per cell, aggregated for drawing (the service says to 0.5°). Coarser than the data: for the oceans\' lanes; in European seas Vessel density is finer. Not real time', url: 'https://datacatalog.worldbank.org/search/dataset/0037580' } },
  { id: 'routes', group: 'shipping', label: 'Route density (Europe)', opacity: 0.85, kind: 'density',
    variants: DENSITY.routes.types,
    info: { src: 'EMSA route density, via EMODnet Human Activities: ship tracks rebuilt from terrestrial and satellite AIS, counting the routes that cross each cell', lic: 'CC BY 4.0 · European Maritime Safety Agency (EMSA)', res: '1 km grid, monthly totals since January 2019, about 3 months behind. EU and neighbouring seas only. Counts passages, not time spent (see Vessel density for hours)', url: 'https://www.emsa.europa.eu/related-operational-projects/traffic-density-maps.html' } },
  { id: 'wrecks', group: 'uses', label: 'Wrecks', opacity: 1, minzoom: 9, kind: 'classes',
    tiles: { all: wms(HA_WMS, 'wwshipwrecks') }, legend: () => haLegend('wwshipwrecks'), credit: `${HA_CREDIT} (wrecks: UKHO)`,
    info: { ...HUMAN_ACTIVITIES, src: 'UK Hydrographic Office worldwide wreck locations, via EMODnet Human Activities', res: 'Wrecks as charted by the UKHO, worldwide; positions of varying accuracy. From zoom 9: they crowd the map below' } },
  { id: 'cables', group: 'uses', label: 'Cables (Europe)', opacity: 1, kind: 'classes', legendSub: 'colour: who reported it', variants: { telecom: 'Telecommunication', power: 'Power' },
    tiles: { telecom: wms(HA_WMS, 'telecablesactual'), power: wms(HA_WMS, 'powercables') },
    // EMODnet draws each cable in the colour of who reported it (its WMS legend: telecom cables red,
    // with a centre line of that colour; power cables in greys)
    legend: (variant) => (variant === 'power'
      ? [['Norway (NVE)', '#1e1e1e'], ['Netherlands', '#666666'], ['France (SHOM)', '#999999'], ['Germany (BSH)', '#000000']].map(([label, colour]) => ({ label, colour, line: true }))
      : [['Germany (BSH)', '#00dc00'], ['Spain (CICA)', '#e6e600'], ['Malta', '#ff78ff'], ['Netherlands', '#fafafa'], ['France (SHOM)', '#00e6e6'],
        ['France (SIGCables)', '#ff8c00'], ['UK (OGA)', '#3737ff']].map(([label, colour]) => ({ label, colour, line: true, casing: '#ff0000' }))),
    info: { ...HUMAN_ACTIVITIES, src: 'EMODnet Human Activities, from national authorities and operators', res: 'Submarine cables in service in European seas, as each country reports them: routes, not surveyed positions. Telecommunication: red, with a centre line in the colour of who reported it (Germany, Spain, Malta, Netherlands, France, UK). Power: only where reported, Norwegian, Dutch, French and German waters; none elsewhere (the Mediterranean\'s, the Baltic\'s) yet' } },
  { id: 'pipelines', group: 'uses', label: 'Pipelines (Europe)', opacity: 1, kind: 'classes', legendSub: 'status',
    tiles: { all: wms(HA_WMS, 'pipelines') }, legend: () => haLegend('pipelines'),
    info: { ...HUMAN_ACTIVITIES, src: 'EMODnet Human Activities', res: 'Oil, gas and other pipelines, European seas' } },
  { id: 'platforms', group: 'uses', label: 'Offshore installations (Europe)', opacity: 1, kind: 'classes', legendSub: 'status',
    tiles: { all: wms(HA_WMS, 'platforms') }, legend: () => haLegend('platforms'),
    info: { ...HUMAN_ACTIVITIES, src: 'EMODnet Human Activities, from OSPAR and national authorities', res: 'Oil and gas platforms and other installations, European seas' } },
  { id: 'windfarms', group: 'uses', label: 'Wind farms (Europe)', opacity: 1, kind: 'classes', legendSub: 'status',
    tiles: { all: wms(HA_WMS, 'windfarmspoly,windfarms') }, legend: () => haLegend('windfarmspoly', 'windfarms'), // a layer drawn from several (areas and points): the classes of each, once
    info: { ...HUMAN_ACTIVITIES, src: 'EMODnet Human Activities', res: 'Offshore wind farms (areas and points), planned to in production, European seas' } },
  { id: 'military', group: 'uses', label: 'Military areas (Europe)', opacity: 1, kind: 'classes',
    tiles: { all: wms(HA_WMS, 'militaryareaspoly,militaryareas') }, legend: () => haLegend('militaryareaspoly', 'militaryareas'),
    info: { ...HUMAN_ACTIVITIES, src: 'EMODnet Human Activities, from national authorities', res: 'Firing, exercise and other military areas, European seas; consult the official notices before entering' } },
  { id: 'protected', group: 'uses', label: 'Protected areas (Europe)', opacity: 1, kind: 'classes', variants: { natura: 'Natura 2000', mpa: 'Regional sea conventions MPAs' },
    tiles: { natura: wms(HA_WMS, 'natura2000areas'), mpa: wms(HA_WMS, 'marineprotectedareas') }, legend: (variant) => haLegend({ natura: 'natura2000areas', mpa: 'marineprotectedareas' }[variant]),
    info: { ...HUMAN_ACTIVITIES, src: 'EMODnet Human Activities: Natura 2000 (EEA), MPAs of the regional sea conventions', res: 'Marine protected areas, European seas' } },
  { id: 'maritime', group: 'sea', label: 'Maritime zones', opacity: 0.8, kind: 'classes', variants: { limits: 'Limits between countries', zones: 'Zones (12 and 24 NM)' },
    // Marine Regions (VLIZ): the limits as lines, or the zones they bound as fills, in its own styles; the
    // zones at 80% would hide the sea beneath them: drawn lighter
    tiles: { limits: wms(MR_WMS, 'MarineRegions:eez_boundaries'), zones: wms(MR_WMS, MR_ZONES.map(([l]) => `MarineRegions:${l}`).join(',')) }, faint: { zones: 0.5 },
    credit: '<a href="https://www.marineregions.org">Marine Regions</a> (VLIZ, CC BY 4.0)',
    // the limits from its legend (line types, dashed as drawn); the zones as its fills
    legend: (variant) => (variant === 'zones' ? MR_ZONES.map(([, label, fill]) => ({ label, colour: `${fill}55` })) // as drawn: its 80%, at half
      : `${MR_WMS}?service=WMS&request=GetLegendGraphic&version=1.0.0&format=application/json&layer=eez_boundaries`),
    info: { src: 'Marine Regions (Flanders Marine Institute, VLIZ): Maritime Boundaries v12 and the zones from it, v4 (2023)', lic: 'CC BY 4.0 · VLIZ; not for legal or navigational use (its terms)', res: 'World. Limits between countries: the lines between neighbours\' waters, as treaties, court rulings and joint regimes set them; where none does, a median line VLIZ computed, or the claims and disputes as they stand; and the baselines the zones are measured from. Zones: internal and archipelagic waters, the territorial sea (to 12 NM) and the contiguous zone (to 24 NM), whose outer edges are those limits. Compiled from public sources: not legal boundaries. Not for navigation', url: 'https://www.marineregions.org' } },
  { id: 'seamarks', group: 'sea', label: 'Seamarks', minzoom: 9, opacity: 1,
    info: { src: 'OpenSeaMap seamark overlay', lic: 'CC BY-SA 2.0 · OpenSeaMap contributors', res: 'Crowd-sourced; completeness varies. Not an official chart', url: 'https://openseamap.org' } },

  { id: 'coastline', group: 'land', label: 'Coastline', on: true,
    info: { src: 'OSM water polygons via OpenFreeMap', lic: 'ODbL · © OpenStreetMap contributors', res: 'Detailed at zoom ≥ 10 where OSM is well mapped; generalised below', url: 'https://osmdata.openstreetmap.de/data/water-polygons.html' } },
  { id: 'relief', group: 'land', label: 'Relief shading', on: true, opacity: 0.3,
    info: { src: 'Hillshade from the Terrarium DEM', lic: 'As DEM', res: 'SRTM 30 m, land only: the DEM is cut to the OSM coastline', url: 'https://registry.opendata.aws/terrain-tiles/' } },
  { id: 'contours', group: 'land', label: 'Land contours', minzoom: 9, opacity: 1,
    info: { src: 'Contoured in your browser from the Terrarium DEM', lic: 'As DEM', res: 'SRTM 30 m; interval by zoom', url: 'https://github.com/onthegomap/maplibre-contour' } },
  { id: 'roads', group: 'land', label: 'Roads', on: true, minzoom: 6, opacity: 1,
    info: { ...OSM, src: 'OpenStreetMap via OpenFreeMap', res: 'Minor roads appear from zoom 12' } },
  { id: 'buildings', group: 'land', label: 'Buildings', on: true, minzoom: 13, opacity: 1,
    info: { ...OSM, src: 'OpenStreetMap via OpenFreeMap', res: 'Footprints as mapped in OSM; coverage varies by country' } },

  // Copernicus Marine: one hour for all, forecasts about 9 days ahead (cmems.js)
  { id: 'waves', group: 'data', section: 'Sea state', label: 'Waves', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('GLOBAL_ANALYSISFORECAST_WAV_001_027'), src: 'Copernicus Marine Service: Mediterranean wave forecast (MEDSEA_ANALYSISFORECAST_WAV_006_017) over the global one (GLOBAL_ANALYSISFORECAST_WAV_001_027)', res: 'Mediterranean 4.2 km, hourly; elsewhere 1/12° (~9 km), every 3 hours. Model analysis and forecast, about 9 days ahead. Not for navigation' } },
  { id: 'currents', group: 'data', section: 'Sea state', label: 'Currents', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('GLOBAL_ANALYSISFORECAST_PHY_001_024'), src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global surface currents (GLOBAL_ANALYSISFORECAST_PHY_001_024, with tides and wave drift)', res: 'Surface, hourly. Mediterranean 4.2 km (with tides); elsewhere 1/12° (~9 km). Arrows show the direction the water flows. Model forecast, about 9 days ahead' } },
  { id: 'wind', group: 'data', section: 'Sea state', label: 'Wind', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('WIND_GLO_PHY_L4_NRT_012_004'), src: 'Copernicus Marine Service: global ocean wind from satellite scatterometers, blended with a weather model (WIND_GLO_PHY_L4_NRT_012_004)', res: '0.125° (~14 km), hourly, 10 m above the sea. An observation, not a forecast: published about a day late. The time shown goes no later than its latest observation. Arrows show where the wind blows to' } },

  { id: 'temperature', group: 'data', section: 'Water column', label: 'Temperature', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('GLOBAL_ANALYSISFORECAST_PHY_001_024'), src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global one (GLOBAL_ANALYSISFORECAST_PHY_001_024)', res: 'Potential temperature, daily means. Mediterranean 4.2 km, 141 levels; elsewhere 1/12° (~9 km), 50 levels: each at its level nearest the depth chosen. Model analysis and forecast, about 9 days ahead' } },
  { id: 'salinity', group: 'data', section: 'Water column', label: 'Salinity', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('GLOBAL_ANALYSISFORECAST_PHY_001_024'), src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global one (GLOBAL_ANALYSISFORECAST_PHY_001_024)', res: 'Practical salinity (PSU), daily means, at the level nearest the depth chosen. Mediterranean 4.2 km; elsewhere 1/12° (~9 km). Model analysis and forecast' } },
  { id: 'mld', group: 'data', section: 'Water column', label: 'Mixed layer depth', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('GLOBAL_ANALYSISFORECAST_PHY_001_024'), src: 'Copernicus Marine Service: Mediterranean physics forecast (MEDSEA_ANALYSISFORECAST_PHY_006_013) over the global one (GLOBAL_ANALYSISFORECAST_PHY_001_024)', res: 'Depth of the well-mixed surface layer (density criterion), daily means. Shallow in summer, deep in winter. Mediterranean 4.2 km; elsewhere 1/12°. Model analysis and forecast' } },

  { id: 'sst', group: 'data', section: 'Satellite', label: 'Sea surface temperature', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001'), src: 'Copernicus Marine Service: satellite sea surface temperature, Mediterranean (SST_MED_SST_L4_NRT_OBSERVATIONS_010_004) over the global OSTIA analysis (SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001)', res: 'Daily, gap-filled from several satellites. Mediterranean 1/16° (~4 km); elsewhere 0.05° (~5 km). Anomaly: against the 1991–2020 climatology of the day, Mediterranean only (marine heatwaves show in red). The time shown goes no later than its latest day' } },
  { id: 'chl', group: 'data', section: 'Satellite', label: 'Chlorophyll', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('OCEANCOLOUR_GLO_BGC_L4_NRT_009_102'), src: 'Copernicus Marine Service: ocean colour, gap-free, Mediterranean (OCEANCOLOUR_MED_BGC_L4_NRT_009_142) over the global one (OCEANCOLOUR_GLO_BGC_L4_NRT_009_102)', res: 'Chlorophyll-a, daily, cloud gaps filled. Mediterranean 1 km; elsewhere 4 km. Logarithmic colours. Only the last two weeks or so are kept. The time shown goes no later than its latest day' } },
  { id: 'sla', group: 'data', section: 'Satellite', label: 'Sea level anomaly', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('SEALEVEL_GLO_PHY_L4_NRT_008_046'), src: 'Copernicus Marine Service: satellite altimetry, all missions merged (SEALEVEL_GLO_PHY_L4_NRT_008_046)', res: 'Sea surface height above its 1993–2012 mean, daily, 0.125° (~14 km). Eddies and large-scale highs and lows; tides and storm surge removed. The time shown goes no later than its latest day' } },
  { id: 'bgc', group: 'data', section: 'Water column', label: 'Water quality', opacity: 0.85, kind: 'cmems',
    info: { ...COPERNICUS, url: product('GLOBAL_ANALYSISFORECAST_BGC_001_028'), src: 'Copernicus Marine Service: Mediterranean biogeochemistry forecast (MEDSEA_ANALYSISFORECAST_BGC_006_014) over the global one (GLOBAL_ANALYSISFORECAST_BGC_001_028)', res: 'Daily means at the level nearest the depth chosen. Mediterranean 4.2 km; elsewhere 0.25° (~28 km). Nitrate in logarithmic colours. Model analysis and forecast, about 9 days ahead' } },

  { id: 'gibs', group: 'data', section: 'Satellite', label: 'NASA daily', opacity: 0.9, kind: 'gibs',
    info: { src: 'NASA EOSDIS GIBS (WMTS)', lic: 'NASA open data; attribution requested', res: 'True colour, 250 m, to zoom 9. A picture of the day as the satellite saw it: clouds and swath gaps are real. The time shown goes no later than its newest published day', url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api' } },

  { id: 'legend', group: 'labels', label: 'Legends', on: true,
    info: { src: 'Drawn from the same colour stops as the map; Copernicus from the colour maps its service publishes; vessel and route density from the stops their WMS publishes; the other EMODnet layers from their services\' own legends (EMODnet depth from its legend picture), the World Bank\'s from its tile service\'s', lic: '—', res: 'Shown bottom left for every colour layer that is drawn; the PNG always includes them', url: '' } },
  { id: 'places', group: 'labels', label: 'Place names', on: true,
    info: { ...OSM, src: 'OpenStreetMap via OpenFreeMap', res: 'English name where tagged, else local name' } },
  { id: 'seanames', group: 'labels', label: 'Sea names', on: true,
    info: { ...OSM, src: 'OpenStreetMap via OpenFreeMap', res: 'Oceans, seas, bays, straits as tagged in OSM' } },
  { id: 'boundaries', group: 'labels', label: 'Boundaries', on: true,
    info: { ...OSM, src: 'OpenStreetMap via OpenFreeMap', res: 'Administrative boundaries, national to provincial. Lines OpenStreetMap tags as maritime (territorial seas, economic zones) are not drawn (Maritime zones, under Sea, has them from Marine Regions); where a country draws its provinces out to sea (Indonesia, to 12 NM), those limits are, as mapped' } },
  { id: 'graticule', group: 'labels', label: 'Graticule', on: true,
    info: { src: 'Computed in your browser (WGS 84)', lic: '—', res: 'Spacing adapts to zoom, down to 1′. With the map north-up, longitudes are labelled along the top edge and latitudes along the left', url: '' } },
];

// Depth colour schemes ([depth m, colour] stops, shared by the depth shading and its legend). atlas: darker = deeper, as on atlases and ocean maps (default);
// nautical: darker = shallower, as on nautical charts (IHO S-52), where shallow water is the hazard.
export const DEPTH_SCHEMES = {
  atlas: [[0, '#dceefa'], [5, '#cfe6f7'], [20, '#bcdbf2'], [50, '#a5cdec'], [200, '#86b9e2'], [2000, '#5189c4'], [6000, '#335f97']],
  nautical: [[0, '#97c1e2'], [5, '#a3c9e6'], [20, '#b6d5ec'], [50, '#c9e0f1'], [200, '#dbeaf5'], [2000, '#ecf4fa']],
};
// Isobaths, in one table: the depths nautical charts draw contours at (INT 1), each from the map
// zoom it first shows at. Zooming in adds lines and never takes one away; shallow water first, where
// draught and anchoring matter (5–50 m), then the shelf (100) and its edge (200); deep water stays
// sparse, where lines on steep slopes would merge into bands. At world scale (zoom 2–3) only 3000 and
// 5000 m: they outline ridges, trenches and abyssal plains, and none of them hugs a coast. None at 75 or 150 m: no decision
// changes there, and on wide gentle shelves, where those lines would fall, the coarse model cannot
// place them (an error of 10 m in depth on a 0.1% slope moves a line 10 km).
// From it: what each zoom traces (isobathSteps, maplibre-contour in app.js) and draws (style.js).
// [depth m, from zoom]
export const ISOBATHS = [
  [5, 10], [10, 8], [20, 6], [30, 8], [50, 6], [100, 6], [200, 4], [300, 8], [500, 6],
  [1000, 4], [1500, 8], [2000, 4], [2500, 8], [3000, 2], [5000, 2], ...[4000, 6000, 7000, 8000, 9000, 10000, 11000].map((d) => [d, 4]),
];
// thicker lines: the shelf (100 m) and every 1000 m
export const isMajorIsobath = (d) => d === 100 || d % 1000 === 0;
// the zooms where lines are added, and the depths drawn from each: [[zoom, depths]]
export const ISOBATH_ZOOMS = [...new Set(ISOBATHS.map(([, z]) => z))].sort((a, b) => a - b)
  .map((z) => [z, ISOBATHS.filter(([, z0]) => z0 <= z).map(([d]) => d)]);
// what maplibre-contour traces from each of those zooms: every `step` m, the largest step that holds
// all the depths drawn (the style draws only those): { zoom: [step] }
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
export const isobathSteps = () => Object.fromEntries(ISOBATH_ZOOMS.map(([z, ds]) => [z, [ds.reduce(gcd)]]));
// every depth an isobath is drawn at, at some zoom
export const DEPTH_LEVELS = ISOBATHS.map(([d]) => d);

// water without depth data (lakes above sea level): never white, which reads as deep
export const NO_DEPTH = '#dde3e7';
// value the sea tiles carry for water without a depth source (clip.js); depthRamp paints it grey
export const NO_DEPTH_M = 9000;

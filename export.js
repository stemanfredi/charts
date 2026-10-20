// The view as GIS data: what goes in the ZIP export besides the pictures. Plain functions of
// the view's corners and the layers drawn; app.js reads those from the map.
//   map.png + map.pgw + map.png.aux.xml   the map as drawn, georeferenced in Web Mercator
//   item.json                             a STAC Item describing the view and every file

const R = 6378137; // Web Mercator sphere (EPSG:3857)
const D2R = Math.PI / 180;
// lon/lat → EPSG:3857 metres
export const mercator = ([lng, lat]) => [R * lng * D2R, R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2))];

// corners: lon/lat of the image's top-left, top-right, bottom-right, bottom-left corners, with
// continuous longitudes (as MapLibre's unproject gives them: across the antimeridian some pass
// ±180°); a rotated view is still an affine image in Web Mercator. w × h pixels.
// → [a, b, c, d, e, f] with x = a·col + b·row + c, y = d·col + e·row + f at pixel corners
// (the order of STAC's proj:transform; GDAL's geotransform is [c, a, b, f, d, e]).
export function affine([tl, tr, , bl], w, h) {
  const [x0, y0] = mercator(tl);
  const [x1, y1] = mercator(tr);
  const [x2, y2] = mercator(bl);
  return [(x1 - x0) / w, (x2 - x0) / h, x0, (y1 - y0) / w, (y2 - y0) / h, y0];
}

// ESRI world file: the same transform, at the centre of the top-left pixel
export function worldFile([a, b, c, d, e, f]) {
  return `${[a, d, b, e, c + a / 2 + b / 2, f + d / 2 + e / 2].join('\n')}\n`;
}

// A world file carries no CRS: GDAL (and so QGIS) reads it from this sidecar
export const MERCATOR_WKT = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]';
export const pamXml = () => `<PAMDataset>\n  <SRS dataAxisToSRSAxisMapping="1,2">${MERCATOR_WKT}</SRS>\n</PAMDataset>\n`;

// GeoJSON footprint and bbox of the view, from corners as for affine (RFC 7946: counter-clockwise,
// west > east across the antimeridian). The footprint keeps continuous longitudes, so across the
// antimeridian some exceed ±180° instead of being split in two.
export function footprint(corners) {
  let lngs = corners.map(([lng]) => lng);
  const mid = 360 * Math.round((Math.min(...lngs) + Math.max(...lngs)) / 720); // centre the view on [−180°, 180°]
  lngs = lngs.map((lng) => lng - mid);
  const ring = corners.map(([, lat], i) => [lngs[i], lat]).reverse(); // screen order is clockwise on the map
  const lats = corners.map((p) => p[1]);
  const lo = Math.min(...lngs), hi = Math.max(...lngs), whole = hi - lo >= 360;
  const bbox = [whole ? -180 : lo < -180 ? lo + 360 : lo, Math.min(...lats), whole ? 180 : hi > 180 ? hi - 360 : hi, Math.max(...lats)];
  return { bbox, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
}

// STAC Item (1.1) for the export. layers: the items drawn ({ id, label, info, … } from
// catalog.js, plus what was chosen: variant, date, period); attribution: the credit line.
export const STAC_VERSION = '1.1.0';
const PROJECTION_EXT = 'https://stac-extensions.github.io/projection/v2.0.0/schema.json';
export function stacItem({ id, when, corners, zoom, bearing, layers, attribution, link, assets }) {
  const { bbox, geometry } = footprint(corners);
  const providers = new Map(); // one per source, however many layers it feeds
  for (const l of layers) {
    if (!l.info || l.info.lic === '—' || providers.has(l.info.src)) continue;
    // isobaths, contours, relief are made from the DEM here: processors, under its licence
    const derived = l.info.lic === 'As DEM';
    providers.set(l.info.src, { name: l.info.src, description: `Licence: ${derived ? 'as the DEM' : l.info.lic}`, roles: [derived ? 'processor' : 'producer'], ...(l.info.url && { url: l.info.url }) });
  }
  return {
    type: 'Feature',
    stac_version: STAC_VERSION,
    stac_extensions: [PROJECTION_EXT],
    id,
    bbox,
    geometry,
    properties: {
      title: 'Chart export',
      description: 'One map view, exported from Charts. NOT FOR NAVIGATION: positions, coastlines and depths come from open datasets of varying accuracy.',
      datetime: when.toISOString(),
      created: when.toISOString(),
      license: 'other', // one per source, in providers and chart:attribution
      providers: [...providers.values()],
      'chart:attribution': attribution,
      'chart:zoom': +zoom.toFixed(2),
      'chart:bearing': +bearing.toFixed(1),
      'chart:layers': layers.map(({ id: lid, label, variant, date, period }) => ({ id: lid, title: label, ...(variant && { variant }), ...(date && { date }), ...(period && { period }) })),
    },
    links: link ? [{ rel: 'via', href: link, type: 'text/html', title: 'This view in Charts' }] : [],
    assets,
  };
}

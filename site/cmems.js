// Copernicus Marine layers on the map (catalog.js CMEMS): a tile handler that draws an item's
// datasets into one tile, each at its own time step for the hour asked, the global first and the
// regional one over it; the datasets' time ranges, read from their own capabilities; legends.
import { CMEMS } from './catalog.js';
import { HOSTS } from './hosts.js';
import { mercator, tileBounds, CIRC } from './geo.js';
import { lru, fetchOk } from './net.js';
// The service's addresses (WMTS, keyless, CORS; STAC for the values) and its styles
const CMEMS_WMTS = `${HOSTS.copernicusWmts}/teroWmts`;
// the service's style for a variant drawing `look` ('colour', 'arrows', or 'both': all it can)
export function cmemsStyle(v, look = 'both') {
  const vector = look === 'colour' ? null : look === 'arrows' ? 'vector' : v.vector;
  return `cmap:${v.cmap},range:${v.range.join('/')}${v.log ? ',logScale' : ''}${vector ? `,vectorStyle:${vector}` : ''}`;
}
// 512 px tiles (the @2x matrix set): arrows at a readable spacing, and sharp on high-density screens
function cmemsTileUrl(part, style, time, z, x, y, level = null) {
  return `${CMEMS_WMTS}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(part)}&STYLE=${encodeURIComponent(style)}`
    + `&TILEMATRIXSET=EPSG:3857@2x&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/png&TIME=${time}${level === null ? '' : `&ELEVATION=${level}`}`;
}
const cmemsLegendUrl = (part, style) => `${CMEMS_WMTS}?SERVICE=WMTS&REQUEST=GetLegend&LAYER=${encodeURIComponent(part)}&STYLE=${encodeURIComponent(style)}&FORMAT=application/json`;
// a dataset's entry in Copernicus Marine's STAC catalogue: where its values are, as Zarr stores (zarr.js)
export const cmemsStacUrl = (part) => `${HOSTS.copernicusStac}/metadata/${part.split('/').slice(0, 2).join('/')}/dataset.stac.json`;
// the stored variables a part draws: itself, or for arrows their eastward and northward components
// (the global currents: the total, with tides and wave drift, as the tiles draw it)
export function storedVariables(part) {
  const [, dataset, variable] = part.split('/');
  if (variable === 'sea_water_velocity') return dataset.includes('merged-uv') ? ['utotal', 'vtotal'] : ['uo', 'vo'];
  return variable === 'wind' ? ['eastward_wind', 'northward_wind'] : [variable];
}
// one dataset's own capabilities (~100 kB, not the 67 MB of the whole service): its time steps
const cmemsCapsUrl = (part) => `${CMEMS_WMTS}/${part.split('/').slice(0, 2).join('/')}?SERVICE=WMTS&REQUEST=GetCapabilities`;

// regional datasets (by product name: MEDSEA_…, SST_MED_…, OCEANCOLOUR_MED_…): drawn only within
// their area, a union of boxes [west, south, east, north], and not asked for a tile outside it. The
// Mediterranean products' own box (18°W–36°E, 30–46°N) also holds part of the Atlantic, the Bay of
// Biscay and the Black Sea, where their values do not match the global ones (straight seams): the
// area is the Mediterranean only, from the Strait of Gibraltar (5.6°W), north of 40.9°N between 1°W
// and 27°E (Gulf of Lion, Adriatic, northern Aegean); the global products draw the rest.
const REGIONS = [{ name: 'Mediterranean', test: /^MEDSEA_|_MED_/, area: [[-5.6, 30.1, 36.3, 40.9], [-1, 40.9, 27, 46]] }];
export const regionOf = (part) => REGIONS.find((r) => r.test.test(part.split('/')[0])) || null;


// ---- what a dataset's own capabilities say: its time steps, its depth levels ------------------
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

// part (product/dataset/variable) → promise of { time: its time domain, levels: its depth levels }
// (timeDomain, depthLevels)
const domains = lru(Infinity);
export function domainOf(part) {
  return domains(part, () => fetchOk(cmemsCapsUrl(part)).then((r) => r.text())
    .then((xml) => {
      const variable = part.split('/')[2], time = timeDomain(xml, variable);
      if (!time.length) throw new Error(`no time steps for ${part}`);
      return { time, levels: depthLevels(xml, variable) };
    }));
}

// for each part of item/variant: the time it draws for t (ms), its step holding t; null outside its
// range, or undefined if its range is not known
export function partTimes(item, variant, t) {
  return Promise.all(CMEMS[item][variant].parts.map((p) => domainOf(p).then(({ time }) => snapTime(time, t), () => undefined)));
}
// for each part: the depth level drawn for depth (m), as the service lists it; null for a variable
// without depth (or if its levels are not known: the service then draws its default, the top)
export function partLevels(item, variant, depth) {
  const v = CMEMS[item][variant];
  return Promise.all(v.parts.map((p) => (v.depth ? domainOf(p).then(({ levels }) => nearestLevel(levels, depth), () => null) : null)));
}

function inArea(part, z, x, y) {
  const area = regionOf(part)?.area, [w, s, e, n] = tileBounds(z, x, y);
  return !area || area.some((a) => e > a[0] && w < a[2] && s < a[3] && n > a[1]);
}

// MapLibre protocol handler for cmems://item/variant/look/t/depth/z/x/y (look: what it draws,
// 'colour', 'arrows' or 'both'; t: the hour, ms since the epoch; depth: m below the surface, used
// by variables with depth)
export async function cmemsTile({ url }, abortController) {
  const [, item, variant, look, t, depth, z, x, y] = /^cmems:\/\/(\w+)\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map((v, i) => (i > 3 ? +v : v));
  const v = CMEMS[item][variant], style = cmemsStyle(v, look);
  const [times, levels] = await Promise.all([partTimes(item, variant, t), partLevels(item, variant, depth)]);
  const images = await Promise.all(v.parts.map(async (part, i) => {
    if (times[i] === null || !inArea(part, z, x, y)) return null; // no data at this hour, or not here
    const when = times[i] === undefined ? new Date(t) : new Date(times[i]); // range unknown: ask anyway
    const r = await fetchOk(cmemsTileUrl(part, style, when.toISOString(), z, x, y, levels[i]), { signal: abortController?.signal });
    return createImageBitmap(await r.blob());
  }));
  const c = new OffscreenCanvas(512, 512), g = c.getContext('2d');
  images.forEach((im, i) => {
    if (!im) return;
    const area = regionOf(v.parts[i])?.area;
    if (!area) { g.drawImage(im, 0, 0); return; }
    // the area in tile pixels (Web Mercator: x linear in longitude, y in the Mercator ordinate)
    const px = (L) => ((mercator([L, 0])[0] / CIRC + 0.5) * 2 ** z - x) * 512;
    const py = (B) => ((0.5 - mercator([0, B])[1] / CIRC) * 2 ** z - y) * 512;
    g.save();
    g.beginPath(); // one path: the boxes add up
    for (const a of area) g.rect(px(a[0]), py(a[3]), px(a[2]) - px(a[0]), py(a[1]) - py(a[3]));
    g.clip();
    g.drawImage(im, 0, 0);
    g.restore();
  });
  for (const im of images) im?.close(); // drawn: freed now, not when collected
  return { data: c.transferToImageBitmap() };
}

// legend of item/variant: the service's colour map over the fixed range, as entries for
// legend.js drawColormap, in the units shown (offset applied; log10 of the value for a log scale)
const legends = lru(Infinity);
export function cmemsLegend(item, variant) {
  const v = CMEMS[item][variant], url = cmemsLegendUrl(v.parts[0], cmemsStyle(v));
  return legends(url, () => fetchOk(url).then((r) => r.json())
    .then(({ continuous: c }) => {
      const f = (x) => (v.log ? Math.log10(x) : x + (v.offset || 0));
      const cols = c.cmap.colorMap, lo = f(c.valueMin), step = (f(c.valueMax) - lo) / cols.length;
      return cols.map((rgb, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, rgb: `rgb(${rgb.join(',')})` }));
    }));
}

// Copernicus Marine layers on the map (catalog.js CMEMS): a tile handler that draws an item's
// datasets into one tile, each at its own time step for the hour asked, the global first and the
// regional one over it; the datasets' time ranges, read from their own capabilities; legends.
import { CMEMS, cmemsStyle, cmemsTileUrl, cmemsLegendUrl, cmemsCapsUrl, timeDomain, snapTime, domainEndMs } from './catalog.js';

const FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };
// regional datasets: no request for a tile outside their area (lon/lat box)
const AREA = { MEDSEA: [-18.2, 30.1, 36.3, 46] };

async function ok(r) {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// part (product/dataset/variable) → promise of its time domain (catalog.js timeDomain)
const domains = {};
export function domainOf(part) {
  return (domains[part] ||= fetch(cmemsCapsUrl(part), FETCH).then(ok).then((r) => r.text())
    .then((xml) => {
      const d = timeDomain(xml, part.split('/')[2]);
      if (!d.length) throw new Error(`no time steps for ${part}`);
      return d;
    })
    .catch((e) => { delete domains[part]; throw e; }));
}

// for each part of item/variant: the time it draws for t (ms), null outside its range (an
// observation: its latest step, for t after it), or undefined if its range is not known
export function partTimes(item, variant, t) {
  const v = CMEMS[item][variant];
  return Promise.all(v.parts.map((p) => domainOf(p).then((d) => {
    const s = snapTime(d, t), end = domainEndMs(d);
    return s === null && v.observed && t > end ? snapTime(d, end) : s;
  }, () => undefined)));
}

const lon = (x, z) => (x / 2 ** z) * 360 - 180;
const lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
function inArea(part, z, x, y) {
  const a = AREA[part.split('_')[0]];
  return !a || (lon(x + 1, z) > a[0] && lon(x, z) < a[2] && lat(y + 1, z) < a[3] && lat(y, z) > a[1]);
}

// MapLibre protocol handler for cmems://item/variant/t/z/x/y (t: the hour, ms since the epoch)
export async function cmemsTile({ url }, abortController) {
  const [, item, variant, t, z, x, y] = /^cmems:\/\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map((v, i) => (i > 2 ? +v : v));
  const v = CMEMS[item][variant], style = cmemsStyle(v);
  const times = await partTimes(item, variant, t);
  const images = await Promise.all(v.parts.map(async (part, i) => {
    if (times[i] === null || !inArea(part, z, x, y)) return null; // no data at this hour, or not here
    const when = times[i] === undefined ? new Date(t) : new Date(times[i]); // range unknown: ask anyway
    const r = await fetch(cmemsTileUrl(part, style, when.toISOString(), z, x, y), { ...FETCH, signal: abortController?.signal }).then(ok);
    return createImageBitmap(await r.blob());
  }));
  const c = new OffscreenCanvas(512, 512), g = c.getContext('2d');
  for (const im of images) if (im) g.drawImage(im, 0, 0);
  return { data: c.transferToImageBitmap() };
}

// legend of item/variant: the service's colour map over the fixed range, as entries for
// legend.js drawColormap
const legends = {};
export function cmemsLegend(item, variant) {
  const v = CMEMS[item][variant], url = cmemsLegendUrl(v.parts[0], cmemsStyle(v));
  return (legends[url] ||= fetch(url, FETCH).then(ok).then((r) => r.json())
    .then(({ continuous: c }) => {
      const cols = c.cmap.colorMap, lo = c.valueMin, step = (c.valueMax - c.valueMin) / cols.length;
      return cols.map((rgb, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, rgb: `rgb(${rgb.join(',')})` }));
    })
    .catch((e) => { delete legends[url]; throw e; }));
}

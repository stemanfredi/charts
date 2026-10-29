// Pure helpers (no map, no DOM): angle, distance and depth formatting, Mercator scale.
// Kept apart from app.js so they can be unit-tested in Node.

import { norm360, norm180, NM, D2R } from './geo.js';

// a length, an area, a bearing as read (in the display's units: 'km' or 'nm')
export function fmtDist(m, units) {
  if (units === 'nm') return m < NM ? `${(m / NM).toFixed(3)} NM` : `${(m / NM).toFixed(m < 100 * NM ? 2 : 1)} NM`;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 100e3 ? 2 : 1)} km`;
}
export function fmtArea(a, units) {
  a = Math.abs(a);
  if (units === 'nm') return `${(a / NM / NM).toFixed(a < 100 * NM * NM ? 3 : 1)} NM²`;
  return a < 1e6 ? `${(a / 1e4).toFixed(2)} ha` : `${(a / 1e6).toFixed(a < 1e8 ? 2 : 1)} km²`;
}
export function fmtBrg(b) {
  const t = norm360(b).toFixed(1);
  return `${t === '360.0' ? '000.0' : t.padStart(5, '0')}°T`;
}

// Graticule label: whole degrees, or degrees and minutes when the step is below 1°.
export function fmtAngle(v, pos, neg, step) {
  const hemi = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  let d = Math.floor(a + 1e-9), mnt = Math.round((a - d) * 60);
  if (mnt === 60) { d += 1; mnt = 0; }
  return step >= 1 || mnt === 0 ? `${d}°${hemi}` : `${d}°${String(mnt).padStart(2, '0')}′${hemi}`;
}

// Position readout: degrees and decimal minutes, e.g. 35°53.900′N.
export function dm(v, p, n) {
  const a = Math.abs(v);
  let d = Math.floor(a), m = ((a - d) * 60).toFixed(3);
  if (m === '60.000') { d += 1; m = '0.000'; } // rounding carries into the degrees
  return `${d}°${m.padStart(6, '0')}′${v >= 0 ? p : n}`;
}

// Relative change of the Mercator scale (∝ 1/cos lat) between latitudes south and north:
// from the lowest to the highest |lat|, the lowest being 0 when the span crosses the equator.
// below this variation the scale bar is as good as exact for reading a chart; a note would be noise
export const NOTE_AT = 0.03;
export function mercatorVariation(south, north) {
  const n = Math.min(85, north), s = Math.max(-85, south);
  const hi = Math.max(Math.abs(n), Math.abs(s)), lo = s < 0 && n > 0 ? 0 : Math.min(Math.abs(n), Math.abs(s));
  return Math.cos(lo * D2R) / Math.cos(hi * D2R) - 1;
}

// Largest 1/2/5 × 10^k not above m (scale bar lengths).
export function niceLen(m) {
  const p = 10 ** Math.floor(Math.log10(m));
  return [5, 2, 1].map((k) => k * p).find((v) => v <= m) || p;
}

// Coordinates typed into the search box → { lat, lon }, or null if the text is not coordinates.
// Accepts decimal degrees ("35.898, 14.513", "-31.2 -51.3"), degrees and decimal minutes or
// degrees, minutes and seconds, with hemisphere letters before or after ("35 53.9N 14 30.8E",
// "35°53'54\"N 014°30'48\"E", "N35 53.9 E14 30.8", "14.513E 35.898N"). Without letters, latitude first.
// A decimal comma ("35,898 14,513") is read as such when the text has no decimal point.
export function parseLatLon(text) {
  if (!text.includes('.') && /\d,\d/.test(text)) {
    const r = latLon(text.replace(/(\d),(\d)/g, '$1.$2'));
    if (r) return r;
  }
  return latLon(text);
}
// degrees [, minutes [, seconds]]: only the last part may have decimals; a minus on the degrees ("-0 30") counts
function dmsValue(nums) {
  const [d, m = 0, s = 0] = nums;
  if (m < 0 || m >= 60 || s < 0 || s >= 60 || nums.slice(0, -1).some((v) => !Number.isInteger(v))) return NaN;
  return (d < 0 || Object.is(d, -0) ? -1 : 1) * (Math.abs(d) + m / 60 + s / 3600);
}
function latLon(text) {
  const t = text.toUpperCase().replace(/[°º˚′'″",;]/g, ' ').replace(/([NSEW])/g, ' $1 ').trim();
  if (!t || /[^0-9NSEW.+\-\s]/.test(t)) return null;
  const tokens = t.split(/\s+/);
  const parts = []; // [{ nums: [d, m?, s?], hemi }]
  const prefix = /^[NSEW]$/.test(tokens[0]);
  let cur = { nums: [], hemi: null };
  for (const tok of tokens) {
    if (/^[NSEW]$/.test(tok)) {
      if (prefix) { if (cur.nums.length || cur.hemi) parts.push(cur); cur = { nums: [], hemi: tok }; }
      else { if (!cur.nums.length || cur.hemi) return null; cur.hemi = tok; parts.push(cur); cur = { nums: [], hemi: null }; }
    } else if (/^[+-]?\d+(\.\d+)?$/.test(tok)) cur.nums.push(+tok);
    else return null;
  }
  if (cur.nums.length || cur.hemi) parts.push(cur);
  let comps;
  if (parts.every((p) => p.hemi)) comps = parts;
  else if (parts.length === 1 && !parts[0].hemi) { // no letters: split the numbers in half
    const n = parts[0].nums;
    if (![2, 4, 6].includes(n.length)) return null;
    comps = [{ nums: n.slice(0, n.length / 2) }, { nums: n.slice(n.length / 2) }];
  } else return null;
  if (comps.length !== 2 || comps.some((c) => !c.nums.length || c.nums.length > 3)) return null;
  const value = ({ nums }) => dmsValue(nums);
  let lat, lon;
  if (comps[0].hemi) {
    const la = comps.find((c) => 'NS'.includes(c.hemi)), lo = comps.find((c) => 'EW'.includes(c.hemi));
    if (!la || !lo || la.nums[0] < 0 || lo.nums[0] < 0) return null;
    lat = value(la) * (la.hemi === 'S' ? -1 : 1);
    lon = value(lo) * (lo.hemi === 'W' ? -1 : 1);
  } else [lat, lon] = comps.map(value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// One coordinate typed into its own field: axis 'lat' or 'lon' → decimal degrees, or null. The
// notations of parseLatLon (decimal degrees, degrees and minutes, DMS, a decimal comma), with a
// hemisphere letter before or after, which must be the axis's own (N or S for a latitude).
export function parseCoord(text, axis) {
  let t = text.trim();
  if (!t.includes('.')) t = t.replace(/(\d),(\d)/g, '$1.$2');
  t = t.toUpperCase().replace(/[°º˚′'″"]/g, ' ').replace(/([NSEW])/g, ' $1 ').trim();
  if (!t || /[^0-9NSEW.+\-\s]/.test(t)) return null;
  const tokens = t.split(/\s+/);
  const isHemi = (x) => /^[NSEW]$/.test(x);
  const letters = tokens.filter(isHemi);
  if (letters.length > 1 || (letters.length && !isHemi(tokens[0]) && !isHemi(tokens.at(-1)))) return null;
  const hemi = letters[0];
  if (hemi && !(axis === 'lat' ? 'NS' : 'EW').includes(hemi)) return null;
  const nums = tokens.filter((x) => !isHemi(x));
  if (!nums.length || nums.length > 3 || nums.some((x) => !/^[+-]?\d+(\.\d+)?$/.test(x))) return null;
  if (hemi && nums[0].startsWith('-')) return null;
  const v = dmsValue(nums.map(Number)) * (hemi === 'S' || hemi === 'W' ? -1 : 1);
  return Number.isFinite(v) && Math.abs(v) <= (axis === 'lat' ? 90 : 180) ? v : null;
}

// A distance typed into a field → metres, or null: a number with m, km or NM (any case), or a bare
// number, read in the unit the field showed (bare: 'm', 'km' or 'nm'). A decimal comma is read as such.
export const UNIT_M = { m: 1, km: 1000, nm: NM };
export const UNIT_TEXT = { m: 'm', km: 'km', nm: 'NM' };
// a length in metres as a number in the unit, as a table's column reads (m whole; km, NM 3 decimals)
export const inUnit = (m, unit) => (m / UNIT_M[unit]).toFixed(unit === 'm' ? 0 : 3);
// a depth (a negative elevation, m) in words; −1: shallower than 1 m, or sea the data calls dry (clip.js)
export const fmtDepth = (z) => (z >= -1 ? 'under 1 m' : `${Math.floor(-z)} m`);
export function parseDist(text, bare) {
  const r = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*(m|km|nm)?\s*$/i.exec(text);
  return r ? +r[1].replace(',', '.') * UNIT_M[(r[2] || bare).toLowerCase()] : null;
}
// A distance as a field shows it, as read (to the decimetre, the metre, 2 m; fmtDist rounds more): in the km
// mode metres below 1 km, else km; in the nm mode NM. With its unit, for parseDist's bare number.
export function distText(m, units) {
  const unit = units === 'nm' ? 'nm' : m < 1000 ? 'm' : 'km';
  const v = +(m / UNIT_M[unit]).toFixed(unit === 'm' ? 1 : 3); // to the decimetre, the metre (km), 2 m (NM): what is read; a value typed is kept exact
  return { text: `${v} ${unit === 'nm' ? 'NM' : unit}`, value: v, unit };
}

// Export file name (and STAC id): chart-YYYYMMDD-HHMM in UTC, then the view's centre to 0.01°
// (about 1 km), e.g. chart-20261020-1636-40.51N-17.16E: sorts by time, says where
export function exportName(when, lat, lng) {
  lng = norm180(lng);
  const deg = (v, pos, neg) => { const t = Math.abs(v).toFixed(2); return `${t}${v >= 0 || t === '0.00' ? pos : neg}`; };
  return `chart-${when.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}-${deg(lat, 'N', 'S')}-${deg(lng, 'E', 'W')}`;
}

// rows as text a spreadsheet takes: tab-separated, a header line first
export const rowsText = (head, rows) => [head, ...rows].map((r) => r.map((v) => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n';
// "1 line", "2 lines"
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Pure helpers (no map, no DOM): angle and distance formatting, Mercator scale, text wrap.
// Kept apart from app.js so they can be unit-tested in Node.

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
export function mercatorVariation(south, north) {
  const n = Math.min(85, north), s = Math.max(-85, south);
  const hi = Math.max(Math.abs(n), Math.abs(s)), lo = s < 0 && n > 0 ? 0 : Math.min(Math.abs(n), Math.abs(s));
  const rad = Math.PI / 180;
  return Math.cos(lo * rad) / Math.cos(hi * rad) - 1;
}

// Largest 1/2/5 × 10^k not above m (scale bar lengths).
export function niceLen(m) {
  const p = 10 ** Math.floor(Math.log10(m));
  return [5, 2, 1].map((k) => k * p).find((v) => v <= m) || p;
}

// Word wrap to lines of at most n characters (a longer single word stays whole).
export function wrap(text, n) {
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
    if ((line + ' ' + w).length > n && line) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

// Coordinates typed into the search box → { lat, lon }, or null if the text is not coordinates.
// Accepts decimal degrees ("35.898, 14.513", "-31.2 -51.3"), degrees and decimal minutes or
// degrees, minutes and seconds, with hemisphere letters before or after ("35 53.9N 14 30.8E",
// "35°53'54\"N 014°30'48\"E", "N35 53.9 E14 30.8", "14.513E 35.898N"). Without letters, latitude first.
export function parseLatLon(text) {
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
  // degrees [, minutes [, seconds]]: only the last part may have decimals; a minus on the degrees ("-0 30") counts
  const value = ({ nums }) => {
    const [d, m = 0, s = 0] = nums;
    if (m < 0 || m >= 60 || s < 0 || s >= 60 || nums.slice(0, -1).some((v) => !Number.isInteger(v))) return NaN;
    return (d < 0 || Object.is(d, -0) ? -1 : 1) * (Math.abs(d) + m / 60 + s / 3600);
  };
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

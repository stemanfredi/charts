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

// Position readout: degrees and decimal minutes, e.g. 44°05.123′N.
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

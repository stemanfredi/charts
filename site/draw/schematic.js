// Lines drawn apart (docs/drawing-ui.md §5), display only: lengths, totals and exports always come
// from the real geometry. Pure: no map, no DOM. Lines with Draw apart (their own, else their group's:
// a gap in px) are drawn apart where they run together, in two steps, as transit maps are:
// 1. Once, when the drawing changes: where ticked lines run within TOLERANCE of each other (nearly
//    parallel, on one side: near copies), they share a stretch. On each stretch each
//    line has a slot: the shortest in the middle, the longer outwards, right then left in turn, so a
//    line that stops sooner is inside those that go on and reaches its end without crossing them.
// 2. When drawn: on a stretch the lines are drawn on the longest one's geometry, side by side about
//    it, the gap between their strokes, a constant number of pixels at every zoom. A line alone, or
//    not ticked, is drawn where it is. Where a stretch begins or ends a line moves to its new place
//    gradually (1 px across for 4 px along); it comes back to its ends; a line too short on
//    screen for that is drawn nearer, as much as fits.

import { lineTrace } from './lines.js';
import { styleOf, isShown, drawApartOf } from './document.js';
import { mercator, unmercator, CIRC, D2R } from '../geo.js';

const TOLERANCE = 50; // m on the ground: lines nearer than this running together share a stretch
const MIN_TAPER = 24; // px: the shortest stretch over which a line changes its place across
const SLOPE = 4; // px along for each px across, where a line changes its place
const TAPER_STEPS = 8; // points inserted along a taper, so it is smooth whatever the line's own points
const PARALLEL = Math.cos((30 * Math.PI) / 180); // nearly parallel: within 30°
const MAX_SAMPLES = 4000; // points added along a line at most, to look along it

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return l ? [v[0] / l, v[1] / l] : [0, 0]; };

// What is drawn as one line, with Draw apart: each line shown that has it. [{ id, trace: { coords,
// length }, width (px), ends: [key, key] (the point it is attached to, else its position), apart (Draw
// apart) }], in the file's order.
const endKey = (e) => e.element || e.position.join(',');
function strands(doc) {
  const out = [];
  for (const sg of doc.lines) {
    if (!isShown(doc, sg) || !(drawApartOf(doc, sg) > 0)) continue; // only those with Draw apart take part
    out.push({ id: sg.id, trace: lineTrace(doc, sg), width: styleOf(doc, 'line', sg).stroke.width, ends: [endKey(sg.start), endKey(sg.end)], apart: drawApartOf(doc, sg) });
  }
  return out;
}

// ---- 1. stretches, once ---------------------------------------------------------------------------

// A line's points to look along (Mercator), at least every tolerance, with the distance along and the
// direction at each, and the tolerance there in Mercator metres. Cached by the line's trace.
const sampled = new WeakMap();
function samplesOf(trace) {
  if (sampled.has(trace)) return sampled.get(trace);
  const own = trace.coords.map(mercator);
  const tol = TOLERANCE / Math.cos(trace.coords[0][1] * D2R); // Mercator metres: ground metres stretched
  const legs = own.slice(1).map((p, i) => Math.hypot(p[0] - own[i][0], p[1] - own[i][1]));
  const step = Math.max(tol, legs.reduce((a, l) => a + l, 0) / MAX_SAMPLES);
  const pts = [own[0]];
  legs.forEach((l, i) => {
    const n = Math.max(1, Math.ceil(l / step));
    for (let j = 1; j <= n; j++) pts.push([own[i][0] + ((own[i + 1][0] - own[i][0]) * j) / n, own[i][1] + ((own[i + 1][1] - own[i][1]) * j) / n]);
  });
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const dir = pts.map((_, i) => unit(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])));
  const box = pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const out = { pts, s, dir, box, tol, grids: new Map() };
  sampled.set(trace, out);
  return out;
}
// a line's legs in a grid (made once for its points at a zoom): cells at least r wide, and at least
// as wide as its legs on average, so a leg falls in a few cells
const cellKey = (x, y) => (x + 2 ** 23) * 2 ** 24 + (y + 2 ** 23); // one number per cell, exact up to 2²³ cells either way
function gridOf(B, r) {
  if (B.grids.has(r)) return B.grids.get(r);
  const size = Math.max(r, B.s.at(-1) / Math.max(1, B.pts.length - 1)), cells = new Map();
  for (let j = 0; j < B.pts.length - 1; j++) {
    const p = B.pts[j], q = B.pts[j + 1];
    const x0 = Math.floor(Math.min(p[0], q[0]) / size), x1 = Math.floor(Math.max(p[0], q[0]) / size), y0 = Math.floor(Math.min(p[1], q[1]) / size), y1 = Math.floor(Math.max(p[1], q[1]) / size);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = cellKey(x, y); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(j); }
  }
  const grid = { size, cells };
  B.grids.set(r, grid);
  return grid;
}
// Where a runs along b (within the tolerance, nearly parallel, beside it, for longer than a crossing,
// and on one side of it: a crossing, however shallow, is not running along): for each point of a, the
// point of b beside it { q (Mercator), j (b's leg), d (signed metres, positive: a is left of b), align
// (+1: the same direction), lean (+1, −1: the side of b a goes to where they part, in a's terms; 0:
// they do not part) }, or null. Cached by the two traces.
const alongCache = new WeakMap();
function alongOf(ta, tb) {
  let m = alongCache.get(ta);
  if (!m) alongCache.set(ta, (m = new WeakMap()));
  if (m.has(tb)) return m.get(tb);
  const A = samplesOf(ta), B = samplesOf(tb), r = Math.max(A.tol, B.tol);
  let out = null;
  if (!(A.box[0] > B.box[2] + r || B.box[0] > A.box[2] + r || A.box[1] > B.box[3] + r || B.box[1] > A.box[3] + r)) {
    const { size, cells } = gridOf(B, r), eps = r / 10; // closer than this, they coincide
    const near = A.pts.map((p, i) => {
      const cx = Math.floor(p[0] / size), cy = Math.floor(p[1] / size);
      let best = null;
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
        for (const j of cells.get(cellKey(x, y)) || []) {
          const a = B.pts[j], v = sub(B.pts[j + 1], a), len2 = v[0] * v[0] + v[1] * v[1];
          const f = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / len2)) : 0;
          const q = [a[0] + f * v[0], a[1] + f * v[1]], w = sub(p, q), d = Math.hypot(w[0], w[1]);
          if (d > r || (best && d >= Math.abs(best.d))) continue;
          const dirB = unit(v), dot = A.dir[i][0] * dirB[0] + A.dir[i][1] * dirB[1];
          if (Math.abs(dot) < PARALLEL) continue;
          if (d > eps && Math.abs(w[0] * dirB[0] + w[1] * dirB[1]) > 0.5 * d) continue; // past a bend or an end of b: not beside it
          const left = [-A.dir[i][1], A.dir[i][0]], side = w[0] * left[0] + w[1] * left[1];
          best = { q, j, d: side < 0 ? -d : d, align: dot < 0 ? -1 : 1, lean: 0 };
        }
      }
      return best;
    });
    // only runs longer than a crossing, on one side (or coinciding)
    for (let i = 0; i < near.length;) {
      if (!near[i]) { i++; continue; }
      let k = i, lo = 0, hi = 0;
      while (k + 1 < near.length && near[k + 1]) k++;
      for (let x = i; x <= k; x++) { lo = Math.min(lo, near[x].d); hi = Math.max(hi, near[x].d); }
      if (A.s[k] - A.s[i] < 3 * r || (lo < -2 * eps && hi > 2 * eps)) for (let x = i; x <= k; x++) near[x] = null;
      else {
        // where they part: after the run, else before it
        const lean = parts(A, B, k, 1, near[k].align, r) || parts(A, B, i, -1, near[i].align, r);
        for (let x = i; x <= k; x++) near[x].lean = lean;
      }
      i = k + 1;
    }
    if (near.some(Boolean)) out = near;
  }
  m.set(tb, out);
  return out;
}

// The side of b that a goes to past its point x (w: +1 ahead, −1 behind), once more than twice the
// tolerance r away: +1 left, −1 right in a's terms; 0 if a ends first, or b does (a line ending is not
// parting), or they do not part within 20 tolerances.
function parts(A, B, x, w, align, r) {
  const last = B.pts.length - 1;
  for (let y = x + w; y >= 0 && y < A.pts.length && Math.abs(A.s[y] - A.s[x]) <= 20 * r; y += w) {
    const p = A.pts[y];
    let best = null;
    for (let j = 0; j < last; j++) {
      const a = B.pts[j], v = sub(B.pts[j + 1], a), l2 = v[0] * v[0] + v[1] * v[1];
      const f = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) / l2)) : 0;
      const q = [a[0] + f * v[0], a[1] + f * v[1]], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, q, v, end: (j === 0 && f === 0) || (j === last - 1 && f === 1) };
    }
    if (!best || best.end) return 0;
    if (best.d < 2 * r) continue;
    const u = sub(p, best.q);
    return Math.sign(best.v[0] * u[1] - best.v[1] * u[0]) * align; // across b's way there, in a's terms
  }
  return 0;
}

// Each ticked line's place on the stretches it shares: id → { pts (Mercator), s (metres along), base
// (Mercator: where it is drawn from: the stretch's line, else its own), off (px, left positive) }
// for each one that shares a stretch somewhere.
let lastPlaces = null; // the places worked out last, and what they were worked out from
function places(all) {
  const key = all.flatMap((x) => [x.trace, x.apart, x.width, x.id]);
  if (lastPlaces && lastPlaces.key.length === key.length && lastPlaces.key.every((v, i) => v === key[i])) return lastPlaces.out;
  const out = new Map();
  lastPlaces = { key, out };
  for (const A0 of all) {
    const A = samplesOf(A0.trace), n = A.pts.length;
    const others = all.filter((x) => x !== A0).map((B0) => ({ B0, near: alongOf(A0.trace, B0.trace) })).filter((o) => o.near);
    if (!others.length) continue;
    const base = A.pts.slice(), off = new Float64Array(n);
    let moved = false;
    for (let i = 0; i < n; i++) {
      const here = others.filter((o) => o.near[i]);
      if (!here.length) continue;
      // the lines on this stretch: the longest's geometry, in its direction; the shortest in the
      // middle, the longer outwards, right then left in turn
      const members = [{ x: A0, align: 1, q: A.pts[i], j: i }, ...here.map((o) => ({ x: o.B0, align: o.near[i].align, q: o.near[i].q, j: o.near[i].j }))];
      const byLength = members.slice().sort((a, b) => b.x.trace.length - a.x.trace.length || all.indexOf(a.x) - all.indexOf(b.x));
      const ref = byLength[0];
      // the side each goes to where it parts from the reference, in the reference's terms
      const toRef = (x) => (x.x === A0 ? ref.align : x.align * ref.align); // its direction against the reference's
      for (const x of members) {
        if (x === ref) { x.lean = 0; continue; }
        const nr = alongOf(x.x.trace, ref.x.trace)?.[Math.min(x.j, samplesOf(x.x.trace).pts.length - 1)];
        x.lean = (nr?.lean ?? 0) * toRef(x);
      }
      // the shortest in the middle, the longer outwards; at each depth, left and right to those that
      // go there (else the shorter right)
      const inner = members.slice().sort((a, b) => a.x.trace.length - b.x.trace.length || all.indexOf(a.x) - all.indexOf(b.x));
      const m = inner.length, depth = (k) => (m % 2 ? Math.ceil(k / 2) : Math.floor(k / 2) + 0.5);
      for (let k = m % 2; k < m; k += 2) {
        const [u, v] = [inner[k], inner[k + 1]], d = depth(k);
        const uLeft = v ? (u.lean > 0 || v.lean < 0) && !(u.lean < 0) : u.lean > 0;
        u.p = uLeft ? d : -d;
        if (v) v.p = uLeft ? -d : d;
      }
      if (m % 2) inner[0].p = 0;
      // left to right, in the reference's direction (left positive): centres from widths and the gap
      const across = inner.slice().sort((a, b) => b.p - a.p);
      const gap = Math.max(...members.map((x) => x.x.apart));
      const xs = [0];
      for (let k = 1; k < across.length; k++) xs.push(xs[k - 1] + (across[k - 1].x.width + across[k].x.width) / 2 + gap);
      const mid = (xs.at(-1) + across.at(-1).x.width / 2 - across[0].x.width / 2) / 2;
      const k = across.findIndex((x) => x.x === A0);
      // in this line's own direction: the reference's left is its left if they run the same way
      off[i] = (mid - xs[k]) * ref.align;
      base[i] = ref.x === A0 ? A.pts[i] : ref.q;
      moved = true;
    }
    if (moved) out.set(A0.id, { pts: A.pts, s: A.s, base, off });
  }
  return out;
}

// ---- 2. the lines as drawn --------------------------------------------------------------------------

// The lines as drawn at a zoom, where they are not drawn on their real geometry: Map line ID →
// [lon, lat][], for those moved only.
export function schematic(doc, zoom) {
  const lines = new Map();
  if (!doc.lines.some((s) => drawApartOf(doc, s) > 0)) return lines;
  const all = strands(doc);
  if (all.length < 2) return lines;
  const mpp = CIRC / (512 * 2 ** zoom);
  const placed = places(all);
  // each line's place across, changing gradually (1 px across for SLOPE px along, both ways), and
  // the point it is drawn from, eased between its own and the stretch's the same way
  const backs = [], taper = new Map(); // an end's key → px
  for (const x of all) {
    const pl = placed.get(x.id);
    if (!pl) continue;
    const n = pl.pts.length, o = Float64Array.from(pl.off), w = Float64Array.from(pl.base, (q, i) => (q === pl.pts[i] ? 0 : 1));
    for (const v of [o, w]) {
      const k = v === w ? MIN_TAPER : 1; // the snap eased over MIN_TAPER px, the place at SLOPE
      for (let i = 1; i < n; i++) { const dd = (pl.s[i] - pl.s[i - 1]) / mpp / (v === w ? k : SLOPE); v[i] = Math.max(v[i - 1] - dd, Math.min(v[i - 1] + dd, v[i])); }
      for (let i = n - 2; i >= 0; i--) { const dd = (pl.s[i + 1] - pl.s[i]) / mpp / (v === w ? k : SLOPE); v[i] = Math.max(v[i + 1] - dd, Math.min(v[i + 1] + dd, v[i])); }
    }
    // and at its own ends, its own points (it ends where it is attached)
    const L0 = pl.s.at(-1);
    for (let i = 0; i < n; i++) w[i] = Math.min(w[i], Math.min(pl.s[i], L0 - pl.s[i]) / mpp / MIN_TAPER);
    const pts = pl.pts.map((p, i) => (w[i] > 0 ? [p[0] + (pl.base[i][0] - p[0]) * w[i], p[1] + (pl.base[i][1] - p[1]) * w[i]] : p));
    const b = (v) => interp(pl.s, o, v), L = pl.s.at(-1);
    const fix = [-b(0), -b(L)]; // back to its ends
    fix.forEach((f, e) => { if (f) taper.set(x.ends[e], Math.max(taper.get(x.ends[e]) || MIN_TAPER, SLOPE * Math.abs(f))); });
    if (!o.some((v) => Math.abs(v) > 1e-9) && !w.some(Boolean)) continue; // in the middle of its stretch, on its own line
    backs.push({ x, pts, s: pl.s, b, fix });
  }
  // all the lines at an end come back over the same length, so they keep their order
  for (const { x, pts, s, b, fix } of backs) {
    const T = fix.map((f, e) => (f ? taper.get(x.ends[e]) : 0));
    // too short on screen to reach its place and come back at that slope: all of it nearer, as much
    // as fits (far out, lines merge rather than bend)
    // (its place and the length over which it comes back both, so the slope stays the same)
    const Lpx = s.at(-1) / mpp, scale = T[0] + T[1] > Lpx ? Lpx / (T[0] + T[1]) : 1;
    lines.set(x.id, drawn({ pts, s }, mpp, b, fix, T.map((t) => t * scale), scale).map(unmercator));
  }
  return lines;
}
// the value at x of a profile given at increasing distances s
function interp(s, v, x) {
  if (x <= s[0]) return v[0];
  if (x >= s.at(-1)) return v.at(-1);
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= x) lo = m; else hi = m; }
  const f = s[hi] === s[lo] ? 0 : (x - s[lo]) / (s[hi] - s[lo]);
  return v[lo] + f * (v[hi] - v[lo]);
}
// A line drawn off its real geometry: { pts, s } offset to its left by off(s) px, plus fix[e] px at
// each end, brought in smoothly over Tpx[e] px; all of it times scale.
function drawn({ pts, s }, mpp, off, fix, Tpx, scale = 1) {
  const L = s.at(-1);
  if (!L) return pts;
  const T = Tpx.map((t) => Math.min(t * mpp, L / 2));
  return displace(pts, s, (x) => {
    let o = off(x);
    if (fix[0] && x < T[0]) o += fix[0] * ease(1 - x / T[0]);
    if (fix[1] && L - x < T[1]) o += fix[1] * ease(1 - (L - x) / T[1]);
    return o * scale * mpp;
  }, [fix[0] ? T[0] : 0, fix[1] ? T[1] : 0]);
}
const ease = (x) => x * x * (3 - 2 * x); // smoothstep: no kink where a taper starts

// A line (Mercator) offset to its left by off(s) metres at each distance s along, along the averaged
// normal at each point (mitre, clamped at sharp bends); points are added along the tapers (T: their
// lengths at the start and the end) so they are smooth.
function displace(pts, d, off, T) {
  const L = d.at(-1);
  const extra = [];
  for (let j = 1; j <= TAPER_STEPS; j++) {
    if (T[0]) extra.push((T[0] * j) / TAPER_STEPS);
    if (T[1]) extra.push(L - (T[1] * j) / TAPER_STEPS);
  }
  const at = (x) => { // the point at distance x along
    let i = 1;
    while (i < d.length - 1 && d[i] < x) i++;
    const f = d[i] === d[i - 1] ? 0 : (x - d[i - 1]) / (d[i] - d[i - 1]);
    return [pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])];
  };
  const all = [...pts.map((p, i) => ({ s: d[i], p })), ...extra.filter((x) => x > 0 && x < L).map((x) => ({ s: x, p: at(x) }))].sort((a, b) => a.s - b.s);
  // the normal at each point: the average of its legs' left normals, lengthened at a bend (mitre, up to twice)
  const normalOf = (i) => {
    const prev = i > 0 ? unit(sub(all[i].p, all[i - 1].p)) : null, next = i < all.length - 1 ? unit(sub(all[i + 1].p, all[i].p)) : null;
    const ns = [prev, next].filter((v) => v && (v[0] || v[1])).map((v) => [-v[1], v[0]]);
    if (!ns.length) return [0, 0];
    const m = unit([ns.reduce((a, v) => a + v[0], 0), ns.reduce((a, v) => a + v[1], 0)]);
    const cos = ns[0][0] * m[0] + ns[0][1] * m[1];
    return [m[0] / Math.max(cos, 0.5), m[1] / Math.max(cos, 0.5)];
  };
  const out = all.map(({ s, p }, i) => { const n = normalOf(i), o = off(s); return [p[0] + n[0] * o, p[1] + n[1] * o]; });
  return unloop(unfold(out, all.map((x) => x.p)));
}

// An offset line without the folds it makes at a sharp corner while its offset changes: a point where
// it turns back (more than 120°) and the real line does not (less than 90°) is left out.
const turnCos = (a, b, c) => {
  const u = sub(b, a), v = sub(c, b), lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
  return lu && lv ? (u[0] * v[0] + u[1] * v[1]) / lu / lv : 1;
};
function unfold(pts, real) {
  let keep = pts.map(() => true);
  for (let pass = 0; pass < 4; pass++) {
    const ix = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
    let changed = false;
    for (let k = 1; k < ix.length - 1; k++) {
      const [a, b, c] = [ix[k - 1], ix[k], ix[k + 1]];
      if (turnCos(pts[a], pts[b], pts[c]) < -0.5 && turnCos(real[a], real[b], real[c]) > 0) { keep[b] = false; changed = true; k++; }
    }
    if (!changed) break;
  }
  return pts.filter((_, i) => keep[i]);
}

// An offset line without the loops it makes on the inside of a bend tighter than the offset: where it
// crosses itself (within a few points), the part between is cut out at the crossing.
const LOOP = 64; // points: how far along a loop is looked for
function unloop(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (out.length < 2) continue;
    const a = out.at(-2), b = out.at(-1);
    // does the newest leg cross an earlier one (not its neighbour)?
    for (let k = out.length - 3; k >= 1 && k >= out.length - LOOP; k--) {
      const x = cross(out[k - 1], out[k], a, b);
      if (!x) continue;
      out.length = k; // drop the loop
      out.push(x, b);
      break;
    }
  }
  return out;
}
// where legs p–q and r–t cross, or null
function cross(p, q, r, t) {
  const d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]);
  if (!d) return null;
  const u = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d, v = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return u > 0 && u < 1 && v > 0 && v < 1 ? [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])] : null;
}

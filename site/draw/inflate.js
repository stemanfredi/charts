// Inflate (docs/drawing-ui.md §6): a connection's trees drawn bowed, display only: lengths, totals
// and exports always come from the real, straight lines. Pure: no map, no DOM.
// Each hub's branches have a dominant direction, the mean of their directions from the hub. A branch
// is drawn as a curve through its real ends, bowed away from that direction by its angle from it
// (one along it stays straight; the farther off, the more it bows): the fan opens. The trunk is drawn
// arriving at the hub along the dominant direction, as far as it heads that way at all. The amount is
// the connection's `inflate` (0: off, straight; 1: the most), on a quadratic Bézier in the map's
// projection. A line edited by hand (a vertex added, a handle set) is drawn as it is.

import { mercator, unmercator } from '../geo.js';
import { connections } from './generator.js';

const STEPS = 12; // points along each curve
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => { const l = len(v); return l ? [v[0] / l, v[1] / l] : null; };
// the quadratic Bézier a–c–b, sampled, as lon/lat
const curve = (a, c, b) => Array.from({ length: STEPS + 1 }, (_, i) => {
  const t = i / STEPS, u = 1 - t;
  return unmercator([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
});

// The lines drawn bowed: Map line ID → [lon, lat][]
export function inflated(doc) {
  const out = new Map();
  for (const c of connections(doc)) {
    if (!(c.inflate > 0) || c.pattern !== 'tree') continue;
    const ids = new Set(c.created); // (a Set: a drawing of thousands of lines asks this per line)
    const made = doc.lines.filter((s) => ids.has(s.id) && !s.vertices.length && !s.startHandle && !s.endHandle);
    for (const b of c.hubs) {
      const H = mercator(b.pos);
      const branches = made.filter((s) => s.start.element === b.pointId && b.pointIds.includes(s.end.element));
      const dirs = branches.map((s) => unit(sub(mercator(s.end.position), H))).filter(Boolean);
      const D = dirs.length && unit(dirs.reduce((a, d) => [a[0] + d[0], a[1] + d[1]], [0, 0]));
      if (!D) continue;
      for (const s of branches) {
        const T = mercator(s.end.position), v = sub(T, H), along = v[0] * D[0] + v[1] * D[1];
        const across = [v[0] - along * D[0], v[1] - along * D[1]]; // the part of the branch square to the dominant direction: how far off it heads
        if (0.5 * c.inflate * len(across) < 1) continue; // along it (a bow under a metre): straight
        const M = [(H[0] + T[0]) / 2, (H[1] + T[1]) / 2];
        out.set(s.id, curve(H, [M[0] + 0.5 * c.inflate * across[0], M[1] + 0.5 * c.inflate * across[1]], T));
      }
      const trunk = made.find((s) => s.end.element === b.pointId && s.start.element === b.rootId);
      if (!trunk) continue;
      const R = mercator(trunk.start.position), v = sub(H, R), l = len(v), u = unit(v);
      const k = u ? 0.5 * c.inflate * Math.max(0, u[0] * D[0] + u[1] * D[1]) : 0; // only as far as the trunk heads the dominant way
      if (k > 1e-9) out.set(trunk.id, curve(R, [H[0] - k * l * D[0], H[1] - k * l * D[1]], H));
    }
  }
  return out;
}

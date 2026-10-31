import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';

const { OUTLINES } = await import('../../site/draw/document.js');
const { OUTLINE_NAME, unitOutline, outlinePoints } = await import('../../site/draw/outlines.js');
const { inverse, areaOf, densify, ccw } = await import('../../site/geodesy.js');

const C = [12, 40], B = 30, L = 120, W = 40;
// an outline's places as a closed ring, its legs geodesics (a closed line's, straight)
const ringOf = (o) => { const ps = outlinePoints(C, B, L, W, o); return [...ps, ps[0]].flatMap((p, i, all) => (i ? densify(all[i - 1], p, 1000).slice(1) : [p])); };

test('every outline: symmetric, clockwise, reaching the length and width exactly', () => {
  for (const o of OUTLINES) {
    const u = unitOutline(o);
    const key = (p) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0).join(); // + 0: −0 as 0
    const pts = new Set(u.map(key));
    for (const [x, y] of u) assert.ok(pts.has(key([-x, y])), `${o}: mirrored ${x}, ${y}`);
    let a = 0; // the shoelace sum, x right and y forward: negative going clockwise
    for (let i = 0; i < u.length; i++) { const [x1, y1] = u[i], [x2, y2] = u[(i + 1) % u.length]; a += x1 * y2 - x2 * y1; }
    assert.ok(a < 0, `${o}: clockwise`);
    // on the ellipsoid: the farthest places across and along at half the width and length
    const ps = outlinePoints(C, B, L, W, o);
    const local = ps.map((p) => { const d = inverse(C, p), t = ((d.azi - B) * Math.PI) / 180; return [d.s * Math.sin(t), d.s * Math.cos(t)]; });
    near(Math.max(...local.map((p) => p[0])), W / 2, 0.001, `${o} right`);
    near(Math.min(...local.map((p) => p[0])), -W / 2, 0.001, `${o} left`);
    near(Math.max(...local.map((p) => p[1])), L / 2, 0.001, `${o} front`);
    near(Math.min(...local.map((p) => p[1])), -L / 2, 0.001, `${o} back`);
    assert.ok(areaOf(ccw(ringOf(o))) <= L * W * 1.0001, `${o}: within its rectangle`);
  }
});

test('the rectangle: its corners at the half diagonal (front right, back right, back left, front left), its sides the length and width', () => {
  const cs = outlinePoints(C, B, L, W);
  for (const p of cs) near(inverse(C, p).s, Math.hypot(L, W) / 2, 1e-6, 'half diagonal');
  near(inverse(cs[0], cs[1]).s, L, 1e-3, 'right side');
  near(inverse(cs[1], cs[2]).s, W, 1e-3, 'back');
  near(inverse(cs[2], cs[3]).s, L, 1e-3, 'left side');
  near(inverse(cs[3], cs[0]).s, W, 1e-3, 'front');
});

test('areas: the rectangle its length by its width; the ellipse π/4 of it; the vehicles in between', () => {
  near(areaOf(ccw(ringOf('rectangle'))), L * W, 0.001 * L * W, 'rectangle');
  near(areaOf(ccw(ringOf('ellipse'))), (Math.PI / 4) * L * W, 0.002 * L * W, 'ellipse');
  for (const o of ['surface-vehicle', 'underwater-vehicle']) { const a = areaOf(ccw(ringOf(o))); assert.ok(a > 0.75 * L * W && a < L * W, `${o}: ${a}`); }
  const air = areaOf(ccw(ringOf('aerial-vehicle')));
  assert.ok(air > 0.1 * L * W && air < 0.5 * L * W, `aerial: ${air}`);
});

test('every outline the Shape tool offers has a name', () => {
  for (const o of OUTLINES) assert.ok(OUTLINE_NAME[o], o);
});

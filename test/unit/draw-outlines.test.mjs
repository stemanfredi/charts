import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';

const { OUTLINES } = await import('../../site/draw/document.js');
const { OUTLINE_NAME, unitOutline, outlineOf, isVehicle } = await import('../../site/draw/outlines.js');
const { OUTLINES: DOC_OUTLINES, makePart } = await import('../../site/draw/document.js');
const { enlargement } = await import('../../site/draw/features.js');
const { inverse, rectangle, areaOf, ccw } = await import('../../site/geodesy.js');
const { CIRC } = await import('../../site/geo.js');

const C = [12, 40], B = 30, L = 120, W = 40;

test('every outline: symmetric, clockwise, reaching the length and width exactly', () => {
  for (const o of OUTLINES) {
    const u = unitOutline(o);
    const key = (p) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0).join(); // + 0: −0 as 0
    const pts = new Set(u.map(key));
    for (const [x, y] of u) assert.ok(pts.has(key([-x, y])), `${o}: mirrored ${x}, ${y}`);
    let a = 0; // the shoelace sum, x right and y forward: negative going clockwise
    for (let i = 0; i < u.length; i++) { const [x1, y1] = u[i], [x2, y2] = u[(i + 1) % u.length]; a += x1 * y2 - x2 * y1; }
    assert.ok(a < 0, `${o}: clockwise`);
    // on the ellipsoid: the farthest points across and along at half the width and length
    const { ring } = outlineOf(C, B, L, W, o);
    const local = ring.map((p) => { const d = inverse(C, p), t = ((d.azi - B) * Math.PI) / 180; return [d.s * Math.sin(t), d.s * Math.cos(t)]; });
    near(Math.max(...local.map((p) => p[0])), W / 2, 0.001, `${o} right`);
    near(Math.min(...local.map((p) => p[0])), -W / 2, 0.001, `${o} left`);
    near(Math.max(...local.map((p) => p[1])), L / 2, 0.001, `${o} front`);
    near(Math.min(...local.map((p) => p[1])), -L / 2, 0.001, `${o} back`);
    near(inverse(ring[0], ring.at(-1)).s, 0, 1e-6, `${o}: closed`);
    assert.ok(areaOf(ccw(ring)) <= L * W * 1.0001, `${o}: within its rectangle`);
  }
});

test('areas: the rectangle as before; the ellipse π/4 of it; the vehicles in between', () => {
  assert.deepEqual(outlineOf(C, B, L, W).ring, rectangle(C, B, L, W).ring);
  near(areaOf(outlineOf(C, B, L, W, 'ellipse').ring), (Math.PI / 4) * L * W, 0.002 * L * W, 'ellipse');
  for (const o of ['surface-vehicle', 'underwater-vehicle']) { const a = areaOf(outlineOf(C, B, L, W, o).ring); assert.ok(a > 0.75 * L * W && a < L * W, `${o}: ${a}`); }
  const air = areaOf(outlineOf(C, B, L, W, 'aerial-vehicle').ring);
  assert.ok(air > 0.1 * L * W && air < 0.5 * L * W, `aerial: ${air}`);
});

test('a vehicle drawn small is enlarged to twice the drawing\'s minimum; its own value still wins', () => {
  const doc = (minSize) => ({ look: { minSize }, groups: [] }); // the drawing's look
  const point = (kind, own) => ({ position: [0, 0], bearing: 0, parts: [makePart(kind, { length: 100, width: 20 })], groupId: null, look: own == null ? {} : { minSize: own } });
  // at zoom 10 on the equator, about 153 m a pixel: 100 m is 0.65 px
  const k = enlargement(doc(12), point('rectangle'), 10);
  near(k, 12 / (100 / (CIRC / (512 * 2 ** 10))), 1e-6, 'the long side drawn 12 px');
  near(enlargement(doc(12), point('surface-vehicle'), 10) / k, 2, 1e-9, 'twice');
  near(enlargement(doc(12), point('ellipse'), 10), k, 1e-9, 'an ellipse as a rectangle');
  near(enlargement(doc(12), point('aerial-vehicle', 12), 10), k, 1e-9, 'its own value');
  assert.equal(enlargement(doc(0), point('underwater-vehicle'), 10), 1);
  assert.ok(isVehicle('aerial-vehicle') && !isVehicle('ellipse'));
  // several outlines: the largest decides, a vehicle among the smaller ones does not double it
  const two = (big, small) => ({ ...point('rectangle'), parts: [makePart(small, { length: 50, width: 20 }), makePart(big, { length: 100, width: 20 })] });
  near(enlargement(doc(12), two('rectangle', 'surface-vehicle'), 10), k, 1e-9, 'by the largest');
  near(enlargement(doc(12), two('surface-vehicle', 'rectangle'), 10), 2 * k, 1e-9, 'the largest a vehicle');
});

test('enlargement: none for a point without an outline, one large enough on screen, or no zoom', () => {
  const doc = { look: { minSize: 12 }, groups: [] };
  const point = (...parts) => ({ position: [0, 0], parts, groupId: null, look: {} });
  assert.equal(enlargement(doc, point(), 10), 1);
  assert.equal(enlargement(doc, point(makePart('circle', { radius: 1 })), 10), 1); // round parts are never enlarged
  assert.equal(enlargement(doc, point(makePart('rectangle', { length: 5000, width: 20 })), 10), 1);
  assert.equal(enlargement(doc, point(makePart('rectangle', { length: 100, width: 20 }), makePart('rectangle', { length: 5000, width: 20 })), 10), 1); // its largest large enough
  assert.equal(enlargement(doc, point(makePart('rectangle', { length: 100, width: 20 })), null), 1);
});

test('the outlines a point may have are the file\'s list, each with a name', () => {
  assert.deepEqual(OUTLINES, DOC_OUTLINES);
  for (const o of OUTLINES) assert.ok(OUTLINE_NAME[o], o);
});

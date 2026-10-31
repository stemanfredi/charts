import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineFrom, placeIn, addRing } from './helpers.mjs';

const { emptyDoc, addPoint, addLabel, addCircle, addLine, makeGroup } = await import('../../site/draw/document.js');
const { outlinePoints } = await import('../../site/draw/outlines.js');
const { clipOf, paste, centreOf } = await import('../../site/draw/clipboard.js');
const { refreshAttached } = await import('../../site/draw/attach.js');
const { loadPresets, savePresets, presetOf, presetsFile, readPresets } = await import('../../site/draw/presets.js');

const shift = (q) => [q[0] + 1, q[1]];

test('a copy pasted: new IDs and numbered names, moved, its group kept; attachments between the copied kept, others freed', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [10, 40], { id: 'a', name: 'Point 1' });
  const b = addPoint(doc, [10.1, 40], { id: 'b', name: 'Mark' });
  const g = makeGroup(doc, ['a']);
  lineFrom(doc, 'a', [[10.05, 40.05]], 'b', { id: 'l', name: 'Line 1' });
  const lab = addLabel(doc, [10.1, 40], { element: 'b' });
  const clip = clipOf(doc, [g.id, 'l', lab.id]); // the group: its member
  assert.deepEqual(clip.items.map((x) => x.el.id), ['a', 'l', lab.id]);
  assert.deepEqual(centreOf(clip), [10.05, 40.025]);
  const made = paste(doc, clip, shift);
  const [a2, l2, lab2] = made.map((x) => x.el);
  assert.ok(![a2.id, l2.id, lab2.id].some((id) => ['a', 'l', lab.id].includes(id)));
  assert.deepEqual([a2.name, l2.name], ['Point 2', 'Line 2']);
  assert.deepEqual(a2.position, [11, 40]);
  assert.equal(a2.groupId, g.id);
  assert.deepEqual(placeIn(doc, l2, 0), { position: [11, 40], to: { element: a2.id } }); // linked to the copy
  assert.deepEqual(placeIn(doc, l2, -1), { position: [11.1, 40], to: null }); // b was not copied: free
  assert.deepEqual(l2.points[1], [11.05, 40.05]);
  assert.equal(placeIn(doc, lab2).to.element, 'b'); // b is in the drawing: still pointing at it
  refreshAttached(doc);
  assert.deepEqual(placeIn(doc, lab2), { position: [10.1, 40], to: { element: 'b' } }); // where b is
  assert.equal(b.name, 'Mark');
  // into another drawing: the group and what was left behind are not there
  const other = emptyDoc(0);
  const [a3, , lab3] = paste(other, clip, shift).map((x) => x.el);
  assert.deepEqual([a3.groupId, a3.name], [null, 'Point 1']);
  assert.deepEqual(placeIn(other, lab3), { position: [11.1, 40], to: null }); // free, where it pointed (moved with the copy)
  assert.deepEqual(other.links, [{ from: [other.lines[0].id, 0], to: { element: a3.id } }]); // only the one between the copied
  const twice = paste(doc, clipOf(doc, ['b']), shift)[0].el;
  assert.equal(twice.name, 'Mark 2');
});

test('a point copied with its shapes: they are its copy\'s; a shape copied alone is free', () => {
  const doc = emptyDoc(0), g = makeGroup(doc, []);
  const p = addPoint(doc, [10, 40], { groupId: g.id });
  const c = addCircle(doc, [10, 40], { groupId: p.id, aperture: 45 }), r = addLine(doc, outlinePoints([10, 40], 0, 100, 50), { groupId: p.id, closed: true });
  const clip = clipOf(doc, [p.id]);
  assert.deepEqual(clip.items.map((x) => x.el.id), [p.id, c.id, r.id]); // a point: with its shapes
  const [p2, c2, r2] = paste(doc, clip, shift).map((x) => x.el);
  assert.deepEqual([p2.groupId, c2.groupId, r2.groupId, c2.aperture, c2.position, r2.points[0]], [g.id, p2.id, p2.id, 45, [11, 40], shift(r.points[0])]);
  assert.notEqual(c2.id, c.id);
  const [c3] = paste(doc, clipOf(doc, [c.id]), shift).map((x) => x.el);
  assert.equal(c3.groupId, null); // its point not copied: free
});

test('presets: a point and its shapes kept under a name, as they are; stored; a file of them read back, what is not one left out', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [10, 40], { bearing: 30, look: { stroke: { color: '#1f5f86' } } });
  addCircle(doc, [10, 40], { groupId: p.id, radius: 2000, aperture: 45, name: 'wide', look: { fill: { opacity: 0 } } });
  addLine(doc, outlinePoints([10, 40], 30, 80, 100, 'triangle'), { groupId: p.id, closed: true });
  addPoint(doc, [11, 40]); // not its
  const pre = presetOf(doc, p.id, 'Mine');
  assert.deepEqual([pre.name, pre.doc.points.length, pre.doc.circles.length, pre.doc.lines.length], ['Mine', 1, 1, 1]);
  assert.deepEqual([pre.doc.points[0].look, pre.doc.points[0].bearing, pre.doc.circles[0].look, pre.doc.circles[0].groupId], [p.look, 30, { fill: { opacity: 0 } }, pre.doc.points[0].id]);
  assert.notEqual(pre.doc.circles[0], doc.circles[0], 'a copy');
  const kept = JSON.parse(presetsFile([pre])).presets[0];
  const back = readPresets(JSON.stringify({ format: 'charts-presets', presets: [kept, { name: '' }, { name: 'x' }, { name: 'none', drawing: { type: 'FeatureCollection', features: [] } }, kept] }));
  assert.deepEqual(back.map((x) => x.name), ['Mine']); // each name once, and holding a point
  assert.deepEqual([back[0].doc.circles[0].aperture, back[0].doc.lines[0].points.length, back[0].doc.circles[0].groupId], [45, 3, back[0].doc.points[0].id]);
  // read as a file is: what is not valid left out
  const odd = readPresets(JSON.stringify({ format: 'charts-presets', presets: [{ name: 'Odd', drawing: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { charts: { kind: 'point', symbol: 'star' } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { charts: { kind: 'circle', radius: -5 } } }] } }] }));
  assert.deepEqual([odd[0].doc.points[0].symbol, odd[0].doc.circles], ['none', []]);
  assert.equal(readPresets('{"format":"charts-drawing"}'), null);
  assert.equal(readPresets('nope'), null);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadPresets(), []);
  savePresets([pre]);
  assert.deepEqual(loadPresets().map((x) => [x.name, x.doc.circles.length]), [['Mine', 1]]);
  delete globalThis.localStorage;
});

test('a large import: Zoom to, Duplicate and Paste take hundreds of thousands of positions', async () => {
  const { boundsOf } = await import('../../site/draw/features.js');
  const doc = emptyDoc(0);
  const pts = Array.from({ length: 300000 }, (_, i) => [10 + (i % 1000) / 1000, 40 + i / 1e6]);
  const g = addRing(doc, pts);
  assert.deepEqual(boundsOf(doc, new Set([g.id])).map((v) => +v.toFixed(4)), [10, 40, 10.999, 40.3]); // its closing leg's geodesic a little north of its ends
  assert.deepEqual(centreOf(clipOf(doc, [g.id])).map((v) => +v.toFixed(7)), [10.4995, 40.1499995]);
});

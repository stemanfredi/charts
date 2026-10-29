import { test } from 'node:test';
import assert from 'node:assert/strict';

const { emptyDoc, addPoint, addLine, addLabel, makeGroup, makePart } = await import('../../site/draw/document.js');
const { copyOf, paste, centreOf } = await import('../../site/draw/clipboard.js');
const { refreshAttached } = await import('../../site/draw/attach.js');
const { loadPresets, savePresets, presetOf, presetsFile, readPresets } = await import('../../site/draw/presets.js');

const shift = (q) => [q[0] + 1, q[1]];

test('a copy pasted: new IDs and numbered names, moved, its group kept; attachments between the copied kept, others freed', () => {
  const doc = emptyDoc(0);
  const a = addPoint(doc, [10, 40], { id: 'a', name: 'Point 1' });
  const b = addPoint(doc, [10.1, 40], { id: 'b', name: 'Mark' });
  const g = makeGroup(doc, ['a']);
  addLine(doc, 'a', [[10.05, 40.05]], 'b', { id: 'l', name: 'Line 1' });
  const lab = addLabel(doc, { position: [10.1, 40], element: 'b' });
  const clip = copyOf(doc, [g.id, 'l', lab.id]); // the group: its member
  assert.deepEqual(clip.items.map((x) => x.el.id), ['a', 'l', lab.id]);
  assert.deepEqual(centreOf(clip), [10.05, 40.025]);
  const made = paste(doc, clip, shift);
  const [a2, l2, lab2] = made.map((x) => x.el);
  assert.ok(![a2.id, l2.id, lab2.id].some((id) => ['a', 'l', lab.id].includes(id)));
  assert.deepEqual([a2.name, l2.name], ['Point 2', 'Line 2']);
  assert.deepEqual(a2.position, [11, 40]);
  assert.equal(a2.groupId, g.id);
  assert.deepEqual(a2.parts, a.parts); // its parts copied, not shared
  assert.notEqual(a2.parts[0], a.parts[0]);
  assert.deepEqual(l2.start, { position: [11, 40], element: a2.id }); // attached to the copy
  assert.deepEqual(l2.end, { position: [11.1, 40], element: null }); // b was not copied: free
  assert.deepEqual(l2.vertices[0].position, [11.05, 40.05]);
  assert.equal(lab2.anchor.element, 'b'); // b is in the drawing: still pointing at it
  refreshAttached(doc);
  assert.deepEqual(lab2.anchor, { position: [10.1, 40], element: 'b' }); // where b is
  assert.equal(b.name, 'Mark');
  // into another drawing: the group and what was left behind are not there
  const other = emptyDoc(0);
  const [a3, , lab3] = paste(other, clip, shift).map((x) => x.el);
  assert.deepEqual([a3.groupId, a3.name], [null, 'Point 1']);
  assert.deepEqual(lab3.anchor, { position: [11.1, 40], element: null }); // free, where it pointed (moved with the copy)
  const twice = paste(doc, copyOf(doc, ['b']), shift)[0].el;
  assert.equal(twice.name, 'Mark 2');
});

test('presets: a point\'s own look kept under a name; stored; a file of them read back, what is not one left out', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [10, 40], { bearing: 30, look: { stroke: { color: '#1f5f86' } }, parts: [makePart('circle'), { ...makePart('sector', { radius: 2000, aperture: 45 }), fill: false, name: 'wide' }, makePart('triangle', { length: 80, width: 100 })] });
  const pre = presetOf(p, 'Mine');
  assert.deepEqual([pre.name, Object.keys(pre.point).sort(), pre.point.symbol, pre.point.parts], ['Mine', ['look', 'parts', 'symbol'], 'diamond', p.parts]); // its parts, not its bearing
  assert.notEqual(pre.point.parts[0], p.parts[0], 'a copy');
  assert.deepEqual(pre.point.look, { stroke: { color: '#1f5f86' } }); // what it sets itself, nothing it takes from the drawing or the defaults
  const back = readPresets(presetsFile([pre, { name: '' }, { name: 'x' }, pre]));
  assert.deepEqual(back.map((x) => x.name), ['Mine']);
  assert.deepEqual(back[0].point.parts, p.parts);
  // its parts read as a file's are: what is not one left out
  const odd = readPresets(presetsFile([{ name: 'Odd', point: { symbol: 'star', parts: [{ kind: 'hovercraft', length: 1, width: 1 }, { kind: 'circle', radius: 5, fill: false }, { kind: 'sector', radius: 9 }] } }]));
  assert.deepEqual(odd[0].point, { symbol: 'none', parts: [{ ...makePart('circle', { radius: 5 }), fill: false }, makePart('circle', { radius: 9 })], look: {} });
  assert.equal(readPresets('{"format":"charts-drawing"}'), null);
  assert.equal(readPresets('nope'), null);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadPresets(), []);
  savePresets([pre]);
  assert.deepEqual(loadPresets().map((x) => x.name), ['Mine']);
  delete globalThis.localStorage;
});

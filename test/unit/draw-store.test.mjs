import { test } from 'node:test';
import assert from 'node:assert/strict';

const { DrawStore } = await import('../../site/draw/store.js');
const { addPoint, addLine, addLabel, makeGroup, lookOf, dependents } = await import('../../site/draw/document.js');

// a store counting what it was told of
function store() {
  const s = new DrawStore();
  s.told = { changed: 0, selection: 0, hover: 0 };
  s.changed = () => s.told.changed++;
  s.selectionChanged = () => s.told.selection++;
  s.hoverChanged = () => s.told.hover++;
  return s;
}

test('a change is one undo step; undo and redo go back and forth; nothing changed, no step', () => {
  const s = store();
  let p;
  s.change((doc) => { p = addPoint(doc, [14, 44]); });
  assert.equal(s.doc.points.length, 1);
  assert.equal(s.undos.length, 1);
  const name = s.doc.points[0].name;
  s.change((doc) => { doc.points[0].name = name; }); // the same value applied again
  assert.equal(s.undos.length, 1);
  s.undo();
  assert.equal(s.doc.points.length, 0);
  s.redo();
  assert.equal(s.doc.points[0].id, p.id);
  assert.equal(s.told.changed, 3);
});

test('previews make no step; the change after them makes one, from before the first preview', () => {
  const s = store();
  s.change((doc) => { addPoint(doc, [14, 44]); });
  s.preview((doc) => { doc.points[0].look.fill = { color: '#000001' }; });
  s.preview((doc) => { doc.points[0].look.fill = { color: '#000002' }; });
  assert.equal(s.undos.length, 1);
  s.change((doc) => { doc.points[0].look.fill = { color: '#000003' }; });
  assert.equal(s.undos.length, 2);
  s.undo();
  assert.deepEqual(s.doc.points[0].look, {});
});

test('selection: replace, toggle, add; told only when it changes', () => {
  const s = store();
  s.select(['a', 'b']);
  s.select(['a', 'b']);
  assert.deepEqual([...s.sel], ['a', 'b']);
  assert.equal(s.told.selection, 1);
  s.select(['b', 'c'], 'toggle');
  assert.deepEqual([...s.sel].sort(), ['a', 'c']);
  s.select(['d'], 'add');
  assert.deepEqual([...s.sel].sort(), ['a', 'c', 'd']);
  s.setHover('a');
  s.setHover('a');
  assert.equal(s.told.hover, 1);
});

test('a change settles the geometry: an attached end follows its point, in the same step', () => {
  const s = store();
  let a, b, ln;
  s.change((doc) => { a = addPoint(doc, [14, 44]); b = addPoint(doc, [14.1, 44]); ln = addLine(doc, a.id, [[14.05, 44.05]], b.id); });
  s.change((doc) => { doc.points.find((p) => p.id === a.id).position = [13.9, 43.9]; });
  const line = s.doc.lines[0];
  assert.deepEqual(line.start, { position: [13.9, 43.9], element: a.id });
  assert.deepEqual(line.end, { position: [14.1, 44], element: b.id });
  assert.equal(s.undos.length, 2);
  s.undo();
  assert.deepEqual(s.doc.lines[0].start.position, [14, 44]);
  assert.equal(s.doc.lines[0].id, ln.id);
});

test('what no longer exists leaves the selection and the hover; deleting a point frees the ends attached to it, in one step', () => {
  const s = store();
  let a, b, ln;
  s.change((doc) => { a = addPoint(doc, [14, 44]); b = addPoint(doc, [14.1, 44]); ln = addLine(doc, a.id, [], b.id); });
  s.select([a.id, ln.id]);
  s.setHover(a.id);
  assert.deepEqual([...dependents(s.doc, [a.id])], [a.id], 'the line is not taken with it');
  s.remove([a.id]);
  assert.deepEqual([...s.sel], [ln.id]);
  assert.equal(s.hover, null);
  assert.equal(s.doc.points.length, 1);
  assert.deepEqual(s.doc.lines[0].start, { position: [14, 44], element: null }, 'free where it was');
  assert.equal(s.doc.lines[0].end.element, b.id);
  s.undo();
  assert.equal(s.doc.points.length, 2);
  assert.equal(s.doc.lines[0].start.element, a.id);
});

test('deleting a group: its members with it, or kept ungrouped; a label on what goes stays, free where it pointed', () => {
  const s = store();
  let p, q, g, lab;
  s.change((doc) => {
    p = addPoint(doc, [14, 44]); q = addPoint(doc, [14.2, 44]);
    g = makeGroup(doc, [p.id, q.id]);
    lab = addLabel(doc, { position: [14, 44], element: p.id });
  });
  s.remove([g.id]);
  assert.deepEqual(s.doc.points.map((x) => [x.id, x.groupId]), [[p.id, null], [q.id, null]]);
  s.undo();
  s.remove([g.id], true);
  assert.equal(s.doc.points.length, 0);
  assert.equal(s.doc.groups.length, 0);
  assert.deepEqual(s.doc.labels.map((x) => [x.id, x.anchor]), [[lab.id, { position: [14, 44], element: null }]]);
});

test('adopt: another document, its display settings, nothing selected, undo afresh', () => {
  const s = store();
  s.change((doc) => { addPoint(doc, [14, 44]); });
  s.select([s.doc.points[0].id]);
  const other = new DrawStore().doc;
  other.look = { minSize: 20 }; // the drawing's look: with its document
  s.adopt(other);
  assert.equal(s.doc, other);
  assert.equal(lookOf(s.doc, s.doc).minSize, 20);
  assert.equal(s.sel.size, 0);
  assert.equal(s.undos.length, 0);
  assert.ok(s.isEmpty());
});

test('undo while a change is previewed (a colour being picked): the preview dropped, never part of a step', () => {
  const s = store();
  s.change((doc) => { addPoint(doc, [12, 41]); });
  s.change((doc) => { addPoint(doc, [13, 41]); });
  s.preview((doc) => { doc.points[0].name = 'Previewed'; });
  s.undo();
  assert.deepEqual(s.doc.points.map((p) => p.name), [s.doc.points[0].name]);
  assert.notEqual(s.doc.points[0].name, 'Previewed');
  s.redo();
  assert.equal(s.doc.points.length, 2);
  assert.ok(!s.doc.points.some((p) => p.name === 'Previewed'), 'the preview not brought back by redo');
});

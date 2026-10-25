import { test } from 'node:test';
import assert from 'node:assert/strict';

// the browser's storage and events, as the page has them
const data = new Map();
globalThis.localStorage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
const { DrawStore } = await import('../../site/draw/store.js');
const { Saving, savedView } = await import('../../site/draw/saving.js');
const { emptyDoc, addPoint } = await import('../../site/draw/document.js');
const { serialise } = await import('../../site/draw/file.js');

// a drawing as drawing.js has it, without the map: the store, its file text, its saving
function drawing() {
  const d = new DrawStore();
  d.known = null;
  d.onChange = () => {};
  d.text = () => serialise(d.doc);
  d.saving = new Saving(d);
  d.changed = () => d.saving.soon();
  return d;
}
const named = (title, at = [12, 41]) => { const doc = emptyDoc(); doc.meta.title = title; addPoint(doc, at); return doc; };
// a drawing of another format version
const another = (title, view) => JSON.stringify({ type: 'FeatureCollection', charts: { format: 'charts-drawing', version: 2, title, ...(view ? { view } : {}) }, features: [] });

test('saved as the file is: GeoJSON text, read back as it was', () => {
  data.clear();
  const d = drawing();
  d.adopt(named('One'));
  d.saving.now();
  const id = d.saving.list()[0].id, text = localStorage.getItem(`charts.drawing.${id}`);
  assert.equal(JSON.parse(text).type, 'FeatureCollection');
  assert.equal(text, serialise(d.doc));
  const e = drawing();
  e.saving.restore();
  assert.equal(e.doc.meta.title, 'One');
  assert.deepEqual(e.doc.points.map((p) => p.position), [[12, 41]]);
});

test('a drawing of the list of another format version is not read: a new one opens, its text never saved over', () => {
  data.clear();
  const text = another('Old', { center: [12, 41], zoom: 6, bearing: 0 });
  localStorage.setItem('charts.drawing.k1', text);
  localStorage.setItem('charts.drawings', JSON.stringify([{ id: 'k1', title: 'Old', modified: '2026-01-01T00:00:00Z', size: text.length }]));
  localStorage.setItem('charts.drawings.current', 'k1');
  assert.equal(savedView(null), null);
  const d = drawing();
  const said = [], error = console.error;
  console.error = (...x) => said.push(x.join(' '));
  try { d.saving.restore(); } finally { console.error = error; }
  assert.match(said.join(), /format version 2/);
  assert.ok(d.isEmpty());
  const list = d.saving.list();
  assert.deepEqual(list.find((x) => x.id === 'k1') && [list.length, list.find((x) => x.open).id !== 'k1'], [2, true]);
  d.adopt(named('New'));
  d.saving.now();
  assert.equal(localStorage.getItem('charts.drawing.k1'), text, 'its text left as it was');
});

test('New, open another, delete: each drawing under its own key, the list up to date', () => {
  data.clear();
  const d = drawing();
  d.adopt(named('One'));
  d.saving.now();
  d.saving.add(); // New: empty, nothing saved until something is drawn
  assert.equal(d.saving.list().length, 2);
  d.adopt(named('Two'));
  d.saving.now();
  const one = d.saving.list().find((x) => x.title === 'One');
  d.saving.open(one.id);
  assert.equal(d.doc.meta.title, 'One');
  assert.deepEqual(d.saving.list().map((x) => x.title).sort(), ['One', 'Two']);
  d.saving.remove(one.id); // the open one: the next opens
  assert.equal(d.doc.meta.title, 'Two');
  assert.deepEqual(d.saving.list().map((x) => x.title), ['Two']);
  assert.ok(d.saving.list()[0].size > 100);
});

test('the view moved: saved with the next save or when the page goes, never by a tab another tab has saved over', () => {
  data.clear();
  const d = drawing();
  d.adopt(named('One'));
  d.saving.now();
  const saved = localStorage.getItem(`charts.drawing.${d.saving.id}`);
  d.saving.viewChanged();
  assert.equal(d.saving.viewMoved, true);
  assert.equal(localStorage.getItem(`charts.drawing.${d.saving.id}`), saved, 'nothing written yet');
  d.saving.now();
  assert.equal(d.saving.viewMoved, false);
  d.saving.otherTab = true; // another tab saved this drawing since
  d.saving.viewChanged();
  assert.equal(d.saving.viewMoved, false, 'an older copy never written back for a moved view');
});

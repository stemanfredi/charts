// The user's own presets (docs/drawing-ui.md §9): a point kept under a name with its shapes (sizes
// and bearings as they are about it), its symbol and its look, placed again from the Shape tool's kinds
// (the Point tool's for a point without shapes). Each is a small drawing of its own ({ name, doc }),
// kept as a drawing's file is. They live in this browser only, never in the app or a drawing's file; a
// small file of their own moves them to another browser (Download › Presets, Open a file…). Local
// storage may be missing or refuse: every access is guarded.

import { emptyDoc } from './document.js';
import { parse, toFile } from './file.js';
import { clipOf, paste } from './clipboard.js';
import { store } from '../dom.js';
import { note } from '../menu.js';

const KEY = 'charts.presets';
const PRESETS_FORMAT = 'charts-presets';

// as kept: each preset's drawing as its file's object
const kept = (list) => list.map((x) => ({ name: x.name, drawing: toFile(x.doc) }));
export function loadPresets() {
  const v = store.json(KEY);
  return Array.isArray(v) ? clean(v) : [];
}
export function savePresets(list) {
  if (!store.set(KEY, JSON.stringify(kept(list)))) note('The presets could not be saved in this browser (storage full or turned off)');
}
// point id of doc as a preset named name: a drawing of it and its shapes, as they are
export function presetOf(doc, id, name) {
  const d = emptyDoc(0);
  paste(d, clipOf(doc, [id]), (q) => q);
  return { name, doc: d };
}
// the presets as a file, and back (what is not a preset left out); null: not a presets file
export const presetsFile = (list) => `${JSON.stringify({ format: PRESETS_FORMAT, presets: kept(list) }, null, 2)}\n`;
export function readPresets(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  return raw?.format === PRESETS_FORMAT && Array.isArray(raw.presets) ? clean(raw.presets) : null;
}
// the presets whose drawing reads (as a file is: what is not valid left out) and holds a point, each
// name once
function clean(list) {
  const seen = new Set();
  return list.filter((x) => x && typeof x.name === 'string' && x.name.trim() && !seen.has(x.name) && seen.add(x.name))
    .map((x) => ({ name: x.name, doc: parse(JSON.stringify(x.drawing ?? null)).doc })).filter((x) => x.doc?.points.length);
}
// where a preset is placed from: Shape when it has shapes, else Point
export const presetTool = (x) => (x.doc.circles.length || x.doc.lines.length ? 'shape' : 'point');

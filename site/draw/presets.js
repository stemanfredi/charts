// The user's own presets (docs/drawing-ui.md §9): a point kept under a name (its symbol, its parts,
// its look), placed again from the Shape tool's sub-rail (the Point tool's for a symbol only). They live in
// this browser only, never in the app or a drawing's file; a small file of their own moves them to
// another browser (Export, Import). Local storage may be missing or refuse: every access is guarded.

import { styleOf, minSizeOf, SYMBOLS } from './document.js';
import { parts, look } from './check.js';

const KEY = 'charts.presets';
export const PRESETS_FORMAT = 'charts-presets';

export function loadPresets() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? clean(v) : []; } catch { return []; }
}
export function savePresets(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
// a point as a preset named name: its parts, and its fill and stroke as drawn (its group's made its
// own), its minimum display size when it or its group has one
export function presetOf(doc, p, name) {
  const m = minSizeOf(doc, p);
  return { name, point: structuredClone({ symbol: p.symbol, parts: p.parts, look: { ...styleOf(doc, 'point', p), ...(m.own ? { minSize: m.px } : {}) } }) };
}
// the presets as a file, and back (what is not a preset left out); null: not a presets file
export const presetsFile = (list) => `${JSON.stringify({ format: PRESETS_FORMAT, presets: list }, null, 2)}\n`;
export function readPresets(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  return raw?.format === PRESETS_FORMAT && Array.isArray(raw.presets) ? clean(raw.presets) : null;
}
const QUIET = { warn() {} }; // a preset's parts read as a file's are, what is not valid left out
// the presets that hold what a point needs, each name once
function clean(list) {
  const seen = new Set();
  return list.filter((x) => x && typeof x.name === 'string' && x.name.trim() && !seen.has(x.name) && seen.add(x.name) && x.point && typeof x.point === 'object')
    .map((x) => ({ name: x.name, point: { symbol: SYMBOLS.includes(x.point.symbol) ? x.point.symbol : 'diamond',
      parts: parts(x.point.parts, QUIET),
      look: look(x.point.look, QUIET) } }));
}

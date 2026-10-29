// The user's own presets (docs/drawing-ui.md §9): a point kept under a name (its symbol, its parts,
// its look), placed again from the Shape tool's kinds (the Point tool's for a symbol only). They live in
// this browser only, never in the app or a drawing's file; a small file of their own moves them to
// another browser (Export, Import). Local storage may be missing or refuse: every access is guarded.

import { SYMBOLS } from './document.js';
import { parts, look } from './check.js';
import { store } from '../dom.js';

const KEY = 'charts.presets';
const PRESETS_FORMAT = 'charts-presets';

export function loadPresets() {
  const v = store.json(KEY);
  return Array.isArray(v) ? clean(v) : [];
}
export function savePresets(list) {
  return store.set(KEY, JSON.stringify(list));
}
// a point as a preset named name: its symbol, its parts, and the fill and stroke it sets itself (what
// it takes from the drawing or the defaults, a point placed from it takes as well)
export function presetOf(p, name) {
  const { fill, stroke } = p.look;
  return { name, point: structuredClone({ symbol: p.symbol, parts: p.parts, look: { ...(fill && { fill }), ...(stroke && { stroke }) } }) };
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
// where a preset is placed from: Shape when it has extent (an outline, radii), else Point
export const presetTool = (x) => (x.point.parts.length ? 'shape' : 'point');

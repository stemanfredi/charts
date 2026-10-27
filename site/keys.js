// Every key the page answers to, in one place: app.js dispatches the single keys from here (each
// opens what it names, from anywhere), the tooltips say a tool's key, and About lists them all.
// Keys acting on what is under way (finishing, taking back a point, deleting) are handled where it
// is (draw/drawing.js, draw/panel.js), and listed here. show: the keys as About shows them, [x] a key cap.

import { h } from './dom.js';

// a Mac's modifier is ⌘ (its Ctrl-click is a right-click); elsewhere Ctrl
export const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
export const MOD = mac ? '⌘' : 'Ctrl';

const KEYS = [
  { line: 1, key: '/', show: '[/]', text: 'search', open: 'search' },
  { line: 1, key: 'l', text: 'layers', open: 'layers' },
  { line: 1, key: 'd', text: 'tools (draw and measure)', open: 'draw' },
  { line: 1, key: 'e', text: 'elements (the tree beside the map)', open: 'elements' },
  { line: 3, key: 'p', text: 'point', tool: ['draw', 'point'] },
  { line: 3, key: 'g', text: 'line', tool: ['draw', 'line'] },
  { line: 3, key: 's', text: 'shape', tool: ['draw', 'shape'] },
  { line: 3, key: 't', text: 'label', tool: ['draw', 'label'] },
  { line: 3, key: 'm', text: 'measure', tool: ['draw', 'measure'] },
  { line: 3, key: 'a', text: 'select area', tool: ['draw', 'area'] },
  { line: 4, show: 'A tool\'s key again:', text: 'its next kind (Point, Shape, Measure)' },
  { line: 4, show: '[Enter]', text: 'or double-click finishes' },
  { line: 4, show: '[Backspace]', text: 'takes back a point' },
  { line: 4, show: '[Esc]', text: 'cancels' },
  { line: 5, prefix: 'In Tools: ', show: '[↑][↓]', text: 'select' },
  { line: 5, show: mac ? '[Delete] or [⌘] [Backspace]' : '[Delete]', text: 'deletes' },
  { line: 5, show: '[F2]', text: 'rename' },
  { line: 5, show: `[${MOD}] [Z]`, text: 'undo' },
  { line: 5, show: `[${MOD}] [Shift] [Z]`, text: 'redo' },
  { line: 5, show: `[${MOD}] [C] [V] [D]`, text: 'copy, paste, duplicate' },
];

// the entry of a single key pressed (a letter, '/'), or undefined
export const keyEntry = (key) => KEYS.find((k) => k.key === key.toLowerCase());
// a tool's key, for its tooltip ("R"), or ''; openKey: the key opening a panel ("L")
export function keyOf(tool) {
  const k = KEYS.find((x) => x.tool?.[1] === tool);
  return k ? k.key.toUpperCase() : '';
}
export const openKey = (name) => KEYS.find((x) => x.open === name)?.key.toUpperCase() ?? '';
// the list About shows: a line per group, its keys as key caps
export function keyList() {
  const caps = (s) => s.split(/(\[[^\]]+\])/).filter(Boolean).map((p) => (p.startsWith('[') ? h('kbd', {}, p.slice(1, -1)) : p));
  const lines = [...new Set(KEYS.map((k) => k.line))].map((n) => KEYS.filter((k) => k.line === n));
  return lines.map((ks) => h('li', {}, ks[0].prefix || '', ks.flatMap((k, i) => [i ? ' · ' : '', ...caps(k.show || `[${k.key.toUpperCase()}]`), ` ${k.text}`])));
}

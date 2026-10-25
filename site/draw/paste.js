// Rows copied out of a list grid and places pasted into one (docs/drawing-ui.md §5). Pure: no map,
// no DOM.

import { parseCoord, parseLatLon } from '../format.js';

// A grid's rows as text a spreadsheet takes: tab-separated, a header line first.
export const rowsText = (head, rows) => [head, ...rows].map((r) => r.map((v) => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n') + '\n';

// The cells of pasted text: one row per line that is not empty, its cells split at tabs or semicolons
// (when the text has any; else the line is one cell).
export function rowsOf(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = /\t/.test(text) ? '\t' : /;/.test(text) ? ';' : null;
  return lines.map((l) => (sep ? l.split(sep).map((c) => c.trim()) : [l.trim()]));
}

// The places in pasted text, latitude then longitude on each line, in any format a coordinate field or
// the search reads: [lon, lat] each. A first line that is no place (a header) is skipped; one saying Lat
// and Lon names the columns to read. { places, bad (the number of the first line not read, from 1), or
// null }: a line not read stops it, and nothing is to be applied.
export function placesOf(text) {
  const rows = rowsOf(text);
  let lat = 0, lon = 1, from = 0;
  const head = rows[0]?.map((c) => c.toLowerCase());
  if (head && head.some((c) => /^lat/.test(c)) && head.some((c) => /^lon/.test(c))) { lat = head.findIndex((c) => /^lat/.test(c)); lon = head.findIndex((c) => /^lon/.test(c)); from = 1; }
  const read = (cells) => {
    if (cells.length > 1) { const a = parseCoord(cells[lat] ?? '', 'lat'), b = parseCoord(cells[lon] ?? '', 'lon'); return a === null || b === null ? null : [b, a]; }
    const r = parseLatLon(cells[0]);
    return r ? [r.lon, r.lat] : null;
  };
  const places = [];
  for (let i = from; i < rows.length; i++) {
    const p = read(rows[i]);
    if (p) { places.push(p); continue; }
    if (i === 0) continue; // a header of another kind
    return { places: [], bad: i + 1 };
  }
  return { places, bad: null };
}

// The places of a line or an area after pasted ones replace them from index from on: past the last,
// it grows (pasted places added; a line's last one is its end). A place locked (an attached end) is
// never moved: the paste stops before it. { places, applied, left (pasted places not applied) }.
export function placesAfterPaste(places, from, pasted, locked = new Set()) {
  const out = places.map((p) => [...p]);
  let k = 0;
  for (; k < pasted.length; k++) {
    const i = from + k;
    if (locked.has(i)) break;
    if (i < out.length) out[i] = [...pasted[k]]; else out.push([...pasted[k]]);
  }
  return { places: out, applied: k, left: pasted.length - k };
}

// Colour legends, drawn on canvases so the PNG export can copy them as they are.
// The depth legend uses the same stops as the map layer; Copernicus legends the colour maps its
// service publishes for the layer (cmems.js), so the colours are the real ones.

import { INK, SOFT } from './style.js';

const W = 236, H = 44, KEY = 16, BAR = { x: 8, y: 20, w: 220, h: 9 };

// h: the canvas's height
function canvas(el, h) {
  // one canvas pixel per screen pixel, in whole screen pixels (at a display scale of 125% too: its
  // CSS size follows), or the browser resamples it and the text blurs
  const dpr = window.devicePixelRatio || 1;
  el.width = Math.round(W * dpr);
  el.height = Math.round(h * dpr);
  el.style.width = `${el.width / dpr}px`;
  el.style.height = `${el.height / dpr}px`;
  const g = el.getContext('2d');
  g.scale(el.width / W, el.height / h);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(0, 0, W, h);
  g.font = '600 11px system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  return g;
}
// the canvas with its title and, beside it, its subtitle; on a line of its own below when it would
// not fit beside it (the rest is then drawn that much lower: the context is moved down)
const SUB_LINE = 13;
function head(el, text, sub, noData, height) {
  const m = el.getContext('2d');
  m.font = '600 11px system-ui, sans-serif';
  const w = m.measureText(text).width;
  m.font = '11px system-ui, sans-serif';
  const below = !!sub && BAR.x + w + 6 + m.measureText(sub).width > W - 4;
  const g = canvas(el, (height || H + (noData ? KEY : 0)) + (below ? SUB_LINE : 0));
  g.fillStyle = INK;
  g.fillText(text, BAR.x, 14);
  if (sub) {
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = SOFT;
    if (below) g.fillText(sub, BAR.x, 14 + SUB_LINE, W - BAR.x - 4); else g.fillText(sub, BAR.x + w + 6, 14);
  }
  if (below) g.translate(0, SUB_LINE);
  if (noData) { // noData: { colour, label }, a key on a row of its own below the bar
    g.fillStyle = noData.colour;
    g.fillRect(BAR.x, H + 1, 14, 9);
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(BAR.x + 0.5, H + 1.5, 13, 8);
    g.fillStyle = SOFT; g.font = '10px system-ui, sans-serif';
    g.fillText(noData.label, BAR.x + 20, H + 9.5);
  }
  return g;
}
function ticks(g, marks) {
  g.font = '10px system-ui, sans-serif';
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineWidth = 1;
  // a label that would touch its neighbour is dropped (tick kept); first and last always stay
  const span = ([x, label, align]) => {
    const w = g.measureText(label).width, a = align || 'center';
    return a === 'left' ? [x, x + w] : a === 'right' ? [x - w, x] : [x - w / 2, x + w / 2];
  };
  const last = marks.length ? span(marks[marks.length - 1]) : null;
  let right = -Infinity;
  marks.forEach((mk, k) => {
    const [x, label, align] = mk, [a, b] = span(mk), end = k === marks.length - 1;
    g.beginPath(); g.moveTo(x + 0.5, BAR.y + BAR.h); g.lineTo(x + 0.5, BAR.y + BAR.h + 3); g.stroke();
    if (!end && (a < right + 4 || b > last[0] - 4)) return;
    g.textAlign = align || 'center';
    g.fillText(label, x, BAR.y + BAR.h + 13);
    right = b;
  });
  g.textAlign = 'left';
  g.strokeRect(BAR.x + 0.5, BAR.y + 0.5, BAR.w - 1, BAR.h);
}

// Continuous depth ramp; stops sit at equal widths (the depth axis is not linear).
export function drawRamp(el, text, sub, stops, noData) {
  const g = head(el, text, sub, noData);
  const n = stops.length - 1, seg = BAR.w / n;
  for (let i = 0; i < n; i++) {
    const gr = g.createLinearGradient(BAR.x + i * seg, 0, BAR.x + (i + 1) * seg, 0);
    gr.addColorStop(0, stops[i][1]);
    gr.addColorStop(1, stops[i + 1][1]);
    g.fillStyle = gr;
    g.fillRect(BAR.x + i * seg, BAR.y, seg + 0.5, BAR.h);
  }
  ticks(g, stops.map(([d], i) => [BAR.x + i * seg, i === n ? `${d}+` : `${d}`, i === 0 ? 'left' : i === n ? 'right' : 'center']));
}

// open: whether values run on beyond the first and last colour ('<' and '≥' on the end labels);
// log: entries are log10 of the values, ticked at whole decades (0.01, 0.1, 1, 10)
export function drawColormap(el, text, sub, entries, open = [true, true], log = false) {
  const g = head(el, text, sub);
  const finite = entries.flatMap((e) => [e.lo, e.hi]).filter(Number.isFinite);
  const lo = Math.min(...finite), hi = Math.max(...finite);
  const x = (v) => BAR.x + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * BAR.w;
  for (const e of entries) {
    const a = Number.isFinite(e.lo) ? x(e.lo) : BAR.x, b = Number.isFinite(e.hi) ? x(e.hi) : BAR.x + BAR.w;
    g.fillStyle = e.rgb;
    g.fillRect(a, BAR.y, Math.max(0.6, b - a + 0.4), BAR.h);
  }
  const step = log ? 1 : [0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10, 20, 50].find((s) => ((hi - lo) / s) <= 8) || 100;
  const label = (v) => `${log ? +(10 ** v).toPrecision(1) : v}`;
  const marks = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step < hi - 1e-9; k++) {
    const v = +(k * step).toFixed(2);
    marks.push([x(v), label(v), v === lo ? 'left' : 'center']);
  }
  if (open[0] && marks.length && marks[0][0] <= BAR.x + 0.5) marks[0][1] = `<${marks[0][1]}`;
  if (marks.length && BAR.x + BAR.w - marks[marks.length - 1][0] < 26) marks.pop(); // room for the end label
  marks.push([BAR.x + BAR.w, `${open[1] ? '≥' : ''}${label(+hi.toFixed(2))}`, 'right']);
  ticks(g, marks);
}

// Classes of a categorical layer ([{ label, colour, stroke, line, casing, dash, image }]): how each is
// drawn and its name, two to a row, or one where a name is too long for half the width. A fill
// (colour) with its outline (stroke, or ink); a line (line: true, dashed as dash says) on its casing colour if any; a
// point's symbol (image, a loaded picture), beside the fill when there are both
export function drawClasses(el, text, sub, classes) {
  const g0 = el.getContext('2d');
  g0.font = '10px system-ui, sans-serif';
  const room = (c) => 17 + (c.image && (c.colour || c.line) ? 14 : 0);
  const cols = classes.every((c) => g0.measureText(c.label).width <= 108 - room(c)) ? 2 : 1;
  const g = head(el, text, sub, null, 24 + Math.ceil(classes.length / cols) * 14);
  g.font = '10px system-ui, sans-serif';
  classes.forEach((c, i) => {
    const { label, colour, stroke, line, casing, image, dash } = c;
    const x = BAR.x + (i % cols) * 112, y = 20 + Math.floor(i / cols) * 14;
    if (line) { // a line, on its casing if it has one
      g.setLineDash(dash ? dash.map((d) => d / 2) : []); // its dashes, at half size: a 12 px swatch shows the pattern
      for (const [col, w] of [[casing, 5], [colour, casing ? 2 : 3]]) if (col) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x, y + 4.5); g.lineTo(x + 12, y + 4.5); g.stroke(); }
      g.setLineDash([]);
    } else if (colour) {
      g.fillStyle = '#ffffff'; // a translucent fill as on the white sea
      g.fillRect(x, y, 12, 9);
      g.fillStyle = colour;
      g.fillRect(x, y, 12, 9);
      g.strokeStyle = stroke || INK; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 11, 8);
    }
    if (image) g.drawImage(image, x + room(c) - 17, y - 1.5, 12, 12);
    g.fillStyle = INK;
    g.fillText(label, x + room(c), y + 8.5, (cols === 2 ? 108 : 220) - room(c));
  });
}

// A WMS's legend as JSON (GeoServer's GetLegendGraphic, format=application/json) → classes for
// drawClasses, without images: each rule's title (without a numbering, "2. Sand", "A: SPA") and how
// it is drawn: a fill at its opacity and its outline (a hatch: its outline's colour, faint; a hatch
// without an outline is left out, its colour unknown), a line
// on its casing (two strokes), or a point's symbol, by URL (icon). Rules filled white (no data,
// as a fill) are left out.
export function wmsClasses(json) {
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  return json.Legend.flatMap((l) => l.rules).map((r) => {
    const label = (r.title || r.name || '').replace(/^(\d+\.|[A-Z]:)\s*/, ''), of = (k) => r.symbolizers.find((s) => s[k])?.[k];
    const lines = r.symbolizers.filter((s) => s.Line).map((s) => s.Line.stroke);
    const dash = r.symbolizers.findLast((s) => s.Line)?.Line['stroke-dasharray']?.map(Number);
    if (lines.length) return { label, line: true, colour: lines.at(-1), ...(lines.length > 1 && { casing: lines[0] }), ...(dash && { dash }) };
    if (of('Point')?.url) return { label, icon: of('Point').url };
    const p = of('Polygon') || of('Raster') || {};
    if (!p.fill && !(p['graphic-fill'] && p.stroke)) return { label }; // a hatch's colour is its outline's: none, nothing to draw
    if (p.fill?.toUpperCase() === '#FFFFFF' && !p.stroke) return { label }; // no data
    return { label, colour: p.fill ? rgba(p.fill, +(p['fill-opacity'] ?? 1)) : rgba(p.stroke, 0.35), ...(p.stroke && { stroke: p.stroke }) };
  }).filter((c) => c.label && (c.colour || c.icon));
}

// Colour legends, drawn on canvases so the PNG export can copy them as they are.
// The depth legend uses the same stops as the map layer; Copernicus legends the colour maps its
// service publishes for the layer (cmems.js), so the colours are the real ones.

const W = 236, H = 44, KEY = 16, BAR = { x: 8, y: 20, w: 220, h: 9 };
const INK = '#2b3a46', SOFT = '#5d6d79';

// noData: optional { colour, label } key drawn on an extra row below the bar; height: another height
function canvas(el, noData, height) {
  // one canvas pixel per screen pixel, in whole screen pixels (at a display scale of 125% too: its
  // CSS size follows), or the browser resamples it and the text blurs
  const dpr = window.devicePixelRatio || 1, h = height || H + (noData ? KEY : 0);
  el.width = Math.round(W * dpr);
  el.height = Math.round(h * dpr);
  el.style.width = `${el.width / dpr}px`;
  el.style.height = `${el.height / dpr}px`;
  const g = el.getContext('2d');
  g.scale(el.width / W, el.height / h);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(0, 0, W, h);
  if (noData) {
    g.fillStyle = noData.colour;
    g.fillRect(BAR.x, H + 1, 14, 9);
    g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(BAR.x + 0.5, H + 1.5, 13, 8);
    g.fillStyle = SOFT; g.font = '10px system-ui, sans-serif';
    g.fillText(noData.label, BAR.x + 20, H + 9.5);
  }
  g.font = '600 11px system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  return g;
}
function title(g, text, sub) {
  g.fillStyle = INK;
  g.fillText(text, BAR.x, 14);
  if (sub) {
    const w = g.measureText(text).width;
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = SOFT;
    g.fillText(sub, BAR.x + w + 6, 14, W - BAR.x - w - 10);
  }
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
  const g = canvas(el, noData);
  title(g, text, sub);
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
  const g = canvas(el);
  title(g, text, sub);
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

// Classes of a categorical layer ([{ label, colour, line, casing }]): a swatch (a line, for line:
// true, on its casing colour if any) and its name, two to a row
export function drawClasses(el, text, sub, classes) {
  const rows = Math.ceil(classes.length / 2);
  const g = canvas(el, null, 24 + rows * 14);
  title(g, text, sub);
  g.font = '10px system-ui, sans-serif';
  classes.forEach(({ label, colour, line, casing }, i) => {
    const x = BAR.x + (i % 2) * 112, y = 20 + Math.floor(i / 2) * 14;
    if (line) { // a line, on its casing if it has one
      for (const [c, w] of [[casing, 5], [colour, casing ? 2 : 3]]) if (c) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x, y + 4.5); g.lineTo(x + 12, y + 4.5); g.stroke(); }
    } else {
      g.fillStyle = colour;
      g.fillRect(x, y, 12, 9);
      g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 11, 8);
    }
    g.fillStyle = INK;
    g.fillText(label, x + 17, y + 8.5, 92);
  });
}

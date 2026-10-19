// Colour legends, drawn on canvases so the PNG export can copy them as they are.
// Depth legends use the same stops as the map layers; the SST legend uses the
// colour map NASA GIBS publishes for the layer, so the classes are the real ones.

const W = 236, H = 44, KEY = 16, BAR = { x: 8, y: 20, w: 220, h: 9 };
const INK = '#2b3a46', SOFT = '#5d6d79';

function hexRgb(c) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? m.slice(1).map((x) => parseInt(x, 16)) : [255, 255, 255];
}
// linear RGB interpolation, as MapLibre's `interpolate` does for colours
export function colourAt(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [d1, c1] = stops[i];
    if (v <= d1) {
      const [d0, c0] = stops[i - 1], t = (v - d0) / (d1 - d0), a = hexRgb(c0), b = hexRgb(c1);
      return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * t)).join(',')})`;
    }
  }
  return stops[stops.length - 1][1];
}

// noData: optional { colour, label } key drawn on an extra row below the bar
function canvas(el, noData) {
  const dpr = window.devicePixelRatio || 1, h = H + (noData ? KEY : 0);
  el.width = W * dpr;
  el.height = h * dpr;
  el.style.width = `${W}px`;
  el.style.height = `${h}px`;
  const g = el.getContext('2d');
  g.scale(dpr, dpr);
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

// One swatch per class (from edges[i] to the next edge); endLabel closes the last one.
export function drawClasses(el, text, sub, edges, colours, endLabel, noData) {
  const g = canvas(el, noData);
  title(g, text, sub);
  const n = colours.length, seg = BAR.w / n;
  colours.forEach((c, i) => { g.fillStyle = c; g.fillRect(BAR.x + i * seg, BAR.y, seg + 0.5, BAR.h); });
  // label every edge that fits (~22 px apart)
  const every = Math.max(1, Math.ceil(22 / seg));
  const marks = edges.map((d, i) => [BAR.x + i * seg, `${d}`, i === 0 ? 'left' : 'center']).filter((_, i) => i % every === 0);
  if (marks.length && BAR.x + BAR.w - marks[marks.length - 1][0] < 22) marks.pop();
  marks.push([BAR.x + BAR.w, `${endLabel}`, 'right']);
  ticks(g, marks);
}

// GIBS colour map (v1.3 XML): entries with value="[lo,hi)" and rgb="r,g,b".
const cmapCache = {};
export function loadColormap(url) {
  return (cmapCache[url] ||= fetch(url, { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then((xml) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const out = [];
      for (const e of doc.querySelectorAll('ColorMap:not([title="No Data"]) ColorMapEntry')) {
        const m = /^[[(]([^,]+),([^)\]]+)[)\]]$/.exec(e.getAttribute('value') || '');
        if (!m || e.getAttribute('transparent') === 'true') continue;
        out.push({ lo: parseFloat(m[1]), hi: parseFloat(m[2]), rgb: `rgb(${e.getAttribute('rgb')})` });
      }
      if (!out.length) throw new Error('empty colour map');
      return out;
    })
    .catch((err) => { delete cmapCache[url]; throw err; }));
}

export function drawColormap(el, text, sub, entries) {
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
  const step = [1, 2, 4, 5, 10, 20, 50].find((s) => ((hi - lo) / s) <= 8) || 100;
  const marks = [];
  for (let v = Math.ceil(lo / step) * step; v < hi - 1e-9; v += step) marks.push([x(v), `${v}`, v === lo ? 'left' : 'center']);
  if (marks.length && marks[0][0] <= BAR.x + 0.5) marks[0][1] = `<${marks[0][1]}`;
  if (marks.length && BAR.x + BAR.w - marks[marks.length - 1][0] < 26) marks.pop(); // room for the end label
  marks.push([BAR.x + BAR.w, `≥${hi}`, 'right']);
  ticks(g, marks);
}

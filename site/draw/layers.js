// What the drawing draws with: its map layers (in the sources draw, drawzoom, drawover, drawlabel and drawvalue:
// features.js and labels.js make their features), the symbols as signed distance fields, and which
// layers a click hits, a press grabs, the PNG export hides.

const SEL = '#ffd43b', CASING = '#1f2c36'; // the selection's highlight: yellow on a dark casing, seen on sea, land and satellite

// the symbols and the label box, added to the map once its style is loaded
export function addIcons(map) {
  for (const [name, shape] of Object.entries(SHAPES)) if (!map.hasImage(`draw-${name}`)) map.addImage(`draw-${name}`, sdfIcon(shape, name === 'arrow' ? 56 : 40), { sdf: true, pixelRatio: 2 });
  // a label's box: stretched around its text (its border is the icon's halo, in the text's colour)
  if (!map.hasImage('draw-box')) map.addImage('draw-box', sdfIcon(BOX), { sdf: true, pixelRatio: 2, stretchX: [[14, 26]], stretchY: [[14, 26]], content: [12, 12, 28, 28] });
}

// ---- symbols ---------------------------------------------------------------------------------
// each symbol's signed distance (px, negative inside) at a point of its 24 × 24 px cell, centred
// on 0, 0 (pixelRatio 2: 12 px on screen)
const poly = (pts) => (x, y) => {
  let d = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const nx = by - ay, ny = ax - bx, len = Math.hypot(nx, ny);
    d = Math.max(d, ((x - ax) * nx + (y - ay) * ny) / len); // outward normal: the points go clockwise on screen
  }
  return d;
};
const SHAPES = {
  diamond: poly([[0, -9], [9, 0], [0, 9], [-9, 0]]),
  square: poly([[-7, -7], [7, -7], [7, 7], [-7, 7]]),
  triangle: poly([[0, -9], [8.5, 6], [-8.5, 6]]),
  dot: (x, y) => Math.hypot(x, y) - 6,
  centre: (x, y) => Math.hypot(x, y) - 3.5,
  handle: poly([[-4, -4], [4, -4], [4, 4], [-4, 4]]),
  arrow: poly([[0, 0], [8, 18], [-8, 18]]), // its tip at the centre: on the point it points at
  plus: (x, y) => Math.min(Math.max(Math.abs(x) - 6, Math.abs(y) - 1.5), Math.max(Math.abs(x) - 1.5, Math.abs(y) - 6)),
};
// a rounded rectangle filling most of the 40 px cell
const BOX = (x, y) => { const qx = Math.abs(x) - 8, qy = Math.abs(y) - 8; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 4; };
// a label text's size on screen [w, h] (px), as MapLibre will set it (near enough: the leader stops at
// its edge)
let measureCtx = null;
export function measureText(text, px) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${px}px "Noto Sans", Arial, sans-serif`;
  const lines = text.split('\n');
  return [Math.max(...lines.map((l) => measureCtx.measureText(l).width)), lines.length * px * 1.2];
}
// MapLibre's SDF icons (as TinySDF makes them): the edge at alpha 0.75, 8 px of falloff each side
function sdfIcon(dist, size = 40, buffer = 8) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = dist(x + 0.5 - size / 2, y + 0.5 - size / 2);
    data[(y * size + x) * 4 + 3] = 255 * Math.min(1, Math.max(0, 0.75 - d / buffer));
  }
  return { width: size, height: size, data };
}

// ---- layers ----------------------------------------------------------------------------------
const FONT = ['Noto Sans Regular']; // the map's own (style.js), from the same glyph server
// a label's text, its box stretched round it when it has one
const labelLayout = { 'text-field': ['get', 'text'], 'text-font': FONT, 'text-size': ['get', 'px'], 'text-max-width': 100, 'text-line-height': 1.2,
  'text-allow-overlap': true, 'text-ignore-placement': true, 'icon-image': ['case', ['==', ['get', 'box'], 1], 'draw-box', ''],
  'icon-text-fit': 'both', 'icon-text-fit-padding': [3, 5, 3, 5], 'icon-allow-overlap': true, 'icon-ignore-placement': true };
const DASH = { solid: null, dashed: [4, 3], dotted: [1, 2] };
// a line's Offset (features.js: off, px, positive to the right of its direction), as QGIS offsets a
// line symbol: drawn by MapLibre beside the geometry, display only
const OFF = ['coalesce', ['get', 'off'], 0];
const lineLayers = (kind, source) => Object.entries(DASH).map(([dash, arr]) => ({
  id: `draw-${kind}-line-${dash}`, type: 'line', source, filter: ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'dash'], dash]],
  layout: { 'line-join': 'round' },
  paint: { 'line-color': ['get', 'sc'], 'line-opacity': ['get', 'so'], 'line-width': ['get', 'sw'], 'line-offset': OFF, ...(arr ? { 'line-dasharray': arr } : {}) },
}));
const fillLayer = (kind, source) => ({
  id: `draw-${kind}-fill`, type: 'fill', source, filter: ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'fill'], 1]],
  paint: { 'fill-color': ['get', 'fc'], 'fill-opacity': ['get', 'fo'] },
});
// the selection's halo, never on the element's own stroke, clear of it by 3 px: outside a polygon's
// outline (negative offset: the left of a counter-clockwise ring, its outside on screen), on both
// sides of a line: a yellow band, no dark casing (one look for every selection)
const LINE_HALO = [['line', SEL, 2, 1, 0.6]];
const AREA_HALO = [['line', SEL, 3, 1, 0.6]]; // yellow only, as along lines (a little wider: an outline, one side)
const haloLayers = (geom, sides, parts) => sides.flatMap((side) => parts.map(([part, colour, width, opSel, opHover]) => ({
  id: `draw-mark-${part}-${geom.toLowerCase()}${sides.length > 1 ? (side > 0 ? '-r' : '-l') : ''}`, type: 'line', source: 'drawover',
  filter: ['all', ['in', ['get', 'kind'], ['literal', ['sel', 'hover']]], ['==', ['geometry-type'], geom]],
  layout: { 'line-join': 'round' },
  paint: { 'line-color': colour, 'line-width': width, 'line-opacity': ['match', ['get', 'kind'], 'sel', opSel, opHover],
    'line-offset': ['+', OFF, ['*', side, ['+', ['/', ['get', 'sw'], 2], 3, width / 2]]] } })));
// bottom to top: points' rings, areas, lines (guides, the others), outlines, the selection's
// halos, symbols, handles, the selection's rings
// a finger (a coarse pointer): handles drawn larger (14 px from 8), as drawing.js grabs them farther
export const FINGER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const HANDLE_SIZE = FINGER ? 1.75 : 1;
export const DRAW_LAYERS = [
  fillLayer('ring', 'draw'), ...lineLayers('ring', 'draw'),
  fillLayer('polygon', 'draw'), ...lineLayers('polygon', 'draw'),
  // under the lines: the lines' click targets, invisible
  { id: 'draw-linehit', type: 'line', source: 'drawzoom', filter: ['==', ['get', 'kind'], 'linehit'], paint: { 'line-width': 10, 'line-opacity': 0, 'line-offset': OFF } },
  ...lineLayers('guide', 'drawzoom'), ...lineLayers('path', 'drawzoom'),
  fillLayer('shape', 'drawzoom'), ...lineLayers('shape', 'drawzoom'),
  ...haloLayers('Polygon', [-1], AREA_HALO), ...haloLayers('LineString', [-1, 1], LINE_HALO),
  { id: 'draw-symbol', type: 'symbol', source: 'draw', filter: ['==', ['get', 'kind'], 'symbol'],
    layout: { 'icon-image': ['concat', 'draw-', ['get', 'symbol']], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': ['get', 'sc'], 'icon-opacity': ['get', 'so'], 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.5 } },
  // handles at the outline's key points: small squares, white with a dark edge
  { id: 'draw-handle', type: 'symbol', source: 'drawover', filter: ['==', ['get', 'kind'], 'handle'],
    layout: { 'icon-image': 'draw-handle', 'icon-size': HANDLE_SIZE, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': '#ffffff', 'icon-halo-color': CASING, 'icon-halo-width': 1.5 } },
  // the forms' previews: the points a distribution would make (faint diamonds), Connect's roots (rings) and lines
  { id: 'draw-ghostline', type: 'line', source: 'drawover', filter: ['==', ['get', 'kind'], 'ghostline'],
    paint: { 'line-color': '#e8590c', 'line-opacity': 0.75, 'line-width': 2, 'line-dasharray': [3, 2] } },
  { id: 'draw-ghost', type: 'symbol', source: 'drawover', filter: ['==', ['get', 'kind'], 'ghost'],
    layout: { 'icon-image': 'draw-diamond', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': '#e8590c', 'icon-opacity': 0.6 } },
  { id: 'draw-pick', type: 'circle', source: 'drawover', filter: ['==', ['get', 'kind'], 'pick'],
    paint: { 'circle-radius': 11, 'circle-opacity': 0, 'circle-stroke-color': SEL, 'circle-stroke-width': 3 } },
  // while a line is selected: a + halfway along its legs, its Bézier handles; a rectangle's rotate stalk
  { id: 'draw-stalk', type: 'line', source: 'drawover', filter: ['==', ['get', 'kind'], 'stalk'], paint: { 'line-color': CASING, 'line-width': 1.5 } },
  { id: 'draw-ctrlline', type: 'line', source: 'drawover', filter: ['==', ['get', 'kind'], 'ctrlline'], paint: { 'line-color': CASING, 'line-width': 1, 'line-dasharray': [2, 2] } },
  { id: 'draw-mid', type: 'symbol', source: 'drawover', filter: ['==', ['get', 'kind'], 'mid'],
    layout: { 'icon-image': 'draw-plus', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': CASING, 'icon-opacity': 0.6, 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.5 } },
  { id: 'draw-ctrl', type: 'circle', source: 'drawover', filter: ['==', ['get', 'kind'], 'ctrl'],
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': CASING, 'circle-stroke-width': 1.5 } },
  // the line being drawn (Line tool)
  { id: 'draw-draft', type: 'line', source: 'drawover', filter: ['==', ['get', 'kind'], 'draft'], layout: { 'line-join': 'round' },
    paint: { 'line-color': CASING, 'line-width': 2, 'line-dasharray': [3, 2] } },
  // where a click or a drag snaps (snap.js): a ring on a vertex, a dot on an edge, a cross at a crossing
  { id: 'draw-snapto', type: 'circle', source: 'drawover', filter: ['in', ['get', 'kind'], ['literal', ['snapvertex', 'snapedge']]],
    paint: { 'circle-radius': ['match', ['get', 'kind'], 'snapvertex', 8, 4], 'circle-color': SEL, 'circle-opacity': ['match', ['get', 'kind'], 'snapvertex', 0, 1],
      'circle-stroke-color': ['match', ['get', 'kind'], 'snapvertex', SEL, CASING], 'circle-stroke-width': ['match', ['get', 'kind'], 'snapvertex', 3, 1] } },
  { id: 'draw-snapcross', type: 'symbol', source: 'drawover', filter: ['==', ['get', 'kind'], 'snapcrossing'],
    layout: { 'icon-image': 'draw-plus', 'icon-rotate': 45, 'icon-size': 1.4, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': CASING, 'icon-halo-color': SEL, 'icon-halo-width': 2 } },
  { id: 'draw-draftpt', type: 'circle', source: 'drawover', filter: ['==', ['get', 'kind'], 'draftpt'],
    paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-color': CASING, 'circle-stroke-width': 1.5 } },
  // names on the map (features.js): along lines, beside points, at shapes' centres; MapLibre leaves out
  // those that collide
  { id: 'draw-name-line', type: 'symbol', source: 'drawzoom', filter: ['all', ['==', ['get', 'kind'], 'name'], ['==', ['geometry-type'], 'LineString']],
    layout: { 'symbol-placement': 'line', 'text-field': ['get', 'nm'], 'text-font': FONT, 'text-size': 11, 'symbol-spacing': 300, 'text-max-angle': 40 },
    paint: { 'text-color': ['get', 'c'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
  { id: 'draw-name-vertex', type: 'circle', source: 'draw', filter: ['all', ['==', ['get', 'kind'], 'name'], ['has', 'vx']],
    paint: { 'circle-radius': 2.5, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
  { id: 'draw-name-point', type: 'symbol', source: 'draw', filter: ['all', ['==', ['get', 'kind'], 'name'], ['==', ['geometry-type'], 'Point'], ['!', ['has', 'ctr']]],
    layout: { 'text-field': ['get', 'nm'], 'text-font': FONT, 'text-size': 11, 'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-justify': 'auto', 'text-max-width': 12 },
    paint: { 'text-color': ['get', 'c'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
  { id: 'draw-name-centre', type: 'symbol', source: 'drawzoom', filter: ['all', ['==', ['get', 'kind'], 'name'], ['has', 'ctr']],
    layout: { 'text-field': ['get', 'nm'], 'text-font': FONT, 'text-size': 11, 'text-max-width': 12 },
    paint: { 'text-color': ['get', 'c'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
  // labels (labels.js, their own source): leaders, their ends, the text (on a halo, or in a box);
  // always shown, where the user put them
  { id: 'draw-leader', type: 'line', source: 'drawlabel', filter: ['==', ['get', 'kind'], 'leader'], layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 1.25 } },
  { id: 'draw-lend', type: 'symbol', source: 'drawlabel', filter: ['==', ['get', 'kind'], 'lend'],
    layout: { 'icon-image': ['match', ['get', 'end'], 'arrow', 'draw-arrow', 'draw-centre'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'viewport',
      'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': ['get', 'c'] } },
  // a selected label: a yellow rim round its text or its box (hidden with the other marks)
  { id: 'draw-mark-label', type: 'symbol', source: 'drawlabel', filter: ['all', ['==', ['get', 'kind'], 'label'], ['!=', ['get', 'mark'], '']], layout: labelLayout,
    paint: { 'text-color': 'rgba(0,0,0,0)', 'text-halo-color': SEL, 'text-halo-width': ['case', ['==', ['get', 'box'], 1], 0, 4], 'text-halo-blur': 0,
      'text-opacity': ['match', ['get', 'mark'], 'sel', 1, 0.6], 'icon-opacity': ['match', ['get', 'mark'], 'sel', 1, 0.6],
      'icon-color': SEL, 'icon-halo-color': SEL, 'icon-halo-width': 3 } },
  { id: 'draw-label-text', type: 'symbol', source: 'drawlabel', filter: ['==', ['get', 'kind'], 'label'], layout: labelLayout,
    paint: { 'text-color': ['get', 'c'], 'text-halo-color': '#ffffff', 'text-halo-width': ['case', ['==', ['get', 'box'], 1], 0, 1.6],
      'icon-color': '#ffffff', 'icon-halo-color': ['get', 'c'], 'icon-halo-width': 1 } },
  { id: 'draw-lhandle', type: 'symbol', source: 'drawlabel', filter: ['==', ['get', 'kind'], 'lhandle'],
    layout: { 'icon-image': 'draw-handle', 'icon-size': HANDLE_SIZE, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': '#ffffff', 'icon-halo-color': CASING, 'icon-halo-width': 1.5 } },
  // a point's centre: selected, a small white dot with a dark rim (as a handle); hovered, a yellow ring
  { id: 'draw-mark-point', type: 'circle', source: 'drawover', filter: ['all', ['in', ['get', 'kind'], ['literal', ['sel', 'hover']]], ['==', ['geometry-type'], 'Point']],
    paint: { 'circle-radius': ['match', ['get', 'kind'], 'sel', 5, 11], 'circle-color': '#ffffff', 'circle-opacity': ['match', ['get', 'kind'], 'sel', 1, 0],
      'circle-stroke-color': ['match', ['get', 'kind'], 'sel', CASING, SEL], 'circle-stroke-width': ['match', ['get', 'kind'], 'sel', 1.5, 2], 'circle-stroke-opacity': ['match', ['get', 'kind'], 'sel', 1, 0.6] } },
  // the values of the elements showing them, and of what is being drawn (features.js valueFeatures):
  // on top of everything
  { id: 'draw-value', type: 'symbol', source: 'drawvalue', filter: ['has', 'label'],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-anchor': ['get', 'anchor'],
      'text-allow-overlap': true, 'text-ignore-placement': true, 'text-justify': 'center' },
    paint: { 'text-color': '#7a0d55', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } },
];
// what a click can hit, topmost first (drawing-ui.md §5): symbols, outlines, lines, areas, rings
export const HIT_LAYERS = DRAW_LAYERS.filter((l) => /^draw-(symbol|shape|polygon|path|guide|linehit|ring|label-text)/.test(l.id)).map((l) => l.id).reverse();
export const MARK_LAYERS = DRAW_LAYERS.filter((l) => /^draw-(mark|handle|stalk|ctrl|mid|lhandle)/.test(l.id)).map((l) => l.id);
// what a press can grab, and the cursor over each
export const HANDLE_LAYERS = ['draw-ctrl', 'draw-handle', 'draw-mid', 'draw-lhandle'];
export const CURSOR = { move: 'move', point: 'grab', end: 'grab', vertex: 'grab', mid: 'copy', ctrl: 'grab', radius: 'ew-resize', aperture: 'ew-resize', corner: 'nwse-resize', rotate: 'crosshair', anchor: 'grab', ppoint: 'grab', pmid: 'copy' };

// The page's icons, as SVG path data (24 × 24, stroked): the bar's, the panels', the actions', what
// each kind of element looks like; icon(...paths) builds one.
import { svg } from './dom.js';

// a 20 px line icon (the bar's size; style.css sizes it where it differs) from SVG path data; a path given as [d, colour] is filled in that colour
export const icon = (...paths) => svg('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  paths.map((d) => (Array.isArray(d) ? svg('path', { d: d[0], fill: d[1], stroke: d[1] }) : svg('path', { d }))));

export const KIND_ICON = {
  point: ['m12 4 8 8-8 8-8-8z'], shape: ['M4 8h16v8H4z'], polygon: ['M5 7l7-4 7 5-2 11H7z'], line: ['M4 18 20 6'], group: ['M3 7h7l2 2h9v10H3z'],
  label: ['M10 4h10v7H10z', 'M10 11 4 19'], // a text box and its leader
};
// the bar's, the panels' and the actions' icons (most as Lucide's)
export const UI_ICON = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-4-4'],
  plus: ['M12 5v14', 'M5 12h14'], minus: ['M5 12h14'],
  link: ['M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1', 'M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'],
  png: ['M4 5h16v14H4z', 'm4 17 5-5 4 4 3-3 4 4', 'M17 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z'], // a picture
  zip: ['M4 4h16v4H4z', 'M5 8v12h14V8', 'M10 12h4'],
  offline: ['M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z', 'M12 9v6', 'm9.5 12.5 2.5 2.5 2.5-2.5'], // a map, an arrow into it
  compass: [['m12 3 4 9h-8z', 'var(--err)'], 'm12 21-4-9h8z'],
  locate: ['M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'M12 2v3M12 19v3M2 12h3M19 12h3', ['M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'currentColor']], // a dot in sights
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  ruler: ['M3 17 17 3l4 4L7 21z', 'm7 13 2 2M10 10l2 2M13 7l2 2'],
  layers: ['m12 3 9 5-9 5-9-5z', 'm3 13 9 5 9-5'],
  elements: [['M4 5.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z', 'currentColor'], 'M8 6h13', 'M4 8v2a2 2 0 0 0 2 2h2', 'M4 10v6a2 2 0 0 0 2 2h2', ['M10 11.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z', 'currentColor'], ['M10 17.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z', 'currentColor'], 'M14 12h7', 'M14 18h7'],
  properties: ['M4 5h16v14H4z', 'M15 5v14'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'], redo: ['m15 14 5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  open: ['M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'], // ☰
  drawing: ['M6 3h9l4 4v14H6z', 'M14 3v5h5'], // a page: the drawing itself
  attach: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'], // a link
  zoom: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M12 9v6', 'M9 12h6'],
  duplicate: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2'],
  group: ['M3 7h7l2 2h9v10H3z', 'M12 11v6', 'M9 14h6'],
  delete: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  detach: ['m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'm5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71', 'M8 2v3', 'M2 8h3', 'M16 19v3', 'M19 16h3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  update: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'], // two arrows round: refresh
  hidden: ['M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7', 'M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M2 2l20 20'],
};
// what each kind of point and shape looks like (the tools' kinds, the tree): those round a centre have it
// marked, the outlines not
export const POINT_ICON = {
  point: KIND_ICON.point, symbol: KIND_ICON.point,
  circle: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 12h8', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'], // its radius drawn from its centre
  rings: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
  sector: ['M5 19V5a14 14 0 0 1 14 14z'], // a quarter of a circle, its centre bottom left
  rectangle: ['M4 8h16v8H4z'], ellipse: ['M12 7c5 0 9 2.2 9 5s-4 5-9 5-9-2.2-9-5 4-5 9-5z'], triangle: ['M12 4l8 15H4z'],
  'aerial-vehicle': ['M12 3v18M4 12l8-3 8 3M9 19l3-1 3 1'], 'surface-vehicle': ['M12 3c3 2 4 5 4 8v9H8v-9c0-3 1-6 4-8z'], 'underwater-vehicle': ['M12 2c1.7 0 3 2.2 3 5v9.5l2.2 4h-2.2l-.6-1.5h-4.8l-.6 1.5H6.8l2.2-4V7c0-2.8 1.3-5 3-5z'], // the outline's rocket, upright: slimmer than the surface vehicle
};
export const SELECT_ICON = ['M5 3l14 8-6 2-2 6z']; // an arrow
// Box select: a dashed square
export const BOX_ICON = ['M4 8V4h4', 'M11 4h2', 'M16 4h4v4', 'M20 11v2', 'M20 16v4h-4', 'M13 20h-2', 'M8 20H4v-4', 'M4 13v-2'];
// a point's symbols, in its Symbol control
export const SYMBOL_ICON = { diamond: ['m12 4 8 8-8 8-8-8z'], square: ['M6 6h12v12H6z'], triangle: ['M12 4l9 15H3z'], dot: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], none: [] };

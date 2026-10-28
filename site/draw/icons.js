// The drawing's icons, as SVG path data (24 × 24, stroked): what each kind of element looks like, the
// tools', the actions'.

export const KIND_ICON = {
  point: ['m12 4 8 8-8 8-8-8z'], shape: ['M4 8h16v8H4z'], polygon: ['M5 7l7-4 7 5-2 11H7z'], line: ['M4 18 20 6'], group: ['M3 7h7l2 2h9v10H3z'],
  label: ['M10 4h10v7H10z', 'M10 11 4 19'], // a text box and its leader
};
// the panels' and the actions' icons (as Lucide's): the drawing, Attach, Zoom to, Duplicate, Group,
// Delete, Detach, shown and hidden
export const UI_ICON = {
  drawing: ['M6 3h9l4 4v14H6z', 'M14 3v5h5'], // a page: the drawing itself
  attach: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'], // a link
  zoom: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M12 9v6', 'M9 12h6'],
  duplicate: ['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2'],
  group: ['M3 7h7l2 2h9v10H3z', 'M12 11v6', 'M9 14h6'],
  delete: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  detach: ['m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'm5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71', 'M8 2v3', 'M2 8h3', 'M16 19v3', 'M19 16h3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  hidden: ['M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7', 'M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M14.1 14.1a3 3 0 1 1-4.2-4.2', 'M2 2l20 20'],
  // a fold's
  chevron: ['m6 9 6 6 6-6'],
};
// what each kind of point and shape looks like (the tools' kinds, the tree): those round a centre have it
// marked, the outlines not
export const POINT_ICON = {
  point: KIND_ICON.point, symbol: KIND_ICON.point,
  circle: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M12 12h8', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'], // its radius drawn from its centre
  rings: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
  sector: ['M5 19V5a14 14 0 0 1 14 14z'], // a quarter of a circle, its centre bottom left
  rectangle: ['M4 8h16v8H4z'], ellipse: ['M12 7c5 0 9 2.2 9 5s-4 5-9 5-9-2.2-9-5 4-5 9-5z'], triangle: ['M12 4l8 15H4z'], polygon: KIND_ICON.polygon,
  'aerial-vehicle': ['M12 3v18M4 12l8-3 8 3M9 19l3-1 3 1'], 'surface-vehicle': ['M12 3c3 2 4 5 4 8v9H8v-9c0-3 1-6 4-8z'], 'underwater-vehicle': ['M12 2c2.2 0 4 2.4 4 5v9.5l2 3.5h-2.4l-.6-1h-6l-.6 1H6l2-3.5V7c0-2.6 1.8-5 4-5z'], // the outline's rocket, upright
};
export const SELECT_ICON = ['M5 3l14 8-6 2-2 6z']; // an arrow
// Box select: a dashed square
export const BOX_ICON = ['M4 8V4h4', 'M11 4h2', 'M16 4h4v4', 'M20 11v2', 'M20 16v4h-4', 'M13 20h-2', 'M8 20H4v-4', 'M4 13v-2'];

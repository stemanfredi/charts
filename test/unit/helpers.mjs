// What the unit tests share.
import assert from 'node:assert/strict';

// a and b within tol of each other (what: what they are, for the message)
export const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

const { addPoint, nextName, makePart } = await import('../../site/draw/document.js');
const { drawParts } = await import('../../site/draw/features.js');
// a point with one outline drawn to scale, no symbol
export const addShape = (doc, position, kind = 'rectangle') => addPoint(doc, position, { name: nextName(doc, 'point', 'Shape'), symbol: 'none', parts: [makePart(kind)] });
// what the map draws, all of it as one collection
export function drawFeatures(doc, sel = new Set(), hover = null, display = {}) {
  const p = drawParts(doc, sel, hover, display);
  return { type: 'FeatureCollection', features: [...p.base, ...p.zoom, ...p.marks] };
}

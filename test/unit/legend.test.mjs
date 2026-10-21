import test from 'node:test';
import assert from 'node:assert/strict';
import { wmsClasses } from '../../site/legend.js';

const rule = (title, ...symbolizers) => ({ title, symbolizers });
test('wmsClasses: fills at their opacity, lines on their casing, point symbols, no-data left out', () => {
  const cls = wmsClasses({ Legend: [{ rules: [
    rule('2. Sand', { Raster: { fill: '#FFE699' } }),
    rule('No data', { Polygon: { fill: '#FFFFFF' } }),
    rule('Firing Area', { Polygon: { stroke: '#FF0000', fill: '#FEC5CE', 'fill-opacity': '0.2' } }),
    rule('OSPAR', { Polygon: { stroke: '#008040', 'graphic-fill': { url: 'x' } } }),
    rule('Hatched, no outline', { Polygon: { 'graphic-fill': { url: 'x' } } }),
    rule('Active', { Line: { stroke: '#000000' } }, { Line: { stroke: '#007800' } }),
    rule('Unsettled (maritime)', { Line: { stroke: '#c64131', 'stroke-dasharray': ['10.0', '5.0'] } }),
    rule('A: SPA (Special Protection Areas)', { Polygon: { stroke: '#000000', fill: '#99C7CC', 'fill-opacity': '0.8' } }),
    rule('Operational', { Point: { url: 'https://example.org/p.png' } }),
  ] }] });
  assert.deepEqual(cls, [
    { label: 'Sand', colour: 'rgba(255,230,153,1)' },
    { label: 'Firing Area', colour: 'rgba(254,197,206,0.2)', stroke: '#FF0000' },
    { label: 'OSPAR', colour: 'rgba(0,128,64,0.35)', stroke: '#008040' },
    { label: 'Active', line: true, colour: '#007800', casing: '#000000' },
    { label: 'Unsettled (maritime)', line: true, colour: '#c64131', dash: [10, 5] },
    { label: 'SPA (Special Protection Areas)', colour: 'rgba(153,199,204,0.8)', stroke: '#000000' },
    { label: 'Operational', icon: 'https://example.org/p.png' },
  ]);
});

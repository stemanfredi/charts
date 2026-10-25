import { test } from 'node:test';
import assert from 'node:assert/strict';

const { rowsText, rowsOf, placesOf, placesAfterPaste } = await import('../../site/draw/paste.js');

test('rowsText: tab-separated, a header first, tabs and line breaks in a cell made spaces', () => {
  assert.equal(rowsText(['Key', 'Value'], [['a', 'one\ttwo'], ['b', 'x\ny']]), 'Key\tValue\na\tone two\nb\tx y\n');
});

test('rowsOf: lines that are not empty; cells at tabs, else at semicolons, else the line whole', () => {
  assert.deepEqual(rowsOf('45.1\t12.5\n\n45.2\t12.6\n'), [['45.1', '12.5'], ['45.2', '12.6']]);
  assert.deepEqual(rowsOf('45,1;12,5\r\n45,2;12,6'), [['45,1', '12,5'], ['45,2', '12,6']]);
  assert.deepEqual(rowsOf('45.1, 12.5\n45 07.5N 012 30.0E'), [['45.1, 12.5'], ['45 07.5N 012 30.0E']]);
});

test('placesOf: latitude then longitude, any format; a header skipped, its Lat and Lon columns read; a line not read stops it', () => {
  assert.deepEqual(placesOf('45.1, 12.5\n45 07.5N 012 30.0E').places, [[12.5, 45.1], [12.5, 45.125]]);
  assert.deepEqual(placesOf('45,1;12,5\n45,2;12,6').places, [[12.5, 45.1], [12.6, 45.2]]); // decimal commas
  // a copy of a vertex list pasted back: its Lat and Lon columns
  assert.deepEqual(placesOf('#\tLat\tLon\tLeg m\nstart\t44.2\t14.5\t\n1\t43.9\t14.2\t41099').places, [[14.5, 44.2], [14.2, 43.9]]);
  assert.deepEqual(placesOf('latitude,longitude\n10, 20').places, [[20, 10]]); // a header of another kind
  assert.deepEqual(placesOf('10, 20\nnot a place\n30, 40'), { places: [], bad: 2 });
  assert.deepEqual(placesOf('95, 20'), { places: [], bad: null }); // a first line not read: taken as a header
});

test('placesAfterPaste: places replaced from the row on; past the last, more; never one locked', () => {
  const ps = [[0, 0], [1, 0], [2, 0]];
  assert.deepEqual(placesAfterPaste(ps, 1, [[1, 1]]), { places: [[0, 0], [1, 1], [2, 0]], applied: 1, left: 0 });
  assert.deepEqual(placesAfterPaste(ps, 1, [[1, 1], [2, 1], [3, 1]]), { places: [[0, 0], [1, 1], [2, 1], [3, 1]], applied: 3, left: 0 }); // grows: the last its end
  assert.deepEqual(placesAfterPaste(ps, 1, [[1, 1], [2, 1], [3, 1]], new Set([2])), { places: [[0, 0], [1, 1], [2, 0]], applied: 1, left: 2 }); // an attached end: stopped before it
  assert.deepEqual(placesAfterPaste(ps, 0, [[9, 9]], new Set([0])).applied, 0);
  assert.deepEqual(ps, [[0, 0], [1, 0], [2, 0]], 'the places given untouched');
});

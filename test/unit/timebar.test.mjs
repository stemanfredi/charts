import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeWindow, spanPct, floorHour } from '../../timebar.js';

const T = (s) => Date.parse(s);

test('timeWindow: a week back and ten days ahead of now, or around an hour elsewhere', () => {
  const now = T('2026-10-20T17:42:00Z');
  assert.deepEqual(timeWindow(T('2026-10-21T12:00:00Z'), now), { start: T('2026-10-13T00:00:00Z'), end: T('2026-10-30T00:00:00Z') });
  assert.deepEqual(timeWindow(T('2026-10-29T23:00:00Z'), now).start, T('2026-10-13T00:00:00Z'), 'the last forecast day: same window');
  assert.deepEqual(timeWindow(T('2024-03-05T06:00:00Z'), now), { start: T('2024-02-27T00:00:00Z'), end: T('2024-03-15T00:00:00Z') }, 'a day picked in the calendar');
});

test('spanPct: data spans as percentages of the window, clipped; none outside', () => {
  const w = { start: 0, end: 100 };
  assert.deepEqual(spanPct([10, 30], w), [10, 20]);
  assert.deepEqual(spanPct([-50, 40], w), [0, 40], 'from before the window');
  assert.deepEqual(spanPct([90, 500], w), [90, 10], 'to after it');
  assert.equal(spanPct([120, 130], w), null);
});

test('floorHour: on the hour, UTC', () => {
  assert.equal(new Date(floorHour(T('2026-10-20T17:59:59Z'))).toISOString(), '2026-10-20T17:00:00.000Z');
});

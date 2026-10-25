import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtAngle, dm, mercatorVariation, niceLen, parseLatLon, parseCoord, parseDist, distText, exportName } from '../../site/format.js';

test('fmtAngle: degrees, minutes, hemispheres, carry', () => {
  assert.equal(fmtAngle(44, 'N', 'S', 1), '44°N');
  assert.equal(fmtAngle(-12.5, 'E', 'W', 0.5), '12°30′W');
  assert.equal(fmtAngle(9.9999999, 'E', 'W', 1 / 60), '10°E'); // 59.99′ rounds up into the degrees
  assert.equal(fmtAngle(30 + 5 / 60, 'N', 'S', 1 / 60), '30°05′N');
});

test('dm: decimal minutes, carry into degrees', () => {
  assert.equal(dm(44.5, 'N', 'S'), '44°30.000′N');
  assert.equal(dm(-0.25, 'N', 'S'), '0°15.000′S');
  assert.equal(dm(44.99999995, 'N', 'S'), '45°00.000′N');
});

test('mercatorVariation: by |lat|, 0 at the equator crossing', () => {
  assert.equal(mercatorVariation(-1e-9, 1e-9), 0);
  const across = mercatorVariation(-14, 14);
  assert.ok(Math.abs(across - (1 / Math.cos((14 * Math.PI) / 180) - 1)) < 1e-12);
  assert.ok(across > 0.03); // the case that used to read 0 %
  assert.ok(Math.abs(mercatorVariation(60, 61) - mercatorVariation(-61, -60)) < 1e-12);
  assert.ok(Number.isFinite(mercatorVariation(80, 90))); // clamped at 85°
});

test('niceLen: 1/2/5 steps not above the input', () => {
  assert.deepEqual([0.7, 1, 3, 19, 20, 49, 999, 1234].map(niceLen), [0.5, 1, 2, 10, 20, 20, 500, 1000]);
});


test('parseLatLon: decimal, DM, DMS, hemispheres before or after, either order', () => {
  const near = (r, lat, lon) => assert.ok(r && Math.abs(r.lat - lat) < 1e-9 && Math.abs(r.lon - lon) < 1e-9, JSON.stringify(r));
  near(parseLatLon('35.898, 14.513'), 35.898, 14.513);
  near(parseLatLon('-31.2 -51.3'), -31.2, -51.3);
  near(parseLatLon('35 53.9N 14 30.8E'), 35 + 53.9 / 60, 14 + 30.8 / 60);
  near(parseLatLon('35°53\'54"N 014°30\'48"W'), 35 + 53 / 60 + 54 / 3600, -(14 + 30 / 60 + 48 / 3600));
  near(parseLatLon('N35 53.9 E14 30.8'), 35 + 53.9 / 60, 14 + 30.8 / 60);
  near(parseLatLon('14.513E 35.898S'), -35.898, 14.513);
  near(parseLatLon('35°53.9′N, 14°30.8′E'), 35 + 53.9 / 60, 14 + 30.8 / 60);
  near(parseLatLon('35 54 14 31'), 35 + 54 / 60, 14 + 31 / 60);
  near(parseLatLon('-0 30 10 0'), -0.5, 10);
});

test('parseLatLon: not coordinates', () => {
  for (const t of ['', 'Lisbon', 'Crete', 'SEN', '35.898', '1 2 3', '91 10', '44 10 200 0', '44 61N 9E', '44N 9N', '44.5 30N 9E', 'N44 E', '44N -9E'])
    assert.equal(parseLatLon(t), null, t);
});

test('exportName: UTC time, then the centre to 0.01° with hemispheres', () => {
  const t = new Date('2026-10-20T16:36:59Z');
  assert.equal(exportName(t, 40.51147, 17.16421), 'chart-20261020-1636-40.51N-17.16E');
  assert.equal(exportName(t, -33.8688, -151.2093), 'chart-20261020-1636-33.87S-151.21W');
  assert.equal(exportName(t, -0.001, 190), 'chart-20261020-1636-0.00N-170.00W', 'no "-0.00S"; a world copy east of 180°');
});

test('parseLatLon: a decimal comma, where the text has no decimal point', () => {
  assert.deepEqual(parseLatLon('35,898 14,513'), { lat: 35.898, lon: 14.513 });
  assert.deepEqual(parseLatLon('35,898, 14,513'), { lat: 35.898, lon: 14.513 });
  assert.deepEqual(parseLatLon('43,6N 13,5E'), { lat: 43.6, lon: 13.5 });
  assert.deepEqual(parseLatLon('43,13'), { lat: 43, lon: 13 }); // a comma between two numbers stays a separator
  assert.deepEqual(parseLatLon('43.6,13.5'), { lat: 43.6, lon: 13.5 });
});

test('parseCoord: one coordinate, each notation, its own hemisphere only', () => {
  const near = (v, want) => assert.ok(v !== null && Math.abs(v - want) < 1e-9, `${v} vs ${want}`);
  near(parseCoord('37.2913083', 'lat'), 37.2913083);
  near(parseCoord('-9.5', 'lon'), -9.5);
  near(parseCoord('37,29', 'lat'), 37.29); // decimal comma
  near(parseCoord('37 17.48N', 'lat'), 37 + 17.48 / 60);
  near(parseCoord('N37 17.48', 'lat'), 37 + 17.48 / 60);
  near(parseCoord('37° 17\' 28.71"S', 'lat'), -(37 + 17 / 60 + 28.71 / 3600));
  near(parseCoord('009° 31\' 28.34"E', 'lon'), 9 + 31 / 60 + 28.34 / 3600);
  near(parseCoord('-0 30', 'lat'), -0.5);
  assert.equal(parseCoord('37N', 'lon'), null); // a latitude's letter in a longitude field
  assert.equal(parseCoord('91', 'lat'), null);
  assert.equal(parseCoord('181', 'lon'), null);
  assert.equal(parseCoord('37 61', 'lat'), null); // minutes ≥ 60
  assert.equal(parseCoord('N37 S2', 'lat'), null);
  assert.equal(parseCoord('-37N', 'lat'), null);
  assert.equal(parseCoord('', 'lat'), null);
  assert.equal(parseCoord('abc', 'lat'), null);
});

test('parseDist: units, a bare number in the unit shown, rubbish', () => {
  assert.equal(parseDist('500 m', 'km'), 500);
  assert.equal(parseDist('1.2 NM', 'm'), 1.2 * 1852);
  assert.equal(parseDist('3km', 'nm'), 3000);
  assert.equal(parseDist('2,5 km', 'm'), 2500);
  assert.equal(parseDist('750', 'm'), 750);
  assert.equal(parseDist('1.5', 'km'), 1500);
  assert.equal(parseDist('2', 'nm'), 3704);
  for (const bad of ['', 'abc', '-5 m', '5 mi', '1e3 m']) assert.equal(parseDist(bad, 'm'), null, bad);
});

test('distText: exact to the millimetre, in the unit the mode reads', () => {
  assert.deepEqual(distText(500, 'km'), { text: '500 m', unit: 'm' });
  assert.deepEqual(distText(1234.5, 'km'), { text: '1.2345 km', unit: 'km' });
  assert.deepEqual(distText(1852 * 1.5, 'nm'), { text: '1.5 NM', unit: 'nm' });
  for (const m of [0.001, 999.999, 1000, 12345.678]) {
    const t = distText(m, 'km');
    assert.ok(Math.abs(parseDist(t.text, t.unit) - m) < 1e-3, t.text);
  }
});

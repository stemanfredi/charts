import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CMEMS } from '../../site/catalog.js';
import { regionOf, durationMs, timeDomain, snapTime, depthLevels, nearestLevel } from '../../site/cmems.js';

test('regionOf: Mediterranean products by name, whatever their family; global ones none', () => {
  for (const p of ['MEDSEA_ANALYSISFORECAST_WAV_006_017/x/VHM0', 'SST_MED_SST_L4_NRT_OBSERVATIONS_010_004/x/analysed_sst', 'OCEANCOLOUR_MED_BGC_L4_NRT_009_142/x/CHL']) {
    assert.equal(regionOf(p)?.name, 'Mediterranean', p);
  }
  for (const p of ['GLOBAL_ANALYSISFORECAST_PHY_001_024/x/zos', 'SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001/x/analysed_sst', 'WIND_GLO_PHY_L4_NRT_012_004/x/wind']) {
    assert.equal(regionOf(p), null, p);
  }
  // every variant with two parts draws a global one first and the regional one over it
  for (const [id, vs] of Object.entries(CMEMS)) {
    for (const [k, v] of Object.entries(vs)) {
      if (v.parts.length > 1) assert.deepEqual(v.parts.map((p) => !!regionOf(p)), [false, true], `${id}/${k}`);
    }
  }
});

test('Copernicus time: durations, a dataset\'s domain from its capabilities, snapping', () => {
  assert.equal(durationMs('PT1H'), 36e5);
  assert.equal(durationMs('PT10800S'), 3 * 36e5);
  assert.equal(durationMs('PT15M'), 9e5);
  assert.equal(durationMs('P1D'), 864e5);
  const xml = `<Layer><ows:Identifier>P/D/zos_detided</ows:Identifier><Dimension><ows:Identifier>time</ows:Identifier><Value>2020-01-01T00:00:00Z/2020-01-02T00:00:00Z/PT1H</Value></Dimension></Layer>
    <Layer><ows:Identifier>P/D/zos</ows:Identifier><Dimension><ows:Identifier>time</ows:Identifier><Default>x</Default>
    <Value>2024-06-25T00:00:00.000000000Z/2026-10-29T23:00:00Z/PT1H</Value></Dimension></Layer>`;
  const d = timeDomain(xml, 'zos');
  assert.deepEqual(d, [{ start: Date.parse('2024-06-25T00:00:00Z'), end: Date.parse('2026-10-29T23:00:00Z'), step: 36e5 }], 'zos, not zos_detided; nanoseconds read');
  assert.deepEqual(timeDomain(xml.replace('2020-01-02T00:00:00Z/PT1H', '2020-01-02T00:00:00Z/P1M'), 'zos_detided'), [], 'a step in months is not read: the range is left out');
  const t = (s) => Date.parse(s);
  assert.equal(snapTime(d, t('2026-10-21T12:00:00Z')), t('2026-10-21T12:00:00Z'));
  assert.equal(snapTime(d, t('2026-10-21T12:40:00Z')), t('2026-10-21T12:00:00Z'));
  assert.equal(snapTime(d, t('2026-10-31T00:00:00Z')), null, 'after the forecast');
  assert.equal(snapTime(d, t('2024-01-01T00:00:00Z')), null, 'before the first step');
  // every 3 hours from 03:00: noon is a step, 13:00 draws noon
  const w = [{ start: t('2022-11-01T03:00:00Z'), end: t('2026-10-30T00:00:00Z'), step: 3 * 36e5 }];
  assert.equal(snapTime(w, t('2026-10-21T13:00:00Z')), t('2026-10-21T12:00:00Z'));
});

test('Copernicus depth: levels from capabilities, the nearest one to the depth chosen', () => {
  const xml = `<Layer><ows:Identifier>P/D/thetao</ows:Identifier><Dimension><ows:Identifier>elevation</ows:Identifier><UOM>m</UOM>
    <Default>-1.0182366371154785</Default><Value>-110.0</Value><Value>-98.5</Value><Value>-10.5</Value><Value>-1.0182366371154785</Value></Dimension>
    <Dimension><ows:Identifier>time</ows:Identifier><Value>2024-01-01T00:00:00Z/2024-01-02T00:00:00Z/P1D</Value></Dimension></Layer>`;
  const levels = depthLevels(xml, 'thetao');
  assert.deepEqual(levels, ['-110.0', '-98.5', '-10.5', '-1.0182366371154785'], 'as listed, for the ELEVATION parameter');
  assert.equal(nearestLevel(levels, 0), '-1.0182366371154785', 'surface: the top level');
  assert.equal(nearestLevel(levels, 100), '-98.5');
  assert.equal(nearestLevel(levels, 1000), '-110.0', 'below the deepest: the deepest');
  assert.equal(nearestLevel([], 100), null, 'a variable without depth');
  assert.deepEqual(depthLevels(xml.replace('elevation', 'x'), 'thetao'), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CMEMS } from '../../site/catalog.js';
import { regionOf } from '../../site/cmems.js';

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

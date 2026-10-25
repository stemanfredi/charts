import test from 'node:test';
import assert from 'node:assert/strict';
import { classOf } from '../../tools/seagrass.mjs';

test('seagrass: a class from habitat names in any of its languages and codes', () => {
  assert.equal(classOf('Posidonia oceanica'), 'posidonia');
  assert.equal(classOf("III.5.1. - Biocenose de l'herbier a Posidonia oceanica"), 'posidonia');
  assert.equal(classOf('Posidonia beds | 1120 - Posidonia beds (Posidonion oceanicae)'), 'posidonia');
  assert.equal(classOf('Facies of dead "mattes" of Posidonia oceanica without much epiflora'), 'matte');
  assert.equal(classOf('Association de la matte morte de Posidonia oceanica'), 'matte');
  assert.equal(classOf('Mosaico di praterie a Posidonia oceanica vive e morte'), 'posidonia'); // living with dead
  assert.equal(classOf('Association with Cymodocea nodosa on well sorted fine sands'), 'cymodocea');
  assert.equal(classOf('A5.5331'), 'zostera');
  assert.equal(classOf('LS.LMp.LSgr.Znol'), 'zostera');
  assert.equal(classOf('Zostera noltii beds'), 'zostera');
  assert.equal(classOf('Seagrass beds'), 'other');
  assert.equal(classOf('Ruppia beds'), 'other');
  assert.equal(classOf(''), 'other');
});

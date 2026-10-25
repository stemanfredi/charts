import { test } from 'node:test';
import assert from 'node:assert/strict';

const { looksLikeCoords } = await import('../../site/search.js');

test('coordinates, complete or still being typed, are told from place names (never sent)', () => {
  for (const t of ['35', '35 54N', '35 54N 14', '35.9', '43°', '-12.5, 44', '37 17.48N 015 03E', '44°03′N 9°48′E']) assert.ok(looksLikeCoords(t), t);
  for (const t of ['Genoa', 'N1 road', 'Route 66', 'Sesto 2', 'NE']) assert.ok(!looksLikeCoords(t), t);
});

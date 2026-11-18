// Plan studio-taktart T5, golden: szenenZielBeat over 40 inputs equals the recording from the unchanged code (fixtures/taktart_4_szenen.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './fixtures/taktart_4_szenen_run.mjs';

const golden = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/taktart_4_szenen.json', import.meta.url)), 'utf8'));

test('taktart 4/4 golden: szenenZielBeat over 40 inputs equals the recording from the unchanged code', () => {
  const ist = lauf();
  assert.equal(ist.length, 40);
  assert.deepEqual(ist, golden);
  assert.equal(JSON.stringify(ist), JSON.stringify(golden), 'byte-wise equal');
});

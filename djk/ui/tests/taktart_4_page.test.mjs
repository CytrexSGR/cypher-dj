// Plan studio-taktart T4, golden: the pure page helpers with default arguments equal the recording from the unchanged code (fixtures/taktart_4_seite.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './fixtures/taktart_4_page_run.mjs';

const golden = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/taktart_4_seite.json', import.meta.url)), 'utf8'));

test('taktart 4/4 golden: seq_feld and seq_logik helpers with default arguments equal the recording from the unchanged code', () => {
  const ist = lauf();
  assert.deepEqual(ist, golden);
  assert.equal(JSON.stringify(ist), JSON.stringify(golden), 'byte-wise equal');
});

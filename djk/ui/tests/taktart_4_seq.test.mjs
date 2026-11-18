// Plan studio-taktart T3, golden: the SEQ pattern bar maths with a 4/4 project equals the recording from the unchanged code (fixtures/taktart_4_seq.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './fixtures/taktart_4_seq_run.mjs';

const golden = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/taktart_4_seq.json', import.meta.url)), 'utf8'));

test('taktart 4/4 golden: pattern text plan, round trip, editierbar and the clip_neu guard equal the recording from the unchanged code', async (t) => {
  const ist = await lauf(t);
  assert.deepEqual(ist, golden);
  assert.equal(JSON.stringify(ist), JSON.stringify(golden), 'byte-wise equal');
});

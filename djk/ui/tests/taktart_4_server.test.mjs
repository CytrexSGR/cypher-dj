// Plan studio-taktart T2, golden: with no project open and with a 4/4 project open the page server's bar-bound routes
// (/regler, /spur, /tempo, /lage) behave exactly as recorded on the code BEFORE the change (fixtures/taktart_4_server.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './fixtures/taktart_4_server_run.mjs';

const golden = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/taktart_4_server.json', import.meta.url)), 'utf8'));

for (const [name, mitProjekt] of [['ohne_projekt', false], ['projekt_4_4', true]]) {
  test(`taktart 4/4 golden: ${name} equals the recording from the unchanged server`, async (t) => {
    const ist = await lauf(t, mitProjekt);
    assert.deepEqual(ist, golden[name]);
    assert.equal(JSON.stringify(ist), JSON.stringify(golden[name]), 'byte-wise equal');
  });
}

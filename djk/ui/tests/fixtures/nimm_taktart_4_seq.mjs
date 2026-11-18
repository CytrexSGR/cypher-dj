// Recorder, run ONCE on the unchanged code (plan studio-taktart T3, golden procedure). Writes taktart_4_seq.json beside it.
// Run: CYPHERDJ_TEST_INSTANZ=i node tests/fixtures/nimm_taktart_4_seq.mjs  (from djk/ui; a test instance, never the live studio)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './taktart_4_seq_run.mjs';

const aufraeumen = [];
const t = { after: (f) => aufraeumen.push(f) };
const aus = await lauf(t);
for (const f of aufraeumen.splice(0).reverse()) await f();
const ziel = fileURLToPath(new URL(process.argv[2] ?? 'taktart_4_seq.json', import.meta.url));
fs.writeFileSync(ziel, `${JSON.stringify(aus, null, 1)}\n`);
console.log('geschrieben', ziel);
process.exit(0);

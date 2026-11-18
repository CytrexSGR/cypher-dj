// Recorder, run ONCE on the unchanged code (plan studio-taktart T2, golden procedure). Writes taktart_4_server.json beside it.
// Run: CYPHERDJ_TEST_INSTANZ=i node tests/fixtures/nimm_taktart_4_server.mjs  (from djk/ui; a test instance, never the live studio)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './taktart_4_server_run.mjs';

const aufraeumen = [];
const t = { after: (f) => aufraeumen.push(f) };
const aus = { ohne_projekt: await lauf(t, false) };
for (const f of aufraeumen.splice(0).reverse()) await f();
aus.projekt_4_4 = await lauf(t, true);
for (const f of aufraeumen.splice(0).reverse()) await f();
const ziel = fileURLToPath(new URL(process.argv[2] ?? 'taktart_4_server.json', import.meta.url));
fs.writeFileSync(ziel, `${JSON.stringify(aus, null, 1)}\n`);
console.log('geschrieben', ziel);
process.exit(0);

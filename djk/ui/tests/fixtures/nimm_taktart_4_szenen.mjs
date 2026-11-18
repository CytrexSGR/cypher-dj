// Recorder, run ONCE on the unchanged code (plan studio-taktart T5, golden procedure). Writes taktart_4_szenen.json beside it.
// Run from djk/ui: node tests/fixtures/nimm_taktart_4_szenen.mjs   (pure function, touches nothing else)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lauf } from './taktart_4_szenen_run.mjs';

const ziel = fileURLToPath(new URL(process.argv[2] ?? 'taktart_4_szenen.json', import.meta.url));
fs.writeFileSync(ziel, `${JSON.stringify(lauf(), null, 1)}\n`);
console.log('geschrieben', ziel);

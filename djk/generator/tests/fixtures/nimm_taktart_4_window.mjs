// Recorder, run ONCE on the unchanged code (plan studio-taktart T1, golden procedure). Writes the two fixtures beside it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fensterAusgabe, planerAusgabe } from './taktart_4_korpus.mjs';

const hier = (n) => fileURLToPath(new URL(n, import.meta.url));
fs.writeFileSync(hier('taktart_4_fenster.json'), `${JSON.stringify(fensterAusgabe(), null, 1)}\n`);
fs.writeFileSync(hier('taktart_4_planer.json'), `${JSON.stringify(planerAusgabe(), null, 1)}\n`);

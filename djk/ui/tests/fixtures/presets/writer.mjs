// Child process for the concurrency tests (presets_store.test.mjs): waits for the start file, then saves one preset and prints
// the outcome as one JSON line. Arguments: <nutzer folder> <start file> <name> <thresh> <ueberschreiben 0|1>
import fs from 'node:fs';
import { PresetSpeicher } from '../../../presets/store.ts';

const [nutzer, start, name, thresh, ueber] = process.argv.slice(2);
const s = new PresetSpeicher({ nutzer, werk: nutzer + '-werk' });
const bis = Date.now() + 5000;
while (!fs.existsSync(start) && Date.now() < bis) { /* busy wait: all children start their write at nearly the same moment */ }
try {
  const beschreibung = { art: 'compressor', unterart: 'bus', charakter: ['punchy'], genre: [], einsatz: ['mixdown'], energie: 3, text: 'Written by a racing child process.' };
  const r = s.speichere({ name, geraet: 'komp', werte: { thresh: Number(thresh) }, beschreibung }, { ueberschreiben: ueber === '1' });
  console.log(JSON.stringify({ ok: true, neu: r.neu }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, fehler: e.fehler ?? e.message }));
}

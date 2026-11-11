// arr-bk: the takeover of the kern state file from version 3 to 4, seen from the page. Two steps against a test instance:
//   node end_to_end_state_v3.mjs setzen <page url> <out json>   sets mixer rows and the tempo through the Hand, then writes what lage reports
//   node end_to_end_state_v3.mjs lesen  <page url> <out json>   writes what lage reports (after the kern was restarted with another build)
// The caller restarts the kern between the two steps (kill of the kern unit, the link core/build now points at the build under test) and compares the files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const [MODUS, SEITE, AUS] = process.argv.slice(2);
if (!MODUS || !SEITE || !AUS) { console.error('usage: end_to_end_state_v3.mjs setzen|lesen <page url> <out json>'); process.exit(2); }
const c = new Client({ name: 'durchstich-zustand-v3', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HIER, '..', 'hand.ts'), '--seite', SEITE] }));
const roh = (name, args = {}) => c.callTool({ name, arguments: args });
const ruft = async (name, args = {}) => {
  const r = await roh(name, args);
  const t = r.content[0].text;
  try { return { fehler: !!r.isError, j: JSON.parse(t) }; } catch { return { fehler: !!r.isError, j: t }; }
};
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

// a spread of mixer rows over channel kinds (all of them Hand-writable; the crossfader, master and cue are Andreas' hand only)
const WERTE = {
  'deck/1/fader': -7.5, 'deck/1/trim': 2.0, 'deck/1/eq/tief': -3.0, 'deck/1/eq/mitte': 1.5, 'deck/1/eq/hoch': -4.5, 'deck/1/filter': 0.25,
  'deck/2/fader': -12.0, 'deck/2/trim': -1.0, 'deck/2/eq/hoch': 3.0, 'deck/2/kill/tief': 1,
  'erz/1/fader': -9.0, 'erz/2/fader': -6.0, 'erz/3/fader': -15.0, 'erz/1/eq/tief': -2.0, 'erz/2/filter': -0.5,
  'pad/1/fader': -11.0, 'pad/2/fader': -13.5, 'pad/1/eq/mitte': 2.5,
  'erz/1/send/2': -18.0, 'erz/2/send/2': -21.0, 'deck/1/send/2': -24.0,
  'duck/tiefe': -9.0, 'duck/release': 250,
  'deck/1/komp/schwelle': -20.0, 'deck/1/komp/ratio': 4.0, 'erz/1/komp/makeup': 3.0,
  'deck/1/bk/3': 0.8, 'erz/2/bk/5': 0.2,
};
const erg = { modus: MODUS, gesendet: {}, abgelehnt: {} };
if (MODUS === 'setzen') {
  await ruft('tempo', { bpm: 137 });
  for (const [pfad, nach] of Object.entries(WERTE)) {
    const r = await ruft('regler', { pfad, nach });
    if (r.fehler || (r.j && r.j.ok === false)) erg.abgelehnt[pfad] = r.j; else erg.gesendet[pfad] = nach;
  }
  await schlaf(1500);   // the ramp of the tempo, and the kern writes its state every cycle
}
const lage = (await ruft('lage')).j;
erg.lage = lage;
fs.writeFileSync(AUS, JSON.stringify(erg, null, 1));
console.log(`${MODUS}: ${Object.keys(erg.gesendet).length} sent, ${Object.keys(erg.abgelehnt).length} refused -> ${AUS}`);
await c.close();
process.exit(0);

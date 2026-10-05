// Durchstich Plan Hand Task 10 (von Hand, nicht Teil der Suite): SDK-Client → djk-hand → Seiten-Server Instanz i → echter Kern.
// Aufruf: node djk/hand/tests/durchstich_instanz.mjs [http://127.0.0.1:56300]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SEITE = process.argv[2] ?? 'http://127.0.0.1:56300';
const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const c = new Client({ name: 'durchstich', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', SEITE] }));
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const ruf = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const t = r.content[0].text;
  console.log(`${r.isError ? 'FEHLER' : 'ok    '} ${name} ${JSON.stringify(args)} → ${t.length > 220 ? t.slice(0, 220) + '…' : t}`);
  return { fehler: !!r.isError, j: JSON.parse(t) };
};
const griff = (pfad, u) => fetch(SEITE + '/griff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, u }) });
const b = (await ruf('bestand', { max: 3 })).j.eintraege;
await ruf('laden', { deck: 1, material_id: b[0].material_id }); await ruf('laden', { deck: 2, material_id: b[1].material_id }); await w(1500);
await ruf('deck_start', { deck: 1 }); await ruf('deck_start', { deck: 2 }); await w(2500);
console.log('--- Andreas zieht Deck 1 auf (Hand)'); await griff('deck/1/fader', 0.9); await w(500);
await ruf('regler', { pfad: 'deck/2/fader', nach: 0 });                       // Grenze: geschlossen öffnen
await ruf('regler', { pfad: 'xfader', nach: 0.3, ab: 'jetzt' });              // Grenze: nur Hand
await ruf('sprung', { deck: 1, delta: 16 });                                    // Grenze: offenes Deck
await ruf('sprung', { deck: 2, delta: 16 });                                    // geschlossen: erlaubt
await ruf('regler', { pfad: 'deck/1/eq/tief', nach: -20, takte: 2 });          // Rampe auf offenem Deck
await ruf('loop', { deck: 1, beats: 4 }); await w(2500);
await ruf('pad', { deck: 1, nr: 3, aktion: 'setzen', art: 'loop' });
await ruf('loop', { deck: 1, beats: 0 });
await ruf('regler', { pfad: 'deck/1/filter', nach: -0.6, takte: 8 }); await w(600);
await ruf('abbrechen');
const l = (await ruf('warte', { takte: 1 })).j;
console.log('Lage Deck 1:', JSON.stringify(l.decks[0]), '| Regler:', JSON.stringify(l.regler), '| letzte Quittungen:', JSON.stringify(l.quittungen.slice(-4).map((q) => [q.status, q.grund])));
await c.close(); process.exit(0);

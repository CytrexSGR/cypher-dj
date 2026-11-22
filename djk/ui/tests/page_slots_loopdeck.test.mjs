// DJ view: a loops place shows the loop deck of its group (LoopDeck.platz), the same deck SESSION shows in that container (D13). The live project
// can arrive after /lage (two requests race): the nodes follow the project then, not the order of the loops places. Real page on the DOM stand-in.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// the live project of the studio: place 1 holds the group "LOOP 2" (deck 2), place 4 the group "LOOP 1" (deck 1)
const PLAETZE = [{ typ: 'loops', gruppe: 'g26' }, { typ: 'track' }, { typ: 'leer' }, { typ: 'loops', gruppe: 'g25' }];
const PROJEKT = { live: true, gruppen: [{ id: 'g25', name: 'LOOP 1', loopdeck: { platz: 1 } }, { id: 'g26', name: 'LOOP 2', loopdeck: { platz: 2 } }] };
let ansicht, live, zeichneLive;
const warte = () => new Promise((r) => setTimeout(r, 30));
const platzVon = (id) => attrappe.body.querySelector(`#${id}`).dataset.platz;

before(async () => {
  installiere({ html: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'),
    antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /lage': () => ({ j: { plaetze: PLAETZE, container: [{ art: 'modul' }, { art: 'player' }, { art: 'leer' }, { art: 'modul' }] } }) } });
  await import('../public/app.js');
  ansicht = await import('../public/slots_view.js');
  ({ live, zeichneLive } = await import('../public/live_view.js'));
  await warte();
});

test('the project known when /lage answers: place 1 (group LOOP 2) shows deck 2, place 4 deck 1', async () => {
  live.projekt = PROJEKT; await ansicht.holeLage();
  assert.equal(platzVon('platz-loops2'), '1'); assert.equal(platzVon('platz-loops'), '4');
});

test('the project arrives after /lage: the nodes follow it at the next frame, not the order of the loops places', async () => {
  live.projekt = null; await ansicht.holeLage();   // the race: the places are read before the project
  assert.equal(platzVon('platz-loops'), '1', 'without the project the order of the loops places decides (fallback)');
  const alt = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { setTimeout(f, 0); return 1; };   // the stand-in has no frames
  try { live.projekt = PROJEKT; zeichneLive(); await warte(); } finally { globalThis.requestAnimationFrame = alt; }
  assert.equal(platzVon('platz-loops2'), '1', 'place 1 shows deck 2 as soon as the project is known');
  assert.equal(platzVon('platz-loops'), '4');
});

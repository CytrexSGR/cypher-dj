// Audit U22: Delete with the cursor on a body cell of a long note (note grid) removes the note, like Enter and the right button do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');

const clip = { id: 'c_B', art: 'midi', name: 'Bass', start_beat: 0, laenge_beats: 64, loop_beats: 16, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 43, vel: 100 }] };   // steps 0..3 of row 43
const spur = { id: 's1', nr: 1, name: 'Bass', farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'bass-banddrive', parameter: {} }, clips: [clip] };
const projekt = { name: 'M', rev: 1, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [spur] };
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const post = (u, k) => fetch(u, { method: 'POST', body: JSON.stringify(k) });
let wurzel, w;
const alle = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
const zelle = (ton, schritt) => alle('zelle').find((z) => Number(z.dataset.ton) === ton && Number(z.dataset.schritt) === schritt);
const schreibt = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern');

test('audit U22: Delete on the third cell of a long note removes the note', async () => {
  installiere({ antworten: {
    'GET /proj/aktuell': { j: { slug: 'm1', projekt } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /seq/geraet': { j: { art: 'bk', regler: [], klaenge: [] } }, 'GET /geraete/panel': { j: {} },
    'POST /proj/aendern': (k) => ({ j: { rev: k.rev + 1, projekt: { ...projekt, rev: k.rev + 1 } } }),
  } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
  w.zeige(); await ruhe();
  const z = zelle(43, 2);
  z.dispatch('pointerdown', { buttons: 1 }); z.dispatch('pointerup', {}); await ruhe();
  assert.equal(schreibt().length, 0, 'a plain press on the body writes nothing');
  z.dispatch('keydown', { key: 'Delete' }); await ruhe();
  assert.equal(schreibt().length, 1, 'Delete on a body cell removes the note');
  assert.deepEqual(schreibt()[0].koerper.befehle, [{ befehl: 'noten_loeschen', clip_id: 'c_B', ids: ['n1'] }]);
});

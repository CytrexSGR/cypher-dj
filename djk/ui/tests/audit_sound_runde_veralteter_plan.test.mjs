// Audit U09: a PICK whose plan was computed on another project revision is not written (the commands would land on a changed project), but it
// must not vanish silently: the status line says that the pick was dropped, and it stays until the user acts again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const HIER = path.dirname(fileURLToPath(import.meta.url));
const LAGE = JSON.parse(fs.readFileSync(path.join(HIER, 'fixtures', 'klang_runde_lage.json'), 'utf8'));
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const modul = (rev = 3) => ({
  name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, master: { fader_db: 0, inserts: [] },
  spuren: [{ id: 's1', nr: 1, name: 'Bass', art: 'instrument', farbe: '#e0a33e', clips: [], geraet: { art: 'intern', name: 'bk', graph: 'acid', parameter: {} } }],
  returns: [],
});

test('a plan for another revision is dropped with a visible note, and the note stays through the next round', async () => {
  installiere({ antworten: {
    'GET /proj/aktuell': { j: { slug: 'm', projekt: modul() } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } },
    'POST /proj/klang/runde': (k) => ({ j: { ...structuredClone(LAGE), schritt: k.schritt } }),
    'GET /proj/klang/runde': () => ({ j: structuredClone(LAGE) }),
    'POST /proj/klang/hoeren': (k) => ({ j: { ...structuredClone(LAGE), aktiv: k.platz } }),
    'POST /proj/klang/waehlen': { j: { weg: 'proj', rev: 2, label: 'x', befehle: [] } }, 'POST /proj/klang/ende': { j: { ok: true } } } });
  const wurzel = document.createElement('section');
  const w = bindeWerkbank({ post, wurzel, frage: () => true });
  const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
  w.zeige(); await ruhe();
  $w('runde-auf').dispatch('click'); await ruhe();
  let n = 0;
  w.ctx.aendere = async () => { n += 1; return true; };
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-waehlen').dispatch('click'); await ruhe();
  assert.equal(n, 0, 'nothing is written');
  assert.equal(attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/klang/runde').length, 2, 'a new round starts');
  assert.match($w('runde-stand').textContent, /changed/i, `the status line says the pick was dropped: "${$w('runde-stand').textContent}"`);
  w.ctx.uebernimm('m', modul(4)); await ruhe();
  assert.match($w('runde-stand').textContent, /changed/i, 'still there after a project event');
  $w('runde-platz-C').dispatch('click'); await ruhe();
  assert.doesNotMatch($w('runde-stand').textContent, /changed/i, 'gone once the user acts again');
});

// SESSION clip editor, lane E (E3): the WARP tab (KEYLOCK, SOURCE tempo, read-only waveform with the beat grid). DOM stand-in, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere } from './helpers/pages_mock.mjs';

const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const text = (e) => e.textContent;
const tippe = (e, wert) => { e.value = wert; e.dispatch('keydown', { key: 'Enter' }); };

const zelleV = (extra = {}) => ({ id: 'z2', name: 'Drums', farbe: 3, art: 'loop', sha256: 'sha2', beats: 8, frames: 1000, gain_db: -3, bpm: 128, ...extra });
const spalteE = (zelle) => ({ spur_id: 'a1', kurz: 'A1', name: 'Loop 1.1', art: 'audio', deck: 1, spur: 1, zellen: [null, zelle, null, null, null, null, null, null] });
const baue = async (zelle, antwort = () => ({ ok: true })) => {
  installiere({ html: '<body><div id="w"></div></body>', antworten: { 'GET /welle': { j: { spitzen: [] } } } });
  const m = await import('../public/session/editor.js');
  const w = await import('../public/session/editor_warp.js');
  const rufe = { sende: [], meldung: [] };
  const ctx = {
    schreibeZelle: async () => true, aendere: async () => true, szeneAendern: async () => true,
    melde: (t, fehler) => rufe.meldung.push({ t, fehler }),
    sende: async (weg, daten) => { rufe.sende.push({ weg, daten }); return antwort(weg, daten); },
  };
  const ed = m.baueEditor(document.querySelector('#w'), ctx);
  ed.zeigeZelle(spalteE(zelle), 2);
  const oeffne = () => { ed.ed.querySelector('[data-tab="WARP"]').click(); return ed.ed; };
  return { m, w, ed, rufe, oeffne };
};

test('E3 WARP is registered after SLICES and fits audio cells only', async () => {
  const { w, ed } = await baue(zelleV());
  assert.deepEqual(ed.ed.querySelectorAll('.ed-tab').map(text), ['CLIP', 'SLICES', 'WARP', 'ENVELOPES']);
  assert.equal(w.warpTab.passt(zelleV()), true);
  assert.equal(w.warpTab.passt(zelleV({ art: 'einmal' })), true);
  assert.equal(w.warpTab.passt(null), false);
  assert.equal(w.warpTab.passt({ halten: true }), false);
  assert.equal(w.warpTab.passt({ art: 'strudel' }), false);
});

test('E3 the tab has KEYLOCK, SOURCE, the waveform with a beat grid and the "later slice" line, and no MODE, markers or TEXTURE', async () => {
  const { oeffne } = await baue(zelleV());
  const w = oeffne();
  assert.deepEqual(w.querySelectorAll('.wp-keylock .seg-b').map(text), ['ON', 'OFF']);
  assert.ok(w.querySelector('.wp-keylock [data-wert="null"]').classList.contains('an'), 'keylock is the default');
  assert.equal(w.querySelector('.wp-quelle').value, '128');
  const wv = w.querySelector('.wp-welle');
  assert.equal(wv.dataset.sha, 'sha2');
  assert.equal(wv.querySelectorAll('.wp-takt').length, 8, 'one grid line per beat of the cell');
  assert.match(text(w), /Warp markers and more modes come in a later slice\./);
  assert.doesNotMatch(text(w), /MODE|TEXTURE|MARKER/);
  assert.equal(w.querySelector('.wp-mode'), null);
});

test('E3 KEYLOCK OFF sends keylock: false, ON sends null', async () => {
  const { oeffne, rufe } = await baue(zelleV());
  const w = oeffne();
  w.querySelector('.wp-keylock [data-wert="false"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/zelle', daten: { spur_id: 'a1', zelle: 2, keylock: false } });
  w.querySelector('.wp-keylock [data-wert="null"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/zelle', daten: { spur_id: 'a1', zelle: 2, keylock: null } });
});

test('E3 a repitch cell shows OFF as the active mode', async () => {
  const { oeffne } = await baue(zelleV({ keylock: false }));
  const w = oeffne();
  assert.ok(w.querySelector('.wp-keylock [data-wert="false"]').classList.contains('an'));
  assert.ok(!w.querySelector('.wp-keylock [data-wert="null"]').classList.contains('an'));
});

test('E3 on an einmal cell KEYLOCK is disabled with "a one-shot plays unstretched"', async () => {
  const { oeffne, rufe } = await baue(zelleV({ art: 'einmal' }));
  const w = oeffne();
  for (const b of w.querySelectorAll('.wp-keylock .seg-b')) { assert.equal(b.disabled, true); assert.equal(b.title, 'a one-shot plays unstretched'); b.click(); }
  await ruhe();
  assert.equal(rufe.sende.length, 0);
});

test('E3 SOURCE sends bpm; a value outside TEMPO_MIN..TEMPO_MAX is refused in the page', async () => {
  const { oeffne, rufe } = await baue(zelleV());
  const f = oeffne().querySelector('.wp-quelle');
  assert.equal(f.min, '60'); assert.equal(f.max, '200');
  tippe(f, '174.5'); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/zelle', daten: { spur_id: 'a1', zelle: 2, bpm: 174.5 } });
  const n = rufe.sende.length;
  for (const v of ['59.9', '201', '0', '-5', 'abc']) { tippe(f, v); await ruhe(); assert.equal(f.value, '174.5', `${v} puts the old value back`); }
  assert.equal(rufe.sende.length, n, 'nothing was sent');
  assert.equal(rufe.meldung.length, 5);
  assert.deepEqual(rufe.meldung[0], { t: 'The source tempo must be between 60 and 200 BPM', fehler: true });
  tippe(f, '60'); await ruhe(); assert.equal(rufe.sende.at(-1).daten.bpm, 60);
  tippe(f, '200'); await ruhe(); assert.equal(rufe.sende.at(-1).daten.bpm, 200);
});

test('E3 keylock off on a transposed cell shows the server nur_keylock text', async () => {
  const { oeffne, rufe } = await baue(zelleV({ transponieren: 3 }), () => ({ ok: false, text: 'Transpose needs keylock: remove the transpose first.' }));
  oeffne().querySelector('.wp-keylock [data-wert="false"]').click(); await ruhe();
  assert.deepEqual(rufe.meldung.at(-1), { t: 'Transpose needs keylock: remove the transpose first.', fehler: true });
});

test('E3 the tempo limits of the page equal TEMPO_MIN and TEMPO_MAX of the project model', async () => {
  const { w } = await baue(zelleV());
  const quelle = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'project', 'model.ts'), 'utf8');
  assert.equal(w.TEMPO_MIN, Number(/export const TEMPO_MIN = (\d+)/.exec(quelle)[1]));
  assert.equal(w.TEMPO_MAX, Number(/export const TEMPO_MAX = (\d+)/.exec(quelle)[1]));
});

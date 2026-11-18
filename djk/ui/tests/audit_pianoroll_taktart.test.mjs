// Audit U20: the piano roll takes the meter of the project: SNAP BAR and the bar lines follow st.projekt.taktart (3/4: 3 beats), not a fixed 4.
import test from 'node:test';
import assert from 'node:assert/strict';

const { installiere, El } = await import('./helpers/pages_mock.mjs');
const { bindeRolle } = await import('../public/production/pianoroll_operation.js');
const { TASTEN_BREITE } = await import('../public/production/pianoroll.js');

function aufbau(taktart) {
  installiere();
  globalThis.Option = function Option(text, wert) { const o = new El('option'); o.textContent = text; o.value = wert ?? text; return o; };
  const behaelter = new El('div');
  const clip = { id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 12, noten: [] };
  const st = { projekt: { rev: 1, taktart, spuren: [{ id: 's1', farbe: '#ff0000', clips: [clip] }] } };
  const gesendet = [], aufrufe = [];
  const ctx = { st, lies: (k, v) => v, merke() {}, beimBild: [], melde() {}, zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) },
    aendere: () => Promise.resolve(true),
    aendereAus: async (f) => { const r = f(st.projekt); if (r) gesendet.push(...r.befehle); return true; } };
  El.prototype.getContext = () => new Proxy({}, { get: (_, n) => (...a) => aufrufe.push([n, ...a]), set: (_, n, v) => { aufrufe.push(['set', n, v]); return true; } });   // bindeRolle takes the context once
  const rolle = bindeRolle(ctx, behaelter);
  const cv = behaelter.querySelector('[data-r="roll"]');
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 840, height: 240 });
  rolle.zeige('c1');
  st.rolle.ansicht = { beat0: 0, pxProBeat: 20, tonOben: 60 };
  st.rolle.raster = 'takt';
  return { cv, st, ctx, gesendet, aufrufe };
}

test('audit U20: BAR snap in 3/4 puts a note at the start of the 3-beat bar', async () => {
  const { cv, gesendet } = aufbau([3, 4]);
  // beat 3.5 in the roll: x = TASTEN_BREITE + 3.5 * 20
  await cv.listeners.dblclick[0]({ offsetX: TASTEN_BREITE + 3.5 * 20, offsetY: 10, altKey: false });
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0].noten[0].beat, 3, 'bar 2 of a 3/4 project starts at beat 3');
});

test('audit U20: BAR snap in 4/4 is unchanged', async () => {
  const { cv, gesendet } = aufbau([4, 4]);
  await cv.listeners.dblclick[0]({ offsetX: TASTEN_BREITE + 3.5 * 20, offsetY: 10, altKey: false });
  assert.equal(gesendet[0].noten[0].beat, 0);
});

test('audit U20: the strong bar lines in 3/4 sit at 0, 3, 6 ...', () => {
  const { st, ctx, aufrufe } = aufbau([3, 4]);
  for (const f of ctx.beimBild) f();
  const takt = [];
  for (let i = 0; i < aufrufe.length - 2; i++) {
    if (aufrufe[i][0] === 'set' && aufrufe[i][1] === 'strokeStyle' && aufrufe[i][2] === 'rgba(255,255,255,0.18)' && aufrufe[i + 2][0] === 'moveTo') takt.push(aufrufe[i + 2][1]);
  }
  assert.deepEqual(takt.slice(0, 3), [0, 3, 6].map((b) => TASTEN_BREITE + b * 20 + 0.5), String(takt));
});

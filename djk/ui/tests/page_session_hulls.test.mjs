// SESSION clip editor, lane E (E4): the ENVELOPES tab. The lane gestures are the ones of PRODUCTION's envelope editor (lanes.js, lanes_operation.js,
// imported, not copied). DOM stand-in, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const text = (e) => e.textContent;

const zelleV = (extra = {}) => ({ id: 'z2', name: 'Drums', farbe: 3, art: 'loop', sha256: 'sha2', beats: 8, frames: 1000, gain_db: -3, bpm: 128, ...extra });
const spalteE = (zelle, extra = {}) => ({ spur_id: 'a1', kurz: 'A1', name: 'Loop 1.1', art: 'audio', deck: 1, spur: 1, filter: 0.2, send: { hall: -12, delay: -200 },
  rueckgaenge: { hall: true, delay: true }, zellen: [null, zelle, null, null, null, null, null, null], ...extra });
const baue = async (zelle, spalteExtra = {}, antwort = () => ({ ok: true })) => {
  installiere({ html: '<body><div id="w"></div></body>', antworten: { 'GET /welle': { j: { spitzen: [] } } } });
  const m = await import('../public/session/editor.js');
  const h = await import('../public/session/editor_hulls.js');
  const rufe = { sende: [], meldung: [] };
  const ctx = {
    schreibeZelle: async () => true, aendere: async () => true, szeneAendern: async () => true,
    melde: (t, fehler) => rufe.meldung.push({ t, fehler }),
    sende: async (weg, daten) => { rufe.sende.push({ weg, daten }); return antwort(weg, daten); },
  };
  const ed = m.baueEditor(document.querySelector('#w'), ctx);
  ed.zeigeZelle(spalteE(zelle, spalteExtra), 2);
  const oeffne = () => { ed.ed.querySelector('[data-tab="ENVELOPES"]').click(); return ed.ed; };
  return { m, h, ed, rufe, oeffne };
};
const punkte = (n, beats = 8, wert = -6) => Array.from({ length: n }, (_, i) => ({ beat: i * beats / n, wert }));
// one pointer gesture on a lane canvas: the stand-in elements are 100 x 20 big only through getBoundingClientRect; the page uses clientWidth/Height with a fallback
const geste = (canvas, x, y, x2 = x, y2 = y) => {
  const ev = (X, Y) => ({ offsetX: X, offsetY: Y, button: 0, pointerId: 1 });
  canvas.dispatch('pointerdown', ev(x, y));
  if (x2 !== x || y2 !== y) canvas.dispatch('pointermove', ev(x2, y2));
  canvas.dispatch('pointerup', ev(x2, y2));
};

test('E4 ENVELOPES is registered last and fits audio cells only', async () => {
  const { h, ed } = await baue(zelleV());
  assert.deepEqual(ed.ed.querySelectorAll('.ed-tab').map(text), ['CLIP', 'SLICES', 'WARP', 'ENVELOPES']);
  assert.equal(h.huellenTab.passt(zelleV()), true);
  assert.equal(h.huellenTab.passt(zelleV({ art: 'einmal' })), true);
  assert.equal(h.huellenTab.passt(null), false);
  assert.equal(h.huellenTab.passt({ halten: true }), false);
  assert.equal(h.huellenTab.passt({ art: 'strudel' }), false);
});

test('E4 the tab says what an envelope does and offers GAIN FILTER HALL SEND DELAY SEND, no PITCH', async () => {
  const { oeffne } = await baue(zelleV());
  const w = oeffne();
  assert.match(text(w), /CLIP ENVELOPES · LOOP WITH THE CLIP, START WITH EVERY LAUNCH/);
  assert.deepEqual(w.querySelectorAll('.hl-ziel .seg-b').map(text), ['GAIN', 'FILTER', 'HALL SEND', 'DELAY SEND']);
  assert.equal(w.querySelectorAll('.hl-lane').length, 0);
  assert.doesNotMatch(text(w), /PITCH/);
});

test('E4 the picker lists only targets the track has: no HALL SEND without a HALL return, no DELAY SEND without a DLY return', async () => {
  const a = await baue(zelleV(), { rueckgaenge: { hall: false, delay: true } });
  assert.deepEqual(a.oeffne().querySelectorAll('.hl-ziel .seg-b').map(text), ['GAIN', 'FILTER', 'DELAY SEND']);
  const b = await baue(zelleV(), { rueckgaenge: { hall: true, delay: false } });
  assert.deepEqual(b.oeffne().querySelectorAll('.hl-ziel .seg-b').map(text), ['GAIN', 'FILTER', 'HALL SEND']);
  const c = await baue(zelleV(), { rueckgaenge: { hall: false, delay: false } });
  assert.deepEqual(c.oeffne().querySelectorAll('.hl-ziel .seg-b').map(text), ['GAIN', 'FILTER']);
});

test('E4 picking a target adds a lane that starts at the current control value', async () => {
  const { oeffne, rufe } = await baue(zelleV());
  const w = oeffne();
  w.querySelector('.hl-ziel [data-wert="filter"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/huelle', daten: { spur_id: 'a1', zelle: 2, ziel: 'filter', punkte: [{ beat: 0, wert: 0.2 }] } });
  w.querySelector('.hl-ziel [data-wert="send.hall"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1).daten, { spur_id: 'a1', zelle: 2, ziel: 'send.hall', punkte: [{ beat: 0, wert: -12 }] });
  w.querySelector('.hl-ziel [data-wert="gain"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1).daten.punkte, [{ beat: 0, wert: 0 }]);
  w.querySelector('.hl-ziel [data-wert="send.delay"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1).daten.punkte, [{ beat: 0, wert: -200 }]);
});

test('E4 the lanes of the cell are drawn, one per envelope, the picker marks them', async () => {
  const { oeffne } = await baue(zelleV({ huellen: [{ ziel: 'gain', punkte: punkte(2) }, { ziel: 'filter', punkte: punkte(3, 8, 0) }] }));
  const w = oeffne();
  assert.deepEqual(w.querySelectorAll('.hl-lane').map((l) => l.dataset.ziel), ['gain', 'filter']);
  assert.deepEqual(w.querySelectorAll('.hl-lane .hl-etikett').map(text), ['GAIN', 'FILTER']);
  assert.ok(w.querySelector('.hl-ziel [data-wert="gain"]').classList.contains('an'));
  assert.ok(!w.querySelector('.hl-ziel [data-wert="send.hall"]').classList.contains('an'));
});

test('E4 a fifth lane is refused in the page with "A cell holds at most four envelopes."', async () => {
  const vier = [{ ziel: 'gain', punkte: punkte(2) }, { ziel: 'filter', punkte: punkte(2, 8, 0) }, { ziel: 'send.hall', punkte: punkte(2) }, { ziel: 'pitch', punkte: punkte(2, 8, 0) }];
  const { oeffne, rufe } = await baue(zelleV({ huellen: vier }));
  oeffne().querySelector('.hl-ziel [data-wert="send.delay"]').click(); await ruhe();
  assert.equal(rufe.sende.length, 0, 'nothing was sent');
  assert.deepEqual(rufe.meldung, [{ t: 'A cell holds at most four envelopes.', fehler: true }]);
  const { h } = await baue(zelleV());
  assert.equal(h.neueLaneErlaubt(vier, 'send.delay'), false);
  assert.equal(h.neueLaneErlaubt(vier.slice(0, 3), 'send.delay'), true);
  assert.equal(h.neueLaneErlaubt(vier, 'gain'), true, 'an existing target is not a new lane');
});

test('E4 remove sends punkte: null', async () => {
  const { oeffne, rufe } = await baue(zelleV({ huellen: [{ ziel: 'gain', punkte: punkte(2) }, { ziel: 'filter', punkte: punkte(2, 8, 0) }] }));
  oeffne().querySelector('.hl-lane[data-ziel="filter"] .hl-weg').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/huelle', daten: { spur_id: 'a1', zelle: 2, ziel: 'filter', punkte: null } });
});

test('E4 a gesture on a lane posts { ziel, punkte } with the whole point list in cell beats and the target range', async () => {
  const { oeffne, rufe } = await baue(zelleV({ huellen: [{ ziel: 'filter', punkte: [{ beat: 0, wert: -1 }, { beat: 4, wert: 1 }] }] }));
  const c = oeffne().querySelector('.hl-lane[data-ziel="filter"] .hl-canvas');
  geste(c, 240, 14);   // a click in the empty at beat 4 of 8 (480 px wide): at beat 4 there is a point, so click at x = 120 instead
  assert.equal(rufe.sende.length, 0, 'a click onto an existing beat adds nothing');
  geste(c, 120, 14); await ruhe();
  const d = rufe.sende.at(-1);
  assert.equal(d.weg, '/session/huelle'); assert.equal(d.daten.ziel, 'filter');
  assert.deepEqual(d.daten.punkte.map((q) => q.beat), [0, 2, 4]);
  for (const q of d.daten.punkte) assert.ok(q.wert >= -1 && q.wert <= 1, 'inside the filter range');
  assert.deepEqual(d.daten.punkte[0], { beat: 0, wert: -1 }, 'an untouched point keeps its exact value');
  assert.deepEqual(d.daten.punkte[2], { beat: 4, wert: 1 });
});

test('E4 a drawn lane sends at most 64 points (thinned, end points kept)', async () => {
  const lang = Array.from({ length: 64 }, (_, i) => ({ beat: i / 8, wert: -60 + i / 2 }));
  const { oeffne, rufe } = await baue(zelleV({ huellen: [{ ziel: 'gain', punkte: lang }] }));
  const c = oeffne().querySelector('.hl-lane[data-ziel="gain"] .hl-canvas');
  geste(c, 477, 3); await ruhe();   // a click in the empty at about beat 7.95 adds the 65th point
  const p = rufe.sende.at(-1).daten.punkte;
  assert.equal(p.length, 64);
  assert.deepEqual(p[0], lang[0], 'the first point is kept');
  assert.ok(p.at(-1).beat > 7.9 && p.at(-1).beat < 8, 'the last point is kept and stays below the cell length');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].beat >= p[i - 1].beat, 'rising');
});

test('E4 duenneAus keeps the end points, never exceeds the limit and leaves short lists alone', async () => {
  const { h } = await baue(zelleV());
  const p = punkte(200, 8);
  const d = h.duenneAus(p, 64);
  assert.equal(d.length, 64); assert.deepEqual(d[0], p[0]); assert.deepEqual(d.at(-1), p.at(-1));
  assert.deepEqual(h.duenneAus(p.slice(0, 64), 64), p.slice(0, 64));
  assert.deepEqual(h.duenneAus(p.slice(0, 1), 64), p.slice(0, 1));
  assert.equal(new Set(d.map((q) => q.beat)).size, 64, 'no point twice');
});

test('E4 a refused write shows its text', async () => {
  const { oeffne, rufe } = await baue(zelleV(), {}, () => ({ ok: false, text: 'The envelope is out of range.' }));
  oeffne().querySelector('.hl-ziel [data-wert="gain"]').click(); await ruhe();
  assert.deepEqual(rufe.meldung, [{ t: 'The envelope is out of range.', fehler: true }]);
});

test('E4 PRODUCTION lanes are used by import: the tab file names the shared gesture modules', async () => {
  const fs = await import('node:fs');
  const quelle = fs.readFileSync(new URL('../public/session/editor_hulls.js', import.meta.url), 'utf8');
  assert.match(quelle, /from '\.\.\/production\/lanen_bedienung\.js'/);
  assert.match(quelle, /from '\.\.\/production\/lanen\.js'/);
});

// ---------- fix round ----------
test('E4 fix: a GAIN click maps back through the display range -60..0 (t 0.682 = -19.08 dB, the bottom of the row = -60)', async () => {
  const { oeffne, rufe } = await baue(zelleV({ huellen: [{ ziel: 'gain', punkte: [{ beat: 0, wert: -6 }] }] }));
  const c = oeffne().querySelector('.hl-lane[data-ziel="gain"] .hl-canvas');
  geste(c, 240, (3 + (1 - 0.682) * 22)); await ruhe();
  const p = rufe.sende.at(-1).daten.punkte;
  assert.equal(p.length, 2);
  assert.ok(Math.abs(p[1].wert - (-19.08)) < 0.05, `gain stored ${p[1].wert}`);
  geste(c, 360, 28); await ruhe();
  assert.ok(Math.abs(rufe.sende.at(-1).daten.punkte.at(-1).wert - (-60)) < 0.05, 'the bottom of the row is -60 dB');
});

test('E4 fix: a SEND click maps back through -60..0 as well', async () => {
  const { oeffne, rufe } = await baue(zelleV({ huellen: [{ ziel: 'send.hall', punkte: [{ beat: 0, wert: -6 }] }] }));
  const c = oeffne().querySelector('.hl-lane[data-ziel="send.hall"] .hl-canvas');
  geste(c, 240, (3 + (1 - 0.682) * 22)); await ruhe();
  const p = rufe.sende.at(-1).daten.punkte;
  assert.ok(Math.abs(p[1].wert - (-19.08)) < 0.05, `send stored ${p[1].wert}`);
});

test('E4 fix: neuePunkte clamps a point at the right edge before the replace rule, so repeated clicks there stay one point', async () => {
  const { h } = await baue(zelleV());
  const alt = [{ beat: 0, wert: -6 }];
  let p = h.neuePunkte('gain', alt, [{ setze: [{ beat: 8, wert: 0.5 }] }], 8);
  assert.deepEqual(p.map((q) => q.beat), [0, 7.938]);
  p = h.neuePunkte('gain', p, [{ setze: [{ beat: 8, wert: 0.3 }] }], 8);
  p = h.neuePunkte('gain', p, [{ setze: [{ beat: 8, wert: 0.1 }] }], 8);
  assert.deepEqual(p.map((q) => q.beat), [0, 7.938], 'three clicks at the edge are one point');
  assert.equal(new Set(p.map((q) => q.beat)).size, p.length);
});

// EFFECTS: the channel compressor face on the real public/app.js (DOM stand-in, tests/helpers/pages_mock.mjs): the source object (six knobs, fixed knee, key
// options, strip rows, one /regler body per write), the refusal that puts the knob back, the open face on its own channel. The page loads without a cycle error.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const HIER = new URL('..', import.meta.url);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const reglerAufrufe = (ab = 0) => attrappe.anrufe.slice(ab).filter((a) => a.url === '/regler');
let F, G, Z, K;   // effekte_face, effekte_gemeinsam, seite_zustand, face/komp
const antworten = { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'POST /regler': { code: 200, j: {} } };

before(async () => {
  installiere({ html: fs.readFileSync(new URL('public/index.html', HIER), 'utf8'), speicher: {}, antworten });
  await import('../public/app.js');
  await pause(40);
  [F, G, Z, K] = await Promise.all([import('../public/effects_face.js'), import('../public/effects_gemeinsam.js'), import('../public/page_state.js'), import('../public/face/comp.js')]);
  globalThis.window.djkGesendet ??= [];
});

const setzeWerte = (w) => { Z.zustand.regler = { ...w }; };

test('the source: exactly six knobs, knee fixed at 6, the table in real units', () => {
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  assert.deepEqual(Object.keys(q.parameter), ['schwelle', 'ratio', 'attack', 'release', 'makeup', 'mix']);
  assert.deepEqual(q.knie, { fest: 6 });
  assert.equal(q.parameter.schwelle.min, -60); assert.equal(q.parameter.release.max, 1000);
  assert.equal(q.parameter.ratio.log, true); assert.equal(q.parameter.schwelle.log, false);
  assert.equal(q.parameter.schp, undefined, 'no key high-pass knob');
});

test('the key options: a channel does not offer itself', () => {
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  const eigen = G.FX_INDEX['deck/1'] + 1;
  assert.ok(q.schluessel.optionen.length >= 2);
  assert.ok(q.schluessel.optionen.every(([w]) => w === 0 || w !== eigen), 'not itself');
  assert.ok(q.schluessel.optionen.some(([w]) => w === 0), 'off is offered');
  assert.ok(F.kanalQuelleKomp('deck/2', 'BASS').schluessel.optionen.some(([w]) => w === eigen), 'the others still offer DRUMS');
});

test('values come from zustand.regler (the last echo), the default when absent; the curve uses knee 6 and the strip values', () => {
  setzeWerte({ 'deck/1/komp/schwelle': -30, 'deck/1/komp/ratio': 8 });
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  assert.equal(q.get('schwelle'), -30); assert.equal(q.get('ratio'), 8); assert.equal(q.get('attack'), 10);
  const e = K.kompEinstellung({ schwelle: q.get('schwelle'), ratio: q.get('ratio'), knie: q.knie.fest, makeup: q.get('makeup'), mix: q.get('mix') });
  assert.equal(e.knie, 6);
  const kurve = K.kompKurve(e);
  assert.equal(kurve.length, 121);
  assert.ok(Math.abs(kurve.find(([x]) => x === -60)[1] - -60) < 1e-9, 'below the knee the curve is the diagonal');
  assert.ok(Math.abs(kurve.find(([x]) => x === 0)[1] - (-30 + 30 / 8)) < 1e-9, 'above the knee: threshold + (x - threshold) / ratio');
});

test('the gain reduction: null while the compressor is off, the fresh frame while on, 0 when the frame is stale', () => {
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  setzeWerte({ 'deck/1/komp/an': 0 });
  G.kompGr['deck/1'] = { db: 7.5, t: performance.now() };
  assert.equal(q.gr(), null, 'off: the dash');
  setzeWerte({ 'deck/1/komp/an': 1 });
  assert.equal(q.gr(), 7.5);
  G.kompGr['deck/1'] = { db: 7.5, t: performance.now() - 500 };
  assert.equal(q.gr(), 0, 'stale after 400 ms, as the strip');
});

test('a knob move: after the 40 ms coalescing one /regler with the existing body; the key select sends komp/sc at once', async () => {
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  const ab = attrappe.anrufe.length;
  q.set('schwelle', -20); q.set('schwelle', -25); q.set('schwelle', -31);
  assert.deepEqual(reglerAufrufe(ab), [], 'nothing before the 40 ms');
  await pause(120);
  assert.deepEqual(reglerAufrufe(ab).map((a) => a.koerper), [{ pfad: 'deck/1/komp/schwelle', nach: -31, ab: 'jetzt' }]);
  const ab2 = attrappe.anrufe.length;
  q.schluessel.set('3');
  await pause(30);
  assert.deepEqual(reglerAufrufe(ab2).map((a) => a.koerper), [{ pfad: 'deck/1/komp/sc', nach: 3, ab: 'jetzt' }]);
  const ab3 = attrappe.anrufe.length;
  q.an.set(false);
  await pause(30);
  assert.deepEqual(reglerAufrufe(ab3).map((a) => a.koerper), [{ pfad: 'deck/1/komp/an', nach: 0, ab: 'jetzt' }]);
  q.zerstoere();
});

test('no optimistic write: a 200 that is not echoed leaves zustand.regler as it was', async () => {
  setzeWerte({ 'deck/1/komp/schwelle': -18 });
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  q.set('schwelle', -40);
  await pause(120);
  assert.equal(q.get('schwelle'), -18);
  assert.equal(globalThis.window.djkGesendet.at(-1).code, 200);
});

test('the open face: knobs, the key select, the dash; a refusal (409) puts the knob back to the last confirmed value; closing leaves nothing', async () => {
  setzeWerte({ 'deck/1/komp/schwelle': -22, 'deck/1/komp/an': 1, 'deck/1/komp/sc': 0 });
  const f = F.oeffneKanalFace('deck/1', 'DRUMS');
  assert.ok(f, 'the face opened');
  assert.equal(f.el.querySelector('.p-face-ort').textContent, 'DRUMS');
  assert.equal(f.el.querySelectorAll('.fp-knopf').length, 6, 'a knob per parameter, no knee knob');
  assert.match(f.el.textContent, /Knee 6 dB \(fixed\)/);
  assert.equal(f.el.querySelector('.fa-komp-schluessel-wahl').children.length, F.kanalQuelleKomp('deck/1', 'x').schluessel.optionen.length);
  const wert = () => f.el.querySelector('[data-id="c-r1-schwelle"] .fp-wert').textContent;
  assert.equal(wert(), '-22.0 dB');
  antworten['POST /regler'] = { code: 409, j: { fehler: 'busy' } };
  const ab = attrappe.anrufe.length;
  // the plate's own move path: the adapter set of the first knob
  f.el.querySelector('[data-id="c-r1-schwelle"] .fp-knopf').dispatch('keydown', { key: 'ArrowUp' });
  await pause(150);
  assert.equal(reglerAufrufe(ab).length, 1, 'the move was sent once');
  assert.equal(globalThis.window.djkGesendet.at(-1).code, 409);
  assert.equal(wert(), '-22.0 dB', 'back to the last confirmed value');
  antworten['POST /regler'] = { code: 200, j: {} };
  assert.notEqual(attrappe.body.querySelectorAll('.p-face').length, 0);
  f.schliesse();
  assert.equal(attrappe.body.querySelectorAll('.p-face').length, 0);
});

test('a refusal through the source: the face is asked to put the knob back (beiAntwort(true)); a success is not', async () => {
  const q = F.kanalQuelleKomp('deck/2', 'BASS');
  const antwortet = [];
  q.beiAntwort = (abgelehnt) => antwortet.push(abgelehnt);
  antworten['POST /regler'] = { code: 409, j: { fehler: 'busy' } };
  q.set('ratio', 6); await pause(120);
  antworten['POST /regler'] = { code: 200, j: {} };
  q.set('ratio', 7); await pause(120);
  assert.deepEqual(antwortet, [true, false]);
  q.zerstoere();
});

test('the face stays on its own channel when another tab is chosen', async () => {
  setzeWerte({ 'deck/1/komp/an': 1, 'deck/2/komp/an': 1 });
  const f = F.oeffneKanalFace('deck/1', 'DRUMS');
  const A = await import('../public/effects_view.js');
  A.setzeFxGewaehlt('deck/2');
  assert.equal(f.el.querySelector('.p-face-ort').textContent, 'DRUMS');
  assert.equal(f.el.dataset.face, 'face:kanal:deck/1');
  assert.equal(F.oeffneKanalFace('deck/1', 'DRUMS'), null, 'the same channel again closes it');
});

test('a compressor that is off: the face is dimmed and the meter shows the dash', () => {
  setzeWerte({ 'erz/3/komp/an': 0 });
  const f = F.oeffneKanalFace('erz/3', 'MELODY');
  assert.ok(f.el.querySelector('.fa-komp').klassen.has('fa-aus'));
  assert.equal(f.el.querySelector('.p-face-an').textContent, 'OFF');
  f.schliesse();
});

test('T9 the level reading of the channel: null while the compressor is off, the fresh report while on, null when stale (500 ms)', () => {
  const q = F.kanalQuelleKomp('deck/1', 'DRUMS');
  setzeWerte({ 'deck/1/komp/an': 0 });
  G.kompPegel['deck/1'] = { ein: -12, aus: -15.2, t: performance.now() };
  assert.equal(q.pegel(), null, 'off: nothing');
  setzeWerte({ 'deck/1/komp/an': 1 });
  assert.deepEqual(q.pegel(), { ein: -12, aus: -15.2 });
  G.kompPegel['deck/1'] = { ein: -12, aus: -15.2, t: performance.now() - 600 };
  assert.equal(q.pegel(), null, 'stale after 500 ms');
  delete G.kompPegel['deck/1'];
  assert.equal(q.pegel(), null, 'never reported');
  assert.equal(F.kanalQuelleKomp('deck/2', 'BASS').pegel(), null, 'another channel has its own store');
});

test('T9 the open channel face shows the bars and the NOW dot from the store and a dash without a fresh report', () => {
  setzeWerte({ 'deck/1/komp/an': 1, 'deck/1/komp/schwelle': -30, 'deck/1/komp/ratio': 8 });
  G.kompPegel['deck/1'] = { ein: -12, aus: -26, t: performance.now() };
  const f = F.oeffneKanalFace('deck/1', 'DRUMS');
  const texte = () => [...f.el.querySelectorAll('.fa-meter-text')].map((e) => e.textContent);
  assert.deepEqual(texte().slice(0, 2), ['-12.0 dB', '-26.0 dB']);
  assert.equal(f.el.querySelector('.fa-jetzt').getAttribute('visibility'), 'visible');
  G.kompPegel['deck/1'] = { ein: -12, aus: -26, t: performance.now() - 600 };
  f.aktualisiere();
  assert.deepEqual(texte().slice(0, 2), ['–', '–']);
  assert.equal(f.el.querySelector('.fa-jetzt').getAttribute('visibility'), 'hidden');
  f.schliesse();
  delete G.kompPegel['deck/1'];
});

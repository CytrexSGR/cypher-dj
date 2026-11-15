// PRODUCTION: the EQ face of an insert stage, in a real page (headless Chrome against the project stub, as production_face_comp.test.mjs). The pure maths is in
// face_eq.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// four audio tracks, an EQ on the first; `werte`: [[param, value]] of insert i1
function projekt(werte = []) {
  let p = neuesProjekt('EQ page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq' }]);
  for (const [param, wert] of werte) p = lauf(p, [{ befehl: 'insert_param_setzen', insert_id: 'i1', param, wert }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
const BAENDER = [['b1/an', 1], ['b1/typ', 3], ['b1/freq', 60], ['b1/steil', 1], ['b2/an', 1], ['b2/typ', 0], ['b2/freq', 500], ['b2/gain', 6], ['b2/q', 1],
  ['b3/an', 0], ['b3/typ', 0], ['b3/freq', 3000], ['b4/an', 1], ['b4/typ', 2], ['b4/freq', 9000], ['b4/gain', -5], ['b5/an', 1], ['b5/typ', 0], ['b5/freq', 2000], ['b5/gain', 9], ['b5/platz', 2]];
async function seite(t, p, opt = { hoehe: 1080 }) {
  const s = await starteSeite(opt);
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const FACE = '.p-face';
const griff = (m) => `${FACE} .fa-griff[data-band="${m}"]`;
const aend = (s) => fetch(`${s.url}attrappe/aenderungen`).then((r) => r.json());
const oeffneKlick = (s) => s.w(`document.querySelector('.p-stufe[data-insert="i1"] .p-ins-face').click()`);
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const werteVon = async (s) => (await s.projekt()).spuren[0].inserts[0].werte;
// the plot as the page draws it: user units per pixel and the axes of baueAnzeige(720 x 320, rand 30): 678 units for 10 Hz to 22 kHz, 280 units for +30 to -30 dB
const geometrie = (s) => s.w(`(() => { const r = document.querySelector('.p-face .fa-anzeige').getBoundingClientRect(); return { skala: 720 / r.width }; })()`);
const freqNach = (f0, dx, skala) => f0 * 10 ** (((dx * skala) / 678) * Math.log10(22000 / 10));
const gainNach = (g0, dy, skala) => g0 - ((dy * skala) / 280) * 60;

test('face opens from the EQ row (a real click) and lies inside the window without inner scroll: 1280x1080, then 1280x900 and 1920x1080 by element.click()', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  assert.equal(await s.w(`document.querySelectorAll('${FACE}').length`), 0, 'closed by default');
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-face');
  assert.equal(await s.w(`document.querySelectorAll('${FACE}').length`), 1);
  const m = await lage(s);
  assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, JSON.stringify(m));
  assert.ok(m.sh <= m.ch + 1, `no inner scroll: ${m.sh} > ${m.ch}`);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'EQ');
  assert.equal(await s.w(`document.querySelectorAll('.p-face .fa-griff').length`), 8, 'a handle per band');
  assert.match(await s.w(`document.querySelector('.p-face .fa-eq-hinweis').textContent`), /TARGET RESPONSE \(the filter follows it within 0\.5 dB\)/);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Frequency', 'Gain', 'Q', 'Band 1 on', 'Type', 'Slope dB/oct', 'Placement', 'Output', 'Prop. Q']);
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-b1_freq"] .fp-wert').textContent`), '60.0 Hz', 'the plate shows band 1');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-eq-seite').classList.contains('fa-eq-leer')`), false, 'band 5 is on Side: the second curve is drawn');
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s2 = await seite(t, projekt(BAENDER), { breite: b, hoehe: h });
    await oeffneKlick(s2);
    const mm = await lage(s2);
    assert.ok(mm.l >= 0 && mm.t >= 0 && mm.r <= mm.iw && mm.b <= mm.ih, `${b}x${h}: ${JSON.stringify(mm)}`);
    assert.ok(mm.sh <= mm.ch + 1, `${b}x${h}: no inner scroll`);
    assert.ok(mm.b - mm.t <= 620 && mm.r - mm.l <= 760, `${b}x${h}: at most 760x620 (D11): ${mm.r - mm.l}x${mm.b - mm.t}`);
  }
});

test('the second curve is drawn only when a band sits on Mid or Side', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER.filter(([n]) => n !== 'b5/platz')));
  await oeffneKlick(s);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-eq-seite').classList.contains('fa-eq-leer')`), true);
});

test('dragging handle 2 with real pointer events: frequency and gain follow the geometry, the INSERTS rows show the same numbers, one undo reverts both', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');   // the row's popover
  await oeffneKlick(s);
  const { skala } = await geometrie(s);
  const kurve0 = await s.w(`document.querySelector('.p-face .fa-eq-kurve').getAttribute('d')`);
  await s.b.ziehe(griff(2), 50, -30, 1);   // one move: one write
  const f1 = freqNach(500, 50, skala), g1 = gainNach(6, -30, skala);
  assert.ok(await s.bis(async () => { const w = await werteVon(s); return Math.abs(w['b2/freq'] - f1) / f1 < 0.02 && Math.abs(w['b2/gain'] - g1) < 0.2; }), `project: ${JSON.stringify(await werteVon(s))} expected ${f1} Hz, ${g1} dB`);
  const w = await werteVon(s);
  assert.notEqual(await s.w(`document.querySelector('.p-face .fa-eq-kurve').getAttribute('d')`), kurve0, 'the curve moved');
  const text = await s.w(`(async () => { const { wertText } = await import('/production/inserts.js'); return [wertText('eq', 'b2/freq', ${w['b2/freq']}), wertText('eq', 'b2/gain', ${w['b2/gain']})]; })()`);
  for (const [i, n] of ['b2/freq', 'b2/gain'].entries()) {
    assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="${n}"]').textContent`)) === text[i]), `the ${n} row shows ${text[i]}`);
  }
  const batch = (await aend(s)).at(-1);
  assert.deepEqual(batch.befehle, ['insert_param_setzen', 'insert_param_setzen'], 'one batch of the same commands as the rows');
  const verlauf = await (await fetch(`${s.url}proj/verlauf`)).json();
  assert.equal(verlauf.at(-1).label, 'Band 2 EQ on Kick');
  // one undo reverts both values
  await s.w(`document.querySelector('[data-p="undo"]').click()`);
  assert.ok(await s.bis(async () => { const v = await werteVon(s); return v['b2/freq'] === 500 && v['b2/gain'] === 6; }), `undo gives both back: ${JSON.stringify(await werteVon(s))}`);
});

test('a drag with many moves: the handle ends where the hand let go, the project has the same value, and the face shows it', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  await oeffneKlick(s);
  const { skala } = await geometrie(s);
  await s.b.ziehe(griff(4), -80, 25, 12);
  const f1 = freqNach(9000, -80, skala), g1 = gainNach(-5, 25, skala);
  assert.ok(await s.bis(async () => { const w = await werteVon(s); return Math.abs(w['b4/freq'] - f1) / f1 < 0.02 && Math.abs(w['b4/gain'] - g1) < 0.2; }), `project: ${JSON.stringify(await werteVon(s))}`);
  await warte(1000);   // past the local hold: what the face shows now is the project's value
  const w = await werteVon(s);
  const text = await s.w(`(async () => { const { wertText } = await import('/production/inserts.js'); return wertText('eq', 'b4/freq', ${w['b4/freq']}); })()`);
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-b4_freq"] .fp-wert')?.textContent ?? null`), text, 'band 4 is the selected band after the drag and its knob shows the project value');
  assert.ok(Math.abs(w['b4/gain'] - g1) < 0.2);
});

test('a hollow handle drag turns the band on', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  await oeffneKlick(s);
  assert.equal((await werteVon(s))['b3/an'], 0);
  await s.b.ziehe(griff(3), 40, -20, 4);
  assert.ok(await s.bis(async () => (await werteVon(s))['b3/an'] === 1), `band 3 is on: ${JSON.stringify(await aend(s))} ${JSON.stringify(await werteVon(s))}`);
  assert.ok((await werteVon(s))['b3/freq'] > 3000);
  assert.equal(await s.w(`document.querySelector('${griff(3)}').classList.contains('aus')`), false, 'the ring is filled now');
});

test('failure case: the project refuses the write (HTTP 409): the handle goes back to the last confirmed value', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  await oeffneKlick(s);
  const pos0 = await s.w(`(() => { const c = document.querySelector('${griff(2)}'); return [c.getAttribute('cx'), c.getAttribute('cy')]; })()`);
  await s.post('/attrappe/rohantwort', { weg: '/proj/aendern', code: 409, koerper: { fehler: 'beschaeftigt', text: 'refused for the test' } });   // the next write is refused, once
  await s.b.ziehe(griff(2), 60, -40, 1);
  assert.ok(await s.bis(async () => (await s.w(`(() => { const c = document.querySelector('${griff(2)}'); return [c.getAttribute('cx'), c.getAttribute('cy')]; })()`)).join() === pos0.join()), 'the handle is back at its place');
  const w = await werteVon(s);
  assert.equal(w['b2/freq'], 500); assert.equal(w['b2/gain'], 6);
  assert.equal((await aend(s)).length, 0, 'nothing was accepted');
});

test('failure case: the EQ stage is removed while a drag is running: the face closes and the stub receives nothing further', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  await oeffneKlick(s);
  const m = await s.b.mitte(griff(2));
  await s.b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
  await s.b.maus('mousePressed', m.x, m.y);
  await s.b.maus('mouseMoved', m.x + 20, m.y - 10);
  assert.ok(await s.bis(async () => (await aend(s)).length >= 1), 'the drag wrote');
  await s.w(`document.querySelector('.p-stufe[data-insert="i1"] .p-ins-weg').click()`);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelectorAll('${FACE}').length`)) === 0, 500), 'the face is gone');
  const n = (await aend(s)).length;
  await s.b.maus('mouseMoved', m.x + 60, m.y - 30);
  await s.b.maus('mouseReleased', m.x + 60, m.y - 30);
  await warte(300);
  assert.equal((await aend(s)).length, n, 'nothing after the removal');
  const alle = await aend(s), weg = alle.findIndex((x) => x.befehle[0] === 'insert_entfernen');
  assert.ok(weg >= 0 && !alle.slice(weg + 1).some((x) => x.befehle[0] === 'insert_param_setzen'));
});

test('a project with b3/freq 30000 (out of range) and junk values draws without NaN, the handle lies inside the plot', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const p = projekt(BAENDER);
  Object.assign(p.spuren[0].inserts[0].werte, { 'b3/an': 1, 'b3/freq': 30000, 'b3/gain': 99, 'b6/an': 1, 'b6/typ': 5, 'b6/freq': 1000, 'b6/q': 0 });
  const s = await seite(t, p);
  await oeffneKlick(s);
  const d = await s.w(`[...document.querySelectorAll('.p-face path')].map((e) => e.getAttribute('d')).join(' ')`);
  assert.ok(d.length > 200 && !/NaN|Infinity/.test(d));
  const c = await s.w(`(() => { const c = document.querySelector('${griff(3)}'); const v = document.querySelector('.p-face .fa-anzeige').viewBox.baseVal; return { x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), w: v.width, h: v.height }; })()`);
  assert.ok(c.x > 0 && c.x < c.w && c.y > 0 && c.y < c.h, JSON.stringify(c));
});

test('a rack macro on b2/freq: the handle moves in gain only, the macro frequency is not written', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  let p = projekt(BAENDER);
  p = lauf(p, [{ befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'b2/freq', von: 200, bis: 2000 }] }, { ziel: [] }, { ziel: [] }, { ziel: [] }] }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  const s = await seite(t, JSON.parse(JSON.stringify(p)));
  await oeffneKlick(s);
  const vorher = (await aend(s)).length;
  await s.b.ziehe(griff(2), 60, -40, 4);
  assert.ok(await s.bis(async () => (await aend(s)).length > vorher), 'gain was written');
  const nach = await aend(s);
  assert.ok(nach.slice(vorher).every((x) => x.befehle.length === 1), 'only the gain command per move');
  assert.equal((await werteVon(s))['b2/freq'], 500, 'the stored frequency is untouched');
});

test('window smaller than the face (600x480): the face scrolls inside itself, is at most as wide as the window and its close button stays reachable', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER), { breite: 600, hoehe: 480 });
  await oeffneKlick(s);
  const m = await lage(s);
  assert.ok(m.sh > m.ch, `scrolls inside: ${m.sh} vs ${m.ch}`);
  assert.ok(m.r - m.l <= 600 && m.l >= 0 && m.t >= 0 && m.b <= 480, JSON.stringify(m));
  await s.w(`document.querySelector('.p-face').scrollTop = 9999`);
  const zu = await s.w(`(() => { const r = document.querySelector('.p-face .p-face-zu').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
  assert.ok(zu.l >= 0 && zu.t >= 0 && zu.r <= 600 && zu.b <= 480, JSON.stringify(zu));
  assert.equal(await s.w(`document.documentElement.scrollWidth <= innerWidth`), true);
});

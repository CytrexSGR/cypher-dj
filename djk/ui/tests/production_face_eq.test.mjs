// PRODUCTION: the EQ face of an insert stage, in a real page (headless Chrome against the project stub, as production_face_comp.test.mjs). The pure maths is in
// face_eq.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';
import { eqDynDelta, eqDynText, eqSummeDb, eqBandWerte } from '../public/face/eq.js';
import { eqTitel, parameterVon, EQ_DYN_PARAMETER, EQ_DYN_KOPF } from '../public/production/inserts.js';
import { INSERT_ARTEN } from '../project/insert_key.ts';

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
const oeffneKlick = (s, id = 'i1') => s.w(`document.querySelector('[data-w="karte-teil"][data-teil="${id}"]').click()`);
const entferne = async (s, id = 'i1') => {   // the chip menu entry Remove (the event stops at the chip: the card's own menu handler would replace the chip menu, a dock quirk outside this test)
  await s.w(`(() => { const c = document.querySelector('[data-w="karte-teil"][data-teil="${id}"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); })()`);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.trim() === 'Remove').click()`);
};
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const werteVon = async (s) => (await s.projekt()).spuren[0].inserts[0].werte;
// the plot as the page draws it: user units per pixel and the axes of baueAnzeige(720 x 320, rand 30): 678 units for 10 Hz to 22 kHz, 280 units for +30 to -30 dB
const geometrie = (s) => s.w(`(() => { const r = document.querySelector('.p-face .fa-anzeige').getBoundingClientRect(); return { skala: 720 / r.width }; })()`);
const freqNach = (f0, dx, skala) => f0 * 10 ** (((dx * skala) / 678) * Math.log10(22000 / 10));
const gainNach = (g0, dy, skala) => g0 - ((dy * skala) / 280) * 60;

test('face opens from the EQ chip (a real click) and lies inside the window without inner scroll: 1280x1080, then 1280x900 and 1920x1080 by element.click()', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
  assert.equal(await s.w(`document.querySelectorAll('${FACE}').length`), 0, 'closed by default');
  await s.b.klick('[data-w="karte-teil"][data-teil="i1"]');
  assert.equal(await s.w(`document.querySelectorAll('${FACE}').length`), 1);
  const m = await lage(s);
  assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, JSON.stringify(m));
  assert.ok(m.sh <= m.ch + 1, `no inner scroll: ${m.sh} > ${m.ch}`);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'EQ');
  assert.equal(await s.w(`document.querySelectorAll('.p-face .fa-griff').length`), 8, 'a handle per band');
  assert.match(await s.w(`document.querySelector('.p-face .fa-eq-hinweis').textContent`), /TARGET RESPONSE \(the filter follows it within 0\.5 dB\)/);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Frequency', 'Gain', 'Q', 'Band 1 on', 'Type', 'Slope dB/oct', 'Placement', 'Output', 'Prop. Q', 'Mode', 'Threshold', 'Range', 'Attack', 'Release']);
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

test('dragging handle 2 with real pointer events: frequency and gain follow the geometry, one undo reverts both', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(BAENDER));
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
  await entferne(s);
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

// ---- strand 5 slice 2: EQ Pro, the dynamic row, the header readout, the moving curve ----------------------------------------------------------------
test('EQ Pro: the page lists of the dynamic rows equal the generated contract rows', () => {
  const eq = Object.fromEntries(INSERT_ARTEN.eq.parameter.map((q) => [q.name, q]));
  for (let m = 1; m <= 8; m++) for (const q of EQ_DYN_PARAMETER) {
    const v = eq[`d${m}/${q.name}`], l = parameterVon('eq', `d${m}/${q.name}`);
    assert.deepEqual([l.min, l.max, l.vorgabe, l.einheit], [v.min, v.max, v.vorgabe, v.einheit], `d${m}/${q.name}`);
  }
  for (const q of EQ_DYN_KOPF) assert.deepEqual([q.min, q.max, q.vorgabe, q.einheit], [eq[q.name].min, eq[q.name].max, eq[q.name].vorgabe, eq[q.name].einheit], q.name);
  assert.equal(eqTitel({ 'd2/dyn': 2 }), 'Cypher EQ Pro'); assert.equal(eqTitel({}), 'Cypher EQ');
});

test('EQ Pro: the moving curve follows the stage reading; a cut range follows a cut only, a boost range a boost only', () => {
  assert.equal(eqDynDelta(5, -8), -5); assert.equal(eqDynDelta(12, -8), -8, 'limited by the range'); assert.equal(eqDynDelta(-4, 6), 4); assert.equal(eqDynDelta(5, 6), 0); assert.equal(eqDynDelta(null, -8), 0);
  assert.equal(eqDynText(3.24), 'dyn -3.2 dB'); assert.equal(eqDynText(-2), 'dyn 2.0 dB'); assert.equal(eqDynText(null), 'dyn -');
  const w = { 'b3/an': 1, 'b3/typ': 0, 'b3/freq': 1000, 'b3/gain': 0, 'b3/q': 1, 'd3/dyn': 1, 'd3/schwelle': -24, 'd3/bereich': -12 };
  assert.ok(Math.abs(eqSummeDb(w, 1000)) < 1e-9, 'static curve: flat');
  assert.ok(Math.abs(eqSummeDb(w, 1000, 'mitte', 6) + 6) < 1e-6, 'moving curve at a reading of 6 dB: -6 dB at the centre');
  assert.equal(eqSummeDb({ ...w, 'd3/dyn': 0 }, 1000, 'mitte', 6), 0, 'a band without dynamics does not move');
  assert.equal(eqSummeDb({ ...w, 'b3/typ': 5 }, 1000, 'mitte', 6) < -6, true, 'a notch is static (its own depth), the reading does not touch it');
  assert.equal(eqBandWerte(w, 3).dyn, 1);
});

test('EQ Pro face: the DYNAMIC row shows for Bell and shelves only, the mode writes d<m>/dyn, the title turns into Cypher EQ Pro, Attack and Release sit with the dynamic row', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt([...BAENDER, ['b3/an', 1], ['b3/typ', 0], ['b3/gain', -3]]));
  await oeffneKlick(s);
  const sichtbar = () => s.w(`(() => { const e = document.querySelector('.p-face .fa-eq-dyn'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; })()`);
  const tab = (m) => s.w(`document.querySelectorAll('.p-face .fa-eq-tab')[${m - 1}].click()`);
  assert.equal(await sichtbar(), false, 'band 1 is a Low cut: no dynamic row');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-eq-titel').textContent`), 'Cypher EQ');
  await tab(3);
  assert.equal(await sichtbar(), true, 'band 3 is a Bell');
  await tab(4);
  assert.equal(await sichtbar(), true, 'band 4 is a High shelf');
  await tab(3);
  const modus = (k) => s.w(`[...document.querySelectorAll('.p-face .fa-eq-dyn .fp-option')][${k}].click()`);
  await modus(1);   // Above
  assert.ok(await s.bis(async () => (await werteVon(s))['d3/dyn'] === 1), `project: ${JSON.stringify(await werteVon(s))}`);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-face .fa-eq-titel').textContent`)) === 'Cypher EQ Pro'));
  assert.equal(await s.w(`document.querySelector('.p-face .fa-eq-dyn-notiz').hidden`), true, 'no key note for Above');
  await modus(3);   // Above (key)
  assert.ok(await s.bis(async () => (await werteVon(s))['d3/dyn'] === 3));
  assert.equal(await s.w(`document.querySelector('.p-face .fa-eq-dyn-notiz').hidden`), false);
  assert.match(await s.w(`document.querySelector('.p-face .fa-eq-dyn-notiz').textContent`), /until a key is chosen/);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-eq-dyn-gr').textContent`), 'dyn -', 'no fresh reading yet');
  const namen = await s.w(`[...document.querySelectorAll('.p-face .fa-eq-stufe .fp-name')].map((e) => e.textContent)`);
  assert.deepEqual(namen, ['Output', 'Prop. Q']);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fa-eq-dyn .fp-name')].map((e) => e.textContent)`), ['Mode', 'Threshold', 'Range', 'Attack', 'Release'], 'Attack and Release of the stage sit with the dynamic row');
  await tab(5);   // band 5 is a Bell on Side
  assert.equal(await sichtbar(), true);
  assert.equal(await s.w(`(() => { const f = document.querySelector('.p-face'); return f.scrollHeight <= f.clientHeight + 1; })()`), true, 'still no inner scroll');
});

test('De-esser entry: one insert_setzen with band 6 as a dynamic High shelf; the page command reaches the project with the contract values', async () => {
  const { deesserBefehl, DEESSER_WERTE } = await import('../public/dock/plus.js');
  let p = neuesProjekt('De-esser');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Vox' }]);
  const b = deesserBefehl(JSON.parse(JSON.stringify(p)), 's1');
  assert.deepEqual(b, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', werte: DEESSER_WERTE });
  const w = lauf(p, [b]).spuren[0].inserts[0].werte;
  assert.deepEqual([w['b6/an'], w['b6/typ'], w['b6/freq'], w['b6/q'], w['d6/dyn'], w['d6/schwelle'], w['d6/bereich'], w['dyn_attack'], w['dyn_release']], [1, 2, 6000, 0.707, 1, -30, -8, 1, 60]);
  assert.equal(w['b1/an'], 0, 'the other bands stay off'); assert.equal(w['d1/dyn'], 0);
  assert.equal(eqTitel(w), 'Cypher EQ Pro');
});

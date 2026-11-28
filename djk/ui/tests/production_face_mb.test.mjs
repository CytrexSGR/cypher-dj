// PRODUCTION: the multiband face of an insert stage, in a real page (headless Chrome against the project stub, as production_face_limiter.test.mjs), plus the pure
// helpers of face/multiband.js. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';
import { mbGrenzeKlemmen, mbKurve, mbEinstellung, mbParameterListe, mbParameterTabelle, MB_MIN_ABSTAND } from '../public/face/multiband.js';
import { MB_BAND_PARAMETER, MB_UP_PARAMETER, MB_KOPF_PARAMETER, parameterNamen } from '../public/production/inserts.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// four audio tracks, one multiband on Kick (stage i1); `werte`: [[insert, param, value]]
function projekt(werte = [], an = true) {
  let p = neuesProjekt('Face page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'mb' }]);
  for (const [insert_id, param, wert] of werte) p = lauf(p, [{ befehl: 'insert_param_setzen', insert_id, param, wert }]);
  if (!an) p = lauf(p, [{ befehl: 'insert_an', insert_id: 'i1', an: false }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
async function seite(t, p, opt = { hoehe: 1080 }) {
  const s = await starteSeite(opt);
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const FACE = '.p-face';
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const aend = (s) => fetch(`${s.url}attrappe/aenderungen`).then((r) => r.json());
const oeffneKlick = (s, id = 'i1') => s.w(`document.querySelector('[data-w="karte-teil"][data-teil="${id}"]').click()`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
// one pointer gesture on the handle `i` (0 = low crossover, 1 = high): down, the moves (pixel offsets from the handle), up
const ziehe = (s, i, bewegungen) => s.w(`(() => {
  const h = document.querySelectorAll('.p-face .fa-mb-griff')[${i}], r = h.getBoundingClientRect(), x0 = r.left + r.width / 2, y = r.top + r.height / 2;
  const ev = (typ, x) => h.dispatchEvent(new PointerEvent(typ, { pointerId: 7, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  ev('pointerdown', x0); for (const dx of ${JSON.stringify(bewegungen)}) ev('pointermove', x0 + dx); ev('pointerup', x0 + ${JSON.stringify(bewegungen.at(-1) ?? 0)});
})()`);

// ---- pure
test('mbGrenzeKlemmen keeps a crossover inside its range and a third of an octave from the other one', () => {
  assert.equal(mbGrenzeKlemmen('grenze_tief', 5000, 2000), Math.round(2000 / MB_MIN_ABSTAND), 'past the high one: stops at the minimum distance');
  assert.equal(mbGrenzeKlemmen('grenze_hoch', 100, 200), Math.round(200 * MB_MIN_ABSTAND), 'below the low one: stops at the minimum distance');
  assert.equal(mbGrenzeKlemmen('grenze_tief', 1, 2000), 20, 'range minimum');
  assert.equal(mbGrenzeKlemmen('grenze_hoch', 1e6, 200), 20000, 'range maximum');
  assert.equal(mbGrenzeKlemmen('grenze_tief', 350.4, 2000), 350, 'whole Hz from 100 Hz up');
  assert.equal(mbGrenzeKlemmen('grenze_tief', 33.37, 2000), 33.4, 'a tenth of a Hz below 100 Hz');
  assert.equal(mbGrenzeKlemmen('grenze_tief', NaN, 2000), 200, 'NaN gives the default');
});

test('mbKurve and mbEinstellung: defaults, clamping, the threshold line steps at the crossovers', () => {
  const e = mbEinstellung({});
  assert.equal(e.grenze_tief, 200); assert.equal(e.grenze_hoch, 2000); assert.equal(e['b2/ratio'], 1);
  assert.deepEqual(mbKurve({ grenze_tief: 300, grenze_hoch: 3000, 'b1/schwelle': -10, 'b2/schwelle': -20, 'b3/schwelle': -30 }), [[20, -10], [300, -10], [300, -20], [3000, -20], [3000, -30], [20000, -30]]);
  assert.equal(mbEinstellung({ grenze_tief: 5000, grenze_hoch: 5000 }).grenze_tief, 5000 / MB_MIN_ABSTAND, 'crossed values: the low one yields');
  assert.equal(mbEinstellung({ 'b1/schwelle': 'x', 'b3/makeup': 99 })['b3/makeup'], 24);
});

test('the parameter list is the contract-bound list of inserts.js, flat; the upward rows are in, the key row is the KEY button not a knob', () => {
  const namen = mbParameterListe().map((q) => q.name);
  assert.deepEqual(namen, parameterNamen('mb'), 'same names in the same order as the INSERTS popover');
  assert.ok(namen.includes('u2/ratio') && namen.includes('u3/bereich'), 'the upward rows');
  assert.ok(!namen.includes('sc'), 'the key is a stage field, no knob');
  assert.equal(Object.keys(mbParameterTabelle()).length, MB_KOPF_PARAMETER.length + 3 * MB_BAND_PARAMETER.length + 3 * MB_UP_PARAMETER.length);
  assert.equal(mbParameterListe().find((q) => q.name === 'b1/schwelle').label, 'Low band Threshold');
});

// ---- page
test('multiband face opens from the stage chip, lies inside the window, has the strip with two handles, three columns with six knobs and a bypass each, and writes nothing on open', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s = await seite(t, projekt([['i1', 'b2/schwelle', -24]]), { breite: b, hoehe: h });
    assert.equal(await zaehle(s, FACE), 0, 'closed by default');
    const vorher = (await aend(s)).length;
    await oeffneKlick(s);
    assert.equal(await zaehle(s, FACE), 1);
    const m = await s.w(`(() => { const f = document.querySelector('.p-face'), r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
    assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, `${b}x${h}: ${JSON.stringify(m)}`);
    assert.ok(m.sh <= m.ch + 1, `${b}x${h}: no inner scroll ${JSON.stringify(m)}`);
    assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'MULTIBAND');
    assert.equal(await zaehle(s, `${FACE} .fa-mb-griff`), 2);
    assert.equal(await zaehle(s, `${FACE} .fa-mb-band`), 3);
    assert.equal(await zaehle(s, `${FACE} .fa-mb-gr .fa-meter`), 6, 'a reduction bar and a lift bar per band');
    for (const band of [1, 2, 3]) {
      assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fa-mb-band[data-band="${band}"] .fp-name')].map((e) => e.textContent)`),
        ['Threshold', 'Ratio', 'Attack', 'Release', 'Knee', 'Makeup', 'Bypass', 'Threshold', 'Ratio', 'Range'], `band ${band}`);
    }
    assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-b2-b2_schwelle"] .fp-wert').textContent`), '-24.0 dB');
    assert.equal(await zaehle(s, `${FACE} [data-id*="-u1_"]`), 3, 'the upward controls of band 1');
    assert.equal(await s.w(`[...document.querySelectorAll('.p-face .p-face-knopf')].some((e) => e.textContent === 'KEY')`), true, 'the key menu button');
    assert.equal((await aend(s)).length, vorher, 'opening writes nothing');
  }
});

test('dragging a crossover handle writes grenze_tief once per gesture (one change, label "Low / Mid crossover multiband on Kick"); past the high crossover it stops a third of an octave below it', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  const vorher = (await aend(s)).length;
  await ziehe(s, 0, [30, 30]);   // two moves to the same place: one write
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.grenze_tief > 250), 'moved up in the project');
  const v1 = (await s.projekt()).spuren[0].inserts[0].werte.grenze_tief;
  const a1 = (await aend(s)).slice(vorher);
  assert.equal(a1.length, 1, 'one write for the gesture');
  assert.deepEqual(a1[0].befehle, ['insert_param_setzen']);
  assert.equal((await fetch(`${s.url}proj/verlauf`).then((r) => r.json())).at(-1).label, 'Low / Mid crossover multiband on Kick');
  await ziehe(s, 0, [3000]);   // far past the high crossover (2000 Hz)
  const grenze = Math.round(2000 / MB_MIN_ABSTAND);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.grenze_tief === grenze), `stops at ${grenze}, was ${v1}`);
  assert.equal((await s.projekt()).spuren[0].inserts[0].werte.grenze_hoch, 2000, 'the high crossover was not touched');
});

test('without per-band readings all three bars show the stage value dimmed with the tooltip "deepest band"; a bypassed band dims its column', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt([['i1', 'b3/umgehen', 1]]), { breite: 1280, hoehe: 900 });
  await oeffneKlick(s);
  const texte = () => s.w(`[...document.querySelectorAll('.p-face .fa-mb-gr .fa-meter:first-child .fa-meter-text')].map((e) => e.textContent)`);
  assert.deepEqual(await texte(), ['–', '–', '–'], 'no reading yet');
  const sende = () => s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal: 'ins/mb/1', gr_db: 4.0 } }).catch(() => {});
  sende();
  const h = setInterval(sende, 100); h.unref();
  t.after(() => clearInterval(h));
  assert.ok(await s.bis(async () => (await texte()).every((x) => x === '4.0 dB')), JSON.stringify(await texte()));
  assert.equal(await zaehle(s, `${FACE} .fa-mb-gr-stufe[title="deepest band"]`), 3);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-mb-band[data-band="3"]').classList.contains('fa-aus-band')`), true, 'band 3 bypassed');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-mb-band[data-band="1"]').classList.contains('fa-aus-band')`), false);
  clearInterval(h);
  assert.ok(await s.bis(async () => (await texte()).every((x) => x === '–'), 1500), 'a dash 500 ms after the last message');
});

test('signed per-band readings: a positive value fills the reduction bar, a negative one the lift bar of that band', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(), { breite: 1280, hoehe: 900 });
  await oeffneKlick(s);
  const sende = () => Promise.all([['ins/mb/1', 3], ['ins/mb/1/b1', 3.5], ['ins/mb/1/b2', 0], ['ins/mb/1/b3', -6]].map(([kanal, gr_db]) => s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal, gr_db } }).catch(() => {})));
  sende();
  const h = setInterval(sende, 100); h.unref();
  t.after(() => clearInterval(h));
  const texte = (wo) => s.w(`[...document.querySelectorAll('.p-face .fa-mb-gr .fa-meter:${wo}-child .fa-meter-text')].map((e) => e.textContent)`);
  assert.ok(await s.bis(async () => (await texte('last')).join() === '–,–,6.0 dB'), JSON.stringify(await texte('last')));
  assert.deepEqual(await texte('first'), ['3.5 dB', '0.0 dB', '0.0 dB'], 'reduction bars: band 3 has no reduction, a lift instead');
});

test('a stage at an=0 dims the face and shows no reading even when one arrives', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt([], false), { breite: 1280, hoehe: 900 });
  await oeffneKlick(s);
  const h = setInterval(() => s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal: 'ins/mb/1', gr_db: 4.0 } }).catch(() => {}), 100); h.unref();
  t.after(() => clearInterval(h));
  await warte(400);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-mb').classList.contains('fa-aus')`), true);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fa-mb-gr .fa-meter:first-child .fa-meter-text')].map((e) => e.textContent)`), ['–', '–', '–']);
});

test('failure case: the stage is removed under the open face: the face closes and no insert_param_setzen follows', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  await s.w(`(() => { const c = document.querySelector('[data-w="karte-teil"][data-teil="i1"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); })()`);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.trim() === 'Remove').click()`);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0, 500), 'the face is gone');
  const n = (await aend(s)).length;
  await warte(300);
  assert.equal((await aend(s)).length, n, 'nothing after the removal');
});

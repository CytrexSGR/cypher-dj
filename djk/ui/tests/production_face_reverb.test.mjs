// PRODUCTION: the Hall face of a return, in a real page (headless Chrome against the project stub, as production_face_comp.test.mjs). The pure maths is in
// face_reverb.test.mjs, the frame in face_frame.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// two audio tracks and a Hall return named Room with the given Hall norms
function projekt(hall = {}) {
  let p = neuesProjekt('Hall face page');
  p = lauf(p, ['Kick', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'return_neu', name: 'Room', hall }]);
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
const oeffneKlick = (s) => s.w(`document.querySelector('.p-returnkopf[data-ret="r1"] .p-hall-face').click()`);
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const HALL = { pre: 0.5, decay: 0.3, groesse: 0.6, tief: 0.8, highcut: 0.5, fahne: 0.75 };

test('the FACE button of the return opens the Hall face, does not fold the Hall block, and the face lies inside the window (1280x900, 1920x1080)', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s = await seite(t, projekt(HALL), { breite: b, hoehe: h });
    assert.equal(await zaehle(s, FACE), 0, 'closed by default');
    await oeffneKlick(s);
    assert.equal(await zaehle(s, FACE), 1);
    assert.equal(await s.w(`document.querySelector('.p-returnkopf[data-ret="r1"] .p-hallblock').open`), true, 'the block stays unfolded');
    const m = await lage(s);
    assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, `${b}x${h}: ${JSON.stringify(m)}`);
    assert.ok(m.sh <= m.ch + 1, `${b}x${h}: no inner scroll: ${m.sh} > ${m.ch}`);
    assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'HALL');
    assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Pre-delay', 'Size', 'Decay', 'Low decay', 'High cut', 'Level']);
    assert.equal(await s.w(`document.querySelectorAll('.p-face .fp-knopf').length`), 6);
    assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-decay"] .fp-wert').textContent`), '554 ms', 'the knob shows the return decay (0.1 x 300^0.3 s)');
    assert.match(await s.w(`document.querySelector('.p-face .fa-hall-fest').textContent`), /^Fixed in the return: early 0\.50/);
    await oeffneKlick(s);
    assert.equal(await zaehle(s, FACE), 0, 'a second click closes it');
  }
});

test('an arrow key on the Decay knob sends return_aendern with the norm, the return slider shows the same, the undo label names return and field, and the 1 kHz line ends where decay says', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(HALL));
  await oeffneKlick(s);
  const ende = () => s.w(`(async () => {
    const m = await import('/face/reverb.js');
    const p = document.querySelector('.p-face .fa-hall-l1').getAttribute('d').split(/ ?[ML]/).filter(Boolean).map((q) => q.split(',').map(Number));
    const r = document.querySelector('.p-returnkopf[data-ret="r1"] .p-hall[data-feld="decay"]');
    const e = m.hallEinstellung({ ...${JSON.stringify(HALL)}, decay: Number(r.value) });
    const z = m.hallZeit(e), tEnde = m.hallZeitEnde(z);
    return { dx: p[1][0] - (34 + (z.fahneStartS + z.linien[1].t60) / tEnde * (420 - 12 - 34)), slider: Number(r.value), t60: z.linien[1].t60 };
  })()`);
  const e0 = await ende();
  assert.ok(Math.abs(e0.dx) < 1, `line end before: ${e0.dx}`);
  await s.w(`(() => { const k = document.querySelector('.p-face [data-id="c-r1-decay"] .fp-knopf'); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).returns[0].hall.decay > 0.305), 'decay in the project');
  const decay = (await s.projekt()).returns[0].hall.decay;
  assert.ok(Math.abs(decay - 0.31) < 1e-6, `decay norm ${decay}`);
  const a = (await aend(s)).at(-1);
  assert.deepEqual(a.befehle, ['return_aendern']);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-returnkopf[data-ret="r1"] .p-hall[data-feld="decay"]').value`)) === String(decay)), 'the return slider shows the same value');
  const verlauf = await (await fetch(`${s.url}proj/verlauf`)).json();
  assert.equal(verlauf.at(-1).label, 'Hall decay return Room');
  const e1 = await ende();
  assert.ok(Math.abs(e1.dx) < 1, `line end after: ${e1.dx}`);
  assert.ok(e1.t60 > e0.t60, 'the line got longer');
});

test('failure case: the return is deleted while the face is open: the face closes and nothing is sent for it', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(HALL));
  await oeffneKlick(s);
  assert.equal(await zaehle(s, FACE), 1);
  await s.w(`document.querySelector('.p-returnkopf[data-ret="r1"] .p-loeschen').click()`);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0, 800), 'the face is gone');
  const n = (await aend(s)).length;
  assert.deepEqual((await aend(s)).at(-1).befehle, ['return_loeschen']);
  await warte(300);
  assert.equal((await aend(s)).length, n, 'nothing after the deletion');
});

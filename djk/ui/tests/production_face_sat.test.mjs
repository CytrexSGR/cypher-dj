// PRODUCTION: the saturator face of an insert stage, in a real page (headless Chrome against the project stub, as production_face_comp.test.mjs). The pure maths is
// in face_sat.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// four audio tracks, one saturator on Kick (stage i1); `werte`: [[insert, param, value]]
function projekt(werte = []) {
  let p = neuesProjekt('Face page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'saett' }]);
  for (const [insert_id, param, wert] of werte) p = lauf(p, [{ befehl: 'insert_param_setzen', insert_id, param, wert }]);
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
const knopf = (param) => `${FACE} [data-id="c-r1-${param}"] .fp-knopf`;
const aend = (s) => fetch(`${s.url}attrappe/aenderungen`).then((r) => r.json());
const oeffneKlick = (s, id = 'i1') => s.w(`document.querySelector('[data-w="karte-teil"][data-teil="${id}"]').click()`);
const entferne = async (s, id = 'i1') => {   // the chip menu entry Remove (the event stops at the chip: the card's own menu handler would replace the chip menu, a dock quirk outside this test)
  await s.w(`(() => { const c = document.querySelector('[data-w="karte-teil"][data-teil="${id}"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); })()`);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.trim() === 'Remove').click()`);
};
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const taste = (s, param, key) => s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf(param))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); })()`);
const WERTE = [['i1', 'drive', 24], ['i1', 'out', -3], ['i1', 'mix', 0.8]];

test('saturator face opens from the stage chip, lies inside the window (1280x900, 1920x1080), has three knobs showing the stage and writes nothing on open', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s = await seite(t, projekt(WERTE), { breite: b, hoehe: h });
    assert.equal(await zaehle(s, FACE), 0, 'closed by default');
    const vorher = (await aend(s)).length;
    await oeffneKlick(s);
    assert.equal(await zaehle(s, FACE), 1);
    const m = await lage(s);
    assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, `${b}x${h}: ${JSON.stringify(m)}`);
    assert.ok(m.sh <= m.ch + 1, `${b}x${h}: no inner scroll`);
    assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'SATURATOR');
    assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Drive', 'Output', 'Mix']);
    assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-drive"] .fp-wert').textContent`), '24.0 dB');
    assert.equal((await aend(s)).length, vorher, 'opening writes nothing');
    assert.match(await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`), /^M[\d.]+,[\d.]+ L/);
  }
});

test('a Drive knob key sends insert_param_setzen drive with the label "Drive saturator on Kick"; the curve moves', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  const kurve0 = await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`);
  await taste(s, 'drive', 'ArrowUp');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.drive > 12), 'drive in the project');
  const v = (await s.projekt()).spuren[0].inserts[0].werte.drive;
  const text = `${v.toFixed(1)} dB`;
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-drive"] .fp-wert').textContent`), text);
  assert.notEqual(await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`), kurve0, 'the curve moved with the knob');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  assert.equal((await fetch(`${s.url}proj/verlauf`).then((r) => r.json())).at(-1).label, 'Drive saturator on Kick');
});

test('failure case: the stage is removed under the open face: the face closes within 500 ms and no insert_param_setzen follows', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  assert.equal(await zaehle(s, FACE), 1);
  await entferne(s);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0, 500), 'the face is gone');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_entfernen']);
  const n = (await aend(s)).length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await aend(s)).length, n, 'nothing after the removal');
});

test('track head opener: the FACE button shows for a track with a saturator and opens the saturator face', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(), { breite: 1280, hoehe: 900 });
  const kopf = (id) => `.p-kopf[data-spur="${id}"] .p-face-auf`;
  assert.equal(await s.w(`!!document.querySelector(${JSON.stringify(kopf('s1'))})`), true);
  assert.equal(await s.w(`!!document.querySelector(${JSON.stringify(kopf('s2'))})`), false, 'no opener on a track without a face-capable stage');
  await s.w(`document.querySelector(${JSON.stringify(kopf('s1'))}).click()`);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'SATURATOR');
});

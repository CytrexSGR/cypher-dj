// PRODUCTION: the limiter face of an insert stage, in a real page (headless Chrome against the project stub, as production_face_sat.test.mjs). The pure maths is
// in face_limiter.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// four audio tracks, one limiter on Kick (stage i1); `werte`: [[insert, param, value]]
function projekt(werte = []) {
  let p = neuesProjekt('Face page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'lim' }]);
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
const oeffneKlick = (s, id = 'i1') => s.w(`document.querySelector('.p-stufe[data-insert="${id}"] .p-ins-face').click()`);
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const taste = (s, param, key) => s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf(param))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); })()`);
const WERTE = [['i1', 'decke', -9], ['i1', 'abklingen', 200]];

test('limiter face opens from the stage row, lies inside the window (1280x900, 1920x1080), shows the ceiling and the fixed line, has two knobs and the meter', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s = await seite(t, projekt(WERTE), { breite: b, hoehe: h });
    assert.equal(await zaehle(s, FACE), 0, 'closed by default');
    const vorher = (await aend(s)).length;
    await oeffneKlick(s);
    assert.equal(await zaehle(s, FACE), 1);
    const m = await lage(s);
    assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, `${b}x${h}: ${JSON.stringify(m)}`);
    assert.ok(m.sh <= m.ch + 1, `${b}x${h}: no inner scroll`);
    assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'LIMITER');
    assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Ceiling', 'Release']);
    assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-decke"] .fp-wert').textContent`), '-9.0 dB');
    assert.ok((await s.w(`document.querySelector('.p-face .fa-lim-fest').textContent`)).includes('latency 86 samples'));
    assert.equal(await zaehle(s, `${FACE} .fa-lim-gr-platz .fa-meter`), 1, 'the gain-reduction meter is there');
    assert.equal(await s.w(`document.querySelector('.p-face .fa-lim-gr-platz .fa-meter-text').textContent`), '–', 'a dash without a reading');
    assert.match(await s.w(`document.querySelector('.p-face .fa-marke').textContent`), /CEILING .9\.0 dB/);
    assert.equal((await aend(s)).length, vorher, 'opening writes nothing');
  }
});

test('a Ceiling knob key sends insert_param_setzen decke with the label "Ceiling limiter on Kick"; the INSERTS row shows the same number; the ceiling line moves', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  await oeffneKlick(s);
  const linie0 = await s.w(`document.querySelector('.p-face .fa-decke').getAttribute('y1')`);
  await taste(s, 'decke', 'ArrowDown');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.decke < -1), 'ceiling in the project');
  const v = (await s.projekt()).spuren[0].inserts[0].werte.decke;
  const text = `${v.toFixed(1)} dB`;
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="decke"]').textContent`)) === text), 'the row shows the same number');
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-decke"] .fp-wert').textContent`), text);
  assert.notEqual(await s.w(`document.querySelector('.p-face .fa-decke').getAttribute('y1')`), linie0, 'the ceiling line moved');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  assert.equal((await fetch(`${s.url}proj/verlauf`).then((r) => r.json())).at(-1).label, 'Ceiling limiter on Kick');
});

test('failure case: the stage is removed under the open face: the face closes within 500 ms and no insert_param_setzen follows', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt());
  await oeffneKlick(s);
  assert.equal(await zaehle(s, FACE), 1);
  await s.w(`document.querySelector('.p-stufe[data-insert="i1"] .p-ins-weg').click()`);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0, 500), 'the face is gone');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_entfernen']);
  const n = (await aend(s)).length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await aend(s)).length, n, 'nothing after the removal');
});

test('track head opener: the FACE button shows for a track with a limiter and opens the limiter face', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(), { breite: 1280, hoehe: 900 });
  const kopf = (id) => `.p-kopf[data-spur="${id}"] .p-face-auf`;
  assert.equal(await s.w(`!!document.querySelector(${JSON.stringify(kopf('s1'))})`), true);
  await s.w(`document.querySelector(${JSON.stringify(kopf('s1'))}).click()`);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'LIMITER');
});

// ---- T8: the live gain reduction of the limiter
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const BILDER = `${process.env.HOME}/messungen/2026-11-15-backlog/device-faces`;
const liesGr = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const b = f.querySelector('.fa-lim-gr-platz .fa-meter-bahn').getBoundingClientRect(), k = f.querySelector('.fa-lim-gr-platz .fa-meter-balken').getBoundingClientRect();
  return { meter: f.querySelector('.fa-lim-gr-platz .fa-meter-text').textContent, bahn: b.height, balken: k.height, aus: f.querySelector('.fa-lim').classList.contains('fa-aus') }; })()`);
function stromGr(s, kanal, gr) {
  const sende = () => s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal, gr_db: gr } }).catch(() => {});
  sende();
  const h = setInterval(sende, 100);
  h.unref();   // a failed assertion must not keep the test process alive
  return () => clearInterval(h);
}

test('the meter shows /e/ins_gr ins/lim/1 (3.0 dB, bar 3/12), ignores the compressor reading of the same number, and falls to a dash 500 ms after the last message', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(WERTE), { breite: 1280, hoehe: 900 });
  await oeffneKlick(s);
  assert.equal((await liesGr(s)).meter, '–', 'no reading yet');
  const fremd = stromGr(s, 'ins/komp/1', 9);   // negative control: a compressor reading with the same number
  await warte(400);
  assert.equal((await liesGr(s)).meter, '–', 'the compressor reading does not reach the limiter meter');
  fremd();
  const stopp = stromGr(s, 'ins/lim/1', 3.0);
  assert.ok(await s.bis(async () => (await liesGr(s)).meter === '3.0 dB'), JSON.stringify(await liesGr(s)));
  const m = await liesGr(s);
  assert.ok(Math.abs(m.balken - (m.bahn * 3) / 12) <= 1, `bar ${m.balken} of ${m.bahn}`);
  const lage1 = await lage(s);
  assert.ok(lage1.r <= lage1.iw && lage1.b <= lage1.ih, JSON.stringify(lage1));
  await s.b.bild(`${BILDER}/t8-1280.png`);
  stopp();
  await warte(700);
  const n = await liesGr(s);
  assert.equal(n.meter, '–'); assert.ok(n.balken < 0.5);
});

test('a bypassed limiter shows a dash and a dimmed meter although readings arrive; at 1920x1080 the face with its reduction lies inside the window', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(WERTE), { breite: 1920, hoehe: 1080 });
  await oeffneKlick(s);
  const stopp = stromGr(s, 'ins/lim/1', 6.0);
  assert.ok(await s.bis(async () => (await liesGr(s)).meter === '6.0 dB'));
  const lg = await lage(s);
  assert.ok(lg.l >= 0 && lg.t >= 0 && lg.r <= lg.iw && lg.b <= lg.ih && lg.sh <= lg.ch + 1, JSON.stringify(lg));
  await s.b.bild(`${BILDER}/t8-1920.png`);
  await s.w(`document.querySelector('.p-face .p-face-an').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].an === false));
  await warte(500);
  const m = await liesGr(s);
  stopp();
  assert.equal(m.aus, true); assert.equal(m.meter, '–'); assert.ok(m.balken < 0.5);
});

// ---- T9: the level bars of the limiter face
const liesBalken = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null;
  return [...f.querySelectorAll('.fa-lim-pegel .fa-pegel-spalte')].map((c) => { const b = c.querySelector('.fa-meter-bahn').getBoundingClientRect(), k = c.querySelector('.fa-meter-balken').getBoundingClientRect(); return { text: c.querySelector('.fa-meter-text').textContent, bahn: b.height, balken: k.height }; }); })()`);
function stromPegel(s, kanal, ein, aus) {
  const sende = () => s.post('/attrappe/sse', { a: '/e/stufe_pegel', f: { kanal, ein_db: ein, aus_db: aus } }).catch(() => {});
  sende();
  const h = setInterval(sende, 100);
  h.unref();   // a failed assertion must not keep the test process alive
  return () => clearInterval(h);
}

test('the limiter bars show /e/stufe_pegel ins/lim/1 (input -3, output -6), ignore the compressor report of the same number, go to dashes on silence and 500 ms after the last report; the face stays inside the window', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(WERTE), { breite: 1280, hoehe: 900 });
  await oeffneKlick(s);
  assert.deepEqual((await liesBalken(s)).map((x) => x.text), ['–', '–'], 'no report yet');
  const fremd = stromPegel(s, 'ins/komp/1', -3, -6);
  await warte(350);
  assert.deepEqual((await liesBalken(s)).map((x) => x.text), ['–', '–'], 'a compressor report does not reach the limiter');
  fremd();
  const stopp = stromPegel(s, 'ins/lim/1', -3, -6);
  assert.ok(await s.bis(async () => (await liesBalken(s)).map((x) => x.text).join() === '-3.0 dB,-6.0 dB'), JSON.stringify(await liesBalken(s)));
  const b = await liesBalken(s);
  [-3, -6].forEach((v, i) => assert.ok(Math.abs(b[i].balken - b[i].bahn * ((v + 60) / 66)) <= 3, `bar ${i}: ${b[i].balken} of ${b[i].bahn}`));
  const lg = await lage(s);
  assert.ok(lg.l >= 0 && lg.t >= 0 && lg.r <= lg.iw && lg.b <= lg.ih && lg.sh <= lg.ch + 1, JSON.stringify(lg));
  stopp();
  const still = stromPegel(s, 'ins/lim/1', -200, -200);
  await warte(450);
  assert.deepEqual((await liesBalken(s)).map((x) => x.text), ['–', '–'], 'silence: dashes');
  still();
  await warte(700);
  assert.deepEqual((await liesBalken(s)).map((x) => x.text), ['–', '–']);
});

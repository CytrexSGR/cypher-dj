// PRODUCTION: the compressor face of an insert stage, in a real page (headless Chrome against the project stub, as production_inserts.test.mjs). The pure maths
// is in face_comp.test.mjs, the frame in face_frame.test.mjs. Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// four audio tracks, one group, two returns; `ketten`: {strangId: n} compressors per strip; `werte`: [[insert, param, value]]
function projekt(ketten = {}, werte = [], rack = null) {
  let p = neuesProjekt('Face page');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'Hall' }]);
  for (const [strang, n] of Object.entries(ketten)) for (let pos = 0; pos < n; pos++) p = lauf(p, [{ befehl: 'insert_setzen', strang_id: strang, pos, art: 'komp' }]);
  for (const [insert_id, param, wert] of werte) p = lauf(p, [{ befehl: 'insert_param_setzen', insert_id, param, wert }]);
  if (rack) p = lauf(p, [rack]);
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
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const FACE = '.p-face';
const knopf = (param, reihe = 1) => `${FACE} [data-id="c-r${reihe}-${param}"] .fp-knopf`;
const aend = (s) => fetch(`${s.url}attrappe/aenderungen`).then((r) => r.json());
const taste = (s, key, vk) => s.b.sende('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }).then(() => s.b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }));
const oeffneKlick = (s, id = 'i1') => s.w(`document.querySelector('[data-w="karte-teil"][data-teil="${id}"]').click()`);
const entferne = async (s, id = 'i1') => {   // the chip menu entry Remove (the event stops at the chip: the card's own menu handler would replace the chip menu, a dock quirk outside this test)
  await s.w(`(() => { const c = document.querySelector('[data-w="karte-teil"][data-teil="${id}"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); })()`);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.trim() === 'Remove').click()`);
};
const lage = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const r = f.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, sh: f.scrollHeight, ch: f.clientHeight, iw: innerWidth, ih: innerHeight }; })()`);
const WERTE = [['i1', 'schwelle', -26], ['i1', 'ratio', 6], ['i1', 'knie', 12], ['i1', 'attack', 4], ['i1', 'release', 220], ['i1', 'makeup', 4], ['i1', 'mix', 0.8], ['i1', 'schp', 90]];

test('face opens from the stage chip (a real click) and lies inside the window without inner scroll: 1280x1080, then 1280x900 and 1920x1080 opened by element.click()', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, WERTE));
  assert.equal(await zaehle(s, FACE), 0, 'closed by default');
  await s.b.klick('[data-w="karte-teil"][data-teil="i1"]');
  assert.equal(await zaehle(s, FACE), 1);
  const m = await lage(s);
  assert.ok(m.l >= 0 && m.t >= 0 && m.r <= m.iw && m.b <= m.ih, JSON.stringify(m));
  assert.ok(m.sh <= m.ch + 1, `no inner scroll: ${m.sh} > ${m.ch}`);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-titel').textContent`), 'COMPRESSOR');
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Threshold', 'Ratio', 'Knee', 'Attack', 'Release', 'Makeup', 'Mix', 'Key high-pass']);
  assert.equal(await zaehle(s, `${FACE} .fp-knopf`), 8, 'a knob per parameter');
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-schwelle"] .fp-wert').textContent`), '-26.0 dB', 'the knobs show the stage');
  for (const [b, h] of [[1280, 900], [1920, 1080]]) {
    const s2 = await seite(t, projekt({ s1: 1 }, WERTE), { breite: b, hoehe: h });
    await oeffneKlick(s2);
    const mm = await lage(s2);
    assert.ok(mm.l >= 0 && mm.t >= 0 && mm.r <= mm.iw && mm.b <= mm.ih, `${b}x${h}: ${JSON.stringify(mm)}`);
    assert.ok(mm.sh <= mm.ch + 1, `${b}x${h}: no inner scroll`);
    assert.ok(mm.b - mm.t <= 560 && mm.r - mm.l <= 640, `${b}x${h}: at most 640x560 (D11): ${mm.r - mm.l}x${mm.b - mm.t}`);
  }
});

test('a knob key changes the stage in the project, the undo label names the stage; the curve follows', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }));
  await oeffneKlick(s);
  const kurve0 = await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`);
  await s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf('schwelle'))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()`);
  assert.ok(await s.bis(async () => { const v = (await s.projekt()).spuren[0].inserts[0].werte.schwelle; return v > -17.5 && v < -17.3; }), `schwelle in the project: ${(await s.projekt()).spuren[0].inserts[0].werte.schwelle}`);
  const v = (await s.projekt()).spuren[0].inserts[0].werte.schwelle;
  const text = `${v.toFixed(1)} dB`;
  assert.equal(await s.w(`document.querySelector('.p-face [data-id="c-r1-schwelle"] .fp-wert').textContent`), text);
  assert.notEqual(await s.w(`document.querySelector('.p-face .fa-kurve').getAttribute('d')`), kurve0, 'the curve moved with the knob');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  assert.equal((await aend(s)).at(-1).wiedergabe, false, 'live: no new playback');
  const verlauf = await (await fetch(`${s.url}proj/verlauf`)).json();
  assert.equal(verlauf.at(-1).label, 'Threshold compressor on Kick');
});

test('a parameter a rack macro drives: its knob is greyed, shows the macro value and a key sends nothing', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const rack = { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: 'i1', param: 'schwelle', von: -40, bis: -10 }] }, { ziel: [] }, { ziel: [] }, { ziel: [] }] };
  const s = await seite(t, projekt({ s1: 1 }, [], rack));
  await oeffneKlick(s);
  const sel = `.p-face [data-id="c-r1-schwelle"]`;
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(sel)}).classList.contains('fp-gesperrt')`), true);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(`${sel} .fp-wert`)}).textContent`), '-40.0 dB', 'the macro at 0 gives von');
  const vorher = (await aend(s)).length;
  await s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf('schwelle'))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()`);
  await warte(500);
  assert.equal((await aend(s)).length, vorher, 'nothing was sent');
  // an ungated knob of the same face still works
  await s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf('ratio'))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await aend(s)).length === vorher + 1), 'the free knob writes');
});

test('failure case: the stage is removed under the open face: the face closes within 500 ms and no insert_param_setzen follows', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }));
  await oeffneKlick(s);
  assert.equal(await zaehle(s, FACE), 1);
  await entferne(s);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0, 500), 'the face is gone');
  const n = (await aend(s)).length;
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_entfernen']);
  await warte(300);
  assert.equal((await aend(s)).length, n, 'nothing after the removal');
  const alle = await aend(s), weg = alle.findIndex((x) => x.befehle[0] === 'insert_entfernen');
  assert.ok(weg >= 0 && !alle.slice(weg + 1).some((x) => x.befehle[0] === 'insert_param_setzen'));
});

test('window smaller than the face (600x480): the face scrolls inside itself, is at most as wide as the window and its close button stays reachable', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }), { breite: 600, hoehe: 480 });
  await oeffneKlick(s);
  const m = await lage(s);
  assert.ok(m.sh > m.ch, `scrolls inside: ${m.sh} vs ${m.ch}`);
  assert.ok(m.r - m.l <= 600, `width ${m.r - m.l}`); assert.ok(m.l >= 0 && m.t >= 0 && m.b <= 480);
  await s.w(`document.querySelector('.p-face').scrollTop = 9999`);
  const zu = await s.w(`(() => { const r = document.querySelector('.p-face .p-face-zu').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
  assert.ok(zu.l >= 0 && zu.t >= 0 && zu.r <= 600 && zu.b <= 480, `the close button lies inside after scrolling to the end: ${JSON.stringify(zu)}`);
  assert.equal(await s.w(`document.documentElement.scrollWidth <= innerWidth`), true, 'nothing wider than the viewport');
});

test('Esc closes the face (D7: no listener, no face left); with the plug-in panel open the first Esc removes only the face, the second the panel, in both orders', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }));
  const panel = () => s.w(`(async () => {
    const m = await import('/production/plugin_device.js');
    const ctx = { holeGet: async () => ({ status: 200, j: [{ index: 0, name: 'Gain', wert: 0.5 }] }), holeJson: async () => ({ status: 200, j: {} }), melde() {}, antwortText: () => '' };
    m.oeffnePluginGeraet(ctx, { id: 's1', name: 'Kick' });
    return true; })()`);
  const stand = () => s.w(`({ face: document.querySelectorAll('.p-face').length, panel: document.querySelectorAll('.p-geraet-plugin').length })`);
  await oeffneKlick(s);
  await taste(s, 'Escape', 27);
  assert.deepEqual(await stand(), { face: 0, panel: 0 }, 'Esc closes the face');
  // face first, then the panel
  await oeffneKlick(s); await panel();
  assert.deepEqual(await stand(), { face: 1, panel: 1 });
  const z = await s.w(`({ f: Number(getComputedStyle(document.querySelector('.p-face')).zIndex), p: Number(getComputedStyle(document.querySelector('.p-geraet-plugin')).zIndex) })`);
  assert.ok(z.f > z.p, `the face lies above the panel: ${JSON.stringify(z)}`);
  await taste(s, 'Escape', 27); assert.deepEqual(await stand(), { face: 0, panel: 1 }, 'first Esc: only the face');
  await taste(s, 'Escape', 27); assert.deepEqual(await stand(), { face: 0, panel: 0 }, 'second Esc: the panel');
  // panel first, then the face
  await panel(); await oeffneKlick(s);
  assert.deepEqual(await stand(), { face: 1, panel: 1 });
  const z2 = await s.w(`({ f: Number(getComputedStyle(document.querySelector('.p-face')).zIndex), p: Number(getComputedStyle(document.querySelector('.p-geraet-plugin')).zIndex) })`);
  assert.ok(z2.f > z2.p);
  await taste(s, 'Escape', 27); assert.deepEqual(await stand(), { face: 0, panel: 1 }, 'first Esc: only the face');
  await taste(s, 'Escape', 27); assert.deepEqual(await stand(), { face: 0, panel: 0 }, 'second Esc: the panel');
  assert.deepEqual(await s.w(`document.querySelectorAll('.p-face').length`), 0);
});

test('track head opener: FACE shows for a track with a compressor, opens the same face as the stage row (a second click closes it), is absent on a track without one; two compressors give a menu', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1, s2: 2 }), { breite: 1280, hoehe: 900 });
  const kopf = (id) => `.p-kopf[data-spur="${id}"] .p-face-auf`;
  const sichtbar = (id) => s.w(`(() => { const e = document.querySelector(${JSON.stringify(kopf(id))}); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { b: r.bottom, r: r.right, w: r.width, ih: innerHeight, iw: innerWidth }; })()`);
  const m = await sichtbar('s1');
  assert.ok(m && m.b <= m.ih && m.r <= m.iw && m.w >= 20, `the head button fits: ${JSON.stringify(m)}`);
  assert.equal(await sichtbar('s3'), null, 'a track without a compressor has no opener');
  await s.w(`document.querySelector(${JSON.stringify(kopf('s1'))}).click()`);
  assert.equal(await s.w(`document.querySelectorAll('.p-face').length`), 1);
  assert.equal(await s.w(`document.querySelector('.p-face').dataset.face`), 'face:i1');
  await oeffneKlick(s, 'i1');   // the stage row button is the same face: it closes
  assert.equal(await zaehle(s, FACE), 0, 'the other opener closes the same face');
  await s.w(`document.querySelector(${JSON.stringify(kopf('s1'))}).click()`);
  await s.w(`document.querySelector(${JSON.stringify(kopf('s1'))}).click()`);
  assert.equal(await zaehle(s, FACE), 0, 'a second click on the same opener closes it');
  // two compressors: a menu with two entries; the second opens the face of the second stage
  await s.w(`document.querySelector(${JSON.stringify(kopf('s2'))}).click()`);
  assert.equal(await zaehle(s, '.p-menue button'), 2);
  await s.w(`document.querySelectorAll('.p-menue button')[1].click()`);
  assert.equal(await s.w(`document.querySelector('.p-face').dataset.face`), 'face:i3', 'the second stage of Bass (i2 is the first one)');
});

// ---- T2: the live gain reduction, the key chip and bypass
import { schluesselBefehl } from '../public/production/key_choice.js';
const lies = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null; const b = f.querySelector('.fa-komp-meter .fa-meter-bahn').getBoundingClientRect(), k = f.querySelector('.fa-komp-meter .fa-meter-balken').getBoundingClientRect();
  return { meter: f.querySelector('.fa-komp-meter .fa-meter-text').textContent, bahn: b.height, balken: k.height, aus: f.querySelector('.fa-komp').classList.contains('fa-aus') }; })()`);
// a reading every 100 ms (the core sends 20 Hz, the server throttles to 100 ms) until stop() is called
function strom(s, gr = 6.04) {
  const sende = () => s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal: 'ins/komp/1', gr_db: gr } }).catch(() => {});
  sende();
  const h = setInterval(sende, 100);
  h.unref();   // a failed assertion must not keep the test process alive
  return () => clearInterval(h);
}

test('the meter shows the reading of /e/ins_gr (6.0 dB, bar 6/24); 600 ms without a message: a dash and no bar (500 ms rule)', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }));
  await oeffneKlick(s);
  assert.equal((await lies(s)).meter, '–', 'no reading yet');
  const stopp = strom(s);
  assert.ok(await s.bis(async () => (await lies(s)).meter === '6.0 dB'), `meter: ${JSON.stringify(await lies(s))}`);
  const m = await lies(s);
  assert.ok(Math.abs(m.balken - (m.bahn * 6.04) / 24) <= 1, `bar ${m.balken} of ${m.bahn}: 6.04/24 is ${(m.bahn * 6.04) / 24}`);
  assert.equal(m.aus, false);
  stopp();
  await warte(700);
  const n = await lies(s);
  assert.equal(n.meter, '–', 'stale after 500 ms'); assert.ok(n.balken < 0.5, `no bar: ${n.balken}`);
});

test('a bypassed stage is dimmed and shows a dash even when a reading arrives; the ON button of the face bypasses through insert_an', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }));
  await oeffneKlick(s);
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-an').textContent`), 'ON');
  await s.w(`document.querySelector('.p-face .p-face-an').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].an === false), 'insert_an reached the project');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_an']);
  assert.equal((await fetch(`${s.url}proj/verlauf`).then((r) => r.json())).at(-1).label, 'Bypass compressor on Kick');
  assert.equal(await s.w(`document.querySelector('.p-face .p-face-an').textContent`), 'OFF');
  const stopp = strom(s);
  await warte(500);
  const m = await lies(s);
  stopp();
  assert.equal(m.aus, true, 'dimmed'); assert.equal(m.meter, '–', 'a dash although readings arrive'); assert.ok(m.balken < 0.5);
  await s.w(`document.querySelector('.p-face .p-face-an').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].an === true), 'back on');
  const stopp2 = strom(s);
  assert.ok(await s.bis(async () => (await lies(s)).meter === '6.0 dB'), 'on again: the reading shows');
  stopp2();
  // mix 0: dimmed as well (the knob key sets it)
  await s.w(`(() => { const k = document.querySelector(${JSON.stringify(knopf('mix', 2))}); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-face .fa-komp').classList.contains('fa-aus')`)) === true), 'mix 0 dims');
});

test('the key chip names the source: Own signal for an unkeyed stage, Track 2 Bass (pre) after the key is set (schluesselBefehl)', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s4: 1 }));
  await oeffneKlick(s);
  const chip = () => s.w(`document.querySelector('.p-face .fa-komp-schluessel-chip')?.textContent ?? null`);
  assert.equal(await chip(), 'KEY: Own signal');
  const p = await s.projekt();
  const r = await fetch(`${s.url}proj/aendern`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: p.rev, label: 'Key compressor on Pad', befehle: [schluesselBefehl('i1', 'spur:2:pre')] }) });
  assert.equal(r.status, 200, await r.clone().text());
  assert.ok(await s.bis(async () => (await chip()) === 'KEY: Track 2 Bass (pre)'), `the chip follows the project: ${await chip()}`);
});

// ---- T9: input and output level bars and the NOW dot, driven by /e/stufe_pegel
import { kompAusgangDb, kompEinstellung } from '../public/face/comp.js';
const BILDER = `${process.env.HOME}/messungen/2026-11-15-backlog/device-faces`;
const EIN = -12, AUS = Math.round(kompAusgangDb(EIN, kompEinstellung({ schwelle: -26, ratio: 6, knie: 12, makeup: 4, mix: 0.8 })) * 10) / 10;
const liesPegel = (s) => s.w(`(() => { const f = document.querySelector('.p-face'); if (!f) return null;
  const sp = [...f.querySelectorAll('.fa-pegel-spalte')].map((c) => { const b = c.querySelector('.fa-meter-bahn').getBoundingClientRect(), k = c.querySelector('.fa-meter-balken').getBoundingClientRect(); return { text: c.querySelector('.fa-meter-text').textContent, bahn: b.height, balken: k.height }; });
  const p = f.querySelector('.fa-jetzt'), t = f.querySelector('.fa-jetzt-text');
  return { sp, dot: p ? p.getAttribute('visibility') : null, cx: p ? Number(p.getAttribute('cx')) : null, cy: p ? Number(p.getAttribute('cy')) : null, nowText: t ? t.textContent : null, aus: f.querySelector('.fa-komp').classList.contains('fa-aus'),
    gr: f.querySelector('.fa-komp-meter .fa-meter-text').textContent }; })()`);
function stromPegel(s, kanal, ein, aus) {
  const sende = () => s.post('/attrappe/sse', { a: '/e/stufe_pegel', f: { kanal, ein_db: ein, aus_db: aus } }).catch(() => {});
  sende();
  const h = setInterval(sende, 100);
  h.unref();   // a failed assertion must not keep the test process alive
  return () => clearInterval(h);
}

test('the level bars show /e/stufe_pegel (input -12, output as the curve says, bar heights on the -60..+6 scale), the NOW dot sits on the curve plane; 600 ms without a report: dashes and no dot', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  for (const [b, h, bild] of [[1280, 900, 't9-1280.png'], [1920, 1080, 't9-1920.png']]) {
    const s = await seite(t, projekt({ s1: 1 }, WERTE), { breite: b, hoehe: h });
    await oeffneKlick(s);
    const leer = await liesPegel(s);
    assert.deepEqual(leer.sp.map((x) => x.text), ['–', '–'], 'no report yet');
    assert.equal(leer.dot, 'hidden');
    const fremd = stromPegel(s, 'ins/komp/2', -3, -3);   // negative control: another slot
    await warte(350);
    assert.equal((await liesPegel(s)).dot, 'hidden', 'a report of slot 2 does not reach the face of slot 1');
    fremd();
    const stopp = stromPegel(s, 'ins/komp/1', EIN, AUS);
    await s.post('/attrappe/sse', { a: '/e/ins_gr', f: { kanal: 'ins/komp/1', gr_db: 6 } });
    assert.ok(await s.bis(async () => (await liesPegel(s)).dot === 'visible'), JSON.stringify(await liesPegel(s)));
    const m = await liesPegel(s);
    assert.deepEqual(m.sp.map((x) => x.text), [`${EIN.toFixed(1)} dB`, `${AUS.toFixed(1)} dB`]);
    const erwartet = [EIN, AUS].map((v) => ((v + 60) / 66));
    m.sp.forEach((x, i) => assert.ok(Math.abs(x.balken - x.bahn * erwartet[i]) <= 1.5, `bar ${i}: ${x.balken} of ${x.bahn}, expected ${(x.bahn * erwartet[i]).toFixed(1)}`));
    assert.equal(m.nowText, 'NOW');
    // the dot is at (input, output) of the plot: the same geometry as the curve at the input level (the maths of the curve is pinned elsewhere)
    const lagePlot = await s.w(`(() => { const svg = document.querySelector('.p-face .fa-komp-kurve svg'); const r = svg.querySelector('.fa-kurve'); return { d: r.getAttribute('d') }; })()`);
    assert.ok(lagePlot.d.startsWith('M'), 'the curve is drawn');
    const dotAufKurve = await s.w(`(() => { const p = document.querySelector('.p-face .fa-jetzt'), k = document.querySelector('.p-face .fa-kurve'); const L = k.getTotalLength(); let best = 1e9; for (let i = 0; i <= 400; i++) { const q = k.getPointAtLength(L * i / 400); best = Math.min(best, Math.hypot(q.x - Number(p.getAttribute('cx')), q.y - Number(p.getAttribute('cy')))); } return best; })()`);
    assert.ok(dotAufKurve < 2, `the NOW dot lies on the drawn curve within 2 px (distance ${dotAufKurve.toFixed(2)})`);
    const lg = await lage(s);
    assert.ok(lg.l >= 0 && lg.t >= 0 && lg.r <= lg.iw && lg.b <= lg.ih, `${b}x${h}: ${JSON.stringify(lg)}`);
    await s.b.bild(`${BILDER}/${bild}`);
    stopp();
    await warte(700);
    const n = await liesPegel(s);
    assert.deepEqual(n.sp.map((x) => x.text), ['–', '–'], 'stale after 500 ms');
    assert.equal(n.dot, 'hidden'); assert.ok(n.sp.every((x) => x.balken < 0.5));
  }
});

test('silence (-200) shows dashes and no dot; a bypassed stage shows dashes although reports arrive; the report reaches the store of the channel compressor through the page', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, WERTE), { breite: 1280, hoehe: 900 });
  await oeffneKlick(s);
  let stopp = stromPegel(s, 'ins/komp/1', -200, -200);
  await warte(400);
  let m = await liesPegel(s);
  assert.deepEqual(m.sp.map((x) => x.text), ['–', '–']); assert.equal(m.dot, 'hidden'); assert.ok(m.sp.every((x) => x.balken < 0.5));
  stopp();
  stopp = stromPegel(s, 'ins/komp/1', EIN, AUS);
  assert.ok(await s.bis(async () => (await liesPegel(s)).dot === 'visible'));
  await s.w(`document.querySelector('.p-face .p-face-an').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].an === false));
  await warte(450);
  m = await liesPegel(s);
  assert.equal(m.aus, true); assert.deepEqual(m.sp.map((x) => x.text), ['–', '–']); assert.equal(m.dot, 'hidden');
  stopp();
  // the channel compressor's report goes into kompPegel through stream.js (no face needed)
  await s.post('/attrappe/sse', { a: '/e/stufe_pegel', f: { kanal: 'komp/erz/1', ein_db: -9.5, aus_db: -14 } });
  assert.ok(await s.bis(async () => (await s.w(`import('/effekte_gemeinsam.js').then((g) => g.kompPegel['erz/1']?.ein ?? null)`)) === -9.5), 'kompPegel["erz/1"] holds the report');
  await s.post('/attrappe/sse', { a: '/e/stufe_pegel', f: { kanal: 'ins/komp/1', ein_db: -9.5, aus_db: -14 } });
  assert.equal(await s.w(`import('/effekte_gemeinsam.js').then((g) => g.kompPegel['ins/komp/1'] ?? null)`), null, 'an insert report does not land in the channel store');
});

// ---- strand 13 slice 1: the Cypher Glue mode
import { glueStufe, GLUE_RATIO, GLUE_ATTACK, GLUE_RELEASE } from '../public/production/inserts.js';
import { glueNadelWinkel } from '../public/face/comp.js';
test('glueStufe: the nearest step in the log domain, a tie goes to the lower step (the rule of comp_dsp, tests/glue.rs)', () => {
  assert.equal(glueStufe(GLUE_RATIO, 3), 4);   // |ln 3 - ln 4| = .288 < |ln 3 - ln 2| = .405
  assert.equal(glueStufe(GLUE_ATTACK, 0.05), 0.1);
  assert.equal(glueStufe(GLUE_RELEASE, 5000), 1200);
  assert.equal(glueStufe(GLUE_RELEASE, 90), 100);
  assert.equal(glueStufe(GLUE_RATIO, 1.2), 1.5);
  assert.equal(glueStufe(GLUE_RATIO, 50), 10);
  assert.equal(glueStufe(GLUE_ATTACK, 10), 10, 'an exact step stays');
  assert.equal(glueStufe(GLUE_RATIO, Math.sqrt(2 * 4)), 2, 'the geometric mean of 2 and 4 is a tie: the lower step');
  assert.equal(glueStufe(GLUE_RATIO, 2.8), 2, 'just below the tie stays low'); assert.equal(glueStufe(GLUE_RATIO, 2.9), 4, 'negative control: just above goes up');
});
test('glueNadelWinkel: 0 dB at the left end, 20 dB at the right end, a missing reading rests at 0', () => {
  assert.equal(glueNadelWinkel(0), -55); assert.equal(glueNadelWinkel(20), 55); assert.equal(glueNadelWinkel(10), 0);
  assert.equal(glueNadelWinkel(40), 55, 'clamped'); assert.equal(glueNadelWinkel(null), -55);
});

const GLUE_WERTE = [['i1', 'glue', 1], ['i1', 'schwelle', -16], ['i1', 'ratio', 3], ['i1', 'attack', 10], ['i1', 'release', 600]];
const wahl = (s, n) => s.w(`document.querySelector('.p-face .fa-glue-${n}').value`);
const stelle = (s, sel, v) => s.w(`(() => { const w = document.querySelector(${JSON.stringify(sel)}); w.value = ${JSON.stringify(v)}; w.dispatchEvent(new Event('change', { bubbles: true })); })()`);

test('glue face: title, snapped selectors, four knobs, the needle meter; glue 0 shows none of it', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, GLUE_WERTE));
  await oeffneKlick(s);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-komp-titel').textContent`), 'Cypher Glue');
  assert.equal(await wahl(s, 'ratio'), '4', 'ratio 3 shows the snapped step 4:1');
  assert.equal(await wahl(s, 'attack'), '10');
  assert.equal(await wahl(s, 'release'), '800', '600 ms snaps to 800 (|ln 600-ln 800| .288 against .405 to 400)');
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-face .fp-name')].map((e) => e.textContent)`), ['Threshold', 'Makeup', 'Mix', 'Key high-pass']);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-komp-meter').hidden`), true, 'the bar meter gives way to the needle');
  const stopp = strom(s, 6.04);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-face .fa-glue-text').textContent`)) === '6.0 dB'), 'the needle reads 6.0 dB');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-glue-nadel').getAttribute('aria-valuenow')`), '6.0');
  stopp();
  const s2 = await seite(t, projekt({ s1: 1 }));   // negative control: a plain compressor is exactly today's face
  await oeffneKlick(s2);
  assert.equal(await zaehle(s2, '.p-face .fa-komp-titel'), 0); assert.equal(await zaehle(s2, '.p-face .fa-glue-wahl'), 0); assert.equal(await zaehle(s2, '.p-face .fp-knopf'), 8);
});

test('glue face: a selector writes the step; AUTO shows Auto in the release selector and disables it; AUTO again gives the release back', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, GLUE_WERTE));
  await oeffneKlick(s);
  await stelle(s, '.p-face .fa-glue-ratio', '2');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.ratio === 2), 'ratio 2 in the project');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  await s.w(`document.querySelector('.p-face .fa-glue-auto').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.auto === 1), 'auto 1 in the project');
  assert.ok(await s.bis(async () => (await wahl(s, 'release')) === 'auto'));
  assert.equal(await s.w(`document.querySelector('.p-face .fa-glue-release').disabled`), true);
  assert.equal(await s.w(`document.querySelector('.p-face .fa-glue-release').selectedOptions[0].textContent`), 'Auto');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-glue-ratio').disabled`), false, 'negative control: only the release is disabled');
  await s.w(`document.querySelector('.p-face .fa-glue-auto').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.auto === 0));
  assert.ok(await s.bis(async () => (await wahl(s, 'release')) === '800'));
  assert.equal(await s.w(`document.querySelector('.p-face .fa-glue-release').disabled`), false);
});

test('glue face: STYLE Smash sends ONE proj_aendern with all the values of the recipe; the project holds them; one undo step', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt({ s1: 1 }, [...GLUE_WERTE, ['i1', 'auto', 1]]));
  await oeffneKlick(s);
  const vorher = (await aend(s)).length;
  await stelle(s, '.p-face .fa-glue-stil', 'smash');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].inserts[0].werte.makeup === 8), 'Smash makeup in the project');
  const neu = (await aend(s)).slice(vorher);
  assert.equal(neu.length, 1, 'one write for the whole style');
  assert.deepEqual(neu[0].befehle, Array(9).fill('insert_param_setzen'), 'eight recipe values and auto 0');
  const w = (await s.projekt()).spuren[0].inserts[0].werte;
  assert.deepEqual([w.schwelle, w.ratio, w.attack, w.release, w.auto, w.knie, w.makeup, w.mix, w.schp, w.glue], [-30, 10, 0.1, 100, 0, 0, 8, 0.4, 0, 1]);
  assert.equal((await (await fetch(`${s.url}proj/verlauf`)).json()).at(-1).label, 'Glue style Smash on Kick');
  assert.equal(await wahl(s, 'ratio'), '10'); assert.equal(await s.w(`document.querySelector('.p-face .fa-glue-stil').value`), '', 'the STYLE selector goes back to its title');
});

test('the GLUE button of the master: lit and opening the face with a glue stage; else it inserts the Master recipe before the CLIP saturator and opens the face', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  let p = projekt({});
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'eq' }, { befehl: 'insert_setzen', strang_id: 'master', pos: 1, art: 'saett', werte: { kurve: 2 } }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  const s = await seite(t, JSON.parse(JSON.stringify(p)));
  assert.equal(await s.w(`document.querySelector('[data-w="karte-glue"]').getAttribute('aria-pressed')`), 'false');
  await s.w(`document.querySelector('[data-w="karte-glue"]').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).master.inserts.length === 3), 'a third stage on the master');
  const ins = (await s.projekt()).master.inserts;
  assert.deepEqual(ins.map((i) => i.art), ['eq', 'komp', 'saett'], 'the glue stage sits before the clipper');
  assert.equal(ins[1].werte.glue, 1); assert.equal(ins[1].werte.ratio, 1.5); assert.equal(ins[1].werte.auto, 1);
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 1), 'the face opens');
  assert.equal(await s.w(`document.querySelector('.p-face .fa-komp-titel').textContent`), 'Cypher Glue');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('[data-w="karte-glue"]').getAttribute('aria-pressed')`)) === 'true'), 'the button is lit now');
});

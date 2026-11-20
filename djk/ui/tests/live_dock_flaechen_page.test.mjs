// Live dock surfaces (plan 2026-11-19-one-dock-stage-5a, tasks 5 to 9) in a real page: headless Chrome against the project stub (check/page_mock.mjs).
// The stub answers 404 for the live routes, so a script installed before the page loads answers /graphen, /regler, /graph, /griff and the focus in the page
// and records every POST. GATE and UTIL popovers and menus, COMP face, key, preset and history, CHANGE / OPEN / + INSERT / Remove of the graph slot, the
// MASTER card (bus window and menu, spectrum window, GLUE knob) and the loop automation window. Without google-chrome the tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const sse = (s, a, f) => s.post('/attrappe/sse', { a, f });
const GRAPHEN = [
  { name: 'bass-acid', art: 'instrument', kategorie: 'bass', prinzip: 'subtraktiv', regler_namen: {} },
  { name: 'echo-tape', art: 'effekt', kategorie: 'delay', regler_namen: {} },
];
const VORHER = `(() => {
  window.__gesendet = [];
  const f = window.fetch.bind(window);
  const json = (j) => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }));
  window.fetch = (u, o = {}) => {
    const w = String(u).replace(location.origin, '');
    if (o.method === 'POST') { let body = null; try { body = JSON.parse(o.body); } catch {} window.__gesendet.push({ w, body }); }
    if (w === '/graphen') return json({ graphen: ${JSON.stringify(GRAPHEN)}, geladen: {} });
    if (w.startsWith('/graphen/panel')) return json({ panel: null });
    if (/^\\/(regler|griff|controller\\/fokus)$/.test(w)) return json({ quittung: { status: 0 } });
    if (w === '/graph') return json({ quittung: { status: 0 } });
    return f(u, o);
  };
})();`;

async function seite(t) {
  const s = await starteSeite({ breite: 1600, hoehe: 1000 });
  t.after(() => s.stoppe());
  await s.b.sende('Page.addScriptToEvaluateOnNewDocument', { source: VORHER });
  await s.b.oeffne(s.url); await warte(1500);
  await s.b.klick('[data-bereich="effekte"]');
  await warte(400);
  return s;
}
const gesendet = (s, w) => s.w(`window.__gesendet.filter((x) => x.w === ${JSON.stringify(w)}).map((x) => x.body)`);
const leere = (s) => s.w('window.__gesendet.length = 0');
const chip = (id, teil) => `document.querySelector('#live-dock [data-strang="${id}"] [data-teil="${teil}"]')`;
async function menue(s, ziel, text) {
  await s.w(`${ziel}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
  await warte(100);
  const ok = await s.w(`(() => { const b = [...document.querySelectorAll('.p-menue button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return [...document.querySelectorAll('.p-menue button, .p-menue li')].map((x) => x.textContent); b.click(); return true; })()`);
  assert.equal(ok, true, `menu entry ${text}`);
  await warte(250);
}

test('GATE and UTIL: popover at the chip, sliders send after 40 ms, chip menus switch, Escape closes', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await s.w(`${chip('erz/1', 'gate')}.click()`);
  await warte(200);
  assert.equal(await s.w(`document.querySelectorAll('.w-live-popover').length`), 1);
  await leere(s);
  await s.w(`(() => { const i = document.querySelector('.w-live-popover input[data-werk-pfad="erz/1/gate/schwelle"]'); i.value = '-30'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await warte(200);
  assert.deepEqual(await gesendet(s, '/regler'), [{ pfad: 'erz/1/gate/schwelle', nach: -30, ab: 'jetzt' }]);
  await s.w(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await warte(100);
  assert.equal(await s.w(`document.querySelectorAll('.w-live-popover').length`), 0, 'Escape closes');
  await leere(s);
  await menue(s, chip('erz/1', 'gate'), 'Enable');
  assert.deepEqual(await gesendet(s, '/regler'), [{ pfad: 'erz/1/gate/an', nach: 1, ab: 'jetzt' }]);
  await leere(s);
  await menue(s, chip('erz/2', 'util'), 'Ø L');
  assert.deepEqual(await gesendet(s, '/regler'), [{ pfad: 'erz/2/util/phase_l', nach: 1, ab: 'jetzt' }]);
});

test('COMP: the chip opens the face; key, preset and history from the chip menu', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await s.w(`${chip('erz/1', 'komp')}.click()`);
  await warte(300);
  assert.equal(await s.w(`document.querySelectorAll('.p-face').length`), 1, 'one face');
  await s.w(`${chip('erz/1', 'komp')}.click()`);   // closes it again
  await warte(200);
  await leere(s);
  await menue(s, chip('erz/1', 'komp'), 'BASS');
  assert.deepEqual(await gesendet(s, '/regler'), [{ pfad: 'erz/1/komp/sc', nach: 6, ab: 'jetzt' }]);
  await leere(s);
  await menue(s, chip('erz/1', 'komp'), 'Bass');
  assert.deepEqual((await gesendet(s, '/regler')).map((b) => b.pfad), ['schwelle', 'ratio', 'attack', 'release', 'makeup', 'mix', 'sc'].map((f) => `erz/1/komp/${f}`));
  await menue(s, chip('erz/1', 'komp'), 'Gain reduction history');
  assert.equal(await s.w(`document.querySelectorAll('#live-fenster [data-fenster-id="live:verlauf:erz/1"] canvas.live-verlauf').length`), 1);
});

test('graph slot: CHANGE of BASS, OPEN of BASS, + INSERT on A, Remove of the effect chip', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await s.w(`document.querySelector('#live-dock [data-strang="erz/2"] [data-w="karte-wechsel"]').click()`);
  await warte(200);
  const punkte = await s.w(`[...document.querySelectorAll('.p-menue li')].map((x) => x.textContent.trim())`);
  assert.ok(punkte.some((p) => p.startsWith('bass-acid')), JSON.stringify(punkte));
  assert.ok(/^Group by/.test(punkte.at(-1)), 'the axis switch is last');
  await leere(s);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.startsWith('bass-acid')).click()`);
  await warte(300);
  assert.deepEqual(await gesendet(s, '/graph'), [{ kanal: 'erz/2', name: 'bass-acid' }]);
  await s.w(`document.querySelector('#live-dock [data-strang="erz/2"] [data-w="karte-auf"]').click()`);
  await warte(300);
  assert.equal(await s.w(`document.querySelectorAll('#live-fenster [data-fenster-id="live:inst:erz/2"] [data-graphplatz="erz/2"]').length`), 1, 'OPEN shows the picker and knob area');
  await leere(s);
  await s.w(`document.querySelector('#live-dock [data-strang="deck/1"] [data-w="karte-plus"]').click()`);
  await warte(200);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.startsWith('echo-tape')).click()`);
  await warte(300);
  assert.deepEqual(await gesendet(s, '/graph'), [{ kanal: 'deck/1', name: 'echo-tape' }]);
  await sse(s, 'graphen', { geladen: { 'deck/1': 'echo-tape' } });
  await warte(400);
  assert.equal(await s.w(`${chip('deck/1', 'insert')}?.textContent`), 'echo-tape', 'the effect is a chip named like the effect');
  await leere(s);
  await menue(s, chip('deck/1', 'insert'), 'Remove');
  assert.deepEqual(await gesendet(s, '/graph'), [{ kanal: 'deck/1', name: '' }]);
});

test('MASTER: bus window and menu, spectrum window moves the view and back, Spectrum of BASS, GLUE knob', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await s.w(`${chip('master', 'bus/2')}.click()`);
  await warte(300);
  assert.equal(await s.w(`document.querySelectorAll('#live-fenster [data-fenster-id="live:bus:2"] .busstreifen[data-kanal="bus/2"]').length`), 1);
  await leere(s);
  await s.w(`(() => { const i = document.querySelector('[data-fenster-id="live:bus:2"] input[data-werk-pfad="bus/2/mb/grenze_tief"]'); i.value = '150'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await warte(200);
  assert.deepEqual((await gesendet(s, '/regler')).map((b) => b.pfad), ['bus/2/mb/grenze_tief']);
  await leere(s);
  await menue(s, chip('master', 'bus/2'), 'MULTIBAND on');
  assert.deepEqual(await gesendet(s, '/regler'), [{ pfad: 'bus/2/mb/an', nach: 1, ab: 'jetzt' }]);
  const heim = await s.w(`(() => { window.__heim = document.querySelector('#spektrum').parentElement; return window.__heim.className; })()`);
  assert.equal(heim, 'spektrum-heim', 'the spectrum view waits in its hidden home');
  await s.w(`document.querySelector('#live-dock [data-strang="master"] [data-w="karte-auf"]').click()`);
  await warte(300);
  assert.equal(await s.w(`!!document.querySelector('[data-fenster-id="live:spektrum"] #spektrum')`), true, 'the spectrum sits in the window');
  await s.w(`document.querySelector('[data-fenster-id="live:spektrum"] [data-w="fenster-zu"]').click()`);
  await warte(200);
  assert.equal(await s.w(`document.querySelector('#spektrum').parentElement === window.__heim`), true, 'back at home');
  await leere(s);
  await menue(s, `document.querySelector('#live-dock [data-strang="erz/2"] .w-karte-name')`, 'Spectrum');
  assert.deepEqual((await gesendet(s, '/regler')).filter((b) => b.pfad === 'spektrum/kanal'), [{ pfad: 'spektrum/kanal', nach: 6, ab: 'jetzt' }]);
  await leere(s);
  await s.w(`(() => { const k = document.querySelector('#live-dock [data-strang="master"] [data-param="kleber"]'); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()`);
  await warte(400);
  const griff = await gesendet(s, '/griff');
  assert.ok(griff.length >= 1 && griff.every((b) => b.pfad === 'master/kleber' && b.u >= 0 && b.u <= 1), JSON.stringify(griff));
});

test('loop automation: the card menu of L1 opens the editor in a window', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await menue(s, `document.querySelector('#live-dock [data-strang="pad/1"] .w-karte-name')`, 'Loop automation…');
  assert.equal(await s.w(`document.querySelectorAll('#live-fenster [data-fenster-id="live:auto:1"] .autospur').length`), 1);
  const fehler = s.b.konsole.filter((k) => k.typ === 'exception');
  assert.deepEqual(fehler, [], 'no uncaught error');
});

// Review 2026-11-19 of stage 5a (MAJOR): the loop automation windows of L1 and L2 shared one module-wide state, so SAVE in the L1 window wrote the
// name and curves of the window opened last; and a window did not follow a new loop in its box (/e/loop), so SAVE wrote the old loop's data.
// Headless Chrome against the page stub (not the running app); a script installed before the page loads answers the live routes and records POSTs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const sse = (s, a, f) => s.post('/attrappe/sse', { a, f });
const VORHER = `(() => {
  window.__gesendet = [];
  const f = window.fetch.bind(window);
  const json = (j) => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }));
  window.fetch = (u, o = {}) => {
    const w = String(u).replace(location.origin, '');
    if (o.method === 'POST') { let body = null; try { body = JSON.parse(o.body); } catch {} window.__gesendet.push({ w, body }); }
    if (w === '/graphen') return json({ graphen: [], geladen: {} });
    if (w.startsWith('/graphen/panel')) return json({ panel: null });
    if (w.startsWith('/loop/automation?name=LOOP_ONE')) return json({ automation: [{ pfad: 'pad/1/filter', punkte: [[0, 0.2]] }] });
    if (w.startsWith('/loop/automation')) return json({ automation: [] });
    if (/^\\/(regler|griff|controller\\/fokus)$/.test(w)) return json({ quittung: { status: 0 } });
    return f(u, o);
  };
})();`;

async function menue(s, ziel, text) {
  await s.w(`${ziel}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
  await warte(100);
  const ok = await s.w(`(() => { const b = [...document.querySelectorAll('.p-menue button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  assert.ok(ok === true, `menu entry ${text}`);
  await warte(300);
}
const gespeichert = async (s) => (await s.w('window.__gesendet')).filter((x) => x.w === '/loop/automation').map((x) => x.body);

test('two automation windows keep their own loop; a window follows a new loop in its box', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await starteSeite({ breite: 1600, hoehe: 1000 });
  t.after(() => s.stoppe());
  await s.b.sende('Page.addScriptToEvaluateOnNewDocument', { source: VORHER });
  await s.b.oeffne(s.url); await warte(1500);
  await sse(s, '/e/loop', { box: 1, name: 'LOOP_ONE', beats: 4 });
  await sse(s, '/e/loop', { box: 2, name: 'LOOP_TWO', beats: 8 });
  await warte(300);
  await s.b.klick('[data-bereich="effekte"]'); await warte(400);
  await menue(s, `document.querySelector('#live-dock [data-strang="pad/1"] .w-karte-name')`, 'Loop automation…');
  await menue(s, `document.querySelector('#live-dock [data-strang="pad/2"] .w-karte-name')`, 'Loop automation…');
  const name = (b) => s.w(`document.querySelector('[data-fenster-id="live:auto:${b}"] .autoname').textContent`);
  assert.equal(await name(1), 'LOOP_ONE (4 beats)');
  assert.equal(await name(2), 'LOOP_TWO (8 beats)');

  await s.w('window.__gesendet.length = 0');
  await s.w(`document.querySelector('[data-fenster-id="live:auto:1"] .autospeichern').click()`);
  await warte(300);
  assert.deepEqual(await gespeichert(s), [{ name: 'LOOP_ONE', automation: [{ pfad: 'pad/1/filter', punkte: [[0, 0.2]] }] }], 'SAVE in L1 writes L1, not the window opened last');

  await sse(s, '/e/loop', { box: 1, name: 'LOOP_NEW', beats: 4 });
  await warte(800);
  assert.equal(await name(1), 'LOOP_NEW (4 beats)', 'the L1 window follows the new loop');
  assert.equal(await name(2), 'LOOP_TWO (8 beats)', 'the L2 window stays');
  await s.w('window.__gesendet.length = 0');
  await s.w(`document.querySelector('[data-fenster-id="live:auto:1"] .autospeichern').click()`);
  await warte(300);
  assert.deepEqual(await gespeichert(s), [{ name: 'LOOP_NEW', automation: [] }], 'after the swap SAVE writes the new loop with its own (empty) curves');
});

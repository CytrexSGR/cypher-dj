// Live dock (plan 2026-11-19-one-dock-stage-5a, task 4) in a real page: headless Chrome against the project stub (check/page_mock.mjs).
// The EFFECTS tab of the DJ view shows the dock: seven channel cards (four containers, three streams), FX3 and FX4, one MASTER card in its own column; a control value changes a chip in place;
// a click on a free spot of a card puts it in front and reports the controller focus; leaving the tab and coming back keeps the rows. Without google-chrome skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const sse = (s, a, f) => s.post('/attrappe/sse', { a, f });

test('the EFFECTS tab shows the live dock; values refresh in place; a card click is the focus; the rows survive leaving the tab', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await starteSeite({ breite: 1600, hoehe: 1000 });
  t.after(() => s.stoppe());
  await s.b.oeffne(s.url); await warte(1500);
  const fehler = s.b.konsole.filter((k) => k.typ === 'exception' || /before initialization|is not defined|Cannot read/.test(k.text ?? ''));
  assert.deepEqual(fehler, [], 'no uncaught error in the console');
  // record what the page sends, answer /regler and /controller/fokus in the page (the stub does not serve them)
  await s.w(`(() => { window.__gesendet = []; const f = window.fetch; window.fetch = (u, o) => { const w = String(u); if (o?.method === 'POST') window.__gesendet.push({ w, body: o.body }); return /\\/(regler|controller\\/fokus)$/.test(w) ? Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) : f(u, o); }; })()`);
  await s.b.klick('[data-bereich="effekte"]');
  await warte(400);
  assert.equal(await s.w(`document.querySelectorAll('[data-w="dock-kanaele"] [data-w="karte-live"]').length`), 7, 'four containers and three streams');
  assert.deepEqual(await s.w(`[...document.querySelectorAll('[data-w="dock-fx"] [data-w="karte-live"]')].map((e) => e.dataset.strang)`), ['fx/3', 'fx/4']);
  assert.equal(await s.w(`document.querySelectorAll('[data-w="dock-master"] [data-w="karte-live"]').length`), 1, 'one MASTER card');
  assert.equal(await s.w(`[...document.querySelectorAll('#live-dock .w-chip-teil')].filter((b) => /INSERT/.test(b.textContent) && b.dataset.w === 'karte-teil').length`), 0, 'no chip is labelled INSERT');
  const komp = `document.querySelector('[data-strang="erz/1"] [data-teil="komp"]')`;
  const kartenVorher = await s.w(`(() => { window.__karte = document.querySelector('[data-strang="erz/1"]'); return true; })()`);
  assert.ok(kartenVorher);
  await sse(s, '/e/regler', { pfad: 'erz/1/komp/an', wert: 0 });
  await warte(300);
  assert.equal(await s.w(`${komp}.classList.contains('aus')`), true, 'COMP off');
  await sse(s, '/e/regler', { pfad: 'erz/1/komp/an', wert: 1 });
  await warte(300);
  assert.equal(await s.w(`${komp}.classList.contains('aus')`), false, 'COMP on after the value came');
  assert.equal(await s.w(`window.__karte === document.querySelector('[data-strang="erz/1"]')`), true, 'refreshed in place, not rebuilt');
  // a click on a free spot of the DRUMS card
  await s.w(`document.querySelector('[data-strang="erz/1"] .w-karte-name').click()`);
  await warte(300);
  assert.equal(await s.w(`document.querySelector('[data-strang="erz/1"]').classList.contains('aktiv')`), true, 'DRUMS in front');
  const fokus = await s.w(`window.__gesendet.filter((x) => x.w.endsWith('/controller/fokus')).map((x) => JSON.parse(x.body))`);
  assert.ok(fokus.some((f) => f.kanal === 'erz/1'), `focus sent: ${JSON.stringify(fokus)}`);
  // leave the tab and come back
  await s.b.klick('[data-bereich="library"]');
  await warte(300);
  assert.equal(await s.w(`document.querySelectorAll('#live-dock [data-w="karte-live"]').length`), 0, 'leaving empties the dock');
  await s.b.klick('[data-bereich="effekte"]');
  await warte(300);
  assert.equal(await s.w(`document.querySelectorAll('#live-dock [data-w="karte-live"]').length`), 10, 'coming back shows the cards at once');
});

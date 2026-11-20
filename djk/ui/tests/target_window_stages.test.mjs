// The stage windows of the kinds without a native face (`/#geraet=ins:<id>`): a Baukasten stage, a utility stage and a plugin stage fill the window page with the content
// of the floating window or popover (same builder), with the stage buttons in the title bar. Headless Chrome against the page stub (never the running studio).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const opt = { skip: !CHROME && 'no google-chrome' };
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// s1 Kick: i1 Baukasten delay, i2 utility, i3 plugin
function projekt() {
  let p = neuesProjekt('Stage kinds');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk', graph: 'fx-delay-sync' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'utility' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'host', plugin: { format: 'vst3', pfad: '/p/X.vst3', uid: 'u1' } }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
async function fenster(t, hash) {
  const s = await starteSeite({ breite: 1100, hoehe: 760 });
  t.after(() => s.stoppe());
  await s.post('/attrappe/saat', { projekt: projekt() });
  await s.b.oeffne(`${s.url}${hash}`);
  await warte(1800);
  return s;
}
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

test('stage window: the ids the test relies on', () => {
  const p = projekt();
  assert.deepEqual(p.spuren[0].inserts.map((i) => [i.id, i.art]), [['i1', 'bk'], ['i2', 'utility'], ['i3', 'host']]);
});

test('stage window of a Baukasten stage: full page, ON/earlier/later/remove, no close button, no drag layer', opt, async (t) => {
  const s = await fenster(t, '#geraet=ins:i1');
  assert.equal(await zaehle(s, '#geraet-fenster .w-fenster.w-fenster-voll'), 1);
  assert.equal(await zaehle(s, '.w-fenster-zu'), 0, 'no close button');
  for (const w of ['fenster-an', 'fenster-links', 'fenster-rechts', 'fenster-weg']) assert.equal(await zaehle(s, `[data-w="${w}"]`), 1, w);
  assert.equal(await s.w("getComputedStyle(document.querySelector('.w-fenster-voll')).position"), 'static');
  const n = (await s.projekt()).rev;
  await s.w("document.querySelector('[data-w=\"fenster-an\"]').click()");
  assert.ok(await s.bis(async () => (await s.projekt()).rev > n), 'ON/OFF writes through the one writer');
});

test('stage window of a utility stage: the parameter panel, the stage buttons', opt, async (t) => {
  const s = await fenster(t, '#geraet=ins:i2');
  assert.equal(await zaehle(s, '.w-fenster-voll .p-ins-popover.p-ins-utility'), 1);
  assert.ok(await zaehle(s, '.w-fenster-voll .p-ins-param') >= 3, 'the rows of the utility');
  assert.equal(await zaehle(s, '[data-w="fenster-an"], [data-w="fenster-weg"]'), 2);
  assert.equal(await s.w("document.querySelector('.gf-name').textContent"), 'Kick · utility');
});

test('stage window of a plugin stage: the panel, NATIVE WINDOW calls the stage\'s window route', opt, async (t) => {
  const s = await fenster(t, '#geraet=ins:i3');
  assert.equal(await zaehle(s, '.w-fenster-voll .p-ins-popover.p-ins-host'), 1);
  assert.equal(await zaehle(s, '[data-w="fenster-nativ"]'), 1);
  assert.equal(await s.w("document.querySelector('[data-w=\"fenster-nativ\"]').textContent"), 'NATIVE WINDOW');
  await s.w("(() => { window.__w = []; const f = window.fetch.bind(window); window.fetch = (u, o) => { window.__w.push(String(u)); return f(u, o); }; })()");
  await s.w("document.querySelector('[data-w=\"fenster-nativ\"]').click()");
  assert.ok(await s.bis(async () => (await s.w('window.__w')).some((u) => u.includes('/proj/insert/i3/fenster'))));
});

test('stage window: the stage removed says so, the window layer goes, undo brings it back', opt, async (t) => {
  const s = await fenster(t, '#geraet=ins:i2');
  const rev = (await s.projekt()).rev;
  await s.post('/proj/aendern', { rev, label: 'x', befehle: [{ befehl: 'insert_entfernen', insert_id: 'i2' }] });
  assert.ok(await s.bis(async () => (await zaehle(s, '.w-fenster-voll')) === 0));
  assert.equal(await s.w("document.querySelector('.gf-hinweis').textContent"), 'This stage is not in the project any more');
  await s.post('/proj/undo', { rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await zaehle(s, '.w-fenster-voll')) === 1));
});

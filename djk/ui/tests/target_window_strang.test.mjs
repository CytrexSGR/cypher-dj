// The strip windows (`/#geraet=ret:<id>`, `grp:<id>`, `master`): exactly one dock card, no rows and no + cards; chips of the card open stage windows inside the window
// page; the "gone" texts. The dock with `einzel` is tested through the window page in headless Chrome against the page stub (never the running studio).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';
import { zielFensterLage } from '../public/target_window.js';
import { parseZiel } from '../public/dock/target.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const opt = { skip: !CHROME && 'no google-chrome' };
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
function projekt() {
  let p = neuesProjekt('Strip window');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'return_neu' }, { befehl: 'gruppenspur_neu', name: 'Drums' }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'eq' }]);
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

test('lage: a strip window says what is gone', () => {
  const p = projekt();
  const lage = (z, q = p) => zielFensterLage({ ziel: parseZiel(z), slug0: 'a', slug: 'a', projekt: q });
  assert.equal(lage('ret:r1').art, 'ok'); assert.equal(lage('ret:r1').name, 'Return 1');
  assert.equal(lage('grp:g1').art, 'ok'); assert.equal(lage('master').art, 'ok');
  assert.equal(lage('ret:r9').text, 'This return is not in the project any more');
  assert.equal(lage('grp:g9').text, 'This group is not in the project any more');
});

test('strip window: a return shows its one card, no rows, no + cards', opt, async (t) => {
  const s = await fenster(t, '#geraet=ret:r1');
  assert.equal(await zaehle(s, '[data-w="karte-fx"]'), 1);
  assert.equal(await zaehle(s, '[data-w="karte-fx"][data-return-id="r1"]'), 1);
  for (const w of ['karte-spur', 'karte-grp', 'karte-master', 'karte-spur-neu', 'fx-laden', 'dock-synths', 'dock-fx', 'dock-grp']) assert.equal(await zaehle(s, `[data-w="${w}"]`), 0, w);
  assert.equal(await s.w("document.querySelector('.gf-name').textContent"), 'Return 1');
  assert.equal(await zaehle(s, '#produktion > *'), 0, 'PRODUCTION is not built here');
});

test('strip window: a group and the master show their one card', opt, async (t) => {
  const g = await fenster(t, '#geraet=grp:g1');
  assert.equal(await zaehle(g, '[data-w="karte-grp"][data-gruppe-id="g1"]'), 1);
  assert.equal(await zaehle(g, '[data-w="karte-fx"], [data-w="karte-master"]'), 0);
  const m = await fenster(t, '#geraet=master');
  assert.equal(await zaehle(m, '[data-w="karte-master"]'), 1);
  assert.equal(await zaehle(m, '[data-w="karte-fx"], [data-w="karte-grp"]'), 0);
});

test('strip window: a chip opens the stage window inside the page; the return deleted says so', opt, async (t) => {
  const s = await fenster(t, '#geraet=ret:r1');
  assert.equal(await zaehle(s, '[data-w="karte-fx"] [data-w="karte-teil"]'), 1, 'the EQ chip');
  await s.w("document.querySelector('[data-w=\"karte-fx\"] [data-w=\"karte-teil\"]').click()");
  assert.ok(await s.bis(async () => (await zaehle(s, '.p-face')) === 1), 'the EQ face opens (floating, as in PRODUCTION)');
  const rev = (await s.projekt()).rev;
  await s.post('/proj/aendern', { rev, label: 'x', befehle: [{ befehl: 'return_loeschen', return_id: 'r1' }] });
  assert.ok(await s.bis(async () => (await zaehle(s, '[data-w="karte-fx"]')) === 0));
  assert.equal(await s.w("document.querySelector('.gf-hinweis').textContent"), 'This return is not in the project any more');
  assert.equal(await s.w("getComputedStyle(document.querySelector('.gf-platte')).display"), 'none');
});

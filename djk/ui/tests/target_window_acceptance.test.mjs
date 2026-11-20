// Acceptance of stage 2 of the one dock work (plan 2026-11-20-one-dock-stage-2, task 7): every surface in its own window, tried once in the real page in
// headless Chrome against the page stub, NOT against the running studio. The pop-up opener of the page is replaced by a recorder (a headless browser has no
// window manager); every recorded address is then opened as a page of its own in the same browser, which is exactly what a pop-up shows.
// Screenshots go to ~/messungen/2026-11-20-one-dock-2/. What the stub cannot show: a real second browser window, the window manager (size, place), a native
// plugin window, the sound. Without google-chrome the tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const opt = { skip: !CHROME && 'no google-chrome' };
const AUS = path.join(os.homedir(), 'messungen/2026-11-20-one-dock-2');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// s1 Kick (audio): i1 compressor, i2 Baukasten delay, i3 utility; s2 Synth (instrument); return r1 with an EQ (i4); group g1
function projekt() {
  let p = neuesProjekt('Stage 2');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Synth', geraet: { art: 'intern', name: 'rb338' } },
    { befehl: 'return_neu' }, { befehl: 'gruppenspur_neu', name: 'Drums' }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'bk', graph: 'fx-delay-sync' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'utility' },
    { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'eq' }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const bild = (s, name) => { fs.mkdirSync(AUS, { recursive: true }); return s.b.bild(path.join(AUS, `${name}.png`)); };
const klicke = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).click()`);
const offen = (s) => s.w('window.__offen.map((x) => x.u)');
let nr = 0;
async function haupt(t) {
  const s = await starteSeite({ breite: 1280, hoehe: 900 });
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(projekt());
  await s.w("(() => { window.__offen = []; window.open = (u, n, f) => { window.__offen.push({ u, n, f }); return { focus() {}, resizeTo() {}, moveTo() {} }; }; })()");
  return s;
}
// the recorded address as a page of its own (a query makes the navigation a real load)
async function fenster(s, adresse) {
  await s.b.oeffne(`${s.url}?f=${++nr}${new URL(adresse, s.url).hash}`);
  await warte(1800);
}
async function chipMenue(s, strang, nth, text) {
  await s.w(`document.querySelectorAll('[data-w="karte-spur"][data-spur-id="${strang}"] [data-w="karte-teil"]')[${nth}].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
  await warte(150);
  const ok = await s.w(`(() => { const b = [...document.querySelectorAll('.p-menue button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  assert.equal(ok, true, `menu entry ${text}`);
  await warte(150);
}

test('WINDOW ↗ in the chip menu and on the cards opens the addresses of the plan; the instrument button is unchanged', opt, async (t) => {
  const s = await haupt(t);
  await bild(s, '01-production-before');
  for (const nth of [0, 1, 2]) await chipMenue(s, 's1', nth, 'WINDOW ↗');
  await klicke(s, '[data-w="karte-fx"][data-return-id="r1"] [data-w="karte-zielfenster"]');
  await klicke(s, '[data-w="karte-grp"][data-gruppe-id="g1"] [data-w="karte-zielfenster"]');
  await klicke(s, '[data-w="karte-master"] [data-w="karte-zielfenster"]');
  await klicke(s, '[data-w="karte-spur"][data-spur-id="s2"] [data-w="karte-fenster"]');
  assert.deepEqual((await offen(s)).map((u) => decodeURIComponent(new URL(u, s.url).hash)),
    ['#geraet=ins:i1', '#geraet=ins:i2', '#geraet=ins:i3', '#geraet=ret:r1', '#geraet=grp:g1', '#geraet=master', '#geraet=s2']);
  await bild(s, '01b-production-after');
});

test('every address shows its surface; a knob writes to the project; the stage deleted says so; the instrument window is the old one', opt, async (t) => {
  const s = await haupt(t);
  const gehe = async (hash, pruefe, name) => { await fenster(s, `/${hash}`); await pruefe(); await bild(s, name); };
  await gehe('#geraet=ins:i1', async () => {
    assert.equal(await zaehle(s, '#geraet-fenster .p-face.p-face-eingebettet'), 1, 'the compressor face fills the window');
    assert.equal(await s.w("document.querySelector('.gf-name').textContent"), 'Kick · compressor');
  }, '02-stage-compressor');
  const vorher = (await s.projekt()).rev;
  await s.w("(() => { const k = document.querySelector('.p-face .fp-knopf'); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()");
  assert.ok(await s.bis(async () => (await s.projekt()).rev > vorher), 'the knob wrote to the project stub');
  await gehe('#geraet=ins:i2', async () => assert.equal(await zaehle(s, '#geraet-fenster .w-fenster-voll'), 1), '03-stage-baukasten');
  await gehe('#geraet=ins:i3', async () => assert.equal(await zaehle(s, '.w-fenster-voll .p-ins-popover.p-ins-utility'), 1), '04-stage-utility');
  await gehe('#geraet=ret:r1', async () => assert.equal(await zaehle(s, '[data-w="karte-fx"][data-return-id="r1"]'), 1), '05-return');
  await gehe('#geraet=grp:g1', async () => assert.equal(await zaehle(s, '[data-w="karte-grp"][data-gruppe-id="g1"]'), 1), '06-group');
  await gehe('#geraet=master', async () => assert.equal(await zaehle(s, '[data-w="karte-master"]'), 1), '07-master');
  // the stage deleted while its window is open
  await fenster(s, '/#geraet=ins:i3');
  const rev = (await s.projekt()).rev;
  await s.post('/proj/aendern', { rev, label: 'x', befehle: [{ befehl: 'insert_entfernen', insert_id: 'i3' }] });
  assert.ok(await s.bis(async () => (await zaehle(s, '.w-fenster-voll')) === 0));
  assert.equal(await s.w("document.querySelector('.gf-hinweis').textContent"), 'This stage is not in the project any more');
  await bild(s, '08-stage-gone');
  // the instrument window: still the instrument page, not the stage page
  await fenster(s, '/#geraet=s2');
  assert.equal(await s.w("document.body.classList.contains('geraet-fenster')"), true);
  assert.equal(await s.w("document.body.classList.contains('ziel-fenster')"), false);
  await bild(s, '09-instrument-window');
});

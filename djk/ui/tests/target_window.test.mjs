// The stage window (public/target_window.js, `/#geraet=ins:<id>`): the pure state function, and in headless Chrome against the page stub (not the running studio)
// that the face of the stage is drawn into the window, follows the project, writes through the one writer, and says so when the stage is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from '../check/page_mock.mjs';
import { zielFensterLage, findeStufe } from '../public/target_window.js';
import { parseZiel } from '../public/dock/target.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
function projekt() {
  let p = neuesProjekt('Stage window');
  p = lauf(p, ['Kick', 'Bass'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'lim' }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}

test('lage: no project, another project, stage gone, ok', () => {
  const p = { spuren: [{ id: 's1', name: 'Kick', inserts: [{ id: 'i1', art: 'lim' }] }] };
  const ziel = parseZiel('ins:i1');
  assert.equal(zielFensterLage({ ziel, slug0: null, slug: null, projekt: null }).art, 'kein_projekt');
  assert.equal(zielFensterLage({ ziel, slug0: 'a', slug: 'b', projekt: p }).art, 'anderes_projekt');
  assert.equal(zielFensterLage({ ziel: parseZiel('ins:i9'), slug0: 'a', slug: 'a', projekt: p }).text, 'This stage is not in the project any more');
  const ok = zielFensterLage({ ziel, slug0: 'a', slug: 'a', projekt: p });
  assert.equal(ok.art, 'ok'); assert.equal(ok.strang.id, 's1'); assert.equal(ok.insert.id, 'i1');
  assert.equal(findeStufe(p, 'i1').strang.name, 'Kick');
  assert.equal(findeStufe(p, 'nope'), null);
});

async function fenster(t, p, hash = '#geraet=ins:i1') {
  const s = await starteSeite({ breite: 1100, hoehe: 760 });
  t.after(() => s.stoppe());
  const r = await s.post('/attrappe/saat', { projekt: p });
  await s.b.oeffne(`${s.url}${hash}`);
  await warte(1800);
  return { s, slug: r.slug };
}
const FACE = '.p-face';
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const aend = (s) => fetch(`${s.url}attrappe/aenderungen`).then((r) => r.json());

test('stage window: the limiter face fills the window page, the main views are not built', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const { s } = await fenster(t, projekt());
  assert.equal(await s.w("document.body.classList.contains('ziel-fenster')"), true);
  assert.equal(await zaehle(s, `#geraet-fenster ${FACE}.p-face-eingebettet`), 1, 'the face is inside the window root, as a block');
  assert.equal(await zaehle(s, '.p-face-zu'), 0, 'no close button: the window is the frame');
  assert.equal(await s.w("getComputedStyle(document.querySelector('.p-face')).position"), 'static');
  assert.equal(await s.w("document.querySelector('.gf-name').textContent"), 'Kick · limiter');
  assert.equal(await s.w('document.title'), 'djk limiter Kick');
  assert.equal(await s.w("document.querySelector('#produktion').children.length"), 0, 'PRODUCTION is not built here: no second project writer');
});

test('stage window: a knob writes through the writer; the face follows a change of another instance', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const { s } = await fenster(t, projekt());
  const vorher = (await aend(s)).length;
  await s.w(`(() => { const k = document.querySelector('${FACE} .fp-knopf'); k.focus(); k.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await aend(s)).length > vorher), 'a command reached the project');
  assert.deepEqual((await aend(s)).at(-1).befehle, ['insert_param_setzen']);
  const alt = await s.w("document.querySelector('.p-face')?.textContent ?? ''");
  const rev = (await s.projekt()).rev;
  await s.post('/proj/aendern', { rev, label: 'other', befehle: [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'decke', wert: -17 }] });
  assert.ok(await s.bis(async () => (await s.w("[...document.querySelectorAll('.p-face .fp-wert')].map((o) => o.textContent).join('|')")) !== alt), 'the face follows');
});

test('stage window: the stage removed says so and the face goes; undo brings it back', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const { s } = await fenster(t, projekt());
  const rev = (await s.projekt()).rev;
  await s.post('/proj/aendern', { rev, label: 'x', befehle: [{ befehl: 'insert_entfernen', insert_id: 'i1' }] });
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 0));
  assert.equal(await s.w("document.querySelector('.gf-hinweis').textContent"), 'This stage is not in the project any more');
  await s.post('/proj/undo', { rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await zaehle(s, FACE)) === 1));
  assert.equal(await s.w("document.querySelector('.gf-hinweis').textContent"), '');
});

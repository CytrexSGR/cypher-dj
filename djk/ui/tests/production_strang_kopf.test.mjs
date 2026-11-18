// Automation rows of returns and master (slice 1, T3): the head rows `.p-arr-strang` and their lane heads in the real page (headless Chrome against the
// project stub), plus the pure helpers laneAnlegen and sperreUmschalten for these strips. Without google-chrome the page tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';
import { laneAnlegen, sperreUmschalten } from '../public/production/track_heads.js';
import { LANEN_TEXT } from '../public/production/lanes_operation.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const opt = { skip: !CHROME && 'no google-chrome' };
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const fertig = (p) => { p.rev = 1; p.wiedergabe_rev = 1; return JSON.parse(JSON.stringify(p)); };
// r1 has an EQ insert, r2 has none, the master has none
const projekt = () => fertig(lauf(neuesProjekt('Strip heads'), [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' },
  { befehl: 'return_neu' }, { befehl: 'return_neu' }, { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'eq' }]));
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const klick = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).click()`);
const kopf = (id) => `.p-arr-strang[data-strang="${id}"]`;
const folge = (s) => s.w(`[...document.querySelectorAll('[data-p="koepfe"] > *')].filter((e) => !e.hidden).map((e) => e.dataset.strang ? 'head:' + e.dataset.strang
  : e.dataset.lanenSpur ? 'lane:' + e.dataset.lanenSpur : 'other')`);

test('T3 strip heads: one .p-arr-strang per return and the master, 28 px, no group head element', opt, async (t) => {
  const s = await seite(t, projekt());
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-arr-strang')].map((e) => e.dataset.strang)`), ['r1', 'r2', 'master']);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('r1'))}).getBoundingClientRect().height`), 28, 'matches layout.js GRUPPEN_HOEHE');
  assert.equal(await s.w(`document.querySelectorAll('.p-arr-gruppe').length`), 0);
  assert.deepEqual(await folge(s), ['other', 'head:r1', 'head:r2', 'head:master']);
});

test('T3 strip heads: A opens the lane head right under its head, A again closes it', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r1') + ' .p-lane');
  assert.deepEqual(await folge(s), ['other', 'head:r1', 'lane:r1', 'head:r2', 'head:master']);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('r1') + ' .p-lane')}).getAttribute('aria-pressed')`), 'true');
  assert.equal(await s.w(`document.querySelector('[data-lanen-spur="r1"]').getBoundingClientRect().height`), 48);
  await klick(s, kopf('r1') + ' .p-lane');
  assert.deepEqual(await folge(s), ['other', 'head:r1', 'head:r2', 'head:master']);
});

test('T3 strip heads: no insert shows the hint and no menu; with an insert the menu lists the free targets and creates the lane with strang_id', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('master') + ' .p-lane');
  const m = '[data-lanen-spur="master"]';
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(m + ' .p-lanentitel')}).textContent`), LANEN_TEXT.keine_ziele_strang);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(m + ' .p-lane-neu')}).hidden`), true, 'no empty menu');
  await klick(s, kopf('r1') + ' .p-lane');
  const r = '[data-lanen-spur="r1"]';
  const ziele = await s.w(`[...document.querySelector(${JSON.stringify(r + ' .p-lane-neu')}).options].map((o) => o.value).filter(Boolean)`);
  assert.equal(ziele[0], 'fader', 'a return offers Volume first (return fader lane)');
  const kette = ziele.filter((z) => z !== 'fader');
  assert.ok(kette.length > 0 && kette.every((z) => /^(insert\.|rack\.)/.test(z)), JSON.stringify(ziele));
  await s.w(`(() => { const e = document.querySelector(${JSON.stringify(r + ' .p-lane-neu')}); e.value = ${JSON.stringify(kette[0])};
    e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => ((await s.projekt()).returns[0].automation ?? []).length === 1), 'auto_neu reached the return');
  assert.equal((await s.projekt()).returns[0].automation[0].ziel, kette[0]);
});

test('T3 strip heads: the lock button of a return lane locks that lane', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r1') + ' .p-lane');
  const r = '[data-lanen-spur="r1"]';
  const ziel = await s.w(`document.querySelector(${JSON.stringify(r + ' .p-lane-neu')}).options[1].value`);
  await s.w(`(() => { const e = document.querySelector(${JSON.stringify(r + ' .p-lane-neu')}); e.value = ${JSON.stringify(ziel)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => ((await s.projekt()).returns[0].automation ?? []).length === 1));
  assert.ok(await s.bis(() => s.w(`!document.querySelector(${JSON.stringify(r + ' .p-lane-sperre')}).hidden`)));
  await klick(s, r + ' .p-lane-sperre');
  assert.ok(await s.bis(async () => (await s.projekt()).returns[0].automation[0].gesperrt === true));
});

test('T3 strip heads: deleting r1 keeps r2 with its open state and removes the heads of r1', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r1') + ' .p-lane'); await klick(s, kopf('r2') + ' .p-lane');
  assert.deepEqual(await folge(s), ['other', 'head:r1', 'lane:r1', 'head:r2', 'lane:r2', 'head:master']);
  await s.post('/proj/aendern', { label: 'x', befehle: [{ befehl: 'return_loeschen', return_id: 'r1' }], rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await folge(s)).length === 4));
  assert.deepEqual(await folge(s), ['other', 'head:r2', 'lane:r2', 'head:master']);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('r2') + ' .p-lane')}).getAttribute('aria-pressed')`), 'true');
});

test('T3 laneAnlegen: a return and the master are addressed by strang_id', async () => {
  const aufrufe = [], gewaehlt = [];
  const aendere = async (label, befehle) => { aufrufe.push(befehle); return true; };
  await laneAnlegen(aendere, (id, z) => gewaehlt.push([id, z]), 'r1', 'insert.i1.out', 'return');
  await laneAnlegen(aendere, (id, z) => gewaehlt.push([id, z]), 'master', 'rack.m1', 'master');
  assert.deepEqual(aufrufe, [[{ befehl: 'auto_neu', strang_id: 'r1', ziel: 'insert.i1.out' }], [{ befehl: 'auto_neu', strang_id: 'master', ziel: 'rack.m1' }]]);
  assert.deepEqual(gewaehlt, [['r1', 'insert.i1.out'], ['master', 'rack.m1']]);
});

test('T3 sperreUmschalten: finds the lane of a return and of the master', () => {
  const p = { spuren: [], gruppen: [], returns: [{ id: 'r1', automation: [{ id: 'a1', ziel: 'insert.i1.out', punkte: [] }] }],
    master: { automation: [{ id: 'a2', ziel: 'rack.m1', punkte: [], gesperrt: true }] } };
  const aus = [];
  const aendereAus = (rechne) => { aus.push(rechne(p)); };
  sperreUmschalten(aendereAus, 'r1', () => undefined);
  sperreUmschalten(aendereAus, 'master', () => undefined);
  assert.equal(aus[0].befehle[0].lane_id, 'a1');
  assert.equal(aus[1].befehle[0].lane_id, 'a2');
  assert.equal(aus[1].label, LANEN_TEXT.entsperre_label);
});

// ---- Follow-up 2 ----
const offenIds = (s) => s.w(`[...window.djkProd.laneOffen].sort()`);
const aria = (s, id) => s.w(`document.querySelector(${JSON.stringify(kopf(id) + ' .p-lane')}).getAttribute('aria-pressed')`);
const zweitProjekt = (name) => fertig(lauf(neuesProjekt(name), [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'return_neu' }]));

test('FU2 collapsed by default: another project closes return and master rows, tracks and groups keep their state', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r1') + ' .p-lane'); await klick(s, kopf('master') + ' .p-lane');
  await s.w(`window.djkProd.laneOffen.add('s1'); window.djkProd.laneOffen.add('g1')`);
  assert.deepEqual(await offenIds(s), ['g1', 'master', 'r1', 's1']);
  await s.saat(zweitProjekt('Other project'));
  assert.deepEqual(await offenIds(s), ['g1', 's1'], 'only return and master ids are dropped');
  assert.equal(await aria(s, 'r1'), 'false');
  assert.equal(await aria(s, 'master'), 'false');
  assert.deepEqual(await folge(s), ['other', 'lane:s1', 'head:r1', 'head:master'], 'the track lane stays open, no lane head for the return and the master of the new project');
  assert.ok(await s.w(`document.querySelector('.p-arr-strang[data-strang="r1"]').getBoundingClientRect().height`) === 28);
});

test('FU2 same project: an edit, undo and redo keep the open state and the row height of return and master rows', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r1') + ' .p-lane'); await klick(s, kopf('master') + ' .p-lane');
  const vorher = await folge(s), h = await s.w(`document.getElementById('flaeche')?.style.height ?? document.querySelector('[data-p="flaeche"]').style.height`);
  assert.deepEqual(await offenIds(s), ['master', 'r1']);
  const rev = (await s.projekt()).rev;
  await s.post('/proj/aendern', { label: 'x', befehle: [{ befehl: 'return_neu' }], rev });
  assert.ok(await s.bis(async () => (await folge(s)).length === 7));
  assert.deepEqual(await offenIds(s), ['master', 'r1'], 'an edit keeps the open rows');
  await s.post('/proj/undo', { rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await folge(s)).length === 6));
  assert.deepEqual(await offenIds(s), ['master', 'r1'], 'undo keeps laneOffen');
  assert.deepEqual(await folge(s), vorher);
  assert.equal(await s.w(`document.querySelector('[data-lanen-spur="r1"]').getBoundingClientRect().height`), 48, 'the open return row keeps its height after undo');
  assert.equal(await s.w(`document.querySelector('[data-lanen-spur="master"]').getBoundingClientRect().height`), 48);
  assert.equal(await s.w(`document.getElementById('flaeche')?.style.height ?? document.querySelector('[data-p="flaeche"]').style.height`), h, 'surface height unchanged after undo');
  await s.post('/proj/redo', { rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await folge(s)).length === 7));
  assert.deepEqual(await offenIds(s), ['master', 'r1'], 'redo keeps laneOffen');
  assert.equal(await s.w(`document.querySelector('[data-lanen-spur="master"]').getBoundingClientRect().height`), 48);
});

test('FU2 reload of the same slug (same revision and a newer one) keeps the open rows', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r2') + ' .p-lane'); await klick(s, kopf('master') + ' .p-lane');
  const slug = await s.w('window.djkProd.slug'), rev = (await s.projekt()).rev;
  await s.post('/attrappe/sse', { a: 'proj', f: { slug, rev, label: 'again', quelle: 'cypher' } });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(await offenIds(s), ['master', 'r2'], 'the same slug was reloaded: nothing closes');
  assert.deepEqual(await folge(s), ['other', 'head:r1', 'head:r2', 'lane:r2', 'head:master', 'lane:master']);
});

test('FU2 the strip head name is no pointer and a click on it clears the track selection like empty space', opt, async (t) => {
  const s = await seite(t, projekt());
  assert.notEqual(await s.w(`getComputedStyle(document.querySelector(${JSON.stringify(kopf('r1') + ' .p-strangname')})).cursor`), 'pointer');
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('r1') + ' .p-arr-name')})`), null, 'does not reuse the group head class');
  for (const id of ['r1', 'master']) {
    await s.w(`(() => { window.djkProd.spurWahl.add('s1'); })()`);
    assert.equal(await s.w(`window.djkProd.spurWahl.size`), 1);
    await klick(s, kopf(id) + ' .p-strangname');
    assert.equal(await s.w(`window.djkProd.spurWahl.size`), 0, `a click on the name of ${id} clears the selection`);
  }
});

// Return fader lane on the page (headless Chrome against the project stub): T1 the "+ Lane" menu of a return offers Volume, the master and a group do not.
// Without google-chrome the page tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';
import { LANEN_TEXT } from '../public/production/lanes_operation.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const opt = { skip: !CHROME && 'no google-chrome' };
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const fertig = (p) => { p.rev = 1; p.wiedergabe_rev = 1; return JSON.parse(JSON.stringify(p)); };
// r1 has an EQ insert, r2 has none; the master gets an EQ insert, g1 is a group with an EQ insert
const projekt = (extra = []) => fertig(lauf(neuesProjekt('Return fader'), [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'return_neu' }, { befehl: 'return_neu' },
  { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'eq' }, ...extra]));
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const klick = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).click()`);
const kopf = (id) => `.p-arr-strang[data-strang="${id}"]`;
const optionen = (s, sel) => s.w(`[...document.querySelector(${JSON.stringify(sel + ' .p-lane-neu')}).options].map((o) => [o.value, o.textContent])`);
const waehle = (s, sel, wert) => s.w(`(() => { const e = document.querySelector(${JSON.stringify(sel + ' .p-lane-neu')}); e.value = ${JSON.stringify(wert)};
  e.dispatchEvent(new Event('change', { bubbles: true })); })()`);

test('return_lane_kopf_bietet_volume: Volume first after the empty entry; choosing it creates the fader lane that starts at the return fader', opt, async (t) => {
  const s = await seite(t, projekt([{ befehl: 'return_aendern', return_id: 'r1', fader_db: -6 }]));
  await klick(s, kopf('r1') + ' .p-lane');
  const r = '[data-lanen-spur="r1"]';
  const o = await optionen(s, r);
  assert.deepEqual(o.slice(0, 2), [['', LANEN_TEXT.neu], ['fader', 'Volume']]);
  assert.ok(o.length > 2 && o.slice(2).every(([v]) => /^(insert\.|rack\.)/.test(v)), JSON.stringify(o));
  await waehle(s, r, 'fader');
  assert.ok(await s.bis(async () => ((await s.projekt()).returns[0].automation ?? []).length === 1), 'auto_neu reached the return');
  const lane = (await s.projekt()).returns[0].automation[0];
  assert.equal(lane.ziel, 'fader');
  assert.equal(lane.punkte[0].wert, -6, 'the lane starts at the return fader');
  assert.ok(await s.bis(async () => !(await optionen(s, r)).some(([v]) => v === 'fader')), 'Volume leaves the menu once the lane exists');
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(r + ' .p-lane-neu')}).hidden`), false, 'the chain targets are still offered');
});

test('return_lane_kopf_ohne_insert: a return without insert and rack still has a menu with Volume only, no hint', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('r2') + ' .p-lane');
  const r = '[data-lanen-spur="r2"]';
  assert.deepEqual(await optionen(s, r), [['', LANEN_TEXT.neu], ['fader', 'Volume']]);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(r + ' .p-lane-neu')}).hidden`), false);
  assert.notEqual(await s.w(`document.querySelector(${JSON.stringify(r + ' .p-lanentitel')}).textContent`), LANEN_TEXT.keine_ziele_strang);
});

test('master_lane_kopf_ohne_volume: the master with an insert offers chain targets only, without an insert it still shows the hint', opt, async (t) => {
  const s = await seite(t, projekt());
  await klick(s, kopf('master') + ' .p-lane');
  const m = '[data-lanen-spur="master"]';
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(m + ' .p-lane-neu')}).hidden`), true);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(m + ' .p-lanentitel')}).textContent`), LANEN_TEXT.keine_ziele_strang);
  await s.post('/proj/aendern', { label: 'x', befehle: [{ befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'eq' }], rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await optionen(s, m)).length > 1));
  const o = await optionen(s, m);
  assert.ok(o.every(([v]) => v !== 'fader'), JSON.stringify(o));
});

test('gruppe_lane_kopf_ohne_volume: a group lane head never offers Volume', opt, async (t) => {
  const s = await seite(t, projekt([{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s1'] }, { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'eq' }]));
  await klick(s, '.p-arr-gruppe[data-gruppe="g1"] .p-lane');
  const g = '[data-lanen-spur="g1"]';
  assert.ok(await s.bis(() => s.w(`!!document.querySelector(${JSON.stringify(g)})`)));
  const o = await optionen(s, g);
  assert.ok(o.length > 1 && o.every(([v]) => v !== 'fader'), JSON.stringify(o));
});

// ---- T3: the marking on the mixer strip (real CSS) ----
// The AUTO mark lives on the LEVEL knob of the return's dock card (the RETURNS panel is gone): class `auto` on the knob, "AUTO" before its value text.
const marke = (s, id) => s.w(`(() => { const karte = document.querySelector('.p-dock [data-strang="${id}"]'), k = karte.querySelector('[data-w="karte-level"]'), w = k.querySelector('.w-dreh-wert');
  return { cls: k.classList.contains('auto'), content: getComputedStyle(w, '::before').content, text: w.textContent,
    wertRechts: w.getBoundingClientRect().right, karteRechts: karte.getBoundingClientRect().right }; })()`);

test('return_lane_marke_css: the LEVEL knob of a return card with a fader lane shows AUTO before the value, a card without lane does not', opt, async (t) => {
  const s = await seite(t, projekt([{ befehl: 'auto_neu', strang_id: 'r1', ziel: 'fader' }]));
  const mit = await marke(s, 'r1'), ohne = await marke(s, 'r2');
  assert.equal(mit.cls, true);
  assert.equal(mit.content, '"AUTO"');
  assert.equal(ohne.cls, false);
  assert.notEqual(ohne.content, '"AUTO"', `without a lane the browser says ${ohne.content}`);
  assert.equal(mit.text, ohne.text, 'the value text itself is unchanged, AUTO is only the CSS prefix');
  assert.ok(mit.wertRechts <= mit.karteRechts + 0.5, 'the value stays inside the card');
});

test('return_lane_marke_folgt_dem_projekt: a lane created from the menu marks the LEVEL knob at once, deleting it takes the marking away', opt, async (t) => {
  const s = await seite(t, projekt());
  assert.equal((await marke(s, 'r1')).cls, false);
  await klick(s, kopf('r1') + ' .p-lane');
  await waehle(s, '[data-lanen-spur="r1"]', 'fader');
  assert.ok(await s.bis(async () => (await marke(s, 'r1')).cls === true), 'AUTO class after auto_neu');
  await s.post('/proj/aendern', { label: 'x', befehle: [{ befehl: 'auto_loeschen', lane_id: 'a1' }], rev: (await s.projekt()).rev });
  assert.ok(await s.bis(async () => (await marke(s, 'r1')).cls === false), 'class gone after auto_loeschen');
});

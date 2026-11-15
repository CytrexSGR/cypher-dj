// PRODUCTION edit tools (task 1): the EDIT toolbar group, the context menu on the arrangement, split at the pointer, the edge cursor.
//  - pure: editZustand (enabled / disabled and the title that says why), editMenuePunkte (clip menu, lane menu), teileBei (snapped split)
//  - the page in headless Chrome against the project stub: toolbar state follows the selection, right click menu, Split here, Esc / click away, no browser menu, ew-resize
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDIT_KNOEPFE, editZustand, editMenuePunkte } from '../public/production/edit_tools.js';
import { teileBei } from '../public/production/clips.js';
import { starteSeite, neuesProjekt } from '../check/page_mock.mjs';
import { fuehreListeAus } from '../project/commands.ts';

const ALLE = new Set(EDIT_KNOEPFE.map((k) => k.id));
const p = (extra = {}) => ({ spuren: [{ id: 's1', art: 'audio', clips: [{ id: 'c1', art: 'audio', start_beat: 0, laenge_beats: 8 }, { id: 'c2', art: 'audio', start_beat: 8, laenge_beats: 8 }] }], ...extra });

test('EDIT_KNOEPFE: SPLIT, GLUE, DUPLICATE, COPY, CUT, PASTE, DELETE in that order, each title names its shortcut', () => {
  assert.deepEqual(EDIT_KNOEPFE.map((k) => k.text), ['SPLIT', 'GLUE', 'DUPLICATE', 'COPY', 'CUT', 'PASTE', 'DELETE']);
  for (const k of EDIT_KNOEPFE) assert.match(k.hilfe, /\((Ctrl\+\w|Del)\)/, k.id);
});

test('editZustand: no selection disables everything but says why; a selection enables; PASTE needs the clipboard; GLUE needs two', () => {
  const leer = editZustand({ projekt: p(), auswahl: [], ablage: null }, ALLE);
  for (const k of EDIT_KNOEPFE) { assert.equal(leer[k.id].aus, true, k.id); assert.match(leer[k.id].titel, /select|nothing copied/i, k.id); }
  const eins = editZustand({ projekt: p(), auswahl: ['c1'], ablage: null }, ALLE);
  assert.deepEqual(['teilen', 'duplizieren', 'kopieren', 'ausschneiden', 'loeschen'].map((i) => eins[i].aus), [false, false, false, false, false]);
  assert.equal(eins.verbinden.aus, true); assert.match(eins.verbinden.titel, /two or more/);
  assert.equal(eins.einfuegen.aus, true); assert.match(eins.einfuegen.titel, /nothing copied/i, 'PASTE is disabled while the clipboard is empty, selection or not');
  const zwei = editZustand({ projekt: p(), auswahl: ['c1', 'c2'], ablage: { clips: [{}] } }, ALLE);
  assert.equal(zwei.verbinden.aus, false); assert.equal(zwei.einfuegen.aus, false, 'a filled clipboard enables PASTE (the target is the start marker)');
  const keinProjekt = editZustand({ projekt: null, auswahl: [], ablage: null }, ALLE);
  assert.match(keinProjekt.teilen.titel, /open a project/i);
  const nochNicht = editZustand({ projekt: p(), auswahl: ['c1'], ablage: null }, new Set(['teilen']));
  assert.equal(nochNicht.kopieren.aus, true); assert.match(nochNicht.kopieren.titel, /comes with the next step/);
  assert.equal(nochNicht.teilen.aus, false);
});

test('editMenuePunkte: clip menu lists the eight entries (Loop follows the clip), lane menu only Paste here, which is disabled without a clipboard', () => {
  const clip = p().spuren[0].clips[0];
  const m = editMenuePunkte({ projekt: p(), auswahl: ['c1'], clip, ablage: null, kann: ALLE });
  assert.deepEqual(m.map((x) => x.text), ['Split here', 'Glue', 'Duplicate', 'Copy', 'Cut', 'Paste here', 'Loop on', 'Delete']);
  assert.deepEqual(m.map((x) => x.id), ['teilen_bei', 'verbinden', 'duplizieren', 'kopieren', 'ausschneiden', 'einfuegen_bei', 'loop', 'loeschen']);
  assert.equal(m.find((x) => x.id === 'verbinden').aus, true, 'one clip: no glue');
  assert.equal(m.find((x) => x.id === 'einfuegen_bei').aus, true);
  assert.equal(m.find((x) => x.id === 'teilen_bei').aus, false);
  const loop = editMenuePunkte({ projekt: p(), auswahl: ['c1'], clip: { ...clip, loop_beats: 4 }, ablage: { clips: [{}] }, kann: ALLE });
  assert.equal(loop.find((x) => x.id === 'loop').text, 'Loop off');
  assert.equal(loop.find((x) => x.id === 'einfuegen_bei').aus, false);
  const lane = editMenuePunkte({ projekt: p(), auswahl: [], clip: null, ablage: null, kann: ALLE });
  assert.deepEqual(lane.map((x) => x.text), ['Paste here']); assert.equal(lane[0].aus, true); assert.match(lane[0].titel, /nothing copied/i);
});

test('teileBei: the pointer beat snaps to the grid, splits every selected clip that contains it, loop clips and clips not containing it stay', () => {
  const q = p(); q.spuren[0].clips.push({ id: 'c3', art: 'audio', start_beat: 2, laenge_beats: 8, loop_beats: 4 });
  assert.deepEqual(teileBei(q, ['c1', 'c2', 'c3'], 5.3, 1), [{ befehl: 'clip_teilen', clip_id: 'c1', beat: 5 }]);
  assert.deepEqual(teileBei(q, ['c1'], 5.3, 0), [{ befehl: 'clip_teilen', clip_id: 'c1', beat: 5.3 }], 'GRID OFF: free');
  assert.deepEqual(teileBei(q, ['c1'], 0.2, 1), [], 'snapped onto the clip start: nothing to split (error case)');
  assert.deepEqual(teileBei(q, ['c2'], 5, 1), [], 'a selected clip that does not contain the beat');
  assert.deepEqual(teileBei(q, [], 5, 1), []);
});

// ---------- the page ----------
const CHROME = fs.existsSync('/usr/bin/google-chrome');
const KLEIN = { skip: !CHROME && 'no google-chrome' };
const lauf = (pr, b) => fuehreListeAus(pr, b, { quelle: 'andreas' }).projekt;
export function projekt() {
  let q = neuesProjekt('Edit tools');
  q = lauf(q, [{ befehl: 'spur_neu', art: 'audio', name: 'Vocals' }, { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern' } }, { befehl: 'spur_neu', art: 'audio', name: 'Empty' }]);
  q = lauf(q, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 16, sha256: 'a'.repeat(64), name: 'Voc' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 4, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 4, laenge: 1, ton: 38, vel: 90 }] }]);
  q.rev = 1; q.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(q));
}
async function seite(t, opt) {
  const s = await starteSeite(opt);
  t.after(() => s.stoppe());
  await s.oeffne(); await s.saat(projekt());
  return s;
}
// viewport position of (beat, track row) on the overlay canvas
const punkt = (s, beat, zeile, dy = 32) => s.w(`(() => { const r = document.querySelector('[data-p="ueber"]').getBoundingClientRect(), a = window.djkProd.ansicht; return { x: r.left + (${beat} - a.beat0) * a.pxProBeat, y: r.top + ${zeile} * 64 + ${dy} }; })()`);
const klickAn2 = async (s, pt, modifiers) => {
  await s.b.maus('mouseMoved', pt.x, pt.y, { button: 'none', buttons: 0 });
  await s.b.maus('mousePressed', pt.x, pt.y, { modifiers });
  await s.b.maus('mouseReleased', pt.x, pt.y, { buttons: 0, modifiers });
};
const klickAn = async (s, pt, button = 'left') => {
  await s.b.maus('mouseMoved', pt.x, pt.y, { button: 'none', buttons: 0 });
  await s.b.maus('mousePressed', pt.x, pt.y, { button, buttons: button === 'right' ? 2 : 1 });
  await s.b.maus('mouseReleased', pt.x, pt.y, { button, buttons: 0 });
};
const menue = (s) => s.w(`[...document.querySelectorAll('.p-menue button')].map((b) => b.textContent)`);
const knopf = (s, id) => s.w(`(() => { const b = document.querySelector('[data-p="edit-${id}"]'); return b && { aus: b.disabled, aria: b.getAttribute('aria-disabled'), titel: b.title, text: b.textContent }; })()`);

test('page: the EDIT group sits in the head row with seven buttons, disabled and explained without a selection, enabled with one', KLEIN, async (t) => {
  const s = await seite(t);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-transport .p-edit button')].map((b) => b.textContent)`), ['SPLIT', 'GLUE', 'DUPLICATE', 'COPY', 'CUT', 'PASTE', 'DELETE']);
  const teilen = await knopf(s, 'teilen');
  assert.deepEqual([teilen.aus, teilen.aria], [true, 'true']); assert.match(teilen.titel, /select a clip/i); assert.match(teilen.titel, /Ctrl\+E/);
  await klickAn(s, await punkt(s, 8, 0));
  assert.ok(await s.bis(async () => (await knopf(s, 'teilen')).aus === false), 'a selected clip enables SPLIT');
  assert.equal((await knopf(s, 'teilen')).aria, 'false');
  assert.equal((await knopf(s, 'loeschen')).aus, false);
  assert.equal((await knopf(s, 'verbinden')).aus, true, 'GLUE needs two clips');
});

test('page: right click on a clip selects it, opens the menu at the pointer, Split here splits at the snapped pointer beat', KLEIN, async (t) => {
  const s = await seite(t);
  await klickAn(s, await punkt(s, 5.3, 0), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length > 0), 'menu open');
  const m = await menue(s);
  assert.deepEqual(m.slice(0, 8), ['Split here', 'Glue', 'Duplicate', 'Copy', 'Cut', 'Paste here', 'Loop on', 'Delete']);
  assert.deepEqual(await s.w('window.djkProd.auswahl'), ['c1'], 'the clip under the pointer is selected first');
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent === 'Split here').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].clips.length === 2), 'split');
  const c = (await s.projekt()).spuren[0].clips;
  assert.deepEqual(c.map((x) => [x.start_beat, x.laenge_beats]), [[0, 5], [5, 11]], 'grid is one beat: 5.3 snaps to 5');
  assert.deepEqual(await menue(s), [], 'the menu is closed after the pick');
});

test('page: Esc and a click elsewhere close the menu; the browser menu never shows on a lane (empty lane: Paste here only)', KLEIN, async (t) => {
  const s = await seite(t);
  await s.w(`window.__dp = []; document.addEventListener('contextmenu', (e) => window.__dp.push(e.defaultPrevented));`);
  await klickAn(s, await punkt(s, 22, 0), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length === 1), 'the empty lane offers one entry');
  assert.deepEqual(await menue(s), ['Paste here']);
  assert.deepEqual(await s.w('window.__dp'), [true], 'default prevented: no browser menu');
  await s.b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await s.b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.ok(await s.bis(async () => (await menue(s)).length === 0), 'Esc closes');
  await klickAn(s, await punkt(s, 6, 0), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length > 1));
  await klickAn(s, await punkt(s, 28, 0));
  assert.ok(await s.bis(async () => (await menue(s)).length === 0), 'a click elsewhere closes');
});

test('page: the pointer shows ew-resize on the clip edges and nowhere else', KLEIN, async (t) => {
  const s = await seite(t);
  const cursor = () => s.w(`document.querySelector('[data-p="ueber"]').style.cursor`);
  const rand = await punkt(s, 16, 0); rand.x -= 2;
  await s.b.maus('mouseMoved', rand.x, rand.y, { button: 'none', buttons: 0 });
  assert.ok(await s.bis(async () => (await cursor()) === 'ew-resize'), 'right edge');
  const links = await punkt(s, 4, 1, 16); links.x += 2;
  await s.b.maus('mouseMoved', links.x, links.y, { button: 'none', buttons: 0 });
  assert.ok(await s.bis(async () => (await cursor()) === 'ew-resize'), 'left edge');
  const mitte = await punkt(s, 8, 0);
  await s.b.maus('mouseMoved', mitte.x, mitte.y, { button: 'none', buttons: 0 });
  assert.ok(await s.bis(async () => (await cursor()) === ''), 'middle of the clip: default');
});

// ---------- task 2: copy, cut, paste on the page ----------
const taste = async (s, key, code, vk, ctrl = true) => {
  const m = { key, code, windowsVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 };
  await s.b.sende('Input.dispatchKeyEvent', { type: 'keyDown', ...m });
  await s.b.sende('Input.dispatchKeyEvent', { type: 'keyUp', ...m });
};
const menuePunkt = (s, text) => s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
const rev = async (s) => (await s.projekt()).rev;

test('page: Ctrl+C then Ctrl+V pastes at the start marker as ONE undo step, the new clip is selected, PASTE was disabled before the copy', KLEIN, async (t) => {
  const s = await seite(t);
  assert.equal((await knopf(s, 'einfuegen')).aus, true);
  await klickAn(s, await punkt(s, 6, 0));
  await taste(s, 'c', 'KeyC', 67);
  assert.ok(await s.bis(async () => (await knopf(s, 'einfuegen')).aus === false), 'a filled clipboard enables PASTE');
  await s.w('window.djkProd.start = 24');
  const r0 = await rev(s);
  await taste(s, 'v', 'KeyV', 86);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].clips.length === 2), 'pasted');
  const p = await s.projekt();
  assert.equal(p.rev, r0 + 1, 'one project change = one undo step');
  const neu = p.spuren[0].clips[1];
  assert.deepEqual([neu.start_beat, neu.laenge_beats, neu.quelle.sha256], [24, 16, 'a'.repeat(64)]);
  assert.ok(await s.bis(async () => JSON.stringify(await s.w('window.djkProd.auswahl')) === JSON.stringify([neu.id])), 'the new clip is selected');
});

test('page: Ctrl+X removes the clip and Paste here brings it back at the snapped pointer beat on the lane under the pointer; a lane that cannot carry it refuses with a message', KLEIN, async (t) => {
  const s = await seite(t);
  await klickAn(s, await punkt(s, 8, 1, 16));
  await taste(s, 'x', 'KeyX', 88);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[1].clips.length === 0), 'cut');
  await klickAn(s, await punkt(s, 20.4, 1, 16), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length > 0));
  await menuePunkt(s, 'Paste here');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[1].clips.length === 1), 'pasted from the snapshot (the source id is gone)');
  const c = (await s.projekt()).spuren[1].clips[0];
  assert.deepEqual([c.start_beat, c.laenge_beats, c.noten.map((n) => [n.beat, n.ton])], [20, 8, [[0, 36], [4, 38]]]);
  // an audio clip onto the instrument lane: refused, nothing changes
  await klickAn(s, await punkt(s, 6, 0));
  await taste(s, 'c', 'KeyC', 67);
  const r0 = await rev(s);
  await klickAn(s, await punkt(s, 30, 1, 16), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length > 0));
  await menuePunkt(s, 'Paste here');
  assert.ok(await s.bis(async () => /did not fit|Nothing to paste/.test(await s.w(`document.querySelector('[data-p="meldung"]').textContent`))), 'a message says why');
  assert.equal(await rev(s), r0, 'no change');
});

// ---------- task 3: glue on the page ----------
test('page: split, select both pieces, GLUE (button) gives one clip again; Ctrl+J does the same; the selection is the glued clip', KLEIN, async (t) => {
  const s = await seite(t);
  await klickAn(s, await punkt(s, 8.2, 0), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length > 0));
  await menuePunkt(s, 'Split here');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].clips.length === 2), 'split');
  assert.ok(await s.bis(async () => JSON.stringify(await s.w('window.djkProd.auswahl')) === '["c3"]'), 'the selection moves to the new piece');
  await klickAn(s, await punkt(s, 3, 0));
  assert.equal((await knopf(s, 'verbinden')).aus, true, 'one clip selected: no glue');
  await klickAn2(s, await punkt(s, 12, 0), 2);
  assert.ok(await s.bis(async () => (await s.w('window.djkProd.auswahl')).length === 2), 'both pieces selected');
  assert.ok(await s.bis(async () => (await knopf(s, 'verbinden')).aus === false), 'GLUE enabled with two clips');
  const r0 = await rev(s);
  await s.w(`document.querySelector('[data-p="edit-verbinden"]').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].clips.length === 1), 'glued');
  const g = (await s.projekt()).spuren[0].clips[0];
  assert.deepEqual([g.id, g.start_beat, g.laenge_beats], ['c1', 0, 16]);
  assert.equal(await rev(s), r0 + 1, 'one undo step');
  assert.ok(await s.bis(async () => JSON.stringify(await s.w('window.djkProd.auswahl')) === '["c1"]'), 'the glued clip is selected');
  // Ctrl+J: split again, select both, key
  await klickAn(s, await punkt(s, 5.2, 0), 'right');
  assert.ok(await s.bis(async () => (await menue(s)).length > 0));
  await menuePunkt(s, 'Split here');
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].clips.length === 2));
  assert.ok(await s.bis(async () => (await s.w('window.djkProd.auswahl')).length === 1 && (await s.w('window.djkProd.auswahl'))[0] !== 'c1'), 'the selection moved to the new piece');
  await klickAn(s, await punkt(s, 2, 0));
  await klickAn2(s, await punkt(s, 12, 0), 2);
  await taste(s, 'j', 'KeyJ', 74);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].clips.length === 1), 'Ctrl+J glues');
});

test('page: GLUE over clips of different tracks shows the server text and changes nothing', KLEIN, async (t) => {
  const s = await seite(t);
  await klickAn(s, await punkt(s, 6, 0));
  await klickAn2(s, await punkt(s, 8, 1, 16), 2);
  assert.ok(await s.bis(async () => (await s.w('window.djkProd.auswahl')).length === 2));
  const r0 = await rev(s);
  await taste(s, 'j', 'KeyJ', 74);
  assert.ok(await s.bis(async () => /different tracks/i.test(await s.w(`document.querySelector('[data-p="meldung"]').textContent`))), 'the text of verbinden_spur');
  assert.equal(await rev(s), r0);
});

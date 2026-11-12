// Nested groups T7: the group head row of the arrangement (.p-arr-gruppe) in the real page (headless Chrome against the project stub, which computes every
// command with the real core): pinned markup of a flat head, depth class and output options of nested heads, the output select, selecting by head id
// and the select click that must keep the selection. Without google-chrome the tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const GOLDEN = new URL('./support/gruppen_kopf_golden.json', import.meta.url);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const fertig = (p) => { p.rev = 1; p.wiedergabe_rev = 1; return JSON.parse(JSON.stringify(p)); };
const flach = () => fertig(lauf(neuesProjekt('Flat head'), [...['Kick', 'Bass', 'Lead'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })),
  { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }]));
// g1 Inner (s1) inside g2 Outer (s2), g3 Side beside them (s3)
const genestet = () => fertig(lauf(neuesProjekt('Nested head'), [...['Kick', 'Bass', 'Lead'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })),
  { befehl: 'gruppenspur_neu', name: 'Inner', mitglieder: ['s1'] }, { befehl: 'gruppenspur_neu', name: 'Outer', mitglieder: ['g1', 's2'] },
  { befehl: 'gruppenspur_neu', name: 'Side', mitglieder: ['s3'] }]));
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const opt = { skip: !CHROME && 'no google-chrome' };
const kopf = (id) => `.p-arr-gruppe[data-gruppe="${id}"]`;
const wahl = (s) => s.w('[...window.djkProd.spurWahl].sort()');
const klickMit = (s, sel, mod = {}) => s.w(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...${JSON.stringify(mod)} }))`);

test('group head (flat project): the exact markup of the head row is pinned (golden)', opt, async (t) => {
  const s = await seite(t, flach());
  const html = await s.w(`[...document.querySelectorAll('.p-arr-gruppe')].map((e) => e.outerHTML)`);
  if (process.env.GOLDEN_SCHREIBEN) fs.writeFileSync(GOLDEN, JSON.stringify(html, null, 1));
  assert.equal(html.length, 1);
  assert.deepEqual(html, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  assert.equal(await s.w(`document.querySelector('.p-arr-gruppe').classList.contains('p-arr-gruppe--tief')`), false, 'a top-level head has no depth class');
});

test('group head (nested): depth class, indent variables and output options without itself and its descendants', opt, async (t) => {
  const s = await seite(t, genestet());
  const tief = (id) => s.w(`document.querySelector(${JSON.stringify(kopf(id))}).classList.contains('p-arr-gruppe--tief')`);
  assert.equal(await tief('g2'), false); assert.equal(await tief('g1'), true);
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('g1'))}).style.getPropertyValue('--tiefe')`), '1');
  const opts = (id) => s.w(`[...document.querySelector(${JSON.stringify(kopf(id) + ' .p-ausgang')}).options].map((o) => o.value)`);
  assert.deepEqual(await opts('g2'), ['master', 'g3'], 'Outer: not itself, not Inner below it');
  assert.deepEqual(await opts('g1'), ['master', 'g2', 'g3'], 'Inner: not itself');
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('g1') + ' .p-ausgang')}).value`), 'g2', 'the select shows the parent');
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('g1') + ' .p-ausgang')}).getAttribute('aria-label')`), 'Output of group Inner');
});

test('group head: the output select sends ziel_setzen with the chosen target', opt, async (t) => {
  const s = await seite(t, genestet());
  await s.w(`(() => { const e = document.querySelector(${JSON.stringify(kopf('g1') + ' .p-ausgang')}); e.value = 'g3'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).gruppen.find((g) => g.id === 'g1').ausgang?.id === 'g3'));
  await s.w(`(() => { const e = document.querySelector(${JSON.stringify(kopf('g1') + ' .p-ausgang')}); e.value = 'master'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).gruppen.find((g) => g.id === 'g1').ausgang === undefined), 'master removes the target');
});

test('group head: a plain click selects the head id, Shift or Ctrl adds, a second plain click on the lone head lets go', opt, async (t) => {
  const s = await seite(t, genestet());
  const name = (id) => `${kopf(id)} .p-arr-name`;
  await klickMit(s, name('g2'));
  assert.deepEqual(await wahl(s), ['g2'], 'plain click selects the head, not its tracks');
  await klickMit(s, name('g3'), { shiftKey: true });
  assert.deepEqual(await wahl(s), ['g2', 'g3'], 'Shift adds');
  await klickMit(s, name('g3'), { ctrlKey: true });
  assert.deepEqual(await wahl(s), ['g2'], 'Ctrl toggles it off again');
  await klickMit(s, name('g1'), { shiftKey: true });
  await klickMit(s, name('g3'));
  assert.deepEqual(await wahl(s), ['g3'], 'a plain click replaces the selection (wahlUmschalten ersetzen)');
  await klickMit(s, name('g3'));
  assert.deepEqual(await wahl(s), [], 'the lone selected head is let go');
  assert.equal(await s.w(`document.querySelector(${JSON.stringify(kopf('g3'))}).classList.contains('gewaehlt')`), false);
});

test('group head: a click on its output select keeps the selection (error case: a click elsewhere clears it)', opt, async (t) => {
  const s = await seite(t, genestet());
  await klickMit(s, `${kopf('g2')} .p-arr-name`);
  await klickMit(s, `${kopf('g1')} .p-ausgang`);
  assert.deepEqual(await wahl(s), ['g2'], 'the select click does not clear spurWahl');
  await s.w(`document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  assert.deepEqual(await wahl(s), [], 'negative control: a plain click elsewhere clears it');
});

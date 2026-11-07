// Slice 4c T15: the rack on the production page. The pure parts (inserts.js) run in node; the page parts drive the real page in a headless Chrome
// against the project stub (the stub computes every command with the real S2 core). Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt, MAX_RACK as MODELL_RACK, MAX_MAKROS as MODELL_MAKROS, MAX_MAKRO_ZIELE as MODELL_ZIELE } from '../projekt/modell.ts';
import { starteSeite } from '../pruef/seite_attrappe.mjs';
import {
  MAX_RACK, MAX_MAKROS, MAX_MAKRO_ZIELE, makroFaehig, parameterNamen, parameterVon, rackMakros, rackWerte, rackZiele, gemapptVon, makroWert,
  freieZiele, zielHinzu, zielWeg, zielWerte, makroName, rackSetzenBefehl, rackMakroBefehl, straenge,
} from '../oeffentlich/produktion/inserts.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
// s1 Kick with a compressor (i1) and an EQ (i2); s2 Bass without a chain
function projekt(mitRack = false) {
  let p = neuesProjekt('Rack page');
  p = lauf(p, ['Kick', 'Bass'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' }]);
  if (mitRack) {
    p = lauf(p, [{ befehl: 'rack_setzen', strang_id: 's1', makros: [
      { name: 'Duck', ziel: [{ insert: 'i1', param: 'schwelle', von: -60, bis: 0 }] },
      { ziel: [{ insert: 'i2', param: 'b1/gain', von: 0, bis: 12 }, { insert: 'i1', param: 'makeup', von: 0, bis: 6 }] }] }]);
  }
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
const strang = (p, id = 's1') => straenge(p).find((x) => x.id === id);
async function seite(t, p) {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  return s;
}
const zaehle = (s, sel) => s.w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

test('rack in inserts.js: the limits equal the model and the contract', () => {
  assert.deepEqual([MAX_RACK, MAX_MAKROS, MAX_MAKRO_ZIELE], [MODELL_RACK, MODELL_MAKROS, MODELL_ZIELE]);
  assert.deepEqual([MAX_RACK, MAX_MAKROS, MAX_MAKRO_ZIELE], [12, 4, 16]);
});

test('rack in inserts.js: which parameters a macro can drive equals the model (continuous ones only)', async () => {
  const { makroFaehig: modell } = await import('../projekt/modell.ts');
  let n = 0;
  for (const art of ['komp', 'eq', 'saett']) {
    for (const name of parameterNamen(art)) {
      assert.equal(makroFaehig(parameterVon(art, name)), modell(art, name), `${art} ${name}`);
      n += makroFaehig(parameterVon(art, name)) ? 1 : 0;
    }
  }
  assert.equal(n, 8 + (1 + 8 * 3) + 3, 'compressor 8 (not the key), EQ out + 8 bands x freq/gain/q, saturator 3');
  // the cases that matter by name: the key, the switches, the step lists
  assert.equal(modell('komp', 'sc'), false); assert.equal(modell('eq', 'b1/typ'), false); assert.equal(modell('eq', 'propq'), false);
  assert.equal(modell('eq', 'b1/freq'), true); assert.equal(modell('komp', 'schwelle'), true);
});

test('rack in inserts.js: the mapping editor edits are pure, return the whole table, refuse the 17th and unknown places', () => {
  const p = projekt(true), s = strang(p), m = rackMakros(s);
  assert.deepEqual(m.map((x) => x.ziel.length), [1, 2, 0, 0]);
  assert.equal(m[0].name, 'Duck'); assert.equal(m[1].name, '');
  assert.equal(rackZiele(s), 3);
  assert.deepEqual(rackWerte(s), [0, 0, 0, 0]);
  assert.equal(gemapptVon(s, 'i1', 'schwelle'), 1); assert.equal(gemapptVon(s, 'i2', 'b1/gain'), 2); assert.equal(gemapptVon(s, 'i1', 'ratio'), null);
  assert.equal(makroWert({ von: -60, bis: 0 }, 0.5), -30); assert.equal(makroWert({ von: 0, bis: -60 }, 1), -60); assert.equal(makroWert({ von: 0, bis: 1 }, 7), 1);
  // add / change / remove / name; the input is untouched
  const q = parameterVon('komp', 'ratio'), plus = zielHinzu(m, 3, 'i1', 'ratio', q);
  assert.deepEqual(plus[2].ziel, [{ insert: 'i1', param: 'ratio', von: 1, bis: 20 }]); assert.equal(m[2].ziel.length, 0);
  assert.deepEqual(zielWerte(plus, 3, 0, 2, 8)[2].ziel[0], { insert: 'i1', param: 'ratio', von: 2, bis: 8 });
  assert.equal(zielWerte(plus, 3, 0, Number.NaN, 8), null); assert.equal(zielWerte(plus, 3, 5, 1, 2), null);
  assert.equal(zielWeg(plus, 3, 0)[2].ziel.length, 0); assert.equal(zielWeg(plus, 3, 4), null);
  assert.equal(makroName(m, 1, 'Pump')[0].name, 'Pump'); assert.equal(makroName(m, 1, 'x'.repeat(25)), null); assert.equal(makroName(m, 9, 'x'), null);
  // the offered places: continuous parameters of the chain, mapped ones left out, labelled with the stage position
  const frei = freieZiele(s);
  assert.ok(frei.some((f) => f.insert === 'i1' && f.param === 'ratio' && f.text === 'Comp 1 · Ratio'));
  assert.ok(frei.some((f) => f.insert === 'i2' && f.param === 'b3/gain' && f.text === 'EQ 2 · Band 3 Gain'));
  assert.ok(!frei.some((f) => f.insert === 'i1' && f.param === 'schwelle'), 'a mapped parameter is not offered again');
  assert.ok(!frei.some((f) => f.param === 'sc' || f.param.endsWith('/typ') || f.param === 'propq'), 'no key, step list or switch');
  assert.deepEqual(freieZiele(strang(p, 's2')), [], 'a strip without a chain offers nothing');
  // the 17th mapping is not built (AK-S4-16): fill to 16 with the strip's own free places, then one more is null
  let voll = m;
  for (const f of freieZiele(s).slice(0, MAX_MAKRO_ZIELE - 3)) voll = zielHinzu(voll, 4, f.insert, f.param, parameterVon(f.art, f.param));
  assert.equal(voll.reduce((n, x) => n + x.ziel.length, 0), MAX_MAKRO_ZIELE);
  assert.equal(zielHinzu(voll, 4, 'i1', 'ratio', q), null);
});

test('rack in inserts.js: the commands carry the whole table, names only when set', () => {
  const s = strang(projekt(true));
  const b = rackSetzenBefehl('s1', rackMakros(s));
  assert.equal(b.befehl, 'rack_setzen'); assert.equal(b.makros.length, 4);
  assert.equal(b.makros[0].name, 'Duck'); assert.ok(!('name' in b.makros[1]));
  assert.deepEqual(b.makros[1].ziel[0], { insert: 'i2', param: 'b1/gain', von: 0, bis: 12 });
  // the page's command is accepted by the real project (round trip), and the 17th is refused by the project as well (page and project agree)
  const p = lauf(projekt(), [b]);
  assert.equal(p.spuren[0].rack.makros[0].ziel.length, 1);
  assert.deepEqual(rackMakroBefehl('s1', 2, 0.5), { befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 0.5 });
  assert.equal(lauf(p, [rackMakroBefehl('s1', 2, 0.5)]).spuren[0].rack.werte[1], 0.5);
});

test('rack_knopf_und_panel: the button appears only on strips with a chain; the panel has four macros with the mappings', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(true));
  assert.equal(await zaehle(s, '.p-kette[data-strang="s1"] .p-rack-knopf'), 1);
  assert.equal(await zaehle(s, '.p-kette[data-strang="s2"] .p-rack-knopf'), 0, 'no chain, no rack button');
  assert.equal(await s.w(`document.querySelector('.p-rack-knopf[data-strang="s1"]').textContent`), 'Rack 3', 'the button says how many mappings there are');
  assert.equal(await zaehle(s, '.p-rack'), 0, 'closed by default');
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  assert.equal(await zaehle(s, '.p-rack .p-makro'), 4);
  assert.equal(await zaehle(s, '.p-rack .p-makro[data-makro="1"] .p-ziel'), 1);
  assert.equal(await zaehle(s, '.p-rack .p-makro[data-makro="2"] .p-ziel'), 2);
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-makro-name').value`), 'Duck');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-ziel-text').textContent`), 'Comp 1 · Threshold');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-ziel-von').value`), '-60');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-ziel-bis').value`), '0');
});

test('rack_regler_sendet_rack_makro: a macro knob is a control change (no new playback) and the mapped row follows it', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(true));
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  const aend = async () => (await (await fetch(`${s.url}attrappe/aenderungen`)).json());
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="1"] .p-makro-regler'); e.value = '0.5'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.werte[0] === 0.5), 'the macro value reached the project');
  assert.deepEqual((await aend()).at(-1).befehle, ['rack_makro']);
  assert.equal((await aend()).at(-1).wiedergabe, false, 'a knob move is live: no new playback');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-makro-wert').textContent`), '50 %');
  // the mapped row of the compressor shows what the macro gives and is greyed (Q4)
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="schwelle"]').disabled`)) === true), 'the mapped control is disabled');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="schwelle"]').textContent`)) === 'M1 -30.0 dB'), 'the mapped readout shows the macro value');
  assert.match(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-zeile[data-name="schwelle"]').title`), /Driven by macro 1 \(Duck\)/);
  // negative control: an unmapped row of the same stage is live and says nothing about a macro
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="ratio"]').disabled`), false);
  assert.equal(await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="ratio"]').textContent`), '4.0:1');
  // the macro moves again: the readout of the mapped row follows without a rebuild
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="1"] .p-makro-regler'); e.value = '1'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-wert[data-param="schwelle"]').textContent`)) === 'M1 0.0 dB'), 'the mapped readout follows the macro');
  // the project did not change the stage's own value (the own row is ignored, not overwritten)
  assert.equal((await s.projekt()).spuren[0].inserts[0].werte.schwelle, -18);
});

test('rack_editor_ordnet_zu: add a mapping, change von/bis, remove it again; the 16th/17th and a bad range are held back by the page', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, projekt(false));
  const aend = async () => (await (await fetch(`${s.url}attrappe/aenderungen`)).json());
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-makro-regler').disabled`), true, 'no rack yet: the knob waits for a mapping');
  // add Comp 1 Threshold to macro 3 (the select lists "Comp 1 · Threshold")
  await s.w(`(() => { const w = document.querySelector('.p-makro[data-makro="3"] .p-ziel-wahl'); w.value = 'i1|schwelle'; })()`);
  await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-ziel-neu').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack?.makros[2].ziel.length === 1), 'the mapping reached the project');
  assert.deepEqual((await aend()).at(-1).befehle, ['rack_setzen']);
  assert.equal((await aend()).at(-1).wiedergabe, true, 'the mapping table is playback structure');
  assert.deepEqual((await s.projekt()).spuren[0].rack.makros[2].ziel[0], { insert: 'i1', param: 'schwelle', von: -60, bis: 0 });
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-makro-regler').disabled`)) === false), 'the knob is live now');
  // the same parameter is not offered a second time
  assert.equal(await s.w(`[...document.querySelectorAll('.p-makro[data-makro="1"] .p-ziel-wahl option')].some((o) => o.value === 'i1|schwelle')`), false);
  // change von/bis
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="3"] .p-ziel-von'); e.value = '-48'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.makros[2].ziel[0].von === -48), 'von changed');
  // a range outside the parameter is held back by the page: no command, the field is marked
  const vorher = (await aend()).length;
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="3"] .p-ziel-bis'); e.value = '5'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-ziel-bis').classList.contains('falsch')`), true);
  assert.equal((await aend()).length, vorher, 'nothing was sent');
  assert.equal((await s.projekt()).spuren[0].rack.makros[2].ziel[0].bis, 0);
  // name the macro
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="3"] .p-makro-name'); e.value = 'Pump'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.namen[2] === 'Pump'), 'the name reached the project');
  assert.equal((await aend()).at(-1).wiedergabe, false, 'a label is not playback');
  // remove the mapping: the last one removes the rack, the parameter is free again
  await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-ziel-weg').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack === undefined), 'the last mapping removed the rack');
  await s.b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-ins-popover[data-insert="i1"] .p-ins-param[data-param="schwelle"]').disabled`)) === false), 'the parameter is free again');
});

test('rack_voll_16: with 16 mappings the add buttons are off and say why', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  let p = projekt(false);
  const m = [{ ziel: [] }, { ziel: [] }, { ziel: [] }, { ziel: [] }];
  let alle = m;
  for (const f of freieZiele(strang(p)).slice(0, MAX_MAKRO_ZIELE)) alle = zielHinzu(alle, 1 + (f.param.length % 4), f.insert, f.param, parameterVon(f.art, f.param));
  p = JSON.parse(JSON.stringify(lauf(p, [rackSetzenBefehl('s1', alle)])));
  assert.equal(rackZiele(strang(p)), MAX_MAKRO_ZIELE);
  const s = await seite(t, p);
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  assert.equal(await s.w(`[...document.querySelectorAll('.p-ziel-neu')].every((b) => b.disabled)`), true, 'every add button is off');
  assert.match(await s.w(`document.querySelector('.p-ziel-neu').title`), /16 mappings/);
  assert.match(await s.w(`document.querySelector('.p-rack-info').textContent`), /^16 of 16 mappings/);
  // positive control: remove one mapping through the page; the add buttons work again
  await s.w(`document.querySelector('.p-ziel-weg').click()`);
  assert.ok(await s.bis(async () => rackZiele(strang(await s.projekt())) === MAX_MAKRO_ZIELE - 1), 'one mapping less in the project');
  assert.ok(await s.bis(async () => (await s.w(`[...document.querySelectorAll('.p-ziel-neu')].some((b) => !b.disabled)`)) === true), 'an add button is on again');
});

// Slice 4c T15: the rack on the production page. The pure parts (inserts.js) run in node; the page parts drive the real page in a headless Chrome
// against the project stub (the stub computes every command with the real S2 core). Without google-chrome the page tests are skipped and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, MAX_RACK as MODELL_RACK, MAX_MAKROS as MODELL_MAKROS, MAX_MAKRO_ZIELE as MODELL_ZIELE,
  MAX_VARIATIONEN as MODELL_VARIATIONEN, VARIATION_NAME_MAX as MODELL_NAME } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';
import {
  MAX_RACK, MAX_MAKROS, MAX_MAKRO_ZIELE, makroFaehig, parameterNamen, parameterVon, rackMakros, rackWerte, rackZiele, gemapptVon, makroWert,
  freieZiele, zielHinzu, zielWeg, zielWerte, makroName, rackSetzenBefehl, rackMakroBefehl, straenge,
  gliedZiele, freieGliedZiele, gliedZielBereich, zielHinzuGlied, variationBefehl, rackVariationen, MAX_VARIATIONEN, VARIATION_NAME_MAX,
} from '../public/production/inserts.js';

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
  const { makroFaehig: modell } = await import('../project/model.ts');
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
  // the panel is rebuilt after each answer, later than the project state reaches the stub: mark the panel acted on and wait for a new one (no sleeps)
  const markiere = () => s.w(`document.querySelector('.p-rack').dataset.alt = '1'`);
  const neuGebaut = async () => assert.ok(await s.bis(async () => (await s.w(`!!document.querySelector('.p-rack') && document.querySelector('.p-rack').dataset.alt !== '1'`)) === true), 'the panel was rebuilt');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-makro-regler').disabled`), true, 'no rack yet: the knob waits for a mapping');
  // add Comp 1 Threshold to macro 3 (the select lists "Comp 1 · Threshold")
  await s.w(`(() => { const w = document.querySelector('.p-makro[data-makro="3"] .p-ziel-wahl'); w.value = 'i1|schwelle'; })()`);
  await markiere();
  await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-ziel-neu').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack?.makros[2].ziel.length === 1), 'the mapping reached the project');
  assert.deepEqual((await aend()).at(-1).befehle, ['rack_setzen']);
  assert.equal((await aend()).at(-1).wiedergabe, true, 'the mapping table is playback structure');
  assert.deepEqual((await s.projekt()).spuren[0].rack.makros[2].ziel[0], { insert: 'i1', param: 'schwelle', von: -60, bis: 0 });
  await neuGebaut();
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-makro-regler').disabled`)) === false), 'the knob is live now');
  // the same parameter is not offered a second time
  assert.equal(await s.w(`[...document.querySelectorAll('.p-makro[data-makro="1"] .p-ziel-wahl option')].some((o) => o.value === 'i1|schwelle')`), false);
  // change von/bis
  await markiere();
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="3"] .p-ziel-von'); e.value = '-48'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.makros[2].ziel[0].von === -48), 'von changed');
  await neuGebaut();
  // a range outside the parameter is held back by the page: no command, the field is marked
  const vorher = (await aend()).length;
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="3"] .p-ziel-bis'); e.value = '5'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-ziel-bis').classList.contains('falsch')`), true);
  assert.equal((await aend()).length, vorher, 'nothing was sent');
  assert.equal((await s.projekt()).spuren[0].rack.makros[2].ziel[0].bis, 0);
  // name the macro
  await markiere();
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="3"] .p-makro-name'); e.value = 'Pump'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.namen[2] === 'Pump'), 'the name reached the project');
  await neuGebaut();
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

// ---- 1.9 U8 T11 (spec E12, E13): member targets and variations in the mapping editor -----------------------------------------------------------
// s1 is a rack track (RB-338 g1, kit g2, Surge-free) with a compressor i1; macro 1 drives Comp 1 Threshold (insert target) and macro 2 g1 cutoff (member target)
const RB = { art: 'intern', name: 'rb338', parameter: {} };
function rackProjekt(mitZielen = true) {
  let p = neuesProjekt('Rack members');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', kette: 0, glieder: [{ id: 'g1', geraet: RB }, { id: 'g2', geraet: RB }] } }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }]);
  if (mitZielen) {
    p = lauf(p, [{ befehl: 'rack_setzen', strang_id: 's1', makros: [
      { name: 'Duck', ziel: [{ insert: 'i1', param: 'schwelle', von: -60, bis: 0 }] },
      { ziel: [{ glied: 'g1', param: 'cutoff', von: 0.2, bis: 0.9 }] }] }]);
  }
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}

test('gliedZiele: the member parameters a macro may drive, by device (E12); Surge and plain strips offer none', () => {
  const g = (id, geraet) => ({ id, geraet });
  const sp = (glieder) => ({ id: 's1', name: 'R', art: 'spur', inserts: [], geraet: { art: 'rack', kette: 0, glieder } });
  const l = gliedZiele(sp([g('g1', RB), g('g2', { art: 'intern', name: 'kit', kit: 'kit_zwei' }), g('g3', { art: 'wirt', name: 'surge', slot: 1 }),
    g('g4', { art: 'intern', name: 'bk', graph: 'x', parameter: {} })]));
  assert.deepEqual(l.filter((x) => x.glied === 'g1').map((x) => x.param), ['lautstaerke', 'cutoff', 'resonanz', 'env_mod', 'gain_db']);
  assert.deepEqual(l.filter((x) => x.glied === 'g2').map((x) => x.param), ['gain_db']);
  assert.deepEqual(l.filter((x) => x.glied === 'g3'), [], 'a Surge member is refused by the project (makro_ziel_wirt): the page does not offer it');
  assert.deepEqual(l.filter((x) => x.glied === 'g4').map((x) => x.param), [...Array.from({ length: 64 }, (_, i) => `k${i + 1}`), 'gain_db']);
  assert.deepEqual(Object.keys(l[0]).sort(), ['glied', 'param', 'text']);
  assert.equal(l[1].text, 'G1 RB-338 · Cutoff');
  assert.deepEqual(gliedZiele({ id: 's2', inserts: [] }), [], 'a strip without a rack device');
  const bereich = (gl, par) => { const b = gliedZielBereich(sp([g('g1', RB)]), gl, par); return b && [b.min, b.max]; };
  assert.deepEqual(bereich('g1', 'gain_db'), [-60, 12]); assert.deepEqual(bereich('g1', 'cutoff'), [0, 1]);
  assert.equal(gliedZielBereich(sp([g('g1', RB)]), 'g1', 'nix'), null);
});

test('member targets survive the mapping table round trip: an edit on the insert target sends both targets (E12)', () => {
  const p = rackProjekt(), s = strang(p);
  const m = rackMakros(s);
  assert.deepEqual(m[1].ziel, [{ glied: 'g1', param: 'cutoff', von: 0.2, bis: 0.9 }]);
  assert.equal(rackZiele(s), 2);
  const b = rackSetzenBefehl('s1', zielWerte(m, 1, 0, -48, 0));
  assert.deepEqual(b.makros[0].ziel, [{ insert: 'i1', param: 'schwelle', von: -48, bis: 0 }]);
  assert.deepEqual(b.makros[1].ziel, [{ glied: 'g1', param: 'cutoff', von: 0.2, bis: 0.9 }], 'the member target is not lost and not reshaped');
  assert.equal(lauf(p, [b]).spuren[0].rack.makros[1].ziel[0].glied, 'g1', 'the project accepts the table');
  // a mapped member parameter is not offered again; the others are
  const frei = freieGliedZiele(s);
  assert.ok(!frei.some((f) => f.glied === 'g1' && f.param === 'cutoff')); assert.ok(frei.some((f) => f.glied === 'g1' && f.param === 'resonanz'));
  // adding a member target
  const plus = zielHinzuGlied(m, 3, 'g2', 'gain_db', { min: -60, max: 12 });
  assert.deepEqual(plus[2].ziel, [{ glied: 'g2', param: 'gain_db', von: -60, bis: 12 }]);
  assert.equal(lauf(p, [rackSetzenBefehl('s1', plus)]).spuren[0].rack.makros[2].ziel[0].param, 'gain_db');
  assert.equal(zielHinzuGlied(m, 3, 'g2', 'gain_db', null), null, 'an unknown parameter builds nothing');
});

test('variationBefehl: one /proj/aendern body per command; the list reads from the rack; the project takes them', () => {
  assert.deepEqual(variationBefehl('s1', 'speichern', 'warm'), { befehl: 'makro_variation_speichern', strang_id: 's1', name: 'warm' });
  assert.deepEqual(variationBefehl('s1', 'laden', 'warm'), { befehl: 'makro_variation_laden', strang_id: 's1', name: 'warm' });
  assert.deepEqual(variationBefehl('s1', 'loeschen', 'warm'), { befehl: 'makro_variation_loeschen', strang_id: 's1', name: 'warm' });
  assert.equal(variationBefehl('s1', 'weg', 'warm'), null, 'an unknown kind builds nothing'); assert.equal(variationBefehl('s1', 'speichern', '  '), null, 'an empty name builds nothing');
  assert.equal(variationBefehl('s1', 'speichern', 'x'.repeat(33)), null, 'a name over 32 characters builds nothing');
  assert.deepEqual([MAX_VARIATIONEN, VARIATION_NAME_MAX], [MODELL_VARIATIONEN, MODELL_NAME]);
  assert.deepEqual([MAX_VARIATIONEN, VARIATION_NAME_MAX], [8, 32]);
  let p = rackProjekt();
  assert.deepEqual(rackVariationen(strang(p)), []);
  p = lauf(p, [rackMakroBefehl('s1', 1, 0.25), variationBefehl('s1', 'speichern', 'warm')]);
  assert.deepEqual(rackVariationen(strang(p)), [{ name: 'warm', werte: [0.25, 0, 0, 0] }]);
  p = lauf(p, [variationBefehl('s1', 'loeschen', 'warm')]);
  assert.deepEqual(rackVariationen(strang(p)), []);
});

test('rack_glied_ziele_im_editor: a member target is listed, kept on an insert edit, added from the select; the button shows on a rack strip without a chain', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, rackProjekt());
  const aend = async () => (await (await fetch(`${s.url}attrappe/aenderungen`)).json());
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="2"] .p-ziel-text').textContent`), 'G1 RB-338 · Cutoff', 'the member target is shown by member and parameter');
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="2"] .p-ziel').dataset.glied`), 'g1');
  // The panel is rebuilt from the project after every answer (the project state reaches the stub before the redraw), so each step that changes the table marks the
  // panel it acts on and waits until a new one stands there (no sleeps): only then are the fields the ones of the server state.
  const markiere = () => s.w(`document.querySelector('.p-rack').dataset.alt = '1'`);
  const neuGebaut = async () => assert.ok(await s.bis(async () => (await s.w(`!!document.querySelector('.p-rack') && document.querySelector('.p-rack').dataset.alt !== '1'`)) === true), 'the panel was rebuilt');
  // negative control, the finding of T7: an edit on the INSERT target sends the whole table with the member target in it
  await markiere();
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="1"] .p-ziel-von'); e.value = '-48'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.makros[0].ziel[0].von === -48), 'the insert edit arrived');
  await neuGebaut();
  assert.deepEqual((await aend()).at(-1).befehle, ['rack_setzen']);
  assert.deepEqual((await s.projekt()).spuren[0].rack.makros[1].ziel, [{ glied: 'g1', param: 'cutoff', von: 0.2, bis: 0.9 }], 'the member target is still there');
  // the range of a member target is checked against the member parameter (0..1), not the insert table
  const vorher = (await aend()).length;
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="2"] .p-ziel-bis'); e.value = '5'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.equal(await s.w(`document.querySelector('.p-makro[data-makro="2"] .p-ziel-bis').classList.contains('falsch')`), true);
  assert.equal((await aend()).length, vorher, 'nothing sent for a range outside 0..1');
  await markiere();
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="2"] .p-ziel-bis'); e.value = '0.5'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.makros[1].ziel[0].bis === 0.5));
  await neuGebaut();
  // add a member target from the select (macro 3, member g2 gain)
  assert.equal(await s.w(`[...document.querySelectorAll('.p-makro[data-makro="3"] .p-ziel-wahl option')].some((o) => o.value === 'g|g2|gain_db')`), true);
  assert.equal(await s.w(`[...document.querySelectorAll('.p-makro[data-makro="3"] .p-ziel-wahl option')].some((o) => o.value === 'g|g1|cutoff')`), false, 'mapped: not offered again');
  await markiere();
  await s.w(`(() => { document.querySelector('.p-makro[data-makro="3"] .p-ziel-wahl').value = 'g|g2|gain_db'; document.querySelector('.p-makro[data-makro="3"] .p-ziel-neu').click(); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.makros[2].ziel.length === 1), 'the member target reached the project');
  await neuGebaut();
  assert.deepEqual((await s.projekt()).spuren[0].rack.makros[2].ziel[0], { glied: 'g2', param: 'gain_db', von: -60, bis: 12 });
  assert.equal((await s.projekt()).spuren[0].rack.makros[0].ziel.length, 1, 'macro 1 kept its insert target');
  // remove the member target again
  await s.w(`document.querySelector('.p-makro[data-makro="3"] .p-ziel-weg').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.makros[2].ziel.length === 0));
});

test('rack_knopf_auf_rack_spur_ohne_kette: a rack track without a chain has the button and can take its first member target', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  let p = rackProjekt(false);
  p = JSON.parse(JSON.stringify(lauf(p, [{ befehl: 'insert_entfernen', insert_id: 'i1' }])));
  const s = await seite(t, p);
  assert.equal(await zaehle(s, '.p-kette[data-strang="s1"] .p-rack-knopf'), 1);
  await s.w(`document.querySelector('#inserts, details.p-inserts, [data-d="inserts"]')?.setAttribute('open', '')`);
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  await s.w(`(() => { document.querySelector('.p-makro[data-makro="1"] .p-ziel-wahl').value = 'g|g1|cutoff'; document.querySelector('.p-makro[data-makro="1"] .p-ziel-neu').click(); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack?.makros[0].ziel.length === 1), 'the first member target created the rack');
  assert.deepEqual((await s.projekt()).spuren[0].rack.makros[0].ziel[0], { glied: 'g1', param: 'cutoff', von: 0, bis: 1 });
});

test('rack_variationen_liste: save, load and delete send the three commands; load is a control change; the list holds 8 at most', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, rackProjekt());
  const aend = async () => (await (await fetch(`${s.url}attrappe/aenderungen`)).json());
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  assert.equal(await zaehle(s, '.p-variation'), 0, 'no variation yet');
  await s.w(`(() => { const e = document.querySelector('.p-makro-regler[aria-label]'); e.value = '0.5'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.werte[0] === 0.5));
  await s.w(`(() => { const e = document.querySelector('.p-variation-name'); e.value = 'warm'; document.querySelector('.p-variation-speichern').click(); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.variationen?.length === 1), 'saved');
  assert.deepEqual((await aend()).at(-1).befehle, ['makro_variation_speichern']);
  assert.ok(await s.bis(async () => (await zaehle(s, '.p-variation[data-name="warm"]')) === 1), 'listed');
  await s.w(`(() => { const e = document.querySelector('.p-makro[data-makro="1"] .p-makro-regler'); e.value = '0.9'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.werte[0] === 0.9));
  await s.w(`document.querySelector('.p-variation[data-name="warm"] .p-variation-laden').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.werte[0] === 0.5), 'loaded');
  assert.deepEqual((await aend()).at(-1).befehle, ['makro_variation_laden']);
  assert.equal((await aend()).at(-1).wiedergabe, false, 'a load is live: no new playback');
  assert.ok(await s.bis(async () => (await s.w(`document.querySelector('.p-makro[data-makro="1"] .p-makro-regler').value`)) === '0.5'), 'the knob shows the loaded value');
  await s.w(`document.querySelector('.p-variation[data-name="warm"] .p-variation-loeschen').click()`);
  assert.ok(await s.bis(async () => (await s.projekt()).spuren[0].rack.variationen === undefined), 'deleted');
  assert.deepEqual((await aend()).at(-1).befehle, ['makro_variation_loeschen']);
  // error case: an empty name sends nothing
  const n = (await aend()).length;
  await s.w(`(() => { document.querySelector('.p-variation-name').value = '  '; document.querySelector('.p-variation-speichern').click(); })()`);
  assert.equal((await aend()).length, n, 'an empty name is held back by the page');
});

test('rack_variationen_ohne_rack: without a rack (no mapping yet) the save button is off and says why', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t, rackProjekt(false));
  await s.b.klick('.p-rack-knopf[data-strang="s1"]');
  assert.equal(await s.w(`document.querySelector('.p-variation-speichern').disabled`), true);
  assert.match(await s.w(`document.querySelector('.p-variation-speichern').title`), /Map a parameter first/);
});

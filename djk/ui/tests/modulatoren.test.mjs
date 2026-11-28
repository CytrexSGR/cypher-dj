// Strand 6 task 1.1: project-level modulators (LFO) in the project model and the AUTO commands mod_neu, mod_aendern, mod_loeschen.
// Pure calculation: no server, no core. The playback (translator) is task 1.2.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import {
  pruefeProjekt, kanonisch, alleInserts, MAX_MODULATOREN, MAX_MOD_ZIELE, MAX_MOD_FELDER, MOD_TIEFE, modTiefeBereich, modulatorenBereinigen,
  neuerModulator, wiedergabeSicht,
} from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { uebersetze } from '../project/playback.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { basisProjekt, szenarioOhneInserts } from './support/inserts_scenario.mjs';
import { ohneAbgeleitetes } from './support/project.mjs';

const lauf = (p, b) => fuehreListeAus(p, Array.isArray(b) ? b : [b], { quelle: 'andreas' }).projekt;
const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreListeAus(p, Array.isArray(b) ? b : [b]),
  (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund} for ${JSON.stringify(b).slice(0, 160)}`);
const pruefe = (p, r) => {
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
};
// s1..s3 audio, s4 RB-338, s5 bk, return r1
const szene = () => {
  let p = basisProjekt();
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'Acid', geraet: { art: 'intern', name: 'rb338', parameter: {} } });
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'Mod', geraet: { art: 'intern', name: 'bk', graph: 'synth-neuro' } });
  p = lauf(p, { befehl: 'return_neu', name: 'Hall' });
  return p;
};
const fader = (strang_id, tiefe = -6) => ({ strang_id, ziel: 'fader', tiefe });

test('constants and depth ranges per target', () => {
  assert.equal(MAX_MODULATOREN, 16); assert.equal(MAX_MOD_ZIELE, 8); assert.equal(MAX_MOD_FELDER, 32);
  assert.deepEqual(modTiefeBereich('fader'), [-24, 24]);
  assert.deepEqual(modTiefeBereich('pan'), [-1, 1]);
  assert.deepEqual(modTiefeBereich('geraet.k3'), [-1, 1]);
  assert.deepEqual(modTiefeBereich('send.r1'), [-24, 24]);
  assert.deepEqual(modTiefeBereich('insert.i1.schwelle'), [-1, 1]);
  assert.deepEqual(modTiefeBereich('rack.m2'), [-1, 1]);
  assert.deepEqual(modTiefeBereich('plugin.i1.3'), [-1, 1]);
  assert.equal(modTiefeBereich('mute'), null);
  assert.deepEqual(Object.keys(MOD_TIEFE).sort(), ['fader', 'geraet', 'insert', 'pan', 'plugin', 'rack', 'send']);
});

test('mod_neu: defaults lfo, sinus, takt 4; id m1, nr 1; valid; patches round-trip; neuerModulator names it', () => {
  const p = szene();
  const r = ok(p, { befehl: 'mod_neu', ziele: [fader('s1')] });
  pruefe(p, r);
  assert.deepEqual(r.projekt.modulatoren, [{ id: 'm1', nr: 1, art: 'lfo', form: 'sinus', takt: 4, ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }] }]);
  assert.deepEqual(neuerModulator(p, r.projekt), { mod_id: 'm1', nr: 1 });
  assert.equal(r.projekt.naechste_id.mod, 2);
  // every field, a free rate
  const r2 = ok(r.projekt, { befehl: 'mod_neu', name: 'Wobble', form: 'rechteck', hz: 2.5, phase: 0.25, glatt_ms: 3,
    ziele: [{ strang_id: 's4', ziel: 'geraet.cutoff', tiefe: 0.4, polaritaet: 'uni' }, { strang_id: 's5', ziel: 'geraet.k3', tiefe: -0.25 },
      { strang_id: 'r1', ziel: 'fader', tiefe: 3 }, { strang_id: 's2', ziel: 'pan', tiefe: 1 }] });
  pruefe(r.projekt, r2);
  assert.deepEqual(r2.projekt.modulatoren[1], { id: 'm2', nr: 2, name: 'Wobble', art: 'lfo', form: 'rechteck', hz: 2.5, phase: 0.25, glatt_ms: 3,
    ziele: [{ strang_id: 's4', ziel: 'geraet.cutoff', tiefe: 0.4, polaritaet: 'uni' }, { strang_id: 's5', ziel: 'geraet.k3', tiefe: -0.25 },
      { strang_id: 'r1', ziel: 'fader', tiefe: 3 }, { strang_id: 's2', ziel: 'pan', tiefe: 1 }] });
  assert.deepEqual(neuerModulator(r.projekt, r2.projekt), { mod_id: 'm2', nr: 2 });
  // the same target in two modulators is allowed
  pruefe(r2.projekt, ok(r2.projekt, { befehl: 'mod_neu', ziele: [fader('s1', 3)] }));
});

test('nr is the lowest free number and stays; ids never come back', () => {
  let p = szene();
  for (let i = 0; i < 3; i++) p = lauf(p, { befehl: 'mod_neu', ziele: [fader('s1')] });
  p = lauf(p, { befehl: 'mod_loeschen', mod_id: 'm2' });
  assert.deepEqual(p.modulatoren.map((m) => [m.id, m.nr]), [['m1', 1], ['m3', 3]]);
  p = lauf(p, { befehl: 'mod_neu', ziele: [fader('s2')] });
  assert.deepEqual(p.modulatoren.map((m) => [m.id, m.nr]), [['m1', 1], ['m3', 3], ['m4', 2]]);
});

test('the 17th modulator is mod_voll', () => {
  let p = szene();
  p = lauf(p, Array.from({ length: 16 }, () => ({ befehl: 'mod_neu', ziele: [fader('s1')] })));
  assert.equal(p.modulatoren.length, 16);
  assert.deepEqual(p.modulatoren.map((m) => m.nr), Array.from({ length: 16 }, (_, i) => i + 1));
  lehntAb(p, { befehl: 'mod_neu', ziele: [fader('s2')] }, 'mod_voll');
});

test('mod_aendern: fields, takt/hz switch, an false and true, ziele replaced; mod_loeschen; unknown id', () => {
  const p = lauf(szene(), { befehl: 'mod_neu', ziele: [fader('s1')] });
  let r = ok(p, { befehl: 'mod_aendern', mod_id: 'm1', hz: 1, form: 'zufall', an: false, name: 'R' });
  pruefe(p, r);
  assert.deepEqual(r.projekt.modulatoren[0], { id: 'm1', nr: 1, name: 'R', art: 'lfo', form: 'zufall', hz: 1, an: false, ziele: [fader('s1')] });
  r = ok(r.projekt, { befehl: 'mod_aendern', mod_id: 'm1', takt: 0.5, an: true, ziele: [{ strang_id: 's2', ziel: 'pan', tiefe: -0.5 }] });
  assert.deepEqual(r.projekt.modulatoren[0], { id: 'm1', nr: 1, name: 'R', art: 'lfo', form: 'zufall', takt: 0.5,
    ziele: [{ strang_id: 's2', ziel: 'pan', tiefe: -0.5 }] });
  const d = ok(r.projekt, { befehl: 'mod_loeschen', mod_id: 'm1' });
  pruefe(r.projekt, d);
  assert.equal('modulatoren' in d.projekt, false, 'an empty list is never written');
  for (const b of [{ befehl: 'mod_aendern', mod_id: 'm9', takt: 2 }, { befehl: 'mod_loeschen', mod_id: 'm9' }]) lehntAb(p, b, 'mod_unbekannt');
  lehntAb(p, { befehl: 'mod_aendern', mod_id: 'm1', nr: 3 }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'mod_aendern', mod_id: 'm1', takt: 2, hz: 1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'mod_aendern', mod_id: 'm1', an: 'nein' }, 'argument_ungueltig');
});

test('refusals of mod_neu: ranges, takt and hz together, bad and duplicate targets, unknown fields', () => {
  const p = szene();
  const b = (x) => ({ befehl: 'mod_neu', ziele: [fader('s1')], ...x });
  lehntAb(p, b({ takt: 2, hz: 1 }), 'argument_ungueltig');
  lehntAb(p, b({ takt: 1 / 128 }), 'argument_ungueltig');
  lehntAb(p, b({ takt: 257 }), 'argument_ungueltig');
  lehntAb(p, b({ hz: 41 }), 'argument_ungueltig');
  lehntAb(p, b({ hz: 0.001 }), 'argument_ungueltig');
  lehntAb(p, b({ phase: 1.5 }), 'argument_ungueltig');
  lehntAb(p, b({ phase: 1 }), 'argument_ungueltig');   // the core reads phase in [0, 1): 1 is the position of 0
  lehntAb(p, b({ phase: -0.1 }), 'argument_ungueltig');
  pruefe(p, ok(p, b({ phase: 0.999 })));
  lehntAb(p, b({ glatt_ms: 501 }), 'argument_ungueltig');
  lehntAb(p, b({ form: 'saegezahn' }), 'argument_ungueltig');
  lehntAb(p, b({ art: 'folger' }), 'argument_ungueltig');   // a follower needs its source track (quelle)
  lehntAb(p, b({ name: 'x'.repeat(33) }), 'argument_ungueltig');
  lehntAb(p, b({ quelle: 's2' }), 'argument_unbekannt');   // a follower field on an LFO
  lehntAb(p, b({ tempo: 1 }), 'argument_unbekannt');
  lehntAb(p, b({ ziele: [] }), 'argument_ungueltig');
  lehntAb(p, b({ ziele: Array.from({ length: MAX_MOD_ZIELE + 1 }, (_, i) => fader(`s${(i % 3) + 1}`)) }), 'argument_ungueltig');
  // depth outside the range of its target
  lehntAb(p, b({ ziele: [fader('s1', 25)] }), 'argument_ungueltig');
  lehntAb(p, b({ ziele: [{ strang_id: 's1', ziel: 'pan', tiefe: 1.1 }] }), 'argument_ungueltig');
  lehntAb(p, b({ ziele: [{ strang_id: 's5', ziel: 'geraet.k3', tiefe: -2 }] }), 'argument_ungueltig');
  lehntAb(p, b({ ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: 1, polaritaet: 'bi' }] }), 'argument_ungueltig');
  lehntAb(p, b({ ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: 1, extra: 1 }] }), 'argument_unbekannt');
  // the same target twice in one modulator
  lehntAb(p, b({ ziele: [fader('s1'), fader('s1', 2)] }), 'argument_ungueltig');
  // targets this slice does not take, unknown strips, device targets that the device does not have
  for (const z of [{ strang_id: 's9', ziel: 'fader', tiefe: 1 }, { strang_id: 's1', ziel: 'mute', tiefe: 1 },
    { strang_id: 'r1', ziel: 'pan', tiefe: 0.5 }, { strang_id: 'master', ziel: 'fader', tiefe: 1 },
    { strang_id: 's1', ziel: 'geraet.k3', tiefe: 0.5 }, { strang_id: 's4', ziel: 'geraet.k3', tiefe: 0.5 },
    { strang_id: 's5', ziel: 'geraet.cutoff', tiefe: 0.5 }, { strang_id: 's1', ziel: 'send.r1', tiefe: 1 },
    { strang_id: 's1', ziel: 'rack.m1', tiefe: 0.5 }, { strang_id: 's1', ziel: 'plugin.i1.3', tiefe: 0.5 }]) {
    lehntAb(p, b({ ziele: [z] }), 'mod_ziel_unbekannt');
  }
});

test('at most MAX_MOD_FELDER distinct fader and pan targets over all modulators (zu_gross)', () => {
  let p = basisProjekt();
  p = lauf(p, Array.from({ length: 13 }, () => ({ befehl: 'spur_neu', art: 'audio' })));   // s1..s16
  const felder = Array.from({ length: 16 }, (_, i) => [fader(`s${i + 1}`), { strang_id: `s${i + 1}`, ziel: 'pan', tiefe: 0.5 }]).flat();
  for (let k = 0; k < 4; k++) p = lauf(p, { befehl: 'mod_neu', ziele: felder.slice(k * 8, k * 8 + 8) });   // 32 fields
  p = lauf(p, { befehl: 'mod_neu', ziele: [fader('s1', 2)] });   // a field already counted
  p = lauf(p, { befehl: 'spur_neu', art: 'audio' });
  lehntAb(p, { befehl: 'mod_neu', ziele: [fader('s17')] }, 'zu_gross');
  lehntAb(p, { befehl: 'mod_aendern', mod_id: 'm5', ziele: [fader('s1'), fader('s17')] }, 'zu_gross');
});

test('the model refuses broken modulator lists', () => {
  const p = lauf(szene(), [{ befehl: 'mod_neu', ziele: [fader('s1')] }, { befehl: 'mod_neu', ziele: [fader('s2')] }]);
  assert.equal(pruefeProjekt(p).fehler, undefined);
  const kaputt = (f) => { const k = structuredClone(p); f(k); return pruefeProjekt(k).fehler; };
  assert.ok(kaputt((k) => { k.modulatoren = []; }), 'empty list');
  assert.ok(kaputt((k) => { k.modulatoren[1].nr = 1; }), 'nr twice');
  assert.ok(kaputt((k) => { k.modulatoren[1].nr = 17; }), 'nr above 16');
  assert.ok(kaputt((k) => { k.modulatoren[1].id = 'm1'; }), 'id twice');
  assert.ok(kaputt((k) => { k.modulatoren[0].an = true; }), 'an: true is never written');
  assert.ok(kaputt((k) => { k.modulatoren[0].hz = 1; }), 'takt and hz');
  assert.ok(kaputt((k) => { k.modulatoren[0].wert = 1; }), 'unknown field');
  assert.ok(kaputt((k) => { k.modulatoren[0].ziele[0].strang_id = 's99'; }), 'unknown strip');
  assert.ok(kaputt((k) => { k.modulatoren[0].ziele[0].tiefe = 30; }), 'depth range');
  assert.ok(kaputt((k) => { k.naechste_id.mod = 0; }), 'counter');
  // /1 projects have no modulators
  const pflicht = ['name', 'rev', 'wiedergabe_rev', 'tempo_bpm', 'taktart', 'loop', 'metronom', 'spuren', 'modulatoren'];
  const alt = { format: 'cypherdj-projekt/1', ...Object.fromEntries(pflicht.map((k) => [k, structuredClone(p[k])])) };
  assert.ok(/modulatoren/.test(pruefeProjekt(alt).fehler ?? ''), pruefeProjekt(alt).fehler);
});

test('cleanup: deleting a track or a return drops its targets; a modulator without targets goes; other modulators stay', () => {
  let p = szene();
  p = lauf(p, [{ befehl: 'mod_neu', ziele: [fader('s1'), fader('s2')] }, { befehl: 'mod_neu', ziele: [fader('s1', 3)] },
    { befehl: 'mod_neu', ziele: [fader('r1', 2)] }, { befehl: 'mod_neu', ziele: [{ strang_id: 's5', ziel: 'geraet.k3', tiefe: 0.5 }] }]);
  const r = ok(p, { befehl: 'spur_loeschen', spur_id: 's1' });
  pruefe(p, r);
  assert.deepEqual(r.projekt.modulatoren.map((m) => [m.id, m.ziele.map((z) => z.strang_id)]), [['m1', ['s2']], ['m3', ['r1']], ['m4', ['s5']]]);
  const r2 = ok(r.projekt, { befehl: 'return_loeschen', return_id: 'r1' });
  pruefe(r.projekt, r2);
  assert.deepEqual(r2.projekt.modulatoren.map((m) => m.id), ['m1', 'm4']);
  const r3 = lauf(r2.projekt, [{ befehl: 'spur_loeschen', spur_id: 's2' }, { befehl: 'spur_loeschen', spur_id: 's5' }]);
  assert.equal('modulatoren' in r3, false, 'the last modulator goes with its last target; the list goes with it');
});

test('cleanup: removing or replacing an insert keeps modulators on other targets of the strip and is valid', () => {
  let p = szene();
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, { befehl: 'mod_neu', ziele: [fader('s1')] }]);
  const id = alleInserts(p).find((x) => x.strangId === 's1').insert.id;
  const r = ok(p, { befehl: 'insert_entfernen', insert_id: id });
  pruefe(p, r);
  assert.deepEqual(r.projekt.modulatoren[0].ziele, [fader('s1')]);
  const r2 = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', ersetzen: true });
  pruefe(p, r2);
  assert.deepEqual(r2.projekt.modulatoren[0].ziele, [fader('s1')]);
});

test('modulatorenBereinigen: stage, plugin, send and rack targets follow their stage, return and rack; a lost follower source turns it off', () => {
  const p = lauf(szene(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, { befehl: 'mod_neu', ziele: [fader('s2')] }]);
  const id = alleInserts(p).find((x) => x.strangId === 's1').insert.id;
  const k = structuredClone(p);
  k.modulatoren = [
    { id: 'm1', nr: 1, art: 'lfo', ziele: [{ strang_id: 's1', ziel: `insert.${id}.schwelle`, tiefe: 0.2 }, { strang_id: 's1', ziel: 'insert.i99.schwelle', tiefe: 0.2 },
      { strang_id: 's1', ziel: 'plugin.i99.3', tiefe: 0.2 }, { strang_id: 's1', ziel: 'rack.m1', tiefe: 0.2 }, { strang_id: 's1', ziel: 'send.r1', tiefe: 2 },
      { strang_id: 's1', ziel: 'send.r9', tiefe: 2 }] },
    { id: 'm2', nr: 2, art: 'folger', quelle: 's9', ziele: [fader('s2')] },
    { id: 'm3', nr: 3, art: 'lfo', ziele: [{ strang_id: 's1', ziel: 'plugin.i99.4', tiefe: 0.2 }] },
  ];
  modulatorenBereinigen(k);
  assert.deepEqual(k.modulatoren, [
    { id: 'm1', nr: 1, art: 'lfo',
      ziele: [{ strang_id: 's1', ziel: `insert.${id}.schwelle`, tiefe: 0.2 }, { strang_id: 's1', ziel: 'send.r1', tiefe: 2 }] },
    { id: 'm2', nr: 2, art: 'folger', quelle: 's9', an: false, ziele: [fader('s2')] },
  ]);
  const leer = structuredClone(p);
  delete leer.modulatoren;
  modulatorenBereinigen(leer);
  assert.equal('modulatoren' in leer, false);
});

test('round trip: a project with modulators loads and saves unchanged; the playback view carries the active ones only', () => {
  const p = lauf(szene(), [{ befehl: 'mod_neu', name: 'A', ziele: [fader('s1')] }, { befehl: 'mod_neu', ziele: [fader('s2')] },
    { befehl: 'mod_aendern', mod_id: 'm2', an: false }]);
  const t = kanonisch(p);
  const g = pruefeProjekt(JSON.parse(t));
  assert.equal(g.fehler, undefined, g.fehler);
  assert.equal(kanonisch(g.projekt), t);
  const sicht = wiedergabeSicht(p);
  assert.deepEqual(sicht.modulatoren, [{ id: 'm1', nr: 1, art: 'lfo', form: 'sinus', takt: 4, ziele: [fader('s1')] }], 'no name, no switched-off modulator');
  const ohne = lauf(p, [{ befehl: 'mod_loeschen', mod_id: 'm1' }, { befehl: 'mod_loeschen', mod_id: 'm2' }]);
  assert.equal('modulatoren' in wiedergabeSicht(ohne), false);
});

test('golden: a project without modulators serialises byte-identical to the recorded old format and loads back unchanged', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'support', 'inserts_ohne_golden.json'), 'utf8'));
  const s = szenarioOhneInserts();
  assert.equal(s.kanonisch, golden.kanonisch);
  assert.equal(s.sicht, golden.sicht);
  const g = pruefeProjekt(JSON.parse(golden.kanonisch));
  assert.equal(g.fehler, undefined, g.fehler);
  assert.equal(kanonisch(g.projekt), golden.kanonisch);
});

test('reasons have English texts', () => {
  for (const g of ['mod_voll', 'mod_unbekannt', 'mod_ziel_unbekannt']) assert.match(GRUND_TEXT[g] ?? '', /^[a-z0-9 ,;:()'.-]+$/i, g);
});

// Strand 6 task 3.2: the envelope follower (art folger) in the model, the commands and the translator.
describe('folger', () => {
  const folger = (x = {}) => ({ befehl: 'mod_neu', art: 'folger', quelle: 's2', ziele: [fader('s1')], ...x });

  test('mod_neu art folger: source track, no LFO fields, defaults absent; valid; patches round-trip', () => {
    const p = szene();
    const r = ok(p, folger());
    pruefe(p, r);
    assert.deepEqual(r.projekt.modulatoren, [{ id: 'm1', nr: 1, art: 'folger', quelle: 's2', ziele: [fader('s1')] }]);
    const r2 = ok(r.projekt, folger({ name: 'Duck', angriff_ms: 0.1, abfall_ms: 5000, empfindlich_db: -24, glatt_ms: 2,
      ziele: [{ strang_id: 's4', ziel: 'geraet.cutoff', tiefe: 0.5 }, { strang_id: 'r1', ziel: 'fader', tiefe: -12 }] }));
    pruefe(r.projekt, r2);
    assert.deepEqual(r2.projekt.modulatoren[1], { id: 'm2', nr: 2, name: 'Duck', art: 'folger', quelle: 's2', angriff_ms: 0.1, abfall_ms: 5000,
      empfindlich_db: -24, glatt_ms: 2, ziele: [{ strang_id: 's4', ziel: 'geraet.cutoff', tiefe: 0.5 }, { strang_id: 'r1', ziel: 'fader', tiefe: -12 }] });
    pruefe(r2.projekt, ok(r2.projekt, folger({ quelle: 's3', angriff_ms: 500, abfall_ms: 1, empfindlich_db: 24 })));
  });

  test('refusals: source missing, unknown or no track, ranges, LFO fields, a target on the source track', () => {
    const p = szene();
    lehntAb(p, { befehl: 'mod_neu', art: 'folger', ziele: [fader('s1')] }, 'argument_ungueltig');
    lehntAb(p, folger({ quelle: 's9' }), 'spur_unbekannt');
    lehntAb(p, folger({ quelle: 'r1' }), 'spur_unbekannt');
    lehntAb(p, folger({ quelle: 7 }), 'argument_ungueltig');
    for (const x of [{ angriff_ms: 0.05 }, { angriff_ms: 501 }, { abfall_ms: 0.5 }, { abfall_ms: 5001 }, { empfindlich_db: -25 },
      { empfindlich_db: 24.5 }, { angriff_ms: '5' }, { glatt_ms: 501 }]) {
      lehntAb(p, folger(x), 'argument_ungueltig');
    }
    for (const x of [{ form: 'sinus' }, { takt: 4 }, { hz: 1 }, { phase: 0.5 }]) lehntAb(p, folger(x), 'argument_unbekannt');
    // an LFO takes no follower fields
    for (const x of [{ angriff_ms: 5 }, { abfall_ms: 150 }, { empfindlich_db: 0 }]) {
      lehntAb(p, { befehl: 'mod_neu', ziele: [fader('s1')], ...x }, 'argument_unbekannt');
    }
    // the source track carries no target of the same modulator (its own fader, pan or device)
    for (const z of [fader('s2'), { strang_id: 's2', ziel: 'pan', tiefe: 0.5 }]) lehntAb(p, folger({ ziele: [fader('s1'), z] }), 'argument_ungueltig');
    lehntAb(p, folger({ quelle: 's4', ziele: [{ strang_id: 's4', ziel: 'geraet.cutoff', tiefe: 0.5 }] }), 'argument_ungueltig');
    // another modulator may target the source track
    const q = lauf(p, [folger(), { befehl: 'mod_neu', ziele: [fader('s2')] }]);
    assert.equal(pruefeProjekt(q).fehler, undefined);
  });

  test('mod_aendern: follower fields, art lfo to folger and back drops the fields of the other kind', () => {
    let p = lauf(szene(), { befehl: 'mod_neu', form: 'rechteck', takt: 2, phase: 0.5, glatt_ms: 4, ziele: [fader('s1')] });
    lehntAb(p, { befehl: 'mod_aendern', mod_id: 'm1', art: 'folger' }, 'argument_ungueltig');   // no source
    let r = ok(p, { befehl: 'mod_aendern', mod_id: 'm1', art: 'folger', quelle: 's3', abfall_ms: 80 });
    pruefe(p, r);
    assert.deepEqual(r.projekt.modulatoren[0], { id: 'm1', nr: 1, art: 'folger', glatt_ms: 4, ziele: [fader('s1')], quelle: 's3', abfall_ms: 80 });
    p = r.projekt;
    r = ok(p, { befehl: 'mod_aendern', mod_id: 'm1', quelle: 's2', angriff_ms: 20, empfindlich_db: 6 });
    pruefe(p, r);
    assert.deepEqual(r.projekt.modulatoren[0], { id: 'm1', nr: 1, art: 'folger', glatt_ms: 4, ziele: [fader('s1')], quelle: 's2', abfall_ms: 80,
      angriff_ms: 20, empfindlich_db: 6 });
    lehntAb(r.projekt, { befehl: 'mod_aendern', mod_id: 'm1', takt: 2 }, 'argument_unbekannt');
    lehntAb(r.projekt, { befehl: 'mod_aendern', mod_id: 'm1', quelle: 's1' }, 'argument_ungueltig');   // its own target track
    const z = ok(r.projekt, { befehl: 'mod_aendern', mod_id: 'm1', art: 'lfo' });
    pruefe(r.projekt, z);
    assert.deepEqual(z.projekt.modulatoren[0], { id: 'm1', nr: 1, art: 'lfo', glatt_ms: 4, ziele: [fader('s1')], form: 'sinus', takt: 4 });
  });

  test('removing the source track turns the follower off and keeps it; it comes back on with a new source', () => {
    const p = lauf(szene(), [folger({ ziele: [fader('s1'), { strang_id: 's3', ziel: 'pan', tiefe: 0.5 }] })]);
    const r = ok(p, { befehl: 'spur_loeschen', spur_id: 's2' });
    pruefe(p, r);
    assert.deepEqual(r.projekt.modulatoren, [{ id: 'm1', nr: 1, art: 'folger', quelle: 's2', an: false,
      ziele: [fader('s1'), { strang_id: 's3', ziel: 'pan', tiefe: 0.5 }] }]);
    const g = pruefeProjekt(JSON.parse(kanonisch(r.projekt)));
    assert.equal(g.fehler, undefined, g.fehler);
    lehntAb(r.projekt, { befehl: 'mod_aendern', mod_id: 'm1', an: true }, 'spur_unbekannt');
    const r2 = ok(r.projekt, { befehl: 'mod_aendern', mod_id: 'm1', an: true, quelle: 's4' });
    pruefe(r.projekt, r2);
    assert.deepEqual(r2.projekt.modulatoren[0], { id: 'm1', nr: 1, art: 'folger', quelle: 's4',
      ziele: [fader('s1'), { strang_id: 's3', ziel: 'pan', tiefe: 0.5 }] });
    // deleting a target track keeps the follower on
    const r3 = ok(p, { befehl: 'spur_loeschen', spur_id: 's3' });
    pruefe(p, r3);
    assert.deepEqual(r3.projekt.modulatoren, [{ id: 'm1', nr: 1, art: 'folger', quelle: 's2', ziele: [fader('s1')] }]);
  });

  test('translator: the follower fields with the source track number and defaults; always unipolar; source or target not played', () => {
    const spiel = (p) => uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000 });
    let p = lauf(szene(), [folger({ ziele: [fader('s1', -12), { strang_id: 'r1', ziel: 'fader', tiefe: 6, polaritaet: 'uni' }] }),
      folger({ quelle: 's3', angriff_ms: 0.5, abfall_ms: 400, empfindlich_db: -6, glatt_ms: 3, ziele: [{ strang_id: 's5', ziel: 'geraet.k3', tiefe: 0.25 }] })]);
    const w = spiel(p);
    assert.equal(w.format, 'cypherdj-arr/3');
    assert.deepEqual(w.mod, [
      { nr: 1, art: 'folger', quelle: 2, angriff_ms: 5, abfall_ms: 150, empfindlich_db: 0, glatt_ms: 1,
        ziele: [{ spur: 1, ziel: 'fader', tiefe: -12, uni: true }, { ret: 1, ziel: 'fader', tiefe: 6, uni: true }] },
      { nr: 2, art: 'folger', quelle: 3, angriff_ms: 0.5, abfall_ms: 400, empfindlich_db: -6, glatt_ms: 3,
        ziele: [{ spur: 5, ziel: 'geraet.k3', tiefe: 0.25, uni: true }] },
    ]);
    assert.deepEqual(Object.keys(w.mod[0]), ['nr', 'art', 'quelle', 'angriff_ms', 'abfall_ms', 'empfindlich_db', 'glatt_ms', 'ziele']);
    // a source track the playback does not have: the follower is left out (it would read silence)
    const ohneQuelle = uebersetze({ ...p, spuren: p.spuren.filter((s) => s.id !== 's3') }, { nr: 1, audioOrdner: '@A@', frames: () => 400000 });
    assert.deepEqual(ohneQuelle.mod.map((m) => m.nr), [1]);
    // switched off (as after its source track went): left out
    p = lauf(p, { befehl: 'spur_loeschen', spur_id: 's2' });
    assert.deepEqual(spiel(p).mod.map((m) => m.nr), [2]);
  });
});

// Strand 6 task 4.2: the wider targets: send.<return id> on a track, insert.<stage id>.<param> and rack.m1..m4 on every strip, plugin.<host>.<index>.
describe('ziele', () => {
  const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
  const stufe = (p, strang, pos) => {
    const t = strang === 'master' ? p.master : p.spuren.find((s) => s.id === strang) ?? (p.gruppen ?? []).find((g) => g.id === strang)
      ?? p.returns.find((r) => r.id === strang);
    return t.inserts[pos].id;
  };
  // s1: komp, eq, a send into r1; group G (s2, s3): eq and a rack whose macro 1 drives b1/gain; r1: komp; master: komp; s3: a host stage
  const bau = () => {
    let p = lauf(szene(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' },
      { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }, { befehl: 'gruppenspur_neu', name: 'Bus', mitglieder: ['s2', 's3'] }]);
    const g = p.gruppen[0].id;
    p = lauf(p, [{ befehl: 'insert_setzen', strang_id: g, pos: 0, art: 'eq' }, { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'komp' },
      { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp' }, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'host', plugin: PLUGIN }]);
    p = lauf(p, { befehl: 'rack_setzen', strang_id: g, makros: [{ ziel: [{ insert: stufe(p, g, 0), param: 'b1/gain', von: -6, bis: 6 }] }] });
    return { p, g, k: stufe(p, 's1', 0), e: stufe(p, 's1', 1), ge: stufe(p, g, 0), rk: stufe(p, 'r1', 0), mk: stufe(p, 'master', 0), h: stufe(p, 's3', 0) };
  };
  const z = (strang_id, ziel, tiefe, uni) => ({ strang_id, ziel, tiefe, ...(uni ? { polaritaet: 'uni' } : {}) });

  test('mod_neu takes send, insert, rack and plugin targets on the strips that carry them; valid; patches round-trip', () => {
    const s = bau();
    const ziele = [z('s1', 'send.r1', -6), z('s1', `insert.${s.k}.schwelle`, 0.25), z('s1', `insert.${s.e}.b2/freq`, -1), z(s.g, `insert.${s.ge}.b1/freq`, -0.5, true),
      z(s.g, 'rack.m1', 0.3), z('r1', `insert.${s.rk}.ratio`, 1), z('master', `insert.${s.mk}.schwelle`, -0.1), z('s3', `plugin.${s.h}.3`, 0.2)];
    const r = ok(s.p, { befehl: 'mod_neu', ziele });
    pruefe(s.p, r);
    assert.deepEqual(r.projekt.modulatoren[0].ziele, ziele);
  });

  test('refusals: a send of a group, a missing send, host stage, switch, key and step parameters, a mapped parameter, no rack, depth ranges', () => {
    const t = bau();
    const s = lauf(t.p, { befehl: 'send_setzen', strang_id: t.g, return_id: 'r1', db: -3 });
    const b = (x) => ({ befehl: 'mod_neu', ziele: [x] });
    for (const x of [z(t.g, 'send.r1', 2), z('s2', 'send.r1', 2), z('s3', `insert.${t.h}.schwelle`, 0.2), z('s1', `insert.${t.k}.an`, 0.5),
      z('s1', `insert.${t.k}.sc`, 0.5), z('s1', `insert.${t.e}.b1/typ`, 0.5), z('s1', `insert.${t.k}.gibtsnicht`, 0.5), z('r1', 'rack.m1', 0.5),
      z('master', 'rack.m2', 0.5), z('s1', `plugin.${t.k}.3`, 0.5), z(t.g, 'fader', 2), z('master', 'pan', 0.5), z(t.g, 'geraet.k3', 0.5)]) {
      lehntAb(t.p, b(x), 'mod_ziel_unbekannt');
    }
    assert.equal(s.gruppen[0].sends.length, 1);
    lehntAb(s, b(z(t.g, 'send.r1', 2)), 'mod_ziel_unbekannt');   // a group has sends, the core takes send targets on tracks only
    lehntAb(t.p, b(z(t.g, `insert.${t.ge}.b1/gain`, 0.5)), 'param_gemappt');
    lehntAb(t.p, b(z('s1', 'send.r1', 25)), 'argument_ungueltig');
    lehntAb(t.p, b(z('s1', `insert.${t.k}.schwelle`, 1.5)), 'argument_ungueltig');
    lehntAb(t.p, b(z(t.g, 'rack.m1', -1.01)), 'argument_ungueltig');
    lehntAb(t.p, b(z('s3', `plugin.${t.h}.3`, 2)), 'argument_ungueltig');
  });

  test('translator: send by return number, chain targets as kette/nr/stufe/param or makro, plugin targets left out', () => {
    const s = bau();
    const p = lauf(s.p, [
      { befehl: 'mod_neu', ziele: [z('s1', 'send.r1', -6), z('s1', `insert.${s.k}.schwelle`, 0.25), z('s1', `insert.${s.e}.b2/freq`, -1),
        z(s.g, `insert.${s.ge}.b1/freq`, -0.5, true), z(s.g, 'rack.m1', 0.3), z('r1', `insert.${s.rk}.ratio`, 1),
        z('master', `insert.${s.mk}.schwelle`, -0.1), z('s3', `plugin.${s.h}.3`, 0.2)] },
      { befehl: 'mod_neu', ziele: [z('s3', `plugin.${s.h}.4`, 0.2)] },
    ]);
    const w = uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000 });
    assert.equal(w.format, 'cypherdj-arr/3');
    assert.deepEqual(w.mod.map((m) => m.nr), [1, 2], 'a modulator with plugin targets only runs in the core with ziele []');
    assert.deepEqual(w.mod[1].ziele, []);
    assert.deepEqual(w.mod[0].ziele, [
      { spur: 1, ziel: 'send.1', tiefe: -6, uni: false },
      { kette: 'spur', nr: 1, stufe: 0, param: 1, tiefe: 0.25, uni: false },
      { kette: 'spur', nr: 1, stufe: 1, param: 12, tiefe: -1, uni: false },
      { kette: 'grp', nr: 1, stufe: 0, param: 5, tiefe: -0.5, uni: true },
      { kette: 'grp', nr: 1, makro: 0, tiefe: 0.3, uni: false },
      { kette: 'ret', nr: 1, stufe: 0, param: 2, tiefe: 1, uni: false },
      { kette: 'pm', nr: 1, stufe: 0, param: 1, tiefe: -0.1, uni: false },
    ]);
    // safety net: a target on a parameter a macro drives, or on a stage that is gone, never reaches the core (it would refuse the whole playback)
    const k = structuredClone(p);
    k.modulatoren[0].ziele = [z(s.g, `insert.${s.ge}.b1/gain`, 0.5), z('s1', 'insert.i99.schwelle', 0.5), z('s1', 'pan', 0.5)];
    assert.deepEqual(uebersetze(k, { nr: 1, audioOrdner: '@A@', frames: () => 400000 }).mod[0].ziele, [{ spur: 1, ziel: 'pan', tiefe: 0.5, uni: false }]);
  });

  test('cleanup: removing the stage or the send takes its targets; the rest stays valid', () => {
    const s = bau();
    const p = lauf(s.p, { befehl: 'mod_neu', ziele: [z('s1', 'send.r1', -6), z('s1', `insert.${s.k}.schwelle`, 0.25), z('s1', 'pan', 0.5)] });
    const r = ok(p, { befehl: 'insert_entfernen', insert_id: s.k });
    pruefe(p, r);
    assert.deepEqual(r.projekt.modulatoren[0].ziele, [z('s1', 'send.r1', -6), z('s1', 'pan', 0.5)]);
  });
});

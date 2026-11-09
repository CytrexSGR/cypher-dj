// Package 1.9 U2 (L25): a kit as the device of a project instrument track ({art: 'intern', name: 'kit', kit}).
// Model (T2.1), commands and default name (T2.2), playback translation (T2.3). Old projects stay byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, pruefeFehler, kanonisch, wiedergabeSicht, KIT_NAME, BK_GRAPH_NAME, MAX_KIT_GERAETE } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { brauchtFreeze, istWirt } from '../project/freeze.ts';
import { specProjekt, kopie, SHA_A, SHA_B } from './support/project.mjs';

const AUDIO = '/arbeit/arr/audio';
const opt = (extra = {}) => ({ nr: 1, audioOrdner: AUDIO, frames: (sha) => (sha === SHA_A || sha === SHA_B ? 24000 : null), ...extra });
const kit = (name = 'kit_zwei') => ({ art: 'intern', name: 'kit', kit: name });
// the spec project is a /1 file; kit devices exist from /2 on, so the carrier is lifted to /2 first
const zwei = () => { const p = specProjekt(); p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 }; return p; };
const mitKit = (g, p = zwei()) => { p.spuren[1].geraet = g; return p; };
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const kitSpur = (i) => ({ id: `k${i}`, nr: i, name: `k${i}`, farbe: '#3b8de0', art: 'instrument', geraet: kit(), fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });

test('T2.1 model: an instrument track with a kit device is valid in /2', () => {
  const r = pruefeProjekt(mitKit(kit('kit_zwei')));
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.deepEqual(r.projekt.spuren[1].geraet, kit('kit_zwei'));
  assert.ok('projekt' in pruefeProjekt(mitKit(kit('a'.repeat(32)))), 'a 32 character name is the longest allowed');
  assert.equal(KIT_NAME.source, BK_GRAPH_NAME.source, 'same name rule as the bk graph (and the kern kit_name_ok)');
});

test('T2.1 model: refusals (name, extra fields, freeze, device parameter, /1 file, nine kit devices)', () => {
  const faelle = [
    ['kit missing', (() => { const x = kit(); delete x.kit; return x; })(), /kit/],
    ['capital letters', kit('Kit'), /kit/],
    ['33 characters', kit('a'.repeat(33)), /kit/],
    ['empty', kit(''), /kit/],
    ['not a string', { ...kit(), kit: 5 }, /kit/],
    ['path traversal', kit('../x'), /kit/],
    ['extra field foo', { ...kit(), foo: 1 }, /foo/],
    ['a parameter object (the kit is the whole device)', { ...kit(), parameter: {} }, /parameter/],
  ];
  for (const [was, geraet, muster] of faelle) {
    const f = pruefeFehler(mitKit(geraet));
    assert.ok(f !== null && muster.test(f), `${was}: ${f}`);
  }
  const mitFreeze = mitKit(kit()); mitFreeze.spuren[1].freeze = null;
  assert.notEqual(pruefeFehler(mitFreeze), null, 'freeze on a kit track');
  const alt = specProjekt(); alt.spuren[1].geraet = kit();   // still format /1
  const f1 = pruefeFehler(alt);
  assert.ok(f1 !== null && /cypherdj-projekt\/2/.test(f1), `/1 refuses the kit device: ${f1}`);
  assert.equal(MAX_KIT_GERAETE, 8);
  const p = zwei(); p.spuren = [];
  for (let i = 1; i <= 9; i += 1) {
    p.spuren.push(kitSpur(i));
    const f = pruefeFehler(p);
    if (i <= MAX_KIT_GERAETE) assert.equal(f, null, `track ${i}: ${f}`);
    else assert.match(f ?? '', /at most 8/, `track ${i}: ${f}`);
  }
});

test('T2.1 model: old fixtures round-trip byte-equal (golden literal taken on the base commit)', () => {
  const a = kanonisch(pruefeProjekt(specProjekt()));
  assert.equal(a, kanonisch(pruefeProjekt(kopie(specProjekt()))));
  assert.ok(!a.includes('"kit"'), 'no kit field appears in an old project');
  assert.ok(!a.includes('"name":"kit"'));
});

test('T2.2 commands: spur_neu with a kit device stores it and names the track KIT · <kit>', () => {
  const r = fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument', geraet: kit('kit_zwei') }]);
  const s = r.projekt.spuren.at(-1);
  assert.deepEqual([s.name, s.art, s.geraet], ['KIT · kit_zwei', 'instrument', kit('kit_zwei')]);
  assert.equal('freeze' in s, false, 'no freeze field on an intern device');
  assert.equal(r.betrifft_wiedergabe, true);
  for (const schlecht of [
    { art: 'intern', name: 'kit' },                              // kit missing
    { art: 'intern', name: 'kit', kit: 'Kit' },
    { art: 'intern', name: 'kit', kit: 'x', parameter: {} },
    { art: 'intern', name: 'kit', kit: 'x', extra: 1 },
    { art: 'intern', name: 'rb338', kit: 'x' },                  // kit belongs to the kit device only
    { art: 'intern', name: 'bk', graph: 'g', kit: 'x' },
  ]) assert.throws(() => fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument', geraet: schlecht }]),
    (e) => e instanceof BefehlFehler && /argument_/.test(e.grund), JSON.stringify(schlecht));
  // an explicit name wins
  assert.equal(fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument', name: 'Drums', geraet: kit() }]).projekt.spuren.at(-1).name, 'Drums');
});

test('T2.2 commands: kitDa lookup refuses an unknown kit as kit_unbekannt; without it only the name rule applies', () => {
  const kitDa = (n) => n === 'kit_zwei';
  const ok = fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument', geraet: kit('kit_zwei') }], { kitDa });
  assert.equal(ok.projekt.spuren.at(-1).geraet.kit, 'kit_zwei');
  lehntAb(() => fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument', geraet: kit('nicht-da-i19') }], { kitDa }), 'kit_unbekannt');
  assert.ok(fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument', geraet: kit('nicht-da-i19') }]).projekt, 'no lookup injected: the name rule only');
  // spur_aendern goes through the same check
  lehntAb(() => fuehreListeAus(zwei(), [{ befehl: 'spur_aendern', spur_id: 's2', geraet: kit('nicht-da-i19') }], { kitDa }), 'kit_unbekannt');
  // negative control: the other device kinds never ask the kit lookup
  const frage = []; const spaeher = (n) => { frage.push(n); return false; };
  fuehreListeAus(zwei(), [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'g' } }], { kitDa: spaeher });
  assert.deepEqual(frage, []);
});

test('T2.2 commands: switching rb338 -> kit -> rb338 is one step each and discards nothing it should not', () => {
  const p0 = zwei();
  const a = fuehreListeAus(p0, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: kit('kit_zwei') }]);
  assert.deepEqual(a.projekt.spuren[1].geraet, kit('kit_zwei'));
  assert.equal(a.betrifft_wiedergabe, true);
  assert.deepEqual(a.projekt.spuren[1].clips, p0.spuren[1].clips, 'the notes stay');
  assert.equal('freeze' in a.projekt.spuren[1], false);
  const zurueck = fuehreListeAus(a.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'rb338' } }]);
  assert.deepEqual(zurueck.projekt.spuren[1].geraet, { art: 'intern', name: 'rb338', parameter: {} });
  // another kit is a new playback, the same kit again changes nothing
  const b = fuehreListeAus(a.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: kit('kit_eins') }]);
  assert.notEqual(kanonisch(wiedergabeSicht(a.projekt)), kanonisch(wiedergabeSicht(b.projekt)));
  const gleich = fuehreListeAus(a.projekt, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: kit('kit_zwei') }]);
  assert.equal(gleich.vor.length, 0, 'no patch for an unchanged device');
});

test('T2.2 commands: the default names of the other devices are unchanged (negative control)', () => {
  const ohneSurge = zwei(); ohneSurge.spuren.pop();   // the spec project already holds the one Surge slot of D1
  const alle = fuehreListeAus(ohneSurge, [
    { befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad' } },
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } },
  ]).projekt.spuren.slice(-3).map((s) => s.name);
  assert.deepEqual(alle, ['RB-338', 'juno-pad', 'Surge']);
});

test('T2.3 translation: the playback carries geraet kit and the kit name, no parameter and no graph; format stays /1', () => {
  const w = uebersetze(mitKit(kit('kit_zwei'), pruefeProjekt(zwei()).projekt), opt());
  assert.deepEqual(w.spuren[1], { nr: 2, art: 'intern', geraet: 'kit', kit: 'kit_zwei',
    noten: [{ id: 'c2/n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] });
  assert.equal(w.format, 'cypherdj-arr/1');
  // negative control: an RB track carries no kit field
  const rb = uebersetze(pruefeProjekt(zwei()).projekt, opt()).spuren[1];
  assert.equal('kit' in rb, false);
  assert.equal(rb.geraet, 'rb338');
});

test('T2.3 export: a kit track needs no freeze (brauchtFreeze false), a Surge track with notes still does (negative control)', () => {
  const p = pruefeProjekt(mitKit(kit('kit_zwei'))).projekt;
  p.spuren[1].clips[0].noten.push({ id: 'n2', beat: 1, laenge: 0.5, ton: 38, vel: 100 });
  assert.equal(brauchtFreeze(p.spuren[1]), false, 'kit track');
  assert.equal(istWirt(p.spuren[1]), false);
  const s = pruefeProjekt(zwei()).projekt;
  s.spuren[2].clips.push({ id: 'c9', art: 'midi', name: 'lead', start_beat: 0, laenge_beats: 4, noten: [{ id: 'n9', beat: 0, laenge: 1, ton: 60, vel: 100 }] });
  assert.equal(brauchtFreeze(s.spuren[2]), true, 'Surge track with notes');
  // the translation of a kit track never asks for a work folder (a frozen host track does)
  assert.doesNotThrow(() => uebersetze(p, opt()));
});

test('T2.2 commands: a track with geraet.* lanes cannot switch to a kit device (geraet_lanes, as for bk); without the lane the switch works', () => {
  const mitLane = fuehreListeAus(zwei(), [{ befehl: 'auto_neu', spur_id: 's2', ziel: 'geraet.cutoff' }]).projekt;
  lehntAb(() => fuehreListeAus(mitLane, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: kit() }]), 'geraet_lanes');
  const laneId = mitLane.spuren[1].automation[0].id;
  const ohne = fuehreListeAus(mitLane, [{ befehl: 'auto_loeschen', lane_id: laneId }]).projekt;
  assert.deepEqual(fuehreListeAus(ohne, [{ befehl: 'spur_aendern', spur_id: 's2', geraet: kit() }]).projekt.spuren[1].geraet, kit());
});

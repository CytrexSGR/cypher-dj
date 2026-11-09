// Package 1.9 U7 T1 (spec E9, E14, E15, 4.4): the instrument rack device in the project model and the playback translator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import {
  pruefeProjekt, pruefeFehler, spurSicht, istRack, glieder, MAX_RACK_GERAETE, MAX_GLIEDER, MAX_GLIED_PLAETZE, MAX_KIT_GERAETE, MAX_BK_SPUREN, MAX_RACK,
} from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { specProjekt } from './support/project.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const zwei = () => { const p = specProjekt(); p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 }; return p; };
const kit = (name) => ({ art: 'intern', name: 'kit', kit: name });
const bk = (graph = 'g_a') => ({ art: 'intern', name: 'bk', graph, parameter: {} });
const rackG = (glieder, kette = 0) => ({ art: 'rack', glieder, kette });
const zweiKit = () => rackG([{ id: 'g1', geraet: kit('kit_rack'), ton: [0, 59] }, { id: 'g2', geraet: kit('kit_zwei'), ton: [60, 127], vel: [1, 63] }]);
const spurMit = (i, geraet) => ({ id: `r${i}`, nr: i, name: `r${i}`, farbe: '#3b8de0', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
const mitSpur = (geraet) => { const p = zwei(); p.spuren = [spurMit(1, geraet)]; return p; };
const viele = (geraete) => { const p = zwei(); p.spuren = geraete.map((g, i) => spurMit(i + 1, g)); return p; };
const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);

test('T1 (a) a rack track of two kit members round-trips through pruefeProjekt and spurSicht shows art rack', () => {
  const p = mitSpur(zweiKit());
  const r = pruefeProjekt(p);
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.deepEqual(r.projekt.spuren[0].geraet, zweiKit());
  const s = r.projekt.spuren[0];
  assert.ok(istRack(s)); assert.equal(glieder(s).length, 2);
  assert.equal(glieder(r.projekt.spuren[0]).map((m) => m.id).join(), 'g1,g2');
  assert.deepEqual(glieder({}), []);
  assert.equal(spurSicht(s).geraet.art, 'rack');
});

test('T1 (b) refusals: nested rack, member count, ids, zones, gain, chain, surge member, /1 file', () => {
  const m = (x = {}) => ({ id: 'g1', geraet: kit('kit_rack'), ...x });
  const faelle = [
    ['nested rack', rackG([m({ geraet: rackG([m()]) })])],
    ['no members', rackG([])],
    ['5 members', rackG(['g1', 'g2', 'g3', 'g4', 'g1'].map((id) => m({ id })))],
    ['duplicate member id', rackG([m(), m()])],
    ['id g5', rackG([m({ id: 'g5' })])],
    ['ton [60, 59]', rackG([m({ ton: [60, 59] })])],
    ['vel [0, 10]', rackG([m({ vel: [0, 10] })])],
    ['kette [0, 128]', rackG([m({ kette: [0, 128] })])],
    ['gain_db 12.5', rackG([m({ gain_db: 12.5 })])],
    ['rack kette -1', rackG([m()], -1)],
    ['surge member', rackG([m({ geraet: { art: 'wirt', name: 'surge', slot: 1 } })])],
    ['unknown member field', rackG([m({ foo: 1 })])],
  ];
  for (const [was, g] of faelle) { const f = pruefeFehler(mitSpur(g)); assert.ok(f !== null, `${was} must be refused`); }
  assert.match(pruefeFehler(mitSpur(rackG([m({ geraet: { art: 'wirt', name: 'surge', slot: 1, parameter: { a: 1 } } })]))) ?? '', /surge member parameters are not mirrored/);
  // (d) a /1 file with a rack track
  const alt = specProjekt(); alt.spuren[1].geraet = zweiKit();
  assert.match(pruefeFehler(alt) ?? '', /cypherdj-projekt\/2/);
  // the valid edges pass
  assert.equal(pruefeFehler(mitSpur(rackG([m({ ton: [0, 127], vel: [1, 127], kette: [0, 127], gain_db: -60 }), m({ id: 'g4', gain_db: 12 })], 127))), null);
});

test('T1 (c) limits count tracks plus members; the three constants equal the core header', () => {
  assert.equal(MAX_GLIED_PLAETZE, MAX_RACK_GERAETE * MAX_GLIEDER);
  assert.notEqual(MAX_RACK_GERAETE, MAX_RACK, 'the S4c effect rack pool is a different thing');
  const k4 = () => rackG(['g1', 'g2', 'g3', 'g4'].map((id) => ({ id, geraet: kit('kit_rack') })));
  const kitSpur = () => kit('kit_rack');
  // 4 kit tracks + a rack of 4 = 8 devices: fine; one more is the ninth
  assert.equal(pruefeFehler(viele([kitSpur(), kitSpur(), kitSpur(), kitSpur(), k4()])), null);
  assert.match(pruefeFehler(viele([kitSpur(), kitSpur(), kitSpur(), kitSpur(), k4(), kitSpur()])) ?? '', /at most 8 kit devices/);
  const b4 = () => rackG(['g1', 'g2', 'g3', 'g4'].map((id) => ({ id, geraet: bk() })));
  assert.equal(pruefeFehler(viele([bk(), bk(), bk(), bk(), b4()])), null);
  assert.match(pruefeFehler(viele([bk(), bk(), bk(), bk(), b4(), bk()])) ?? '', /at most 8 Baukasten/);
  const einzel = () => rackG([{ id: 'g1', geraet: kit('kit_rack') }]);
  assert.equal(pruefeFehler(viele(Array.from({ length: MAX_RACK_GERAETE }, einzel))), null);
  assert.match(pruefeFehler(viele(Array.from({ length: MAX_RACK_GERAETE + 1 }, einzel))) ?? '', /at most 8 rack devices/);
  assert.equal(MAX_KIT_GERAETE, 8); assert.equal(MAX_BK_SPUREN, 8);
  const h = fs.readFileSync(path.join(hier, '..', '..', 'core', 'include', 'cypherdj', 'arr_playback.h'), 'utf8');
  const konst = (n) => Number(new RegExp(`constexpr int ${n} = (\\d+);`).exec(h)?.[1]);
  assert.equal(MAX_RACK_GERAETE, konst('ARR_RACK_MAX'));
  assert.equal(MAX_GLIEDER, konst('ARR_RACK_GLIEDER'));
  assert.equal(MAX_GLIED_PLAETZE, konst('ARR_GLIED_PLAETZE'));
});

test('T1 (e) translator: the rack track emits the core contract, zones explicit, and the playback is /2', () => {
  const p = mitSpur(zweiKit());
  p.spuren[0].clips = [{ id: 'c1', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 4, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 60, vel: 100 }] }];
  const w = uebersetze(p, { nr: 3, audioOrdner: '/arbeit/arr/audio' });
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.spuren[0], {
    nr: 1, art: 'intern', geraet: 'rack', kette: 0,
    glieder: [
      { id: 'g1', art: 'intern', geraet: 'kit', kit: 'kit_rack', ton: [0, 59], vel: [1, 127], kette: [0, 127], gain_db: 0 },
      { id: 'g2', art: 'intern', geraet: 'kit', kit: 'kit_zwei', ton: [60, 127], vel: [1, 63], kette: [0, 127], gain_db: 0 },
    ],
    noten: [{ id: 'c1/n1', beat: 0, laenge: 1, ton: 60, vel: 100 }],
  });
  // a project without a rack track stays /1
  assert.equal(uebersetze(specProjekt(), { nr: 1, audioOrdner: '/a', frames: () => 24000 }).format, 'cypherdj-arr/1');
});

test('T1 translator: rb338 and bk members carry parameter / graph; a member preset is no playback change', () => {
  const g = rackG([{ id: 'g1', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.5 }, preset: 'werk:rb338/acid' } },
    { id: 'g2', geraet: { art: 'intern', name: 'bk', graph: 'g_a', parameter: { k1: 0.25 } }, gain_db: -6 }]);
  const w = uebersetze(mitSpur(g), { nr: 1, audioOrdner: '/a' });
  assert.deepEqual(w.spuren[0].glieder[0], { id: 'g1', art: 'intern', geraet: 'rb338', parameter: { cutoff: 0.5 }, ton: [0, 127], vel: [1, 127], kette: [0, 127], gain_db: 0 });
  assert.deepEqual(w.spuren[0].glieder[1], { id: 'g2', art: 'intern', geraet: 'bk', graph: 'g_a', parameter: { k1: 0.25 }, ton: [0, 127], vel: [1, 127], kette: [0, 127], gain_db: -6 });
  const mitP = spurSicht(mitSpur(g).spuren[0]), ohneP = spurSicht(mitSpur(rackG([{ id: 'g1', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.5 } } },
    g.glieder[1]])).spuren[0]);
  assert.deepEqual(mitP, ohneP);
});

test('T1 commands: spur_neu builds a rack device, default name Rack; refusals', () => {
  const r = fuehreAus(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: zweiKit() });
  const s = r.projekt.spuren.at(-1);
  assert.equal(s.name, 'Rack');
  assert.deepEqual(s.geraet, zweiKit());
  lehntAb(() => fuehreAus(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: rackG([{ id: 'g1', geraet: rackG([]) }]) }), 'argument_ungueltig');
  lehntAb(() => fuehreAus(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: rackG([{ id: 'g1', geraet: { art: 'wirt', name: 'surge', parameter: { a: 1 } } }]) }), 'argument_ungueltig');
  lehntAb(() => fuehreAus(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: rackG([{ id: 'g1', geraet: kit('kit_rack'), ton: [60, 59] }]) }), 'projekt_ungueltig');
  lehntAb(() => fuehreAus(zwei(), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'rack', glieder: [], kette: 0, foo: 1 } }), 'argument_unbekannt');
});

// 1.12 slice 7: automation lanes and clip envelopes on the Baukasten knobs of a bk track (`geraet.k1` .. `geraet.k8`): project model, commands, translator.
// Pure calculation: no server, no core (the core side is kern test_arr_auto_bk_knopf, the audible side is check/acceptance_lanes_chain.mjs).
// Cases: A the knobs are lane targets of a bk track only (every other kind of track refuses them, the RB-338 names are refused on a bk track), B start value and ranges,
// C the device switch respects the owner of the parameter, D translator (auto in /2, the knob names reach the core as written), E clip envelopes on the knobs and the relative lane,
// F limits (12 lanes per track hold the 8 knobs and the four mixer lanes), G the lists of the page and the contract agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, AUTO_ZIELE, MAX_LANES_PRO_SPUR, BK_ZIELE, RB_ZIELE } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { wende } from '../project/patch.ts';
import { HK_ZIELE } from '../project/envelope.ts';
import { ohneAbgeleitetes } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 120)}`);
const pruefe = (p, r) => {
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))).fehler, undefined);
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt), 'redo equal');
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'undo equal');
};
const KNOEPFE = Array.from({ length: 64 }, (_, i) => `geraet.k${i + 1}`);
const KNOEPFE8 = KNOEPFE.slice(0, 8);
const RB = ['geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod'];
// s1 audio, s2 RB-338, s3 bk (graph pad, k2 set to 0.8), s4 bk (graph drone, no knobs set)
function basis() {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: { k2: 0.8 } } }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'drone', parameter: {} } }).projekt;
  p = structuredClone(p);
  p.spuren[1].clips.push({ id: 'c2', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 8, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 40, vel: 100 }] });
  p.spuren[2].clips.push({ id: 'c3', art: 'midi', name: 'm', start_beat: 0, laenge_beats: 8, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 45, vel: 100 }] });
  p.naechste_id.clip = 4;
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler, undefined);
  return p;
}
const W = (p) => uebersetze(p, { nr: 1, audioOrdner: '/x', frames: () => 96000 });

test('A: the knobs are lane targets of a bk track only; the RB-338 names are refused there; the controls next to each refusal', () => {
  const p = basis();
  for (const z of KNOEPFE) {
    const r = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: z });
    pruefe(p, r);
    assert.equal(r.projekt.spuren[2].automation.at(-1).ziel, z);
  }
  assert.equal(ok(p, { befehl: 'auto_neu', spur_id: 's2', ziel: 'geraet.cutoff' }).projekt.spuren[1].automation.length, 1, 'control: an RB-338 name on the RB-338 track');
  for (const z of RB) lehntAb(p, { befehl: 'auto_neu', spur_id: 's3', ziel: z }, 'ziel_unbekannt');                  // RB-338 names on a bk track
  for (const z of KNOEPFE) lehntAb(p, { befehl: 'auto_neu', spur_id: 's2', ziel: z }, 'ziel_unbekannt');             // knobs on the RB-338 track
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'geraet.k1' }, 'ziel_unbekannt');                            // ... on an audio track
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k65' }, 'ziel_unbekannt');                           // there is no knob 65
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k0' }, 'ziel_unbekannt');
  const mit = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k1' }).projekt;
  lehntAb(mit, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k1' }, 'lane_doppelt');                            // the same knob twice
  assert.equal(ok(mit, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k2' }).projekt.spuren[2].automation.length, 2, 'control: another knob');
  // the model refuses a hand-made project that breaks the rule (the project file is closed like the commands)
  const falsch = structuredClone(mit);
  falsch.spuren[2].automation[0].ziel = 'geraet.cutoff';
  assert.match(pruefeProjekt(JSON.parse(JSON.stringify(falsch))).fehler ?? '', /geraet\.cutoff/);
  const auf_rb = structuredClone(mit);
  auf_rb.spuren[1].automation = structuredClone(mit.spuren[2].automation);
  assert.notEqual(pruefeProjekt(JSON.parse(JSON.stringify(auf_rb))).fehler, undefined, 'a knob lane on the RB-338 track is invalid');
  // a group, a return and the master take no device lanes
  const g = ok(ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s1'] }).projekt, { befehl: 'return_neu' }).projekt;
  lehntAb(g, { befehl: 'auto_neu', strang_id: 'g1', ziel: 'geraet.k1' }, 'ziel_unbekannt');
});

test('B: a new knob lane starts at the knob of the track (0.5 for an untouched knob); points are checked against 0..1', () => {
  const p = basis();
  const k2 = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k2' }).projekt.spuren[2].automation[0];
  assert.deepEqual(k2.punkte.map((q) => q.wert), [0.8, 0.8], 'knob 2 is 0.8 on this track');
  const k5 = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k5' }).projekt.spuren[2].automation[0];
  assert.deepEqual(k5.punkte.map((q) => q.wert), [0.5, 0.5], 'an untouched knob is 0.5, as the core plays it');
  const r = ok(p, { befehl: 'auto_neu', spur_id: 's4', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }] });
  pruefe(p, r);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's4', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 1.2 }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's4', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: -0.1 }] }, 'argument_ungueltig');
  const id = r.projekt.spuren[3].automation[0].id;
  const q = ok(r.projekt, { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 4, wert: 0.25 }] });
  pruefe(r.projekt, q);
  lehntAb(r.projekt, { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 4, wert: 2 }] }, 'argument_ungueltig');
});

test('C: a device switch is refused when a lane or an envelope would stay on a parameter the new device does not have', () => {
  const p = ok(basis(), { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k2' }).projekt;
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338', parameter: {} } }, 'geraet_lanes');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'kit', kit: 'k' } }, 'geraet_lanes');
  const bk2 = ok(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'bk', graph: 'other', parameter: { k2: 0.1 } } });
  pruefe(p, bk2);
  assert.equal(bk2.projekt.spuren[2].automation[0].ziel, 'geraet.k2', 'another graph keeps the knob lanes (the knobs are the same eight)');
  const rb = ok(basis(), { befehl: 'auto_neu', spur_id: 's2', ziel: 'geraet.cutoff' }).projekt;
  lehntAb(rb, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: {} } }, 'geraet_lanes');
  const hk = ok(basis(), { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0.2 }] }).projekt;
  lehntAb(hk, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338', parameter: {} } }, 'geraet_huellkurven');
  assert.equal(ok(hk, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'bk', graph: 'other', parameter: {} } }).projekt.spuren[2].geraet.graph, 'other');
  // without lanes the switch works (control)
  assert.equal(ok(basis(), { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338', parameter: {} } }).projekt.spuren[2].geraet.name, 'rb338');
});

test('D: the playback carries the knob lanes as written: ziel "geraet.kN", the points, /2', () => {
  let p = basis();
  p = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }, { beat: 8, wert: 0.9, form: 's' }] }).projekt;
  p = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k8', punkte: [{ beat: 2, wert: 0 }, { beat: 2, wert: 1, form: 'sprung' }] }).projekt;
  const w = W(p);
  assert.equal(w.format, 'cypherdj-arr/2');
  const t = w.spuren.find((s) => s.geraet === 'bk');
  assert.deepEqual(t.auto, [
    { ziel: 'geraet.k3', punkte: [[0, 0.1, 0], [8, 0.9, 1]] },
    { ziel: 'geraet.k8', punkte: [[2, 0, 0], [2, 1, 2]] },
  ]);
  assert.deepEqual(t.parameter, { k2: 0.8 }, 'the knobs of the snapshot stay (the core plays them while no lane runs)');
  // a project without a knob lane writes the old file (no auto on the bk track)
  assert.equal(W(basis()).spuren.find((s) => s.geraet === 'bk').auto, undefined);
});

test('E: clip envelopes on the knobs: MIDI clips of a bk track take geraet.k1..k8, nothing else does; the playback merges them into a relative lane', () => {
  const p = basis();
  for (const z of KNOEPFE) {
    const r = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: z, punkte: [{ beat: 0, wert: -0.5 }, { beat: 8, wert: 0.5 }] });
    pruefe(p, r);
  }
  for (const z of RB) lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: z, punkte: [{ beat: 0, wert: 0 }] }, 'huellkurve_ziel');   // RB-338 names on a bk clip
  for (const z of KNOEPFE) lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c2', ziel: z, punkte: [{ beat: 0, wert: 0 }] }, 'huellkurve_ziel');   // knobs on an RB-338 clip
  lehntAb(p, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'geraet.k1', punkte: [{ beat: 0, wert: 1.5 }] }, 'punkte_ungueltig');   // a summand beyond -1..1
  const m = ok(p, { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'geraet.k2', punkte: [{ beat: 0, wert: -0.5 }, { beat: 8, wert: 0.5 }] }).projekt;
  const t = W(m).spuren.find((s) => s.geraet === 'bk');
  const rel = t.auto.filter((l) => l.relativ);
  assert.equal(rel.length, 1);
  assert.equal(rel[0].ziel, 'geraet.k2');
  assert.deepEqual(rel[0].punkte.slice(0, 2).map((q) => q.slice(0, 2)), [[0, 0], [0, -0.5]], '0 outside the clip, a jump to the first envelope value at the clip start');
  // an absolute lane on the same knob stays next to it (the core adds and clamps)
  const beide = ok(m, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.k2', punkte: [{ beat: 0, wert: 0.5 }, { beat: 8, wert: 0.5 }] }).projekt;
  assert.deepEqual(W(beide).spuren.find((s) => s.geraet === 'bk').auto.map((l) => [l.ziel, l.relativ ?? false]), [['geraet.k2', false], ['geraet.k2', true]]);
});

test('F: 12 lanes per track hold 8 of the 32 knobs and the four mixer lanes', () => {
  let p = basis();
  for (const z of [...KNOEPFE8, 'fader', 'pan', 'mute', 'solo']) p = ok(p, { befehl: 'auto_neu', spur_id: 's3', ziel: z }).projekt;
  assert.equal(p.spuren[2].automation.length, 12);
  assert.equal(MAX_LANES_PRO_SPUR, 12);
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(p))).fehler, undefined);
  assert.equal(W(p).spuren.find((s) => s.geraet === 'bk').auto.length, 12);
});

test('G: the target lists agree: the model, the envelope list and the owner lists', () => {
  assert.deepEqual([...BK_ZIELE], KNOEPFE);
  assert.deepEqual([...RB_ZIELE], RB);
  assert.deepEqual(AUTO_ZIELE.filter((z) => z.startsWith('geraet.')), [...RB, ...KNOEPFE]);
  assert.deepEqual(HK_ZIELE.filter((z) => z.startsWith('geraet.')), [...RB, ...KNOEPFE]);
});

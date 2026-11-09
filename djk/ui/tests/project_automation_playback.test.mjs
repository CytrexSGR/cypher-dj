// Automation Slice 1, Task 3: der Übersetzer schreibt `auto` je Spur in cypherdj-arr/2, nur wenn eine Lane existiert. Plan 2026-10-31-automation-slice1.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze, WiedergabeFehler } from '../project/playback.ts';
import { pruefeProjekt, neuesProjekt, MAX_AUTO_PUNKTE } from '../project/model.ts';
import { fuehreAus } from '../project/commands.ts';
import { exportSicht } from '../areas/proj/output.ts';
import { specProjekt, kopie, SHA_A } from './support/project.mjs';

const opt = (extra = {}) => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 2_000_000 : null), ...extra });
const projekt = () => pruefeProjekt(specProjekt()).projekt;
const lane = (punkte = [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }], id = 'a1') => ({ id, ziel: 'fader', punkte });
const mitLane = (l = lane()) => { const p = projekt(); p.spuren[0].automation = [l]; return p; };

test('S1 T3.1 ohne Lane: Wiedergabe /1 und Zeichen für Zeichen die bisherige', () => {
  const ohne = uebersetze(projekt(), opt());
  assert.equal(ohne.format, 'cypherdj-arr/1');
  assert.equal(JSON.stringify(ohne).includes('"auto"'), false);
  // golden: ein Projekt, das nie ein automation-Feld hatte (aus dem Beispiel von Spec 3.3), ergibt dieselben Bytes wie mit entferntem Feld
  const p = mitLane(); delete p.spuren[0].automation;
  assert.equal(JSON.stringify(uebersetze(p, opt())), JSON.stringify(ohne));
  const alt = kopie(specProjekt());                       // ein /1-Projekt wie vor Slice 1
  assert.equal(JSON.stringify(uebersetze(alt, opt())), JSON.stringify(ohne));
});

test('S1 T3.2 mit Lane: Format /2, auto je Spur mit Lane, Spur ohne Lane ohne Feld; Formcodes', () => {
  const w = uebersetze(mitLane(), opt());
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.gruppen, [], 'nur Automation, kein Routing: /2 mit leerer Gruppen-Liste');
  assert.deepEqual(w.spuren[0].auto, [{ ziel: 'fader', punkte: [[0, 0, 0], [16, -30, 0]] }]);
  assert.equal('auto' in w.spuren[1], false); assert.equal('auto' in w.spuren[2], false);
  const f = uebersetze(mitLane(lane([{ beat: 0, wert: 0 }, { beat: 8, wert: -6, form: 's' }, { beat: 8, wert: -12, form: 'sprung' }, { beat: 9, wert: 0, form: 'linear' }])), opt());
  assert.deepEqual(f.spuren[0].auto[0].punkte, [[0, 0, 0], [8, -6, 1], [8, -12, 2], [9, 0, 0]], 'linear 0, s 1, sprung 2');
});

test('S1 T3.3 Lane an Spur mit Gruppe und mit Warp: gruppen steht, auto neben ausgang', () => {
  const p = mitLane();
  p.gruppen = [{ id: 'g1', nr: 1, name: 'G', farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false }];
  p.spuren[0].ausgang = { art: 'gruppe', id: 'g1' };
  const w = uebersetze(p, opt());
  assert.equal(w.format, 'cypherdj-arr/2'); assert.equal(w.gruppen.length, 1);
  assert.deepEqual(w.spuren[0].ausgang, { art: 'gruppe', nr: 1 }); assert.equal(w.spuren[0].auto.length, 1);
  const q = mitLane();
  Object.assign(q.spuren[0].clips[0], { laenge_beats: 8, warp: { an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 } });
  const v = uebersetze(q, opt());
  assert.ok(v.spuren[0].clips[0].warp && v.spuren[0].auto, 'Warp und Lane nebeneinander');
});

test('S1 T3.4 die Grenze 65536 Punkte gilt auch im Übersetzer (zu_gross), 65536 gehen', () => {
  const viele = (n) => Array.from({ length: n }, (_, i) => ({ beat: i, wert: 0 }));
  const p = projekt();
  // 8 Lanes zu 8192 an acht Spuren = 65536; die Spuren stammen aus Hilfsbau (das Beispiel hat drei)
  const spur = (n, l) => ({ id: `s${n}`, nr: n, name: `T${n}`, farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], von: 'andreas', automation: [l] });
  p.spuren = Array.from({ length: 8 }, (_, i) => spur(i + 1, lane(viele(8192), `a${i + 1}`)));
  assert.equal(MAX_AUTO_PUNKTE, 65536);
  assert.equal(uebersetze(p, opt()).spuren.length, 8, 'genau 65536 gehen');
  p.spuren.push(spur(9, lane(viele(1), 'a9')));
  assert.throws(() => uebersetze(p, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'zu_gross');
});

test('S1 T3.5 die Export-Wiedergabe trägt auto mit (exportSicht liest nur)', () => {
  assert.equal(typeof exportSicht, 'function');
  const e = uebersetze(exportSicht(mitLane()), opt());
  assert.equal(e.format, 'cypherdj-arr/2'); assert.equal(e.spuren[0].auto.length, 1, 'die Export-Wiedergabe trägt die Lane');
  assert.equal('auto' in uebersetze(exportSicht(projekt()), opt()).spuren[0], false, 'Negativ-Kontrolle: ohne Lane kein auto');
});

// slice 2 task 2: every lane target is written with its project string; mute and solo points carry formcode 2
const bass = (p) => p.spuren[1];   // the internal RB track of the example project (nr 2)
test('S2 T2.1 each target is written as `ziel` string with its points; a track without lanes gets no `auto`', () => {
  const p = projekt();
  p.spuren[0].automation = [lane(), { id: 'a2', ziel: 'pan', punkte: [{ beat: 0, wert: -1 }, { beat: 8, wert: 1, form: 's' }] },
    { id: 'a3', ziel: 'mute', punkte: [{ beat: 4, wert: 1, form: 'sprung' }, { beat: 8, wert: 0, form: 'sprung' }] },
    { id: 'a4', ziel: 'solo', punkte: [{ beat: 0, wert: 1, form: 'sprung' }] }];
  bass(p).automation = [
    { id: 'b1', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0.2 }, { beat: 4, wert: 0.9 }] },
    { id: 'b2', ziel: 'geraet.lautstaerke', punkte: [{ beat: 0, wert: 0.5 }] },
    { id: 'b3', ziel: 'geraet.resonanz', punkte: [{ beat: 0, wert: 0.1 }] },
    { id: 'b4', ziel: 'geraet.env_mod', punkte: [{ beat: 0, wert: 0.3 }] }];
  const w = uebersetze(p, opt());
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.spuren[0].auto.map((a) => a.ziel), ['fader', 'pan', 'mute', 'solo']);
  assert.deepEqual(w.spuren[0].auto[1].punkte, [[0, -1, 0], [8, 1, 1]]);
  assert.deepEqual(w.spuren[0].auto[2].punkte, [[4, 1, 2], [8, 0, 2]]);
  assert.deepEqual(w.spuren[0].auto[3].punkte, [[0, 1, 2]]);
  assert.deepEqual(w.spuren[1].auto.map((a) => a.ziel), ['geraet.cutoff', 'geraet.lautstaerke', 'geraet.resonanz', 'geraet.env_mod']);
  assert.deepEqual(w.spuren[1].auto[0].punkte, [[0, 0.2, 0], [4, 0.9, 0]]);
  assert.equal('auto' in w.spuren[2], false, 'a track without lanes carries no auto');
});

test('S2 T2.2 mute and solo points are always formcode 2, even if the project point lacks a form (negative control: pan keeps linear)', () => {
  const p = projekt();
  p.spuren[0].automation = [{ id: 'a1', ziel: 'mute', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] },
    { id: 'a2', ziel: 'solo', punkte: [{ beat: 0, wert: 1, form: 'linear' }] },
    { id: 'a3', ziel: 'pan', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] }];   // bypasses pruefeProjekt on purpose: the writer must not depend on it
  const a = uebersetze(p, opt()).spuren[0].auto;
  assert.deepEqual(a[0].punkte, [[0, 0, 2], [4, 1, 2]]);
  assert.deepEqual(a[1].punkte, [[0, 1, 2]]);
  assert.deepEqual(a[2].punkte, [[0, 0, 0], [4, 1, 0]]);
});

test('S2 T2.3 slice 1 project (fader lane only): the file is the same bytes as before; only a pan lane now yields /2 with that lane', () => {
  assert.equal(JSON.stringify(uebersetze(mitLane(), opt()).spuren[0].auto), JSON.stringify([{ ziel: 'fader', punkte: [[0, 0, 0], [16, -30, 0]] }]));
  const nurPan = projekt(); nurPan.spuren[0].automation = [{ id: 'a1', ziel: 'pan', punkte: [{ beat: 0, wert: 0.5 }] }];
  const w = uebersetze(nurPan, opt());
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.spuren[0].auto, [{ ziel: 'pan', punkte: [[0, 0.5, 0]] }]);
});

test('S2 T2.4 the point limit counts the lanes of every target', () => {
  const viele = (n) => Array.from({ length: n }, (_, i) => ({ beat: i, wert: 0 }));
  const p = projekt();
  const spur = (n, l) => ({ id: `s${n}`, nr: n, name: `T${n}`, farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], von: 'andreas', automation: [l] });
  p.spuren = Array.from({ length: 8 }, (_, i) => spur(i + 1, { id: `a${i + 1}`, ziel: 'pan', punkte: viele(8192) }));
  assert.equal(uebersetze(p, opt()).spuren.length, 8, 'exactly 65536 pan points go');
  p.spuren.push(spur(9, { id: 'a9', ziel: 'solo', punkte: viele(1) }));
  assert.throws(() => uebersetze(p, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'zu_gross');
});

test('S2 T5 AK10: a frozen host track keeps its freeze through every fader/pan/mute lane change, and each lane is written once (in auto, not in the freeze)', () => {
  const ok = (p, b) => fuehreAus(p, b).projekt;
  let p = ok(neuesProjekt('F'), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } });
  const freeze = { datei: 'f.f32', frames: 4800, kennung: 1, sha256: 'a'.repeat(64), von_beat: 0 };
  p.spuren[0].freeze = { ...freeze };
  const frames = () => 4800;
  for (const ziel of ['fader', 'pan', 'mute']) {
    p = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel });
    assert.deepEqual(p.spuren[0].freeze, freeze, `auto_neu ${ziel} keeps the freeze`);
    const id = p.spuren[0].automation.find((l) => l.ziel === ziel).id;
    p = ok(p, { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 2, wert: ziel === 'pan' ? 0.5 : ziel === 'mute' ? 1 : -3 }], loesche_von: 0, loesche_bis: 8 });
    assert.deepEqual(p.spuren[0].freeze, freeze, `auto_punkte ${ziel} keeps the freeze`);
  }
  const w = uebersetze(p, opt({ frames, arbeitsordner: '/arbeit/arr', existiert: () => true }));
  const s = w.spuren[0];
  assert.equal(s.art, 'audio', 'the frozen host track plays as audio');
  assert.deepEqual(s.auto.map((a) => a.ziel), ['fader', 'pan', 'mute'], 'each lane once in auto');
  assert.equal(JSON.stringify(w).split('"ziel":"fader"').length - 1, 1, 'the fader lane appears exactly once in the whole file');
  assert.equal('auto' in s.clips[0] || JSON.stringify(s.clips).includes('"fader"'), false, 'not in the freeze clip');
  // changing a lane's point again, and deleting a lane, keep the freeze too; negative control: a tempo change drops it
  const id = p.spuren[0].automation[0].id;
  assert.deepEqual(ok(p, { befehl: 'auto_loeschen', lane_id: id }).spuren[0].freeze, freeze);
  assert.equal(ok(p, { befehl: 'tempo_setzen', bpm: 130 }).spuren[0].freeze, null);
});

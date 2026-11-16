// Workbench stage 1, task 1: the module marker `werkbank: {schema: 1}` and the command werkbank_spur_neu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { MAX_WERKBANK_SPUREN, istWerkbank, werkbankPruefung } from '../project/werkbank.ts';
import { kopie, specProjekt } from './support/project.mjs';

const modul = () => ({ ...neuesProjekt('M'), werkbank: { schema: 1 } });
const bk = (graph) => ({ art: 'intern', name: 'bk', graph, parameter: {} });
const neu = (name) => ({ befehl: 'werkbank_spur_neu', name, geraet: { art: 'intern', name: 'rb338', parameter: {} } });

test('the marker is accepted, a wrong one refused, never with live', () => {
  assert.equal(pruefeFehler({ ...modul(), werkbank: { schema: 1 } }), null);
  for (const w of [{ schema: 2 }, true, { schema: 1, x: 1 }]) assert.notEqual(pruefeFehler({ ...modul(), werkbank: w }), null);
  assert.notEqual(pruefeFehler({ ...modul(), live: true }), null);
});

test('a project without marker stays byte-identical', () => {
  assert.equal('werkbank' in pruefeProjekt(kopie(specProjekt())).projekt, false);
  assert.equal(pruefeProjekt(kopie(modul())).projekt.werkbank.schema, 1);
});

test('the marker check and helpers', () => {
  assert.equal(werkbankPruefung({ schema: 1 }), null);
  assert.notEqual(werkbankPruefung({ schema: 2 }), null);
  assert.equal(MAX_WERKBANK_SPUREN, 8);
  assert.equal(istWerkbank(modul()), true);
  assert.equal(istWerkbank(neuesProjekt('x')), false);
});

test('werkbank_spur_neu creates a track to the master with its pattern clip', () => {
  const { projekt: p } = fuehreListeAus(modul(), [{ befehl: 'werkbank_spur_neu', name: 'Bass', geraet: bk('bass-banddrive'), loop_beats: 16,
    noten: [{ beat: 0.5, laenge: 0.25, ton: 40, vel: 110 }] }]);
  const s = p.spuren[0], c = s.clips[0];
  assert.deepEqual([s.art, s.name, s.fader_db, s.ausgang, s.mute], ['instrument', 'Bass', -6, undefined, false]);
  assert.deepEqual([c.art, c.start_beat, c.laenge_beats, c.loop_beats, c.noten.length], ['midi', 0, 64, 16, 1]);
});

test('werkbank_spur_neu defaults to 16 beats and honours stumm', () => {
  const { projekt: p } = fuehreListeAus(modul(), [{ ...neu('A'), stumm: true }]);
  assert.deepEqual([p.spuren[0].clips[0].loop_beats, p.spuren[0].mute], [16, true]);
});

test('werkbank_spur_neu refusals', () => {
  assert.throws(() => fuehreListeAus(kopie(specProjekt()), [neu('A')]), (e) => e.grund === 'kein_werkbank');
  const voll = fuehreListeAus(modul(), Array.from({ length: 8 }, (_, i) => neu(`T${i}`))).projekt;
  assert.throws(() => fuehreListeAus(voll, [neu('T9')]), (e) => e.grund === 'werkbank_voll');
  const eins = fuehreListeAus(modul(), [neu('Bass')]).projekt;
  assert.throws(() => fuehreListeAus(eins, [neu('bass')]), (e) => e.grund === 'argument_ungueltig');
  assert.throws(() => fuehreListeAus(modul(), [{ ...neu('X'), loop_beats: 0.1 }]), (e) => e.grund === 'argument_ungueltig');
  assert.throws(() => fuehreListeAus(modul(), [{ befehl: 'werkbank_spur_neu', name: 'X' }]), (e) => e.grund === 'argument_ungueltig');
});

// ---- task 2: the template ----
import { vorlageBefehle, vorlageVon, vorlagenListe, WERKBANK_VORLAGEN } from '../project/werkbank.ts';

const techno = () => fuehreListeAus(modul(), vorlageBefehle(vorlageVon('techno-130-start'))).projekt;

test('the template gives two tracks with the numbers of the plan', () => {
  const p = techno();
  assert.deepEqual([p.tempo_bpm, p.loop], [130, { an: true, von_beat: 0, bis_beat: 16 }]);
  assert.deepEqual(p.spuren.map((s) => [s.name, s.geraet.graph, s.clips[0].loop_beats, s.clips[0].noten.length]),
    [['Drums', 'drums-909', 16, 40], ['Bass', 'bass-banddrive', 16, 48]]);
});

test('template notes: drum pitches 36, 39, 42 only; bass pitch per bar 40, 40, 43, 38', () => {
  const p = techno();
  const drums = p.spuren[0].clips[0].noten, bass = p.spuren[1].clips[0].noten;
  assert.deepEqual([...new Set(drums.map((n) => n.ton))].sort((a, b) => a - b), [36, 39, 42]);
  assert.deepEqual(drums.filter((n) => n.ton === 36).map((n) => n.beat), Array.from({ length: 16 }, (_, i) => i));
  assert.deepEqual(drums.filter((n) => n.ton === 39).map((n) => n.beat), [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(drums.filter((n) => n.ton === 42).map((n) => n.beat), Array.from({ length: 16 }, (_, i) => i + 0.5));
  const proTakt = [0, 1, 2, 3].map((b) => [...new Set(bass.filter((n) => Math.floor(n.beat / 4) === b).map((n) => n.ton))]);
  assert.deepEqual(proTakt, [[40], [40], [43], [38]]);
  assert.deepEqual(bass.slice(0, 3).map((n) => [n.beat, n.vel]), [[0.25, 96], [0.5, 112], [0.75, 96]]);
});

test('template lookup', () => {
  assert.equal(vorlageVon('x'), null);
  assert.equal(vorlageVon(5), null);
  assert.equal(WERKBANK_VORLAGEN.length, 1);
  assert.deepEqual(vorlagenListe().map((v) => [v.id, v.name]), [['techno-130-start', 'Techno 130 · Start']]);
});

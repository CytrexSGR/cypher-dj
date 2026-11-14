// SEQ deck v2, task 2: the pure lane logic (public/seq_logic.js). Cells of a clip, gestures as project commands, shapes, derived lanes.
// The command lists are also run through the project model (fuehreListeAus of project/commands.ts): what the old model already knows (notes, envelopes,
// clip_aendern without `seq`) is checked now; the descriptor field `seq` of task 1 is checked in the one test marked `joins task 1`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { seqFolgen } from '../project/seq.ts';
import {
  TEILER, SeqFehler, abgeleiteteZeilen, folgeSicht, zelleBefehle, wertBefehle, kurveBefehle, formPunkte, abdruck, zeileNeuBefehle,
  zeileWegBefehle, zeileAendernBefehle, laengeBefehle, reglerBasis, musterLaenge, zeileBefehle, zeilenSetzenBefehle, folgeEditierbar, neueZeilenId,
} from '../public/seq_logic.js';

// ---------- fixtures ----------
const BK = { art: 'intern', name: 'bk', graph: 'bass', parameter: { k3: 0.25 } };
const KIT = { art: 'intern', name: 'kit', kit: '909' };
const RB = { art: 'intern', name: 'rb338', parameter: {} };
const spurMit = (geraet) => ({ id: 's1', name: 'Bass', art: 'instrument', geraet });
const INFO_BK = { art: 'bk', regler: [{ nr: 3, name: 'Cutoff', vorgabe: 0.5 }, { nr: 4, name: 'Resonance', vorgabe: 0.3 }, { nr: 5, name: 'Drive', vorgabe: 0.5 }], klaenge: [] };
const INFO_KIT = { art: 'kit', regler: [], klaenge: [{ ton: 36, name: 'kick' }, { ton: 38, name: 'snare' }, { ton: 42, name: 'hat' }] };
const INFO_RB = { art: 'rb338', regler: [{ nr: 'cutoff', name: 'Cutoff', vorgabe: 0.4 }], klaenge: [] };
const note = (id, beat, ton, vel = 100, laenge = 0.125) => ({ id, beat, laenge, ton, vel });
const clipMit = (extra = {}) => ({ id: 'c1', art: 'midi', name: 'Bass', start_beat: 0, laenge_beats: 64, loop_beats: 4, noten: [], ...extra });
const bkSpur = () => spurMit(BK);
const lane = (spur, clip, id, info = INFO_BK) => folgeSicht(spur, clip, info).zeilen.find((z) => z.id === id);
const werteK3 = { id: 'cut', art: 'werte', teiler: 0.25, ziel: 'geraet.k3' };
const hkK3 = (punkte, extra = {}) => ({ ziel: 'geraet.k3', punkte, ...extra });
const wirft = (f, teil) => assert.throws(f, (e) => e instanceof SeqFehler && (!teil || e.message.includes(teil)), `expected a SeqFehler naming ${teil}`);

// a project of the model: the fixture of a bk or kit pattern, built with commands the old model knows
function modellProjekt(geraet, clip) {
  const b = [{ befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', name: 'Bass', start_beat: 0, laenge_beats: 64, ...(clip.loop_beats ? { loop_beats: clip.loop_beats } : {}) }];
  if (clip.noten?.length) b.push({ befehl: 'noten_neu', clip_id: 'c1', noten: clip.noten.map(({ beat, laenge, ton, vel }) => ({ beat, laenge, ton, vel })) });
  for (const h of clip.huellkurven ?? []) b.push({ befehl: 'huellkurve_setzen', clip_id: 'c1', ...h });
  return fuehreListeAus(neuesProjekt('T'), b).projekt;
}
const clipVon = (p) => p.spuren[0].clips[0];
// the same state as the pure functions see it (ids as the model assigned them)
const stand = (geraet, clip) => { const p = modellProjekt(geraet, clip); return { p, spur: p.spuren[0], clip: clipVon(p) }; };
const durchModell = (p, befehle) => fuehreListeAus(p, befehle).projekt;

// ---------- derived lanes ----------
test('a kit clip with notes 36, 38, 42 and no descriptor derives three trigger lanes in pitch order', () => {
  const clip = clipMit({ noten: [note('n1', 0, 42), note('n2', 1, 36), note('n3', 2, 38)] });
  const z = abgeleiteteZeilen(spurMit(KIT), clip, INFO_KIT);
  assert.deepEqual(z, [
    { id: 't36', art: 'noten', teiler: 0.25, ton: 36 }, { id: 't38', art: 'noten', teiler: 0.25, ton: 38 }, { id: 't42', art: 'noten', teiler: 0.25, ton: 42 }]);
  const sicht = folgeSicht(spurMit(KIT), clip, INFO_KIT);
  assert.deepEqual(sicht.zeilen.map((x) => [x.name, x.abgeleitet]), [['kick', true], ['snare', true], ['hat', true]]);
});

test('another instrument derives one pitched lane at 1/16, an envelope without a lane derives a curve lane, an empty pattern derives nothing', () => {
  const clip = clipMit({ noten: [note('n1', 0, 48)], huellkurven: [hkK3([{ beat: 0, wert: 0.1 }])] });
  assert.deepEqual(abgeleiteteZeilen(bkSpur(), clip, INFO_BK), [{ id: 'noten', art: 'noten', teiler: 0.25 }, { id: 'k3', art: 'kurve', ziel: 'geraet.k3' }]);
  assert.deepEqual(abgeleiteteZeilen(bkSpur(), clipMit(), INFO_BK), []);
  assert.deepEqual(abgeleiteteZeilen(bkSpur(), null, INFO_BK), []);
});

test('the descriptor wins: covered notes and envelopes derive nothing, uncovered ones still show', () => {
  const sicht = { schema: 1, zeilen: [{ id: 'kick', art: 'noten', teiler: 0.25, ton: 36 }, { id: 'cut', art: 'werte', teiler: 0.25, ziel: 'geraet.k3' }] };
  const clip = clipMit({ seq: sicht, noten: [note('n1', 0, 36), note('n2', 1, 40)], huellkurven: [hkK3([{ beat: 0, wert: 0 }]), { ziel: 'transpose', punkte: [{ beat: 0, wert: 2 }] }] });
  const ids = abgeleiteteZeilen(spurMit(KIT), clip, INFO_KIT).map((z) => z.id);
  assert.deepEqual(ids, ['kick', 'cut', 't40', 'transp']);
  // an id the descriptor already uses is not taken twice
  const belegt = clipMit({ seq: { schema: 1, zeilen: [{ id: 'noten', art: 'noten', teiler: 1, ton: 36 }] }, noten: [note('n1', 0, 40)] });
  assert.deepEqual(abgeleiteteZeilen(bkSpur(), belegt, INFO_BK).map((z) => z.id), ['noten', 'noten2']);
});

// ---------- cells ----------
test('a 1/32 lane of a 4-beat pattern has 32 cells, a 1/16 lane 16, and the lane grid that does not divide the length ends in a shorter cell', () => {
  const clip = clipMit({ seq: { schema: 1, zeilen: [{ id: 'hat', art: 'noten', teiler: 0.125, ton: 42 }] } });
  assert.equal(lane(spurMit(KIT), clip, 'hat', INFO_KIT).zellen.length, 32);
  assert.deepEqual(TEILER, [1, 0.5, 0.25, 0.125]);
  const kurz = clipMit({ loop_beats: 0.625, seq: { schema: 1, zeilen: [{ id: 'hat', art: 'noten', teiler: 0.25, ton: 42 }] } });
  assert.equal(lane(spurMit(KIT), kurz, 'hat', INFO_KIT).zellen.length, 3);
  assert.equal(musterLaenge(clipMit({ loop_beats: undefined })), 64);
});

test('note cells: a note belongs to floor(beat / teiler), the offset is beat minus the cell start, a chord shows its lowest note and a count', () => {
  const clip = clipMit({ noten: [note('n1', 0.3, 50, 90), note('n2', 1, 55), note('n3', 1, 48, 70), note('n4', 2, 52, 100, 1)] });
  const s = folgeSicht(bkSpur(), clip, INFO_BK);
  const z = s.zeilen[0].zellen;
  assert.equal(z[1].an, true); assert.equal(z[1].versatz, 0.05); assert.equal(z[1].ton, 50); assert.equal(z[1].vel, 90);
  assert.equal(z[4].zahl, 2); assert.equal(z[4].ton, 48); assert.equal(z[4].vel, 70); assert.equal(z[4].versatz, 0);
  assert.deepEqual(z[4].noten.map((n) => n.id), ['n3', 'n2'], 'the notes that start in the cell, by start and then pitch');
  assert.equal(z[0].an, false); assert.equal(z[0].ton, null);
  // a note of one beat starting in cell 8 covers cells 9..11
  assert.deepEqual([z[8].an, z[9].gebunden, z[10].gebunden, z[11].gebunden, z[12].gebunden], [true, true, true, true, false]);
  assert.equal(s.hinter_loop, 0);
});

test('a trigger lane takes the notes of its pitch and the pitched lane the rest; notes behind the loop are counted, not drawn', () => {
  const sicht = { schema: 1, zeilen: [{ id: 'kick', art: 'noten', teiler: 0.25, ton: 36 }, { id: 'bass', art: 'noten', teiler: 0.25 }] };
  const clip = clipMit({ seq: sicht, noten: [note('n1', 0, 36), note('n2', 0.5, 40), note('n3', 3.5, 36), note('n4', 4, 36), note('n5', 9, 40)] });
  const s = folgeSicht(spurMit(KIT), clip, INFO_KIT);
  assert.deepEqual(s.zeilen[0].zellen.map((c, i) => (c.an ? i : -1)).filter((i) => i >= 0), [0, 14]);
  assert.deepEqual(s.zeilen[1].zellen.map((c, i) => (c.an ? i : -1)).filter((i) => i >= 0), [2]);
  assert.equal(s.hinter_loop, 2);
  assert.equal(s.laenge_beats, 4);
});

test('value cells of vel and laenge read the notes of their lane on its grid; a cell without a note is not free', () => {
  const sicht = { schema: 1, zeilen: [{ id: 'bass', art: 'noten', teiler: 0.25 }, { id: 'v', art: 'werte', teiler: 0.5, ziel: 'vel' }, { id: 'l', art: 'werte', teiler: 0.25, ziel: 'laenge' }] };
  const clip = clipMit({ seq: sicht, noten: [note('n1', 0, 48, 90, 0.5), note('n2', 1, 50, 64, 0.25)] });
  const s = folgeSicht(bkSpur(), clip, INFO_BK);
  const v = s.zeilen[1];
  assert.equal(v.teiler, 0.25, 'the grid of the note lane');
  assert.deepEqual(v.zellen[0], { da: true, wert: 90, frei: true, geklemmt: false });
  assert.deepEqual(v.zellen[1], { da: false, wert: null, frei: false, geklemmt: false });
  assert.equal(s.zeilen[2].zellen[0].wert, 2);
  assert.equal(s.zeilen[2].zellen[4].wert, 1);
});

test('envelope value cells: a cell without a point holds the value before it, the first point holds before itself, stored offsets are shown on the knob', () => {
  const hk = hkK3([{ beat: 0.5, wert: 0.1, form: 'sprung' }, { beat: 1.25, wert: -0.05, form: 'sprung' }]);
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  const z = lane(bkSpur(), clip, 'cut').zellen;
  assert.deepEqual(z[0], { da: false, wert: 0.2, frei: true, geklemmt: false, naht: true }, 'cell 0 without a point shows the value over the seam (the last point), marked naht');
  assert.deepEqual([z[1].da, z[1].wert, z[1].naht], [false, 0.35, undefined], 'before the first point the first value holds');
  assert.deepEqual(z[2], { da: true, wert: 0.35, frei: true, geklemmt: false });
  assert.deepEqual([z[4].wert, z[5].da, z[5].wert, z[15].wert], [0.35, true, 0.2, 0.2]);
  // a lane without an envelope is empty but free
  assert.deepEqual(lane(bkSpur(), clipMit({ seq: { schema: 1, zeilen: [werteK3] } }), 'cut').zellen[3], { da: false, wert: null, frei: true, geklemmt: false });
});

test('a value that leaves 0..1 on the knob is drawn clamped and marked, the stored offset stays', () => {
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hkK3([{ beat: 0, wert: 0.9 }])] });
  const z = lane(bkSpur(), clip, 'cut').zellen[0];
  assert.deepEqual([z.wert, z.geklemmt], [1, true]);
  // turning the knob moves the whole lane: the base is the track's parameter, else the default of the graph, else 0.5
  const spur2 = spurMit({ ...BK, parameter: { k3: 0.5 } });
  assert.equal(lane(spur2, clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hkK3([{ beat: 0, wert: 0.1 }])] }), 'cut').zellen[0].wert, 0.6);
  assert.equal(reglerBasis(bkSpur(), 3, INFO_BK), 0.25);
  assert.equal(reglerBasis(bkSpur(), 4, INFO_BK), 0.3);
  assert.equal(reglerBasis(bkSpur(), 9, INFO_BK), 0.5);
  assert.equal(reglerBasis(spurMit(RB), 'cutoff', INFO_RB), 0.4);
});

test('a curve lane carries the points in shown values with the range; the shape is dropped once the points no longer match its fingerprint', () => {
  const stored = [{ beat: 0, wert: -0.1, form: 's' }, { beat: 1, wert: 0.4, form: 's' }];
  const form = { art: 'sinus', von: 0.15, bis: 0.65, abdruck: abdruck(stored) };
  const mk = (punkte) => clipMit({ seq: { schema: 1, zeilen: [{ id: 'res', art: 'kurve', ziel: 'geraet.k3', form }] }, huellkurven: [hkK3(punkte)] });
  const ok = lane(bkSpur(), mk(stored), 'res');
  assert.deepEqual(ok.punkte, [{ beat: 0, wert: 0.15, form: 's', geklemmt: false }, { beat: 1, wert: 0.65, form: 's', geklemmt: false }]);
  assert.deepEqual(ok.bereich, { min: 0, max: 1 });
  assert.deepEqual(ok.form, form);
  assert.equal(lane(bkSpur(), mk([stored[0], { beat: 1, wert: 0.41, form: 's' }]), 'res').form, undefined);
});

test('envelope lanes show their own length; the knob of a lane the instrument does not have is marked', () => {
  const clip = clipMit({ seq: { schema: 1, zeilen: [{ id: 'res', art: 'kurve', ziel: 'geraet.k4' }, { id: 'x', art: 'kurve', ziel: 'geraet.k9' }] },
    huellkurven: [{ ziel: 'geraet.k4', verknuepft: false, loop_beats: 3, punkte: [{ beat: 0, wert: 0 }] }] });
  const s = folgeSicht(bkSpur(), clip, INFO_BK);
  assert.deepEqual([s.zeilen[0].laenge_beats, s.zeilen[0].eigen_laenge, s.zeilen[0].name], [3, true, 'Resonance']);
  assert.deepEqual([s.zeilen[1].laenge_beats, s.zeilen[1].eigen_laenge, s.zeilen[1].hat_huellkurve, s.zeilen[1].kein_regler], [4, false, false, true]);
});

// ---------- note lane commands ----------
test('toggling an off trigger cell gives one noten_neu at the cell start, length teiler / 2, velocity 100, and no id', () => {
  const kick = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
  const clip = clipMit({ seq: { schema: 1, zeilen: [kick] } });
  assert.deepEqual(zelleBefehle(spurMit(KIT), clip, kick, 4, {}), [{ befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 1, laenge: 0.125, ton: 36, vel: 100 }] }]);
  const fein = { id: 'hat', art: 'noten', teiler: 0.125, ton: 42 };
  assert.deepEqual(zelleBefehle(spurMit(KIT), clip, fein, 31, { vel: 60 })[0].noten, [{ beat: 3.875, laenge: 0.0625, ton: 42, vel: 60 }]);
});

test('toggling an on cell deletes every note that starts in it and nothing else', () => {
  const kick = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
  const clip = clipMit({ seq: { schema: 1, zeilen: [kick] }, noten: [note('n1', 1, 36), note('n2', 1.1, 36), note('n3', 1.25, 36), note('n4', 1, 40)] });
  assert.deepEqual(zelleBefehle(spurMit(KIT), clip, kick, 4, {}), [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1', 'n2'] }]);
  assert.deepEqual(zelleBefehle(spurMit(KIT), clip, kick, 4, { an: false }), [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1', 'n2'] }]);
  assert.deepEqual(zelleBefehle(spurMit(KIT), clip, kick, 3, { an: false }), []);
  assert.deepEqual(zelleBefehle(spurMit(KIT), clip, kick, 4, { an: true }), []);
});

test('the pitched lane writes a full cell note on the given pitch, sets velocity, length (in cells) and moves a chord as a whole', () => {
  const bass = { id: 'bass', art: 'noten', teiler: 0.25 };
  const clip = clipMit({ seq: { schema: 1, zeilen: [bass] }, noten: [note('n1', 1, 48, 90, 0.25), note('n2', 1, 55, 90, 0.25)] });
  assert.deepEqual(zelleBefehle(bkSpur(), clip, bass, 0, { ton: 40 })[0].noten, [{ beat: 0, laenge: 0.25, ton: 40, vel: 100 }]);
  assert.deepEqual(zelleBefehle(bkSpur(), clip, bass, 0, {})[0].noten, [{ beat: 0, laenge: 0.25, ton: 48, vel: 100 }], 'a default pitch');
  assert.deepEqual(zelleBefehle(bkSpur(), clip, bass, 4, { vel: 70 }), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 70 }, { id: 'n2', vel: 70 }] }]);
  assert.deepEqual(zelleBefehle(bkSpur(), clip, bass, 4, { laenge: 3 }), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', laenge: 0.75 }, { id: 'n2', laenge: 0.75 }] }]);
  assert.deepEqual(zelleBefehle(bkSpur(), clip, bass, 4, { ton: 50 })[0].noten, [{ id: 'n1', ton: 50 }, { id: 'n2', ton: 57 }]);
  assert.deepEqual(zelleBefehle(bkSpur(), clip, bass, 4, { vel: 90 }), [], 'a value that says the same writes nothing');
  wirft(() => zelleBefehle(bkSpur(), clip, bass, 4, { ton: 125 }), 'lane bass, cell 4');
});

test('review focus 2: a clip made in PRODUCTION is shown completely and editing cell 3 leaves its notes and points alone', () => {
  const clip = clipMit({ noten: [note('n1', 0.3, 50), note('n2', 1, 55), note('n3', 1, 48)],
    huellkurven: [{ ziel: 'geraet.k2', punkte: [{ beat: 0, wert: 0.1 }, { beat: 2, wert: 0.3, form: 'sprung' }] }] });
  const s = folgeSicht(bkSpur(), clip, INFO_BK);
  assert.deepEqual(s.zeilen.map((z) => [z.id, z.art, z.abgeleitet]), [['noten', 'noten', true], ['k2', 'kurve', true]]);
  const z = s.zeilen[0].zellen;
  assert.equal(z[1].versatz, 0.05, 'offset mark');
  assert.equal(z[4].zahl, 2, 'chord');
  assert.equal(s.zeilen[1].punkte.length, 2);
  const b = zelleBefehle(bkSpur(), clip, s.zeilen[0], 3, {});
  assert.deepEqual(b, [{ befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 0.75, laenge: 0.25, ton: 48, vel: 100 }] }]);
  assert.equal(b.every((x) => x.befehl === 'noten_neu'), true);
  // the descriptor of a later write makes the derived lanes explicit, so a click on the curve lane keeps them
  const neu = zeileNeuBefehle(bkSpur(), clip, { art: 'werte', teiler: 0.25, ziel: 'vel' }, INFO_BK)[0];
  assert.deepEqual(neu.seq.zeilen.map((x) => x.id), ['noten', 'k2', 'vel']);
});

test('a pattern without a clip: the first note creates the clip (64 beats, loop 4) with the descriptor in one command', () => {
  const kick = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
  const spur = spurMit(KIT);
  assert.deepEqual(zelleBefehle(spur, null, kick, 0, {}), [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', name: 'Bass', start_beat: 0, laenge_beats: 64, loop_beats: 4,
    noten: [{ beat: 0, laenge: 0.125, ton: 36, vel: 100 }], seq: { schema: 1, zeilen: [kick] }, }]);
  assert.deepEqual(zeileNeuBefehle(spur, null, kick, INFO_KIT)[0].seq, { schema: 1, zeilen: [kick] });
  assert.equal(laengeBefehle(spur, null, 8)[0].loop_beats, 8);
  assert.equal(folgeSicht(spur, null, INFO_KIT).laenge_beats, 4);
});

test('refusals name lane and cell and write nothing', () => {
  const kick = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
  const clip = clipMit({ seq: { schema: 1, zeilen: [kick] } });
  wirft(() => zelleBefehle(spurMit(KIT), clip, kick, 16, {}), 'lane kick, cell 16');
  wirft(() => zelleBefehle(spurMit(KIT), clip, kick, 1.5, {}), 'lane kick, cell 1.5');
  wirft(() => zelleBefehle(spurMit(KIT), clip, kick, 0, { vel: 0 }), 'lane kick, cell 0');
  wirft(() => zelleBefehle(spurMit(KIT), clip, kick, 0, { ton: 40 }), 'fixed pitch');
  wirft(() => zelleBefehle(spurMit(KIT), clip, { ...kick, teiler: 0.3 }, 0, {}), 'grid');
  wirft(() => zelleBefehle(spurMit(KIT), clip, { id: 'x', art: 'werte', teiler: 0.25, ziel: 'vel' }, 0, {}), 'note lane');
});

// ---------- value lane commands ----------
test('vel and laenge lanes set the notes that start in the cell, refuse a cell without a note', () => {
  const sicht = { schema: 1, zeilen: [{ id: 'bass', art: 'noten', teiler: 0.25 }, { id: 'v', art: 'werte', teiler: 0.25, ziel: 'vel' }, { id: 'l', art: 'werte', teiler: 0.25, ziel: 'laenge' }] };
  const clip = clipMit({ seq: sicht, noten: [note('n1', 0, 48, 90, 0.25), note('n2', 0.1, 50, 90, 0.25), note('n3', 1, 48, 64, 0.25)] });
  const [, v, l] = sicht.zeilen;
  assert.deepEqual(wertBefehle(bkSpur(), clip, v, 0, 120, INFO_BK), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 120 }, { id: 'n2', vel: 120 }] }]);
  assert.deepEqual(wertBefehle(bkSpur(), clip, v, 4, 64, INFO_BK), []);
  assert.deepEqual(wertBefehle(bkSpur(), clip, l, 4, 2, INFO_BK)[0].noten, [{ id: 'n3', laenge: 0.5 }]);
  wirft(() => wertBefehle(bkSpur(), clip, v, 1, 80, INFO_BK), 'lane v, cell 1');
  wirft(() => wertBefehle(bkSpur(), clip, v, 0, 128, INFO_BK), 'velocity takes 1..127');
  wirft(() => wertBefehle(bkSpur(), clip, v, 0, null, INFO_BK), 'cannot be removed');
  wirft(() => wertBefehle(bkSpur(), clip, l, 0, 0, INFO_BK), 'above 0');
  // several note lanes need `von`
  const zwei = clipMit({ seq: { schema: 1, zeilen: [{ id: 'a', art: 'noten', teiler: 0.25, ton: 36 }, { id: 'b', art: 'noten', teiler: 0.25 }, { id: 'v', art: 'werte', teiler: 0.25, ziel: 'vel' }] }, noten: [note('n1', 0, 36)] });
  wirft(() => wertBefehle(bkSpur(), zwei, zwei.seq.zeilen[2], 0, 80, INFO_BK), 'no note lane');
  wirft(() => zeileNeuBefehle(bkSpur(), clipMit({ seq: { schema: 1, zeilen: zwei.seq.zeilen.slice(0, 2) } }), { id: 'l', art: 'werte', teiler: 0.25, ziel: 'laenge' }, INFO_BK), 'von');
});

test('an envelope value is a sprung point on the grid, stored as shown minus the knob, and the whole envelope is sent', () => {
  const hk = hkK3([{ beat: 0, wert: 0.1 }, { beat: 1.25, wert: -0.05, form: 'sprung' }]);
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  const b = wertBefehle(bkSpur(), clip, werteK3, 2, 0.6, INFO_BK);
  assert.deepEqual(b, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3',
    punkte: [{ beat: 0, wert: 0.1 }, { beat: 0.5, wert: 0.35, form: 'sprung' }, { beat: 1.25, wert: -0.05, form: 'sprung' }] }]);
  assert.deepEqual(wertBefehle(bkSpur(), clip, werteK3, 5, 0.2, INFO_BK), [], 'the same value writes nothing');
  wirft(() => wertBefehle(bkSpur(), clip, werteK3, 2, 1.2, INFO_BK), 'lane cut, cell 2');
  wirft(() => wertBefehle(bkSpur(), clip, werteK3, 16, 0.5, INFO_BK), 'lane cut, cell 16');
});

test('review focus 1: points in cells 2 and 5 and cell 0 empty: the command carries a point at beat 0 with the value of cell 5', () => {
  const hk = hkK3([{ beat: 0.5, wert: 0.1, form: 'sprung' }, { beat: 1.25, wert: -0.05, form: 'sprung' }]);
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  const b = wertBefehle(bkSpur(), clip, werteK3, 2, 0.6, INFO_BK)[0];
  assert.deepEqual(b.punkte, [{ beat: 0, wert: -0.05 }, { beat: 0.5, wert: 0.35, form: 'sprung' }, { beat: 1.25, wert: -0.05, form: 'sprung' }]);
  // the same for an envelope that does not exist yet: the first value lands in cell 5 and the seam point repeats it
  const leer = clipMit({ seq: { schema: 1, zeilen: [werteK3] } });
  assert.deepEqual(wertBefehle(bkSpur(), leer, werteK3, 5, 0.8, INFO_BK)[0].punkte, [{ beat: 0, wert: 0.55 }, { beat: 1.25, wert: 0.55, form: 'sprung' }]);
  // and a value in cell 0 itself is the first point without a form
  assert.deepEqual(wertBefehle(bkSpur(), leer, werteK3, 0, 0.8, INFO_BK)[0].punkte, [{ beat: 0, wert: 0.55 }]);
});

test('removing a point: cell 0 gets the last value back, the last point removed is huellkurve_loeschen', () => {
  const hk = hkK3([{ beat: 0, wert: 0.1 }, { beat: 1.25, wert: -0.05, form: 'sprung' }]);
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  assert.deepEqual(wertBefehle(bkSpur(), clip, werteK3, 5, null, INFO_BK)[0].punkte, [{ beat: 0, wert: 0.1 }]);
  assert.deepEqual(wertBefehle(bkSpur(), clip, werteK3, 0, null, INFO_BK)[0].punkte, [{ beat: 0, wert: -0.05 }, { beat: 1.25, wert: -0.05, form: 'sprung' }]);
  const eins = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hkK3([{ beat: 1.25, wert: 0.1 }])] });
  assert.deepEqual(wertBefehle(bkSpur(), eins, werteK3, 5, null, INFO_BK), [{ befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'geraet.k3' }]);
  assert.deepEqual(wertBefehle(bkSpur(), clipMit({ seq: { schema: 1, zeilen: [werteK3] } }), werteK3, 5, null, INFO_BK), []);
});

test('other targets are shown in their own range; an unlinked envelope keeps its length and its cells follow it', () => {
  const fader = { id: 'fader', art: 'werte', teiler: 0.5, ziel: 'spur_fader' };
  const hk = { ziel: 'spur_fader', verknuepft: false, loop_beats: 2, punkte: [{ beat: 0, wert: -6 }] };
  const clip = clipMit({ seq: { schema: 1, zeilen: [fader] }, huellkurven: [hk] });
  assert.equal(lane(bkSpur(), clip, 'fader').zellen.length, 4);
  const b = wertBefehle(bkSpur(), clip, fader, 3, -12, INFO_BK)[0];
  assert.deepEqual([b.verknuepft, b.loop_beats, b.punkte[1]], [false, 2, { beat: 1.5, wert: -12, form: 'sprung' }]);
  wirft(() => wertBefehle(bkSpur(), clip, fader, 4, -12, INFO_BK), 'cell 4');
  wirft(() => wertBefehle(bkSpur(), clip, fader, 0, 12, INFO_BK), '-60..6');
});

// ---------- curve commands ----------
test('a curve is sent as the whole envelope in stored values; empty removes it; the points must lie inside the lane', () => {
  const res = { id: 'res', art: 'kurve', ziel: 'geraet.k3' };
  const clip = clipMit({ seq: { schema: 1, zeilen: [res] } });
  const b = kurveBefehle(bkSpur(), clip, res, [{ beat: 2, wert: 0.55, form: 's' }, { beat: 0, wert: 0.25 }], INFO_BK);
  assert.deepEqual(b, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 2, wert: 0.3, form: 's' }] }]);
  const mit = clipMit({ seq: { schema: 1, zeilen: [res] }, huellkurven: [hkK3([{ beat: 0, wert: 0 }])] });
  assert.deepEqual(kurveBefehle(bkSpur(), mit, res, [], INFO_BK), [{ befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'geraet.k3' }]);
  assert.deepEqual(kurveBefehle(bkSpur(), mit, res, [{ beat: 0, wert: 0.25 }], INFO_BK), [], 'unchanged');
  wirft(() => kurveBefehle(bkSpur(), clip, res, [{ beat: 5, wert: 0.5 }], INFO_BK), 'point 0');
  wirft(() => kurveBefehle(bkSpur(), clip, res, [{ beat: 1, wert: 1.5 }], INFO_BK), 'point 0');
});

test('a shape written with kurveBefehle stores form with the fingerprint of the stored points; a later edit drops it', () => {
  const res = { id: 'res', art: 'kurve', ziel: 'geraet.k3' };
  const clip = clipMit({ seq: { schema: 1, zeilen: [res] } });
  const form = { art: 'sinus', von: 0.1, bis: 0.9 };
  const punkte = formPunkte(form, 4);
  const [hk, seq] = kurveBefehle(bkSpur(), clip, res, punkte, INFO_BK, form);
  assert.equal(seq.befehl, 'clip_aendern');
  assert.equal(seq.seq.zeilen[0].form.abdruck, abdruck(hk.punkte));
  assert.deepEqual({ ...seq.seq.zeilen[0].form, abdruck: undefined }, { art: 'sinus', von: 0.1, bis: 0.9, abdruck: undefined });
  // as the clip is after the write the lane keeps its shape; after a point moved the next write of the lane drops it
  const nach = clipMit({ seq: seq.seq, huellkurven: [{ ziel: 'geraet.k3', punkte: hk.punkte }] });
  assert.ok(lane(bkSpur(), nach, 'res').form);
  const bewegt = [...punkte]; bewegt[1] = { ...bewegt[1], wert: 0.8 };
  const [, drop] = kurveBefehle(bkSpur(), nach, lane(bkSpur(), nach, 'res'), bewegt, INFO_BK);
  assert.equal(drop.seq.zeilen[0].form, undefined);
  // a derived curve lane is made explicit when it gets a shape
  const abg = clipMit({ huellkurven: [hkK3([{ beat: 0, wert: 0.1 }])], noten: [note('n1', 0, 48)] });
  const [, s2] = kurveBefehle(bkSpur(), abg, { id: 'k3', art: 'kurve', ziel: 'geraet.k3' }, punkte, INFO_BK, form);
  assert.deepEqual(s2.seq.zeilen.map((z) => z.id), ['noten', 'k3']);
});

// ---------- shapes and fingerprint ----------
test('formPunkte(sinus .1 .9, 3 beats) gives s points at 0 and 1.5 with .1 and .9, closed at the period end', () => {
  const p = formPunkte({ art: 'sinus', von: 0.1, bis: 0.9 }, 3);
  assert.deepEqual(p.slice(0, 2), [{ beat: 0, wert: 0.1, form: 's' }, { beat: 1.5, wert: 0.9, form: 's' }]);
  assert.deepEqual(p[2], { beat: 3, wert: 0.1, form: 's' });
});

test('the other shapes: dreieck, saege, saege_ab, rampe, rechteck, zufall (seeded)', () => {
  assert.deepEqual(formPunkte({ art: 'dreieck', von: 0, bis: 1 }, 2).map((p) => [p.beat, p.wert, p.form]), [[0, 0, 'linear'], [1, 1, 'linear'], [2, 0, 'linear']]);
  assert.deepEqual(formPunkte({ art: 'saege', von: 0, bis: 1 }, 2).map((p) => [p.beat, p.wert]), [[0, 0], [2, 1]]);
  assert.deepEqual(formPunkte({ art: 'saege_ab', von: 0, bis: 1 }, 2).map((p) => [p.beat, p.wert]), [[0, 1], [2, 0]]);
  assert.deepEqual(formPunkte({ art: 'rampe', von: 0.2, bis: 0.7 }, 4).map((p) => [p.beat, p.wert, p.form]), [[0, 0.2, 'linear'], [4, 0.7, 'linear']]);
  assert.deepEqual(formPunkte({ art: 'rechteck', von: 0.2, bis: 0.7 }, 4).map((p) => [p.beat, p.wert, p.form]), [[0, 0.2, 'sprung'], [2, 0.7, 'sprung']]);
  const z = formPunkte({ art: 'zufall', von: 0.2, bis: 0.8, saat: 7, stufen: 4 }, 4);
  assert.deepEqual(z.map((p) => p.beat), [0, 1, 2, 3]);
  assert.ok(z.every((p) => p.form === 'sprung' && p.wert >= 0.2 && p.wert <= 0.8));
  assert.deepEqual(formPunkte({ art: 'zufall', von: 0.2, bis: 0.8, saat: 7, stufen: 4 }, 4), z, 'the same seed gives the same dice');
  assert.notDeepEqual(formPunkte({ art: 'zufall', von: 0.2, bis: 0.8, saat: 8, stufen: 4 }, 4), z);
  assert.equal(formPunkte({ art: 'zufall', von: 0, bis: 1 }, 4).length, 8, 'stufen default 8');
  wirft(() => formPunkte({ art: 'welle', von: 0, bis: 1 }, 4), 'art');
  wirft(() => formPunkte({ art: 'sinus', von: 0, bis: 1, phase: 0.25 }, 4), 'phase');
  wirft(() => formPunkte({ art: 'zufall', von: 0, bis: 1, stufen: 0 }, 4), 'stufen');
  wirft(() => formPunkte({ art: 'sinus', von: 0, bis: 1 }, 0), 'period');
});

test('abdruck is equal for equal points and different after one value moves by 0.01', () => {
  const a = [{ beat: 0, wert: 0.1, form: 's' }, { beat: 1.5, wert: 0.9, form: 's' }];
  const b = a.map((p) => ({ ...p }));
  assert.equal(abdruck(a), abdruck(b));
  b[1].wert = 0.91;
  assert.notEqual(abdruck(a), abdruck(b));
  assert.equal(abdruck([{ beat: 0, wert: 0.1 + 1e-9 }]), abdruck([{ beat: 0, wert: 0.1, form: 'linear' }]), 'rounded to 1e-6, linear is the default form');
  assert.equal(typeof abdruck([]), 'string');
});

// ---------- lanes: add, remove, change ----------
test('zeileNeuBefehle appends the lane and refuses what the descriptor refuses', () => {
  const kick = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
  const clip = clipMit({ seq: { schema: 1, zeilen: [kick] } });
  const [c] = zeileNeuBefehle(spurMit(KIT), clip, { art: 'noten', teiler: 0.125, ton: 42 }, INFO_KIT);
  assert.deepEqual(c, { befehl: 'clip_aendern', clip_id: 'c1', seq: { schema: 1, zeilen: [kick, { id: 't42', art: 'noten', teiler: 0.125, ton: 42 }] } });
  assert.deepEqual(zeileNeuBefehle(bkSpur(), clip, { art: 'kurve', ziel: 'geraet.k4' }, INFO_BK)[0].seq.zeilen[1], { id: 'k4', art: 'kurve', ziel: 'geraet.k4' });
  wirft(() => zeileNeuBefehle(spurMit(KIT), clip, { art: 'noten', teiler: 0.25, ton: 36 }, INFO_KIT), 'has a lane already');
  wirft(() => zeileNeuBefehle(bkSpur(), clipMit({ seq: { schema: 1, zeilen: [{ id: 'n', art: 'noten', teiler: 0.25 }] } }), { art: 'noten', teiler: 0.25 }, INFO_BK), 'one pitched lane');
  wirft(() => zeileNeuBefehle(spurMit(KIT), clip, { art: 'kurve', ziel: 'geraet.k4' }, INFO_KIT), 'no target');
  wirft(() => zeileNeuBefehle(bkSpur(), clip, { art: 'noten', teiler: 0.3, ton: 40 }, INFO_BK), 'grid');
  const voll = clipMit({ seq: { schema: 1, zeilen: Array.from({ length: 32 }, (_, i) => ({ id: `l${i}`, art: 'noten', teiler: 0.25, ton: i })) } });
  wirft(() => zeileNeuBefehle(bkSpur(), voll, { art: 'noten', teiler: 0.25, ton: 100 }, INFO_BK), 'at most 32');
});

test('zeileWegBefehle: a trigger lane takes its notes, an envelope lane its envelope, a lane that reads a removed note lane goes too', () => {
  const sicht = { schema: 1, zeilen: [{ id: 'kick', art: 'noten', teiler: 0.25, ton: 36 }, { id: 'bass', art: 'noten', teiler: 0.25 }, { id: 'v', art: 'werte', teiler: 0.25, ziel: 'vel', von: 'bass' }, werteK3] };
  const clip = clipMit({ seq: sicht, noten: [note('n1', 0, 36), note('n2', 1, 40), note('n3', 2, 36)], huellkurven: [hkK3([{ beat: 0, wert: 0 }])] });
  assert.deepEqual(zeileWegBefehle(spurMit(KIT), clip, 'kick'), [
    { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1', 'n3'] },
    { befehl: 'clip_aendern', clip_id: 'c1', seq: { schema: 1, zeilen: sicht.zeilen.slice(1).map((z) => z) } }]);
  assert.deepEqual(zeileWegBefehle(spurMit(KIT), clip, 'cut'), [
    { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'geraet.k3' },
    { befehl: 'clip_aendern', clip_id: 'c1', seq: { schema: 1, zeilen: sicht.zeilen.slice(0, 3) } }]);
  const bass = zeileWegBefehle(spurMit(KIT), clip, 'bass');
  assert.deepEqual(bass[0], { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n2'] });
  assert.deepEqual(bass[1].seq.zeilen.map((z) => z.id), ['kick', 'cut']);
  // the last lane takes the descriptor with it; a derived lane needs no descriptor write
  const nur = clipMit({ seq: { schema: 1, zeilen: [werteK3] } });
  assert.deepEqual(zeileWegBefehle(bkSpur(), nur, 'cut'), [{ befehl: 'clip_aendern', clip_id: 'c1', seq: null }]);
  const abg = clipMit({ noten: [note('n1', 0, 48)] });
  assert.deepEqual(zeileWegBefehle(bkSpur(), abg, 'noten'), [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1'] }]);
  wirft(() => zeileWegBefehle(bkSpur(), nur, 'zz'), 'no such lane');
});

test('re-assigning a lane from geraet.k3 to geraet.k5 deletes k3 and sets k5 with the same shown values on the new base', () => {
  const spur = spurMit({ ...BK, parameter: { k3: 0.25 } });
  const hk = hkK3([{ beat: 0, wert: 0.1 }, { beat: 2, wert: -0.05, form: 'sprung' }]);
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  const b = zeileAendernBefehle(spur, clip, 'cut', { ziel: 'geraet.k5' }, INFO_BK);
  assert.deepEqual(b[0], { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'geraet.k3' });
  assert.deepEqual(b[1], { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k5', punkte: [{ beat: 0, wert: -0.15 }, { beat: 2, wert: -0.3, form: 'sprung' }] });
  assert.deepEqual(b[2].seq.zeilen, [{ id: 'cut', art: 'werte', teiler: 0.25, ziel: 'geraet.k5' }]);
  // the shown values are equal: 0.25 + 0.1 on k3, 0.5 - 0.15 on k5
  const nach = clipMit({ seq: b[2].seq, huellkurven: [{ ziel: 'geraet.k5', punkte: b[1].punkte }] });
  const vorher = lane(spur, clip, 'cut').zellen.map((z) => z.wert), danach = lane(spur, nach, 'cut').zellen.map((z) => z.wert);
  assert.deepEqual(danach, vorher.map((x) => Math.round(x * 1e6) / 1e6));
  assert.deepEqual(zeileAendernBefehle(spur, clip, 'cut', { ziel: 'geraet.k3' }, INFO_BK), [], 'the same target changes nothing');
  wirft(() => zeileAendernBefehle(spurMit(KIT), clip, 'cut', { ziel: 'geraet.k5' }, INFO_KIT), 'no target');
  wirft(() => zeileAendernBefehle(spur, clipMit({ seq: { schema: 1, zeilen: [werteK3, { id: 'b', art: 'kurve', ziel: 'geraet.k5' }] } }), 'cut', { ziel: 'geraet.k5' }, INFO_BK), 'has a lane already');
  wirft(() => zeileAendernBefehle(spur, clip, 'cut', { ziel: 'vel' }, INFO_BK), 'between');
});

test('re-assigning to a target of another range keeps the fraction of the range', () => {
  const spur = bkSpur();
  const hk = hkK3([{ beat: 0, wert: 0.25 }]);                       // shown 0.5 on k3
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  const b = zeileAendernBefehle(spur, clip, 'cut', { ziel: 'transpose' }, INFO_BK);
  assert.deepEqual(b[1].punkte, [{ beat: 0, wert: 0 }]);
});

test('zeileAendernBefehle: the grid (descriptor only) and the own length of an envelope lane (the envelope only)', () => {
  const hk = hkK3([{ beat: 0, wert: 0.1 }]);
  const clip = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hk] });
  assert.deepEqual(zeileAendernBefehle(bkSpur(), clip, 'cut', { teiler: 0.5 }, INFO_BK), [
    { befehl: 'clip_aendern', clip_id: 'c1', seq: { schema: 1, zeilen: [{ ...werteK3, teiler: 0.5 }] } }]);
  assert.deepEqual(zeileAendernBefehle(bkSpur(), clip, 'cut', { eigen_laenge: 3 }, INFO_BK), [
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }], verknuepft: false, loop_beats: 3 }]);
  const frei = clipMit({ seq: { schema: 1, zeilen: [werteK3] }, huellkurven: [hkK3([{ beat: 0, wert: 0.1 }], { verknuepft: false, loop_beats: 3 })] });
  assert.deepEqual(zeileAendernBefehle(bkSpur(), frei, 'cut', { eigen_laenge: null }, INFO_BK), [
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]);
  assert.deepEqual(zeileAendernBefehle(bkSpur(), frei, 'cut', { eigen_laenge: 3 }, INFO_BK), []);
  wirft(() => zeileAendernBefehle(bkSpur(), clipMit({ seq: { schema: 1, zeilen: [werteK3] } }), 'cut', { eigen_laenge: 3 }, INFO_BK), 'no envelope');
  wirft(() => zeileAendernBefehle(bkSpur(), clip, 'cut', { eigen_laenge: 0.01 }, INFO_BK), 'beats');
  wirft(() => zeileAendernBefehle(bkSpur(), clip, 'cut', { teiler: 0.3 }, INFO_BK), 'grid');
  wirft(() => zeileAendernBefehle(bkSpur(), clip, 'cut', { farbe: 1 }, INFO_BK), 'unknown field');
  // a derived lane gets explicit with the new grid
  const abg = clipMit({ noten: [note('n1', 0, 48)] });
  assert.deepEqual(zeileAendernBefehle(bkSpur(), abg, 'noten', { teiler: 0.125 }, INFO_BK)[0].seq.zeilen, [{ id: 'noten', art: 'noten', teiler: 0.125 }]);
});

test('laengeBefehle sets loop_beats and deletes what falls behind the new end, once; lengthening deletes nothing', () => {
  const clip = clipMit({ loop_beats: 8, noten: [note('n1', 1, 48), note('n2', 4, 48), note('n3', 7.5, 48), note('n4', 20, 48)],
    huellkurven: [hkK3([{ beat: 0, wert: 0 }, { beat: 3, wert: 0.1 }, { beat: 4, wert: 0.2 }, { beat: 6, wert: 0.3 }, { beat: 30, wert: 0.4 }]),
      { ziel: 'transpose', punkte: [{ beat: 6, wert: 2 }] }, { ziel: 'spur_pan', verknuepft: false, loop_beats: 6, punkte: [{ beat: 5, wert: 1 }] }] });
  assert.deepEqual(laengeBefehle(bkSpur(), clip, 4), [
    { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n2', 'n3'] },
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0 }, { beat: 3, wert: 0.1 }, { beat: 4, wert: 0.2 }, { beat: 30, wert: 0.4 }] },
    { befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'transpose' },
    { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 4 }]);
  assert.deepEqual(laengeBefehle(bkSpur(), clip, 16), [{ befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 16 }]);
  assert.deepEqual(laengeBefehle(bkSpur(), clip, 8), []);
  wirft(() => laengeBefehle(bkSpur(), clip, 65), 'at most');
  wirft(() => laengeBefehle(bkSpur(), clip, 0.1), 'multiple of 0.125');
  wirft(() => laengeBefehle(bkSpur(), clip, 0), 'multiple of 0.125');
});

// ---------- every list goes through the model ----------
test('every command list is accepted by the project model and reads back as the cell it was made for', () => {
  const kick = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
  // a kit pattern: click on, velocity, click off
  let { p, spur, clip } = stand(KIT, clipMit({ noten: [note('x', 0.5, 36)] }));
  let c = clip;
  const sicht = (cl) => ({ ...cl, seq: { schema: 1, zeilen: [kick] } });
  p = durchModell(p, zelleBefehle(spur, sicht(c), kick, 4, {})); c = clipVon(p);
  assert.deepEqual(lane(spur, sicht(c), 'kick', INFO_KIT).zellen.map((z) => z.an).map(Number).slice(0, 6), [0, 0, 1, 0, 1, 0]);
  p = durchModell(p, zelleBefehle(spur, sicht(c), kick, 4, { vel: 64 })); c = clipVon(p);
  assert.equal(lane(spur, sicht(c), 'kick', INFO_KIT).zellen[4].vel, 64);
  p = durchModell(p, zelleBefehle(spur, sicht(c), kick, 2, {})); c = clipVon(p);
  assert.equal(c.noten.length, 1);

  // a bk pattern: pitched lane, value lane on a knob (seam rule), curve, grid of the shape, length
  const bass = { id: 'bass', art: 'noten', teiler: 0.25 };
  ({ p, spur, clip } = stand(BK, clipMit({ noten: [note('x', 1, 48, 90, 0.25), note('y', 1, 55, 90, 0.25)] })));
  c = clip;
  const mitSicht = (cl) => ({ ...cl, seq: { schema: 1, zeilen: [bass, werteK3, { id: 'res', art: 'kurve', ziel: 'geraet.k4' }] } });
  p = durchModell(p, zelleBefehle(spur, mitSicht(c), bass, 4, { ton: 52 })); c = clipVon(p);
  assert.deepEqual(c.noten.map((n) => n.ton), [52, 59]);
  p = durchModell(p, zelleBefehle(spur, mitSicht(c), bass, 4, { laenge: 2 })); c = clipVon(p);
  assert.equal(c.noten[0].laenge, 0.5);
  p = durchModell(p, wertBefehle(spur, mitSicht(c), werteK3, 5, 0.8, INFO_BK)); c = clipVon(p);
  assert.deepEqual(c.huellkurven[0].punkte, [{ beat: 0, wert: 0.55 }, { beat: 1.25, wert: 0.55, form: 'sprung' }]);
  assert.equal(lane(spur, mitSicht(c), 'cut').zellen[0].wert, 0.8, 'the value before the loop seam holds across it');
  p = durchModell(p, wertBefehle(spur, mitSicht(c), werteK3, 5, null, INFO_BK)); c = clipVon(p);
  assert.equal(c.huellkurven[0].punkte.length, 1, 'one point is left');
  p = durchModell(p, wertBefehle(spur, mitSicht(c), werteK3, 0, null, INFO_BK)); c = clipVon(p);
  assert.equal(c.huellkurven, undefined, 'the last point removed is huellkurve_loeschen');
  const res = { id: 'res', art: 'kurve', ziel: 'geraet.k4' };
  const form = { art: 'sinus', von: 0.1, bis: 0.9 };
  const kb = kurveBefehle(spur, mitSicht(c), res, formPunkte(form, 3), INFO_BK, form).filter((b) => b.befehl !== 'clip_aendern');
  p = durchModell(p, kb); c = clipVon(p);
  assert.equal(c.huellkurven[0].punkte.length, 3);
  // shortening: notes and points behind the new end go in the same list, the model accepts it, a re-assignment too
  p = durchModell(p, laengeBefehle(spur, c, 1)); c = clipVon(p);
  assert.equal(c.loop_beats, 1);
  assert.equal(c.noten.length, 0, 'the notes at beat 1 are behind a 1-beat pattern');
  assert.deepEqual(c.huellkurven[0].punkte.map((x) => x.beat), [0, 1.5, 3].filter((x) => x <= 1 || x > 3), 'points behind the new end are gone');
  const hkNeu = zeileAendernBefehle(spur, { ...c, seq: { schema: 1, zeilen: [res] } }, 'res', { ziel: 'geraet.k5' }, INFO_BK).filter((b) => b.befehl !== 'clip_aendern');
  p = durchModell(p, hkNeu); c = clipVon(p);
  assert.equal(c.huellkurven[0].ziel, 'geraet.k5');
  // a device target of the wrong device is refused by the pure functions before the model sees it, and by the model
  wirft(() => zeileNeuBefehle(spurMit(KIT), clipMit(), { art: 'kurve', ziel: 'geraet.k3' }, INFO_KIT), 'no target');
  assert.throws(() => durchModell(p, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0 }] }]), BefehlFehler);
});

// joins task 1: the descriptor commands go through `clip_aendern {seq}` and `clip_neu {seq}` of the new model; the test turns on by itself when the model knows the field
const modellKenntSeq = (() => {
  try { const { p } = stand(BK, clipMit()); fuehreListeAus(p, [{ befehl: 'clip_aendern', clip_id: 'c1', seq: null }]); return true; } catch { return false; }
})();
test('joins task 1: the descriptor commands are accepted by the model and the lanes read back', { skip: modellKenntSeq ? false : 'the model of task 1 is not merged' }, () => {
  let { p, spur, clip } = stand(BK, clipMit({ noten: [note('x', 1, 48)], huellkurven: [hkK3([{ beat: 0, wert: 0.1 }])] }));
  const neu = zeileNeuBefehle(spur, clip, { art: 'werte', teiler: 0.25, ziel: 'vel' }, INFO_BK);
  p = durchModell(p, neu); clip = clipVon(p);
  assert.deepEqual(clip.seq.zeilen.map((z) => z.id), ['noten', 'k3', 'vel']);
  const res = clip.seq.zeilen[1];
  const form = { art: 'sinus', von: 0.1, bis: 0.9 };
  p = durchModell(p, kurveBefehle(spur, clip, res, formPunkte(form, 4), INFO_BK, form)); clip = clipVon(p);
  assert.ok(lane(spur, clip, 'k3').form);
  p = durchModell(p, zeileAendernBefehle(spur, clip, 'k3', { ziel: 'geraet.k5' }, INFO_BK)); clip = clipVon(p);
  assert.equal(clip.huellkurven[0].ziel, 'geraet.k5');
  assert.ok(lane(spur, clip, 'k3').form, 'the shape stays after the move');
  p = durchModell(p, zeileWegBefehle(spur, clip, 'k3')); clip = clipVon(p);
  assert.equal(clip.huellkurven, undefined);
  assert.deepEqual(clip.seq.zeilen.map((z) => z.id), ['noten', 'vel']);
  const leer = fuehreListeAus(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'instrument', name: 'Drums', geraet: KIT }]).projekt;
  const k = durchModell(leer, zelleBefehle(leer.spuren[0], null, { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 }, 0, {}));
  assert.deepEqual([clipVon(k).loop_beats, clipVon(k).noten.length, clipVon(k).seq.zeilen[0].ton], [4, 1, 36]);
});

// ---------- task 3: whole lanes, own envelope length, editable rule ----------
const trigZeile = { id: 'kick', art: 'noten', teiler: 0.25, ton: 36 };
const leerZellen = (n) => Array.from({ length: n }, () => ({ an: false }));
const mitSicht = (zeilen, extra = {}) => clipMit({ seq: { schema: 1, zeilen }, ...extra });

test('zeileBefehle on a note lane: writes the hits, leaves a cell that says the same, deletes what the line leaves out, one list per kind', () => {
  const clip = mitSicht([trigZeile], { noten: [note('a', 0, 36, 90, 0.2), note('b', 1, 36, 100), note('c', 1.5, 36, 100)] });
  const z = leerZellen(16);
  z[0] = { an: true };                     // same as the data: untouched, also the odd length and velocity
  z[4] = { an: true, vel: 127 };           // the note in cell 4 is there: only the velocity differs
  z[8] = { an: true, vel: 60, laenge: 0.5 };   // new
  const b = zeileBefehle(spurMit(KIT), clip, trigZeile, z, INFO_KIT);
  assert.deepEqual(b, [
    { befehl: 'noten_loeschen', clip_id: 'c1', ids: ['c'] },
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'b', vel: 127 }] },
    { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 2, laenge: 0.125, ton: 36, vel: 60 }] }]);
  // cells that are undefined are left alone
  assert.deepEqual(zeileBefehle(spurMit(KIT), clip, trigZeile, new Array(16).fill(undefined), INFO_KIT), []);
  wirft(() => zeileBefehle(spurMit(KIT), clip, trigZeile, leerZellen(15), INFO_KIT), 'lane kick');
  wirft(() => zeileBefehle(spurMit(KIT), clip, trigZeile, leerZellen(15), INFO_KIT), '15 cells found, 16 expected');
});

test('zeileBefehle on the pitched lane: a chord keeps matching notes (off-grid start too), swaps the others, a trigger pitch of another lane is refused', () => {
  const kopf = { id: 'noten', art: 'noten', teiler: 0.25 };
  const clip = mitSicht([kopf, trigZeile], { noten: [note('a', 0.3, 48), note('b', 0.3, 55), note('c', 1, 50), note('k', 0, 36)] });
  const z = leerZellen(16);
  z[1] = { an: true, toene: [48, 55] };    // the chord at 0.3 (cell 1) is the same
  z[4] = { an: true, toene: [50, 53], laenge: 2 };   // 50 stays, 53 joins, both get two cells
  z[8] = { an: true, toene: [60] };
  const b = zeileBefehle(bkSpur(), clip, kopf, z, INFO_BK);
  assert.deepEqual(b, [
    { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'c', laenge: 0.5 }] },
    { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 1, laenge: 0.5, ton: 53, vel: 100 }, { beat: 2, laenge: 0.25, ton: 60, vel: 100 }] }]);
  const zz = leerZellen(16); zz[0] = { an: true, toene: [36] };
  wirft(() => zeileBefehle(bkSpur(), clip, kopf, zz, INFO_BK), 'belongs to the trigger lane kick');
  wirft(() => zeileBefehle(bkSpur(), clip, kopf, zz, INFO_BK), 'cell 0');
  // fields only: an empty cell is refused with its place
  const nf = new Array(16).fill(undefined); nf[3] = { nurFelder: true, vel: 80 };
  wirft(() => zeileBefehle(bkSpur(), clip, kopf, nf, INFO_BK), 'cell 3');
  nf[3] = undefined; nf[4] = { nurFelder: true, vel: 80 };
  assert.deepEqual(zeileBefehle(bkSpur(), clip, kopf, nf, INFO_BK), [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'c', vel: 80 }] }]);
});

test('zeileBefehle on an envelope lane: the same value to two decimals keeps the point, a changed one is a sprung point on the cell start, a dot removes, the seam point stays', () => {
  const hk = hkK3([{ beat: 0, wert: 0.1 }, { beat: 0.3, wert: 0.2, form: 'linear' }, { beat: 1, wert: 0.05, form: 'sprung' }]);
  const clip = mitSicht([werteK3], { huellkurven: [hk] });      // stored offsets around the knob at 0.25: shown 0.35, 0.45, 0.30
  const z = new Array(16).fill(null);
  z[0] = 0.35;             // shown value of the point: untouched
  z[1] = 0.45;             // the off-grid point at 0.3 lies in cell 1: untouched
  z[4] = 0.30;             // untouched
  z[8] = 0.9;              // new, stored 0.65
  const b = zeileBefehle(bkSpur(), clip, werteK3, z, INFO_BK);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].punkte, [{ beat: 0, wert: 0.1 }, { beat: 0.3, wert: 0.2, form: 'linear' }, { beat: 1, wert: 0.05, form: 'sprung' }, { beat: 2, wert: 0.65, form: 'sprung' }]);
  assert.equal(b[0].verknuepft, undefined);
  // the same cells again: nothing
  z[8] = null;
  assert.deepEqual(zeileBefehle(bkSpur(), clip, werteK3, z, INFO_BK), []);
  // dots in every cell remove the envelope
  assert.deepEqual(zeileBefehle(bkSpur(), clip, werteK3, new Array(16).fill(null), INFO_BK), [{ befehl: 'huellkurve_loeschen', clip_id: 'c1', ziel: 'geraet.k3' }]);
  // seam: points only in cells 2 and 5 -> a point on beat 0 with the value of the last
  const leer = mitSicht([werteK3]);
  const s = new Array(16).fill(null); s[2] = 0.6; s[5] = 0.8;
  const sb = zeileBefehle(bkSpur(), leer, werteK3, s, INFO_BK);
  assert.deepEqual(sb[0].punkte.map((p) => [p.beat, p.wert]), [[0, 0.55], [0.5, 0.35], [1.25, 0.55]]);
  assert.equal(sb[0].punkte[1].form, 'sprung');
  // a value outside the range is refused with lane and cell
  s[7] = 1.5;
  wirft(() => zeileBefehle(bkSpur(), leer, werteK3, s, INFO_BK), 'lane cut, cell 7');
  // an envelope lane that is not an envelope target is no job of this function
  wirft(() => zeileBefehle(bkSpur(), leer, { id: 'v', art: 'werte', teiler: 0.25, ziel: 'vel' }, [], INFO_BK), 'note cells');
});

test('zeileBefehle: an own length sets verknuepft false and loop_beats on the whole envelope and changes the cell count; null links it again', () => {
  const clip = mitSicht([werteK3], { huellkurven: [hkK3([{ beat: 0, wert: 0.1 }])] });
  const z = new Array(12).fill(null); z[0] = 0.35;
  const b = zeileBefehle(bkSpur(), clip, werteK3, z, INFO_BK, { eigen_laenge: 3 });
  assert.deepEqual(b, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }], verknuepft: false, loop_beats: 3 }]);
  const eigen = mitSicht([werteK3], { huellkurven: [hkK3([{ beat: 0, wert: 0.1 }], { verknuepft: false, loop_beats: 3 })] });
  assert.deepEqual(zeileBefehle(bkSpur(), eigen, werteK3, z, INFO_BK), [], 'without eigen_laenge the length stays: 12 cells, nothing to write');
  wirft(() => zeileBefehle(bkSpur(), eigen, werteK3, new Array(16).fill(null), INFO_BK), '16 cells found, 12 expected');
  const lose = zeileBefehle(bkSpur(), eigen, werteK3, new Array(16).fill(null).map((_, i) => (i === 0 ? 0.35 : null)), INFO_BK, { eigen_laenge: null });
  assert.deepEqual(lose, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 0.1 }] }]);
  wirft(() => zeileBefehle(bkSpur(), clip, werteK3, z, INFO_BK, { eigen_laenge: 65 }), 'lane cut');
});

test('kurveBefehle with an own length: points up to that length, verknuepft false in the command, a longer curve than the pattern is allowed', () => {
  const kurve = { id: 'res', art: 'kurve', ziel: 'geraet.k4' };
  const clip = mitSicht([kurve]);
  const form = { art: 'sinus', von: 0.1, bis: 0.9 };
  const b = kurveBefehle(bkSpur(), clip, kurve, formPunkte(form, 3), INFO_BK, form, 3);
  assert.equal(b[0].befehl, 'huellkurve_setzen');
  assert.deepEqual([b[0].verknuepft, b[0].loop_beats, b[0].punkte.at(-1).beat], [false, 3, 3]);
  const lang = kurveBefehle(bkSpur(), clip, kurve, formPunkte(form, 8), INFO_BK, undefined, 8);
  assert.equal(lang[0].loop_beats, 8, 'a curve of 8 beats on a 4-beat pattern');
  wirft(() => kurveBefehle(bkSpur(), clip, kurve, formPunkte(form, 8), INFO_BK), 'beat 0..4');
  // an envelope that has an own length keeps it when the call says nothing
  const eigen = mitSicht([kurve], { huellkurven: [{ ziel: 'geraet.k4', punkte: [{ beat: 0, wert: 0 }, { beat: 3, wert: 0.1 }], verknuepft: false, loop_beats: 3 }] });
  const keep = kurveBefehle(bkSpur(), eigen, kurve, [{ beat: 0, wert: 0.4 }, { beat: 3, wert: 0.5 }], INFO_BK);
  assert.deepEqual([keep[0].verknuepft, keep[0].loop_beats], [false, 3]);
  // the same shape twice: no descriptor command the second time
  const { p, spur, clip: c1 } = stand(BK, clipMit({ seq: undefined }));
  let q = durchModell(p, [...zeilenSetzenBefehle(spur, c1, [kurve], INFO_BK)]);
  q = durchModell(q, kurveBefehle(spur, clipVon(q), kurve, formPunkte(form, 3), INFO_BK, form, 3));
  assert.deepEqual(kurveBefehle(spur, clipVon(q), clipVon(q).seq.zeilen[0], formPunkte(form, 3), INFO_BK, form, 3), []);
});

test('zeilenSetzenBefehle: the whole lane list as one descriptor command, [] for what the clip already shows, derived lanes become explicit', () => {
  const clip = clipMit({ noten: [note('n1', 0, 36), note('n2', 1, 38)] });          // kit clip: two derived lanes
  const abg = abgeleiteteZeilen(spurMit(KIT), clip, INFO_KIT);
  assert.deepEqual(zeilenSetzenBefehle(spurMit(KIT), clip, abg, INFO_KIT), []);
  const mehr = [...abg, { id: 'vel', art: 'werte', teiler: 0.25, ziel: 'vel', von: 't36' }];
  const b = zeilenSetzenBefehle(spurMit(KIT), clip, mehr, INFO_KIT);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].seq.zeilen.map((z) => z.id), ['t36', 't38', 'vel']);
  assert.equal(zeilenSetzenBefehle(spurMit(KIT), null, mehr.slice(0, 1), INFO_KIT)[0].befehl, 'clip_neu');
  wirft(() => zeilenSetzenBefehle(spurMit(KIT), clip, [...abg, { id: 'hat', art: 'noten', teiler: 0.25, ton: 36 }], INFO_KIT), 'note 36');
  assert.equal(neueZeilenId({ art: 'noten', teiler: 0.25, ton: 36 }, abg), 't362');
});

test('folgeEditierbar is the rule D8 of seqFolgen: an instrument track with no clip or one MIDI clip from beat 0 over 64 beats', () => {
  const p = fuehreListeAus(neuesProjekt('T'), [{ befehl: 'gruppenspur_neu', name: 'G' }]).projekt;
  const faelle = [
    ['empty', []],
    ['one fitting', [{ art: 'midi', start_beat: 0, laenge_beats: 64 }]],
    ['starts late', [{ art: 'midi', start_beat: 4, laenge_beats: 60 }]],
    ['short', [{ art: 'midi', start_beat: 0, laenge_beats: 32 }]],
    ['two clips', [{ art: 'midi', start_beat: 0, laenge_beats: 64 }, { art: 'midi', start_beat: 64, laenge_beats: 4 }]],
  ];
  for (const art of ['instrument', 'audio']) {
    for (const [name, clips] of faelle) {
      const q = structuredClone(p);
      q.gruppen[0].seq = { schema: 2, platz: 1 };
      q.spuren.push({ id: 'sx', name: 'T', art, clips: clips.map((c, i) => ({ id: `c${i}`, noten: [], ...c, art: art === 'audio' ? 'audio' : c.art })), ausgang: { art: 'gruppe', id: q.gruppen[0].id } });
      const aus = seqFolgen(q, q.gruppen[0])[0];
      assert.equal(folgeEditierbar(q.spuren[0]), aus.editierbar, `${art} ${name}`);
    }
  }
});

test('review focus 2 (task 3): wertBefehle on one cell leaves a point of the same envelope that sits off the grid in another cell', () => {
  const clip = mitSicht([werteK3], { huellkurven: [hkK3([{ beat: 0, wert: 0.1 }, { beat: 0.3, wert: 0.2 }, { beat: 2.5, wert: -0.1 }])] });
  const b = wertBefehle(bkSpur(), clip, werteK3, 12, 0.9, INFO_BK);                 // cell 12 = beat 3
  assert.equal(b.length, 1);
  const pk = b[0].punkte;
  assert.ok(pk.some((p) => p.beat === 0.3 && p.wert === 0.2), 'the off-grid point stays');
  assert.ok(pk.some((p) => p.beat === 2.5 && p.wert === -0.1), 'the point at 2.5 stays');
  assert.ok(pk.some((p) => p.beat === 3 && Math.abs(p.wert - 0.65) < 1e-9));
});

// ---------- review fixes, round 1 ----------
test('review 1: the fingerprint of a point list is short and fixed in length, equal for equal points, different when one value moves; 64 steps of a shape are allowed, 65 are not', () => {
  const lang = formPunkte({ art: 'zufall', von: 0, bis: 1, stufen: 64, saat: 3 }, 8);
  assert.equal(lang.length, 64);
  assert.ok(abdruck(lang).length <= 16, abdruck(lang));
  assert.equal(abdruck(lang).length, abdruck(lang.slice(0, 8)).length, 'fixed length');
  assert.equal(abdruck(lang), abdruck(lang.map((p) => ({ ...p }))));
  const bewegt = lang.map((p, i) => (i === 40 ? { ...p, wert: p.wert + 0.001 } : p));
  assert.notEqual(abdruck(bewegt), abdruck(lang));
  assert.notEqual(abdruck(lang.slice(0, 63)), abdruck(lang));
  assert.equal(abdruck([]), abdruck(null));
  wirft(() => formPunkte({ art: 'zufall', von: 0, bis: 1, stufen: 65 }, 8), 'stufen');
});

test('review 4: derived lanes are never cut at 32: a kit clip with 40 pitches shows 40 lanes; writing a descriptor of more than 32 lanes is zu_gross and names the number', () => {
  const noten = Array.from({ length: 40 }, (_, i) => note(`n${i}`, i * 0.25, 30 + i));
  const spur = spurMit(KIT), clip = clipMit({ loop_beats: 16, noten });
  assert.equal(abgeleiteteZeilen(spur, clip, INFO_KIT).length, 40);
  const v = folgeSicht(spur, clip, INFO_KIT);
  assert.equal(v.zeilen.length, 40);
  assert.equal(new Set(v.zeilen.map((z) => z.ton)).size, 40, 'every pitch has its lane');
  // 32 explicit lanes plus a note on another pitch: the note is in a derived lane
  const expl = Array.from({ length: 32 }, (_, i) => ({ id: `l${i}`, art: 'noten', teiler: 0.25, ton: 40 + i }));
  const clip2 = clipMit({ loop_beats: 4, seq: { schema: 1, zeilen: expl }, noten: [note('a', 0.5, 100)] });
  const v2 = folgeSicht(spur, clip2, INFO_KIT);
  assert.equal(v2.zeilen.length, 33);
  assert.ok(v2.zeilen.some((z) => z.ton === 100 && z.abgeleitet), 'note 100 is shown');
  // a function that would write a 33rd lane of the descriptor says so
  const e = assert.throws(() => zeileNeuBefehle(spur, clip2, { art: 'noten', teiler: 0.25, ton: 90, id: 'extra' }, INFO_KIT), (x) => x instanceof SeqFehler && x.grund === 'zu_gross' && /34/.test(x.message) && /32/.test(x.message), '32 stored + 1 derived + the new lane');
  assert.equal(e, undefined);
  const zu = Array.from({ length: 33 }, (_, i) => ({ id: `m${i}`, art: 'noten', teiler: 0.25, ton: 40 + i }));
  assert.throws(() => zeilenSetzenBefehle(spur, clipMit({ loop_beats: 4 }), zu), (x) => x instanceof SeqFehler && x.grund === 'zu_gross' && /33/.test(x.message));
});

test('review 5: a note of the pitched lane does not move onto the pitch of a trigger lane, and a new one is not written there: SeqFehler naming lane and cell', () => {
  const spur = spurMit(KIT);
  const clip = clipMit({ loop_beats: 4, noten: [note('k', 0, 36), note('l', 0, 48)],
    seq: { schema: 1, zeilen: [{ id: 'kick', art: 'noten', teiler: 0.25, ton: 36 }, { id: 'lead', art: 'noten', teiler: 0.25 }] } });
  const lead = lane(spur, clip, 'lead', INFO_KIT);
  wirft(() => zelleBefehle(spur, clip, lead, 0, { ton: 36 }), 'kick');
  wirft(() => zelleBefehle(spur, clip, lead, 2, { ton: 36 }), 'kick');
  assert.deepEqual(zelleBefehle(spur, clip, lead, 0, { ton: 40 }).map((b) => b.befehl), ['noten_aendern'], 'a free pitch still moves');
  assert.equal(zelleBefehle(spur, clip, lead, 2, { ton: 41 })[0].befehl, 'noten_neu');
  try { zelleBefehle(spur, clip, lead, 0, { ton: 36 }); } catch (e) { assert.match(e.message, /lead/); assert.match(e.message, /cell 0|0/); }
});

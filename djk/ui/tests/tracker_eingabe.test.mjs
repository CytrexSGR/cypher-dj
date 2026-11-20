// Tracker task 4: cell entry as pure command builders (public/tracker/eingabe.js); the commands are run through fuehreListeAus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';
import { noteSchreiben, notenAus, wertSetzen, zelleLeeren, zeileEntfernen, zeileEinfuegen, knopfWert } from '../public/tracker/eingabe.js';

const frieren = (x) => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frieren); } return x; };
const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
// project with one bk track; lpb 4, default sections of 16 beats (a1, a2, ...)
function basis(clips = []) {
  let p = lauf(neuesProjekt('x'), [{ befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} } }]);
  for (const c of clips) p = lauf(p, [{ befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', ...c, ...(c.noten?.length ? {} : { noten: undefined }) }]);
  return p;
}
const N = (beat, laenge, ton = 60, extra = {}) => ({ beat, laenge, ton, vel: 100, ...extra });
const ort = (p, zeile, o = {}) => ({ abschnitt_id: 'a1', spur_id: p.spuren[0].id, spalte: 0, zeile, unterspalte: 'note', ...o });
// run a builder result: one undo step = one fuehreListeAus call
function wende(p, r) { assert.ok(r && !r.fehler, JSON.stringify(r)); return fuehreListeAus(kopie(p), r.befehle).projekt; }
const noten = (p, ci = 0) => p.spuren[0].clips[ci].noten.map((n) => ({ ...n })).sort((a, b) => a.beat - b.beat || a.ton - b.ton);
const flach = (p) => noten(p).map((n) => [n.beat, n.laenge, n.ton]);

test('a note in a row without a clip starts with clip_neu (section start and length), one undo step', () => {
  const p = frieren(basis());
  const r = noteSchreiben(p, ort(p, 4), 60, { vel: 90 });
  assert.equal(r.label, 'Note C-3');
  assert.equal(r.befehle.length, 1);
  assert.deepEqual(r.befehle[0], { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 16,
    noten: [{ beat: 1, laenge: 15, ton: 60, vel: 90 }] });
  const q = wende(p, r);
  assert.equal(q.spuren[0].clips.length, 1);
  assert.deepEqual(flach(q), [[1, 15, 60]]);
  assert.equal(noten(q)[0].vel, 90);
});

test('a note goes into the clip that covers the row; the previous note is shortened, the new one lasts up to the old end', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 2, 60)] }]));
  const r = noteSchreiben(p, ort(p, 4), 64, {});
  assert.deepEqual(r.befehle.map((b) => b.befehl), ['noten_aendern', 'noten_neu']);
  assert.deepEqual(flach(wende(p, r)), [[0, 1, 60], [1, 1, 64]]);
  const vel = noten(wende(p, r)).find((n) => n.ton === 64).vel;
  assert.equal(vel, 100);
});

test('the new note lasts up to the next note of the column and at most to the clip end; an ended previous note stays', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 0.5, 60), N(8, 1, 67)] }]));
  assert.deepEqual(flach(wende(p, noteSchreiben(p, ort(p, 4), 64, {}))), [[0, 0.5, 60], [1, 7, 64], [8, 1, 67]]);
  const q = frieren(basis([{ start_beat: 0, laenge_beats: 4 }]));
  assert.deepEqual(flach(wende(q, noteSchreiben(q, ort(q, 12), 64, {}))), [[3, 1, 64]]);
});

test('a row that no clip covers gets a new clip even when another clip of the track lies elsewhere in the section', () => {
  const p = frieren(basis([{ start_beat: 4, laenge_beats: 4 }]));
  const q = wende(p, noteSchreiben(p, ort(p, 4), 60, {}));
  assert.equal(q.spuren[0].clips.length, 2);
  const r = wende(p, noteSchreiben(p, ort(p, 17), 60, {}));
  assert.equal(r.spuren[0].clips.length, 1, 'row 17 = beat 4.25 lies in the existing clip');
  assert.deepEqual(r.spuren[0].clips[0].noten.map((n) => [n.beat, n.laenge]), [[0.25, 3.75]]);
});

test('the row line is used and versatz dropped when the previous sounding start is delayed', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 4, 60, { versatz: 50 })] }]));
  const q = wende(p, noteSchreiben(p, ort(p, 4), 64, {}));
  const a = noten(q).find((n) => n.ton === 60), b = noten(q).find((n) => n.ton === 64);
  assert.equal(b.versatz, undefined);
  assert.equal(b.beat, 1);
  assert.ok(Math.abs(a.beat + a.versatz / 100 * 0.25 + a.laenge - 1) < 1e-9, 'previous note ends exactly at the new sounding start');
});

test('retyping a note that is off the grid puts it on the row line (noten_aendern with the new beat)', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(1.125, 1, 60, { versatz: 40 })] }]));
  const r = noteSchreiben(p, ort(p, 4), 62, {});
  assert.deepEqual(r.befehle.map((b) => b.befehl), ['noten_aendern']);
  const n = noten(wende(p, r))[0];
  assert.equal(n.beat, 1); assert.equal(n.ton, 62); assert.equal(n.versatz, undefined);
  assert.equal(noten(wende(p, r)).length, 1);
  assert.equal(noteSchreiben(p, ort(p, 4), 62, {}) !== null, true);
  const gleich = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(1, 1, 60)] }]));
  assert.equal(noteSchreiben(gleich, ort(gleich, 4), 60, {}), null, 'nothing to do');
});

test('Shift (akkord) writes into the first free note column of the row; all 8 taken is refused', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]));
  const r = noteSchreiben(p, ort(p, 0), 64, { akkord: true });
  assert.equal(r.spalte, 1);
  const q = wende(p, r);
  assert.deepEqual(noten(q).map((n) => [n.ton, n.spalte]), [[60, undefined], [64, 2]]);
  const voll = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: Array.from({ length: 8 }, (_, i) => N(0, 1, 60 + i, i > 0 ? { spalte: i + 1 } : {})) }]));
  const f = noteSchreiben(voll, ort(voll, 0), 72, { akkord: true });
  assert.deepEqual(f, { fehler: 'All 8 note columns are used in this row' });
  assert.equal(f.befehle, undefined);
  const g = noteSchreiben(voll, ort(voll, 0, { spalte: 3 }), 72, { akkord: true });
  assert.equal(g.fehler, 'All 8 note columns are used in this row');
  const frei = noteSchreiben(voll, ort(voll, 1, { spalte: 3 }), 72, { akkord: true });
  assert.equal(frei.spalte, 3, 'a free cell is used in place');
});

test('a note in column 3 stores spalte 3; notes of one column never overlap', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 8, 60, { spalte: 3 }), N(0, 8, 50)] }]));
  const q = wende(p, noteSchreiben(p, ort(p, 8, { spalte: 2 }), 62, {}));
  const col3 = noten(q).filter((n) => n.spalte === 3);
  assert.deepEqual(col3.map((n) => [n.beat, n.laenge, n.ton]), [[0, 2, 60], [2, 6, 62]]);
  assert.deepEqual(noten(q).filter((n) => n.spalte === undefined).map((n) => [n.beat, n.laenge]), [[0, 8]]);
});

test('notenAus ends the sounding note on the row line; without a sounding note it is null', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 4, 60)] }]));
  const r = notenAus(p, ort(p, 2));
  assert.equal(r.label, 'Note off');
  assert.deepEqual(flach(wende(p, r)), [[0, 0.5, 60]]);
  assert.equal(notenAus(p, ort(p, 15)).befehle[0].noten[0].laenge, 3.75, 'row 15 still sounds');
  assert.equal(notenAus(p, ort(p, 16)), null, 'the note ends on row 16');
  assert.equal(notenAus(p, ort(p, 17)), null);
  assert.equal(notenAus(p, ort(p, 2, { spalte: 1 })), null, 'other note column');
});

test('DLY of a note off sets the length of the note that ends there', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]));
  const r = wertSetzen(p, ort(p, 4, { unterspalte: 'dly' }), 'dly', 50);
  assert.equal(r.label, 'Delay 50');
  assert.deepEqual(flach(wende(p, r)), [[0, 1.125, 60]]);
  assert.equal(wertSetzen(p, ort(p, 4), 'dly', 101).fehler !== undefined, true, 'row length is 100 % at 4 rows per beat');
  assert.deepEqual(flach(wende(p, wertSetzen(p, ort(p, 4), 'dly', 100))), [[0, 1.25, 60]]);
  const q = wende(p, r);
  assert.deepEqual(flach(wende(q, wertSetzen(q, ort(q, 4), 'dly', null))), [[0, 1, 60]]);
  const next = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(1.1, 1, 62)] }]));
  assert.ok(wertSetzen(next, ort(next, 4), 'dly', 100).fehler, 'would run into the next note');
});

test('values of a note: velocity, delay, chance, repeat; null clears; limits are refused', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]));
  const o = ort(p, 0);
  let r = wertSetzen(p, o, 'vol', 96);
  assert.equal(r.label, 'Velocity 96');
  assert.equal(noten(wende(p, r))[0].vel, 96);
  assert.equal(wertSetzen(p, o, 'vol', 100), null);
  for (const [u, w] of [['vol', 0], ['vol', 128], ['vol', 1.5], ['dly', 0], ['dly', 96], ['dly', -96], ['chn', 0], ['chn', 100], ['rpt', 1], ['rpt', 9]]) {
    assert.ok(wertSetzen(p, o, u, w).fehler, `${u} ${w}`);
  }
  assert.ok(wertSetzen(p, o, 'vol', null).fehler, 'velocity cannot be cleared');
  r = wertSetzen(p, o, 'chn', 50); assert.equal(noten(wende(p, r))[0].chance, 50);
  r = wertSetzen(p, o, 'rpt', 3); assert.equal(noten(wende(p, r))[0].wdh, 3);
  assert.equal(wertSetzen(p, o, 'chn', null), null);
  const q = wende(p, wertSetzen(p, o, 'chn', 50));
  assert.equal(noten(wende(q, wertSetzen(q, o, 'chn', null)))[0].chance, undefined);
  assert.ok(wertSetzen(p, ort(p, 8), 'vol', 90).fehler, 'no note in the cell');
  // delay of a note: start later, end stays, previous note of the column follows when the delay is negative
  const d = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(1, 1, 62)] }]));
  const dq = wende(d, wertSetzen(d, ort(d, 4), 'dly', -50));
  assert.deepEqual(noten(dq).map((n) => [n.beat, n.laenge, n.versatz]), [[0, 0.875, undefined], [1, 1.125, -50]]);
  assert.equal(wertSetzen(d, ort(d, 4), 'dly', -50).label, 'Delay -50');
});

test('zelleLeeren: a note is deleted and the previous note lasts up to the next start', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(1, 1, 62), N(4, 1, 64)] }]));
  const r = zelleLeeren(p, ort(p, 4));
  assert.equal(r.label, 'Clear cell');
  assert.deepEqual(flach(wende(p, r)), [[0, 4, 60], [4, 1, 64]]);
  const lueck = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 0.5, 60), N(1, 1, 62)] }]));
  assert.deepEqual(flach(wende(lueck, zelleLeeren(lueck, ort(lueck, 4)))), [[0, 0.5, 60]], 'a note with its own end is not lengthened');
  const letzte = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(1, 1, 62)] }]));
  assert.deepEqual(flach(wende(letzte, zelleLeeren(letzte, ort(letzte, 4)))), [[0, 16, 60]], 'up to the clip end');
  assert.equal(zelleLeeren(p, ort(p, 9)), null);
});

test('zelleLeeren on a note off lengthens the note; on a value cell it clears the field', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(4, 1, 62, { chance: 40, wdh: 2, versatz: 25 })] }]));
  assert.deepEqual(flach(wende(p, zelleLeeren(p, ort(p, 4)))).slice(0, 1), [[0, 4.0625, 60]], 'up to the sounding start of the next note');
  for (const [u, feld] of [['chn', 'chance'], ['rpt', 'wdh'], ['dly', 'versatz']]) {
    const r = zelleLeeren(p, ort(p, 16, { unterspalte: u }));
    assert.equal(r.label, 'Clear cell');
    assert.equal(noten(wende(p, r)).find((n) => n.ton === 62)[feld], undefined, u);
  }
  assert.ok(zelleLeeren(p, ort(p, 16, { unterspalte: 'vol' })).fehler);
});

test('a knob value is written as a jump point through huellkurve_setzen; D6 bytes; without a clip it is refused', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]));
  const r = knopfWert(p, ort(p, 8, { unterspalte: 'fx', fxspalte: 0 }), 12, 0x80);
  assert.equal(r.label, 'Knob 12');
  assert.deepEqual(r.befehle, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k12', punkte: [{ beat: 2, wert: 0, form: 'sprung' }] }]);
  const q = wende(p, r);
  const q2 = wende(q, knopfWert(q, ort(q, 4), 12, 0xff));
  assert.deepEqual(q2.spuren[0].clips[0].huellkurven[0].punkte, [{ beat: 1, wert: 1, form: 'sprung' }, { beat: 2, wert: 0, form: 'sprung' }]);
  const q3 = wende(q2, knopfWert(q2, ort(q2, 4), 12, 0));
  assert.deepEqual(q3.spuren[0].clips[0].huellkurven[0].punkte, [{ beat: 1, wert: -1, form: 'sprung' }, { beat: 2, wert: 0, form: 'sprung' }]);
  assert.equal(knopfWert(q3, ort(q3, 4), 12, 0), null, 'same value');
  const leer = frieren(basis());
  assert.deepEqual(knopfWert(leer, ort(leer, 0), 12, 5), { fehler: 'No clip here: type a note first' });
  assert.ok(knopfWert(p, ort(p, 0), 0, 5).fehler); assert.ok(knopfWert(p, ort(p, 0), 65, 5).fehler); assert.ok(knopfWert(p, ort(p, 0), 3, 256).fehler);
  const kurve = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]));
  const mitKurve = lauf(kurve, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k5', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] }]);
  assert.ok(knopfWert(mitKurve, ort(mitKurve, 8), 5, 9).fehler.includes('PRODUCTION'));
});

test('zelleLeeren on a knob value removes that point; the envelope goes when it is empty', () => {
  let p = basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]);
  p = wende(p, knopfWert(p, ort(p, 4), 7, 200));
  p = wende(p, knopfWert(p, ort(p, 8), 7, 10));
  const fx = (z) => ort(p, z, { unterspalte: 'fx', fxspalte: 0 });
  p = frieren(p);
  const q = wende(p, zelleLeeren(p, fx(4)));
  assert.deepEqual(q.spuren[0].clips[0].huellkurven[0].punkte.map((x) => x.beat), [2]);
  const q2 = wende(q, zelleLeeren(q, fx(8)));
  assert.equal(q2.spuren[0].clips[0].huellkurven, undefined);
  assert.equal(zelleLeeren(p, fx(9)), null);
  assert.equal(knopfWert(p, ort(p, 4), 7, null).label, 'Clear cell');
});

test('zeileEntfernen: deletes the notes of the row and moves the later notes of the column up, keeping their offset', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(1, 1, 62), N(2, 1, 64, { versatz: 25 }), N(3.5, 1, 65), N(2, 1, 40, { spalte: 2 })] }]));
  const r = zeileEntfernen(p, ort(p, 4));
  assert.equal(r.label, 'Pull up');
  const q = wende(p, r);
  assert.deepEqual(noten(q).filter((n) => n.spalte === undefined).map((n) => [n.beat, n.ton, n.versatz]), [[0, 60, undefined], [1.75, 64, 25], [3.25, 65, undefined]]);
  assert.deepEqual(noten(q).filter((n) => n.spalte === 2).map((n) => n.beat), [2], 'only this note column changes');
});

test('zeileEntfernen cuts a note that sounds across the row; zeileEinfuegen stretches it', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 2, 60), N(2, 1, 62)] }]));
  assert.deepEqual(flach(wende(p, zeileEntfernen(p, ort(p, 4)))), [[0, 1.75, 60], [1.75, 1, 62]]);
  assert.deepEqual(flach(wende(p, zeileEinfuegen(p, ort(p, 4)))), [[0, 2.25, 60], [2.25, 1, 62]]);
  assert.ok(zeileEntfernen(p, ort(p, 64)).fehler);
  assert.equal(zeileEntfernen(p, ort(p, 60)), null, 'nothing after row 60');
});

test('zeileEinfuegen moves the notes down; what passes the section end is deleted (D8); only this column changes', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60), N(2, 1, 62), N(15.75, 0.25, 64), N(2, 1, 40, { spalte: 2 })] }]));
  const r = zeileEinfuegen(p, ort(p, 4));
  assert.equal(r.label, 'Push down');
  assert.equal(r.verworfen, 1);
  const q = wende(p, r);
  assert.deepEqual(noten(q).filter((n) => n.spalte === undefined).map((n) => [n.beat, n.ton]), [[0, 60], [2.25, 62]]);
  assert.deepEqual(noten(q).filter((n) => n.spalte === 2).map((n) => n.beat), [2]);
  const q2 = wende(p, zeileEinfuegen(p, ort(p, 4, { spalte: 1 })));
  assert.deepEqual(noten(q2).filter((n) => n.spalte === 2).map((n) => n.beat), [2.25]);
});

test('pull up refuses to move a note above the start of its clip', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 4, noten: [N(0, 1, 60)] }, { start_beat: 1, laenge_beats: 4, noten: [N(0, 1, 62)] }]));
  assert.ok(zeileEntfernen(p, ort(p, 0)).fehler);
});

test('builders never change their input and refuse unknown tracks, sections and audio tracks', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [N(0, 1, 60)] }]));
  assert.ok(noteSchreiben(p, { ...ort(p, 0), spur_id: 'nope' }, 60, {}).fehler);
  assert.ok(noteSchreiben(p, { ...ort(p, 0), abschnitt_id: 'a9' }, 60, {}).fehler);
  assert.ok(noteSchreiben(p, ort(p, 0), 20, {}).fehler);
  assert.ok(noteSchreiben(p, ort(p, 0), 60, { vel: 0 }).fehler);
  assert.ok(noteSchreiben(p, ort(p, 64), 60, {}).fehler);
  assert.ok(noteSchreiben(p, ort(p, 0, { spalte: 8 }), 60, {}).fehler);
});

test('a note typed in a section that is not the first (a2) lands in its clip at the section row', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 32 }]));
  const o = { abschnitt_id: 'a2', spur_id: 's1', spalte: 0, zeile: 2, unterspalte: 'note' };
  assert.deepEqual(flach(wende(p, noteSchreiben(p, o, 60, {}))), [[16.5, 15.5, 60]]);
  const p2 = frieren(basis([{ start_beat: 0, laenge_beats: 32 }]));
  assert.equal(p2.spuren[0].clips.length, 1);
});

// review fix: overlapping notes without a tracker origin are shown in separate columns; edits work on the shown column
test('overlapping notes: clearing the off of the long note, and a write in the first column, act on that note only', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [{ id: 'n1', ...N(0, 4, 60) }, { id: 'n2', ...N(1, 1, 64) }] }]));
  const q = wende(p, zelleLeeren(p, ort(p, 16)));                           // the === of n1 (row 16) lies in column 0
  assert.equal(q.spuren[0].clips[0].noten.length, 2);                       // clearing a note off lengthens its note: n1 lasts to the clip end
  assert.equal(q.spuren[0].clips[0].noten.find((n) => n.id === 'n1').laenge, 16);
  assert.equal(q.spuren[0].clips[0].noten.find((n) => n.id === 'n2').laenge, 1);
  const w = wende(p, noteSchreiben(p, ort(p, 12), 67, {}));                  // beat 3 in column 0 shortens n1, n2 stays
  const lang = w.spuren[0].clips[0].noten.find((n) => n.id === 'n1');
  assert.equal(lang.laenge, 3);
  assert.equal(w.spuren[0].clips[0].noten.find((n) => n.id === 'n2').laenge, 1);
});

test('overlapping notes: editing the note shown in the second column stores that column', () => {
  const p = frieren(basis([{ start_beat: 0, laenge_beats: 16, noten: [{ id: 'n1', ...N(0, 4, 60) }, { id: 'n2', ...N(1, 1, 64) }] }]));
  const q = wende(p, noteSchreiben(p, ort(p, 4, { spalte: 1 }), 65, {}));
  const n2 = q.spuren[0].clips[0].noten.find((n) => n.id === 'n2');
  assert.equal(n2.ton, 65); assert.equal(n2.spalte, 2);
});

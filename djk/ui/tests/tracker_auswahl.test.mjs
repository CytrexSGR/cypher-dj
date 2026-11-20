// Tracker task 5: selection, clipboard, interpolation and transpose as pure command builders (public/tracker/auswahl.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';

const A = await import('../public/tracker/auswahl.js');
const { projiziere } = await import('../public/tracker/grid_model.js');
const { erweitere, allesWahl, kopiere, einsetzen, ausschneiden, duplizieren, interpoliere, transponiere } = A;

const BK = { art: 'intern', name: 'bk', graph: 'lead' };
const lauf = (p, befehle) => fuehreListeAus(p, befehle).projekt;
function basis(extra = []) {
  return lauf(neuesProjekt('t'), [
    { befehl: 'spur_neu', art: 'instrument', geraet: BK }, { befehl: 'spur_neu', art: 'instrument', geraet: BK },
    { befehl: 'spur_neu', art: 'instrument', geraet: BK }, { befehl: 'spur_neu', art: 'audio' }, ...extra]);
}
const clip = (spur, noten, extra = {}) => ({ befehl: 'clip_neu', spur_id: spur, art: 'midi', start_beat: 0, laenge_beats: 16, noten, ...extra });
const nt = (beat, ton, laenge = 0.25, extra = {}) => ({ beat, laenge, ton, vel: 100, ...extra });
const frieren = (x) => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frieren); } return x; };
// apply a builder result, check the project stays valid, return the new project
function an(p, r) {
  assert.ok(r && !r.fehler && Array.isArray(r.befehle), `no command list: ${JSON.stringify(r)}`);
  const q = lauf(p, r.befehle);
  assert.ok(pruefeProjekt(q).projekt, `invalid result: ${JSON.stringify(pruefeProjekt(q))}`);
  return q;
}
const noten = (p, spur) => p.spuren.find((s) => s.id === spur).clips.flatMap((c) => c.noten.map((n) => ({ ...n, beat: n.beat + c.start_beat })))
  .sort((a, b) => a.beat - b.beat || a.ton - b.ton).map(({ id, ...r }) => r);
const kurz = (p, spur) => noten(p, spur).map((n) => [n.beat, n.ton, n.laenge, n.spalte ?? 1]);
const wahl = (o) => ({ abschnitt_id: 'a1', spur_von: 0, spur_bis: 0, zeile_von: 0, zeile_bis: 0, spalten: 'eine', spalte: 0, unterspalte: 'note', ...o });
const cur = (o) => ({ spur: 0, spalte: 0, zeile: 0, unterspalte: 'note', ...o });

test('erweitere: starts at the cursor, grows by rows with the cursor as anchor, by tracks into a track selection', () => {
  const r = projiziere(frieren(basis()), { abschnitt_id: 'a1' });
  let w = erweitere(null, cur({ zeile: 4 }), 0, 0, r);
  assert.deepEqual(w, wahl({ zeile_von: 4, zeile_bis: 4 }));
  w = erweitere(null, cur({ zeile: 4 }), 2, 0, r);
  assert.deepEqual([w.zeile_von, w.zeile_bis], [4, 6]);
  w = erweitere(w, cur({ zeile: 4 }), 1, 0, r);
  assert.deepEqual([w.zeile_von, w.zeile_bis], [4, 7]);
  w = erweitere(w, cur({ zeile: 4 }), -5, 0, r);                          // the moving edge crosses the anchor
  assert.deepEqual([w.zeile_von, w.zeile_bis], [2, 4]);
  w = erweitere(null, cur({ zeile: 0 }), -1, 0, r);                       // clamped at row 0
  assert.deepEqual([w.zeile_von, w.zeile_bis], [0, 0]);
  w = erweitere(null, cur({ zeile: 63 }), 5, 0, r);                       // clamped at the section end (64 rows)
  assert.deepEqual([w.zeile_von, w.zeile_bis], [63, 63]);
  let v = erweitere(wahl({}), cur({}), 0, 1, r);
  assert.deepEqual([v.spur_von, v.spur_bis, v.spalten], [0, 1, 'spur']);
  v = erweitere(v, cur({}), 0, -1, r);                                    // back to one track: the single cell again
  assert.deepEqual([v.spur_von, v.spur_bis, v.spalten, v.spalte], [0, 0, 'eine', 0]);
  v = erweitere(null, cur({ spur: 3 }), 0, 1, r);                         // clamped at the last track
  assert.equal(v.spur_bis, 3);
  const f = erweitere(null, cur({ unterspalte: 'fx', fxspalte: 0 }), 1, 0, r);
  assert.deepEqual([f.unterspalte, f.fxspalte], ['fx', 0]);
});

test('allesWahl: the first press the track column of the section, the second the whole section', () => {
  const r = projiziere(frieren(basis()), { abschnitt_id: 'a1' });
  const a = allesWahl(null, cur({ spur: 1, zeile: 9 }), r);
  assert.deepEqual(a, { abschnitt_id: 'a1', spur_von: 1, spur_bis: 1, zeile_von: 0, zeile_bis: 63, spalten: 'spur' });
  const b = allesWahl(a, cur({ spur: 1 }), r);
  assert.deepEqual(b, { abschnitt_id: 'a1', spur_von: 0, spur_bis: 3, zeile_von: 0, zeile_bis: 63, spalten: 'alle' });
  assert.deepEqual(allesWahl(b, cur({}), r), b);
  assert.equal(allesWahl(wahl({ zeile_von: 2, zeile_bis: 5 }), cur({ spur: 2 }), r).spalten, 'spur');
});

test('kopiere: cells relative to the top-left, notes with their fields, knob values', () => {
  const p = basis([clip('s1', [nt(1, 60, 0.4, { versatz: 25, chance: 40, wdh: 3 }), nt(1.5, 64, 0.25, { vel: 90 })]),
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k12', punkte: [{ beat: 1.25, wert: 0, form: 'sprung' }] }]);
  const a = kopiere(frieren(p), wahl({ zeile_von: 4, zeile_bis: 7, spalten: 'spur' }));
  assert.equal(a.zeilen, 4);
  assert.equal(a.spuren.length, 1);
  assert.deepEqual(a.spuren[0].noten, [
    { spalte: 0, zeile: 0, ton: 60, vel: 100, laenge: 0.4, versatz: 25, chance: 40, wdh: 3 },
    { spalte: 0, zeile: 2, ton: 64, vel: 90, laenge: 0.25 }]);
  assert.deepEqual(a.spuren[0].knoepfe, [{ zeile: 1, knopf: 12, wert: 128 }]);
  const e = kopiere(p, wahl({ zeile_von: 0, zeile_bis: 3 }));
  assert.deepEqual(e.spuren[0].noten, []);
});

test('paste across two tracks: notes land on row lines, a track without a clip gets a section-wide clip in the same list', () => {
  const p = basis([clip('s1', [nt(0, 60, 0.25), nt(0.5, 62, 0.25)]), clip('s2', [nt(0.25, 48, 0.5)])]);
  const a = kopiere(p, wahl({ spur_von: 0, spur_bis: 1, zeile_von: 0, zeile_bis: 3, spalten: 'spur' }));
  const r = einsetzen(frieren(p), { abschnitt_id: 'a1', spur_id: 's2', zeile: 8, spalte: 0, unterspalte: 'note' }, a);
  assert.equal(r.label, 'Paste');
  const neuClip = r.befehle.filter((b) => b.befehl === 'clip_neu');
  assert.equal(neuClip.length, 1);
  assert.deepEqual([neuClip[0].spur_id, neuClip[0].start_beat, neuClip[0].laenge_beats], ['s3', 0, 16]);
  const q = an(p, r);
  assert.deepEqual(kurz(q, 's2'), [[0.25, 48, 0.5, 1], [2, 60, 0.25, 1], [2.5, 62, 0.25, 1]]);   // s2 now holds s1's rows
  assert.deepEqual(kurz(q, 's3'), [[2.25, 48, 0.5, 1]]);
  assert.deepEqual(kurz(q, 's1'), kurz(p, 's1'));
  assert.equal(q.spuren.find((s) => s.id === 's3').clips.length, 1);
});

test('paste recomputes lengths: the sounding note is cut at the new start, the pasted note stops at the next note', () => {
  const p = basis([clip('s1', [nt(0, 60, 1), nt(3, 65, 1)]), clip('s2', [nt(0, 72, 0.5)])]);
  const a = kopiere(p, wahl({ spur_von: 1, spur_bis: 1, zeile_von: 0, zeile_bis: 0, spalten: 'spur' }));
  const a2 = { ...a, spuren: [{ ...a.spuren[0], noten: [{ ...a.spuren[0].noten[0], laenge: 4 }] }] };
  const q = an(p, einsetzen(p, { abschnitt_id: 'a1', spur_id: 's1', zeile: 2, spalte: 0, unterspalte: 'note' }, a2));
  assert.deepEqual(kurz(q, 's1'), [[0, 60, 0.5, 1], [0.5, 72, 2.5, 1], [3, 65, 1, 1]]);   // 60 cut to 0.5, 72 stops at 3
  // an overwritten cell is replaced, the note before it keeps its off
  const b = kopiere(p, wahl({ spur_von: 1, spur_bis: 1, zeile_von: 0, zeile_bis: 0, spalten: 'spur' }));
  const q2 = an(p, einsetzen(p, { abschnitt_id: 'a1', spur_id: 's1', zeile: 12, spalte: 0, unterspalte: 'note' }, b));
  assert.deepEqual(kurz(q2, 's1'), [[0, 60, 1, 1], [3, 72, 0.5, 1]]);
  // lengths are sounding time: a delayed note is cut where the pasted one sounds
  const pd = basis([clip('s1', [nt(0, 60, 2)])]);
  const c = { zeilen: 1, spalten: 'eine', spuren: [{ noten: [{ spalte: 0, zeile: 0, ton: 64, vel: 100, laenge: 1, versatz: 50 }], knoepfe: [] }] };
  const q3 = an(pd, einsetzen(pd, { abschnitt_id: 'a1', spur_id: 's1', zeile: 4, spalte: 0, unterspalte: 'note' }, c));
  assert.deepEqual(noten(q3, 's1').map((n) => [n.beat, n.laenge, n.versatz]), [[0, 1.125, undefined], [1, 1, 50]]);
});

test('paste of a chord keeps the note columns; into column 3 shifts a single-column clipboard', () => {
  const p = basis([clip('s1', [nt(0, 60), nt(0, 64, 0.25, { spalte: 2 }), nt(0, 67, 0.25, { spalte: 3 })])]);
  const a = kopiere(p, wahl({ zeile_von: 0, zeile_bis: 0, spalten: 'spur' }));
  assert.deepEqual(a.spuren[0].noten.map((n) => n.spalte), [0, 1, 2]);
  const q = an(p, einsetzen(p, { abschnitt_id: 'a1', spur_id: 's2', zeile: 4, spalte: 0, unterspalte: 'note' }, a));
  assert.deepEqual(kurz(q, 's2'), [[1, 60, 0.25, 1], [1, 64, 0.25, 2], [1, 67, 0.25, 3]]);
  const e = kopiere(p, wahl({ zeile_von: 0, zeile_bis: 0, spalte: 1 }));
  assert.deepEqual(e.spuren[0].noten.map((n) => [n.spalte, n.ton]), [[0, 64]]);
  const q2 = an(p, einsetzen(p, { abschnitt_id: 'a1', spur_id: 's2', zeile: 4, spalte: 2, unterspalte: 'note' }, e));
  assert.deepEqual(kurz(q2, 's2'), [[1, 64, 0.25, 3]]);
});

test('paste refusals write nothing: past the section end, past the last track, audio track, no clip for a knob', () => {
  const p = basis([clip('s1', [nt(0, 60), nt(0.25, 62)]),
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k3', punkte: [{ beat: 0, wert: 1, form: 'sprung' }] }]);
  const a = kopiere(p, wahl({ zeile_von: 1, zeile_bis: 2, spalten: 'spur' }));   // one note, no knob
  const o = (id, z) => ({ abschnitt_id: 'a1', spur_id: id, zeile: z, spalte: 0, unterspalte: 'note' });
  assert.match(einsetzen(p, o('s2', 63), a).fehler, /section end/);
  assert.equal(einsetzen(p, o('s2', 62), a).fehler, undefined);
  const zwei = kopiere(p, wahl({ spur_von: 0, spur_bis: 1, zeile_von: 0, zeile_bis: 1, spalten: 'spur' }));
  assert.match(einsetzen(p, o('s4', 0), zwei).fehler, /Not enough tracks/);
  assert.match(einsetzen(p, o('s4', 0), a).fehler, /audio track/);
  const nurKnopf = { zeilen: 1, spalten: 'spur', spuren: [{ noten: [], knoepfe: [{ zeile: 0, knopf: 3, wert: 255 }] }] };
  assert.equal(einsetzen(p, o('s2', 0), nurKnopf).fehler, 'No clip here: type a note first');
  assert.match(einsetzen(p, o('s1', 0), { zeilen: 1, spalten: 'spur', spuren: [{ noten: [], knoepfe: [] }] }).fehler, /empty/i);
  const neun = { zeilen: 1, spalten: 'spur', spuren: [{ noten: [{ spalte: 8, zeile: 0, ton: 60, vel: 100, laenge: 1 }], knoepfe: [] }] };
  assert.match(einsetzen(p, o('s1', 0), neun).fehler, /column/);
});

test('paste of knob values writes jump points through huellkurve_setzen with the full point list', () => {
  const p = basis([clip('s1', [nt(0, 60), nt(0, 62, 1, { spalte: 2 })], {}), clip('s2', [nt(0, 60)]),
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k12', punkte: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 1, wert: 0.5, form: 'sprung' }] }]);
  const a = { zeilen: 2, spalten: 'spur', spuren: [{ noten: [], knoepfe: [{ zeile: 0, knopf: 12, wert: 255 }, { zeile: 1, knopf: 5, wert: 0 }] }] };
  const q = an(p, einsetzen(p, { abschnitt_id: 'a1', spur_id: 's1', zeile: 4, spalte: 0, unterspalte: 'note' }, a));
  const hk = q.spuren[0].clips[0].huellkurven;
  assert.deepEqual(hk.find((h) => h.ziel === 'geraet.k12').punkte.map((x) => [x.beat, x.wert, x.form]), [[0, 0, 'sprung'], [1, 1, 'sprung']]);
  assert.deepEqual(hk.find((h) => h.ziel === 'geraet.k5').punkte, [{ beat: 1.25, wert: -1, form: 'sprung' }]);
});

test('ausschneiden: ablage as kopiere, the cells are removed, knob points removed (empty envelope gone)', () => {
  const p = basis([clip('s1', [nt(0, 60), nt(1, 62), nt(2, 64)]),
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k12', punkte: [{ beat: 1, wert: 0, form: 'sprung' }] }]);
  const w = wahl({ zeile_von: 4, zeile_bis: 4, spalten: 'spur' });
  const r = ausschneiden(frieren(p), w);
  assert.equal(r.label, 'Cut');
  assert.deepEqual(r.ablage, kopiere(p, w));
  const q = an(p, r);
  assert.deepEqual(kurz(q, 's1'), [[0, 60, 0.25, 1], [2, 64, 0.25, 1]]);
  assert.equal(q.spuren[0].clips[0].huellkurven, undefined);
  assert.equal(ausschneiden(p, wahl({ zeile_von: 1, zeile_bis: 1, spalten: 'spur' })), null);
});

test('duplizieren: the selection directly below itself, refused past the section end', () => {
  const p = basis([clip('s1', [nt(0, 60), nt(0.5, 62)])]);
  const q = an(p, duplizieren(frieren(p), wahl({ zeile_von: 0, zeile_bis: 3, spalten: 'spur' })));
  assert.deepEqual(kurz(q, 's1'), [[0, 60, 0.25, 1], [0.5, 62, 0.25, 1], [1, 60, 0.25, 1], [1.5, 62, 0.25, 1]]);
  assert.equal(duplizieren(p, wahl({ zeile_von: 0, zeile_bis: 3, spalten: 'spur' })).label, 'Duplicate');
  assert.match(duplizieren(p, wahl({ zeile_von: 40, zeile_bis: 63, spalten: 'spur' })).fehler, /section end/);
  assert.match(duplizieren(p, wahl({ zeile_von: 62, zeile_bis: 63, spalten: 'spur' })).fehler, /section end/);
});

test('interpoliere VOL: 10 to 50 over 5 rows gives 10, 20, 30, 40, 50; rows without a note stay empty', () => {
  const v = (beat, vel) => nt(beat, 60, 0.25, { vel });
  const p = basis([clip('s1', [v(0, 10), v(0.25, 99), v(0.5, 99), v(0.75, 99), v(1, 50), v(2, 7)])]);
  const q = an(p, interpoliere(frieren(p), wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'vol' })));
  assert.deepEqual(noten(q, 's1').map((n) => n.vel), [10, 20, 30, 40, 50, 7]);
  const l = clip('s1', [v(0, 10), v(1, 50)]);
  assert.equal(interpoliere(basis([l]), wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'vol' })), null);   // nothing between: nothing to do
  assert.match(interpoliere(p, wahl({ zeile_von: 0, zeile_bis: 6, unterspalte: 'vol' })).fehler, /first and last/);
  assert.equal(interpoliere(p, wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'vol' })).label, 'Interpolate VOL');
});

test('interpoliere DLY, CHN, RPT; a delay that rounds to 0 is removed', () => {
  const mk = (extra) => basis([clip('s1', [0, 0.25, 0.5, 0.75, 1].map((b, i) => nt(b, 60, 0.25, i === 0 ? extra[0] : i === 4 ? extra[1] : {})))]);
  let p = mk([{ versatz: -50 }, { versatz: 50 }]);
  let q = an(p, interpoliere(p, wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'dly' })));
  assert.deepEqual(noten(q, 's1').map((n) => n.versatz), [-50, -25, undefined, 25, 50]);
  p = mk([{ chance: 10 }, { chance: 90 }]);
  q = an(p, interpoliere(p, wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'chn' })));
  assert.deepEqual(noten(q, 's1').map((n) => n.chance), [10, 30, 50, 70, 90]);
  p = mk([{ wdh: 2 }, { wdh: 6 }]);
  q = an(p, interpoliere(p, wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'rpt' })));
  assert.deepEqual(noten(q, 's1').map((n) => n.wdh), [2, 3, 4, 5, 6]);
  assert.match(interpoliere(mk([{}, {}]), wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'chn' })).fehler, /first and last/);
  assert.match(interpoliere(p, wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'note' })).fehler, /VOL, DLY, CHN, RPT/);
});

test('interpoliere knob values: first and last row hold the same knob, every row between gets a jump point', () => {
  const p = basis([clip('s1', [nt(0, 60)]),
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'geraet.k12', punkte: [{ beat: 0, wert: -1, form: 'sprung' }, { beat: 1, wert: 1, form: 'sprung' }] }]);
  const w = wahl({ zeile_von: 0, zeile_bis: 4, unterspalte: 'fx', fxspalte: 0, spalte: undefined });
  const q = an(p, interpoliere(frieren(p), w));
  const pk = q.spuren[0].clips[0].huellkurven[0].punkte;
  assert.deepEqual(pk.map((x) => x.beat), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(pk.map((x) => x.form), Array(5).fill('sprung'));
  const r = projiziere(q, { abschnitt_id: 'a1' });
  assert.deepEqual([0, 1, 2, 3, 4].map((z) => r.spuren[0].fxspalten[0][z].wert), [0, 64, 128, 191, 255]);
  assert.equal(interpoliere(p, w).label, 'Interpolate knob 12');
  assert.match(interpoliere(p, { ...w, zeile_bis: 6 }).fehler, /first and last/);
});

test('transponiere: an octave, by selection or by cell; a note leaving 0..127 refuses the whole step with its name', () => {
  const p = basis([clip('s1', [nt(0, 60), nt(0.25, 72)])]);
  const q = an(p, transponiere(frieren(p), wahl({ zeile_von: 0, zeile_bis: 3, spalten: 'spur' }), 12));
  assert.deepEqual(noten(q, 's1').map((n) => n.ton), [72, 84]);
  assert.equal(transponiere(p, wahl({ zeile_von: 0, zeile_bis: 3, spalten: 'spur' }), -1).label, 'Transpose -1');
  assert.equal(transponiere(p, wahl({ zeile_von: 0, zeile_bis: 3, spalten: 'spur' }), 12).label, 'Transpose +12');
  const c = an(p, transponiere(p, { abschnitt_id: 'a1', spur_id: 's1', spalte: 0, zeile: 1, unterspalte: 'note' }, -2));
  assert.deepEqual(noten(c, 's1').map((n) => n.ton), [60, 70]);
  const hoch = basis([clip('s1', [nt(0, 60), nt(0.25, 120)])]);
  const f = transponiere(hoch, wahl({ zeile_von: 0, zeile_bis: 3, spalten: 'spur' }), 12);
  assert.match(f.fehler, /C-8/); assert.match(f.fehler, /127/);           // 120 = C-8, +12 = 132
  assert.equal(transponiere(p, { abschnitt_id: 'a1', spur_id: 's1', spalte: 0, zeile: 30, unterspalte: 'note' }, 1), null);
  assert.equal(transponiere(p, wahl({ zeile_von: 0, zeile_bis: 3 }), 0), null);
});

test('a looped clip is not rewritten by a paste', () => {
  const p = basis([clip('s1', [nt(0, 60)], { loop_beats: 4 })]);
  const a = { zeilen: 1, spalten: 'eine', spuren: [{ noten: [{ spalte: 0, zeile: 0, ton: 64, vel: 100, laenge: 1 }], knoepfe: [] }] };
  assert.match(einsetzen(p, { abschnitt_id: 'a1', spur_id: 's1', zeile: 8, spalte: 0, unterspalte: 'note' }, a).fehler, /loop/i);
});

// review fix: overlapping notes of foreign data sit in separate displayed columns; copy and paste follow the displayed column
test('overlapping notes: copy takes the displayed column, paste writes it as the stored column', () => {
  const p = basis([clip('s1', [nt(0, 60, 4), nt(1, 64, 1)])]);
  const a = kopiere(frieren(p), wahl({ zeile_von: 0, zeile_bis: 7, spalten: 'spur' }));
  assert.deepEqual(a.spuren[0].noten.map((n) => [n.spalte, n.zeile, n.ton]), [[0, 0, 60], [1, 4, 64]]);
  const einsatz = an(p, einsetzen(p, { abschnitt_id: 'a1', spur_id: 's2', zeile: 8, spalte: 0, unterspalte: 'note' }, a));
  const noten = einsatz.spuren[1].clips[0].noten;
  assert.deepEqual(noten.map((n) => [n.beat, n.ton, n.spalte]), [[2, 60, undefined], [3, 64, 2]]);
});

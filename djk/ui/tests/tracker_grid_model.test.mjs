// Tracker task 1: the pure projection of a project into tracker rows (public/tracker/grid_model.js). No DOM, no I/O.
import test from 'node:test';
import assert from 'node:assert/strict';

const M = await import('../public/tracker/grid_model.js');
const { LPB_WERTE, LPB_VORGABE, TICKS_VORGABE, ABSCHNITT_VORGABE_BEATS, trackerEinstellung, abschnitte, klingStart, zeileVon, tonName,
  tonAusName, projiziere, zellText, fxText, statusText } = M;

const frieren = (x) => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.values(x).forEach(frieren); } return x; };
const note = (id, beat, laenge, ton, vel = 100, extra = {}) => ({ id, beat, laenge, ton, vel, ...extra });

function projekt() {
  return {
    format: 'cypherdj-projekt/2', name: 'T', tempo_bpm: 120, taktart: [4, 4],
    spuren: [
      { id: 's1', nr: 1, name: 'lead', art: 'instrument',
        geraet: { art: 'intern', name: 'bk', graph: 'lead', parameter: { k12: 0.5 } },
        clips: [{
          id: 'c1', art: 'midi', name: 'a', start_beat: 0, laenge_beats: 16,
          noten: [
            note('n1', 0, 1, 60, 96),                       // row 0, off at row 4
            note('n2', 2, 0.125, 64),                       // ends inside its own row: no off
            note('n3', 3.125, 0.5, 67),                     // off the row line (row 12, tinted); end 3.625 = row 14 + 50 %
            note('n4', 5, 1, 60), note('n5', 5, 1, 64), note('n6', 5, 1, 67, 100, { spalte: 2 }),   // chord, n6 wants column 2
            note('n7', 8, 1, 62), note('n8', 9, 1, 62),     // n7 ends where n8 starts: no off for n7
            note('n9', 12, 1, 72, 100, { versatz: 25, chance: 50, wdh: 3 }),
            note('n10', 15.5, 4, 55),                       // cut at the clip end: no off
          ],
          huellkurven: [
            { ziel: 'geraet.k12', punkte: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 2, wert: 0.25, form: 'sprung' }] },
            { ziel: 'geraet.k3', punkte: [{ beat: 2, wert: -1, form: 'sprung' }] },
          ] }] },
      { id: 's2', nr: 2, name: 'loopy', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
        clips: [{ id: 'c2', art: 'midi', name: 'l', start_beat: 0, laenge_beats: 8, loop_beats: 2,
          noten: [note('m1', 0, 1, 48), note('m2', 2.5, 1, 50)] }] },
      { id: 's3', nr: 3, name: 'curvy', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'pad', parameter: {} },
        clips: [{ id: 'c3', art: 'midi', name: 'p', start_beat: 0, laenge_beats: 16, noten: [note('p1', 0, 2, 60)],
          huellkurven: [{ ziel: 'geraet.k5', punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] }] }] },
      { id: 's4', nr: 4, name: 'vox', art: 'audio', clips: [{ id: 'c4', art: 'audio', name: 'vox.wav', start_beat: 4, laenge_beats: 40 }] },
    ],
  };
}
const rast = (p, o = {}) => projiziere(frieren(p), { abschnitt_id: 'a1', lpb: 4, ...o });
const spur = (r, id) => r.spuren.find((s) => s.spur_id === id);

test('constants and settings', () => {
  assert.deepEqual(LPB_WERTE, [2, 3, 4, 6, 8, 12, 16]);
  assert.equal(LPB_VORGABE, 4); assert.equal(TICKS_VORGABE, 6); assert.equal(ABSCHNITT_VORGABE_BEATS, 16);
  assert.deepEqual(trackerEinstellung({}), { lpb: 4, ticks: 6 });
  assert.deepEqual(trackerEinstellung({ tracker: { schema: 1, lpb: 8, ticks: 3 } }), { lpb: 8, ticks: 3 });
  assert.deepEqual(trackerEinstellung({ tracker: { schema: 1, lpb: 5 } }), { lpb: 4, ticks: 6 });
});

test('sections: default list covers the last clip end (40 beats: three sections, the last 16 long)', () => {
  const a = abschnitte(frieren(projekt()));
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => x.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(a.map((x) => x.nr), [0, 1, 2]);
  assert.deepEqual(a.map((x) => x.von_beat), [0, 16, 32]);
  assert.deepEqual(a.map((x) => x.laenge_beats), [16, 16, 16]);
  assert.equal(abschnitte({ spuren: [] }).length, 1);
  assert.equal(abschnitte({ spuren: [{ clips: [{ start_beat: 0, laenge_beats: 32 }] }] }).length, 2);
});

test('sections: explicit list follows each other from beat 0', () => {
  const p = { spuren: [], tracker: { schema: 1, abschnitte: [{ id: 'a1', laenge_beats: 8 }, { id: 'a5', name: 'drop', laenge_beats: 12 }] } };
  assert.deepEqual(abschnitte(frieren(p)), [
    { id: 'a1', nr: 0, name: '', von_beat: 0, laenge_beats: 8 }, { id: 'a5', nr: 1, name: 'drop', von_beat: 8, laenge_beats: 12 }]);
});

test('sounding start and row of a beat', () => {
  assert.equal(klingStart({ beat: 2, versatz: 25 }), 2.0625);
  assert.equal(klingStart({ beat: 2 }), 2);
  assert.deepEqual(zeileVon(0.5, 4), { zeile: 2, schief: false });
  assert.deepEqual(zeileVon(0.6, 4), { zeile: 2, schief: true });
  assert.deepEqual(zeileVon(1 / 3, 3), { zeile: 1, schief: false });
  assert.deepEqual(zeileVon(0.25, 3), { zeile: 0, schief: true });
  assert.deepEqual(zeileVon(0.5 - 1e-12, 4), { zeile: 2, schief: false });
});

test('note names', () => {
  assert.equal(tonName(60), 'C-3'); assert.equal(tonName(54), 'F#2'); assert.equal(tonName(24), 'C-0');
  assert.equal(tonName(127), 'G-8'); assert.equal(tonName(23), 'lo '); assert.equal(tonName(0), 'lo ');
  assert.equal(tonAusName('F#2'), 54); assert.equal(tonAusName('C-3'), 60); assert.equal(tonAusName('c-3'), 60);
  assert.equal(tonAusName('C-0'), 24); assert.equal(tonAusName('G-8'), 127);
  assert.equal(tonAusName('lo '), null); assert.equal(tonAusName('H-3'), null); assert.equal(tonAusName('G#8'), null); assert.equal(tonAusName(''), null);
  for (let t = 24; t <= 127; t++) assert.equal(tonAusName(tonName(t)), t);
});

test('projection: rows, track data, columns', () => {
  const r = rast(projekt());
  assert.equal(r.lpb, 4); assert.equal(r.ticks, 6); assert.equal(r.zeilen, 64); assert.equal(r.abschnitt.id, 'a1');
  assert.deepEqual(r.spuren.map((s) => s.buchstabe), ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.spuren.map((s) => s.art), ['instrument', 'instrument', 'instrument', 'audio']);
  const a = r.spuren[0];
  assert.equal(a.spur_id, 's1'); assert.equal(a.name, 'lead'); assert.equal(a.bk, true); assert.equal(r.spuren[1].bk, false);
  assert.equal(a.geraet_text, 'lead'); assert.equal(r.spuren[1].geraet_text, 'RB-338');
  assert.equal(a.notenspalten.length, 3);
  for (const sp of a.notenspalten) assert.equal(sp.length, 64);
  const z = a.notenspalten[0][0];
  assert.deepEqual(z.note, { id: 'n1', clip_id: 'c1', ton: 60, vel: 96, beat_abs: 0, laenge: 1 });
  assert.equal(z.schief, undefined);
  assert.deepEqual(a.notenspalten[0][4].aus, { note_id: 'n1', clip_id: 'c1', dly: 0 });
  assert.equal(a.notenspalten[0][4].note, undefined);
  assert.equal(a.notenspalten[0][1], null);
});

test('projection: short note shows no off; an off-grid note is tinted and its off carries the offset', () => {
  const sp = rast(projekt()).spuren[0].notenspalten[0];
  assert.equal(sp[8].note.id, 'n2'); assert.equal(sp[8].aus, undefined);
  assert.equal(sp[12].note.id, 'n3'); assert.equal(sp[12].schief, true); assert.equal(sp[12].note.beat_abs, 3.125);
  assert.deepEqual(sp[14].aus, { note_id: 'n3', clip_id: 'c1', dly: 50 }); assert.equal(sp[14].schief, true);
});

test('projection: chord takes neighbouring columns, a wanted column that is taken moves right', () => {
  const sp = rast(projekt()).spuren[0].notenspalten;
  assert.deepEqual([sp[0][20].note.id, sp[1][20].note.id, sp[2][20].note.id], ['n4', 'n5', 'n6']);
  // the ends of the chord notes sit in their own columns
  assert.equal(sp[0][24].aus.note_id, 'n4'); assert.equal(sp[1][24].aus.note_id, 'n5'); assert.equal(sp[2][24].aus.note_id, 'n6');
});

test('projection: off is not shown where the next note of the column starts, nor at the clip end', () => {
  const sp = rast(projekt()).spuren[0].notenspalten[0];
  assert.equal(sp[32].note.id, 'n7'); assert.equal(sp[36].note.id, 'n8'); assert.equal(sp[36].aus, undefined);
  assert.equal(sp[40].aus.note_id, 'n8');
  assert.equal(sp[62].note.id, 'n10'); assert.equal(sp[63], null);
});

test('projection: note fields and a delay move the end', () => {
  const sp = rast(projekt()).spuren[0].notenspalten[0];
  const z = sp[48];
  assert.equal(z.note.id, 'n9'); assert.equal(z.note.versatz, 25); assert.equal(z.note.chance, 50); assert.equal(z.note.wdh, 3);
  assert.equal(z.schief, undefined);
  assert.deepEqual(sp[52].aus, { note_id: 'n9', clip_id: 'c1', dly: 25 });
});

test('projection: a looped clip shows every copy, notes from loop_beats on stay silent', () => {
  const sp = rast(projekt()).spuren[1].notenspalten[0];
  const starts = sp.map((c, i) => (c?.note ? i : null)).filter((i) => i !== null);
  const offs = sp.map((c, i) => (c?.aus ? i : null)).filter((i) => i !== null);
  assert.deepEqual(starts, [0, 8, 16, 24]);
  assert.deepEqual(offs, [4, 12, 20, 28]);
  assert.equal(sp.filter((c) => c?.note?.id === 'm2').length, 0);
});

test('projection: knob envelopes of jump points on row lines give one effect entry per point', () => {
  const fx = rast(projekt()).spuren[0].fxspalten;
  assert.equal(fx.length, 2);
  assert.deepEqual(fx[0][0], { knopf: 12, wert: 0x80 });
  assert.deepEqual(fx[0][8], { knopf: 3, wert: 0x00 });
  assert.deepEqual(fx[1][8], { knopf: 12, wert: 0xa0 });
  assert.equal(fx[0].filter(Boolean).length, 2); assert.equal(fx[1].filter(Boolean).length, 1);
});

test('projection: any other envelope is a curve in every row it covers', () => {
  const fx = rast(projekt()).spuren[2].fxspalten;
  assert.equal(fx.length, 1);
  assert.equal(fx[0].length, 64);
  assert.ok(fx[0].every((c) => c && c.kurve === true));
  const a2 = projiziere(frieren(projekt()), { abschnitt_id: 'a2', lpb: 4 });
  assert.ok(a2.spuren[2].fxspalten[0].every((c) => c === null));
});

test('projection: an audio track has clip entries and no note columns; sections cut the project', () => {
  const r = rast(projekt());
  assert.deepEqual(r.spuren[3].notenspalten, []); assert.deepEqual(r.spuren[3].fxspalten, []);
  assert.deepEqual(r.spuren[3].clips, [{ zeile: 16, name: 'vox.wav' }]);
  assert.deepEqual(r.spuren[0].clips, []);
  const r2 = projiziere(frieren(projekt()), { abschnitt_id: 'a3', lpb: 4 });
  assert.equal(r2.abschnitt.von_beat, 32); assert.deepEqual(r2.spuren[3].clips, []);
  assert.ok(r2.spuren[0].notenspalten[0].every((c) => c === null));
  assert.throws(() => projiziere(projekt(), { abschnitt_id: 'zz' }));
});

test('projection at LPB 3', () => {
  const p = projekt();
  p.spuren[0].clips[0].noten = [note('x1', 1 / 3, 1 / 3, 60), note('x2', 0.25, 0.0625, 62), note('x3', 1, 1, 64)];
  const r = rast(p, { lpb: 3 });
  assert.equal(r.zeilen, 48);
  const sp = r.spuren[0].notenspalten[0];
  assert.equal(sp[1].note.id, 'x1'); assert.equal(sp[1].schief, undefined);
  assert.equal(sp[0].note.id, 'x2'); assert.equal(sp[0].schief, true);
  assert.equal(sp[3].note.id, 'x3'); assert.equal(sp[6].aus.note_id, 'x3');
});

test('projection takes the track setting when no lpb is given', () => {
  const p = projekt(); p.tracker = { schema: 1, lpb: 8 };
  assert.equal(projiziere(frieren(p), { abschnitt_id: 'a1' }).zeilen, 128);
});

test('cell texts', () => {
  const r = rast(projekt()); const nc = r.spuren[0].notenspalten[0];
  assert.equal(zellText(nc[0], 'note', 'hex'), 'C-3');
  assert.equal(zellText(nc[4], 'note', 'hex'), '===');
  assert.equal(zellText(nc[1], 'note', 'hex'), '...'); assert.equal(zellText(null, 'note', 'hex'), '...');
  assert.equal(zellText(nc[0], 'vol', 'hex'), '60'); assert.equal(zellText(nc[0], 'vol', 'dec'), '096');
  assert.equal(zellText(nc[1], 'vol', 'hex'), '..'); assert.equal(zellText(nc[1], 'vol', 'dec'), '...');
  assert.equal(zellText(nc[48], 'dly', 'hex'), ' 25'); assert.equal(zellText(nc[52], 'dly', 'hex'), ' 25');
  assert.equal(zellText(nc[0], 'dly', 'hex'), '...'); assert.equal(zellText(null, 'dly', 'dec'), '...');
  assert.equal(zellText({ note: { ton: 60, vel: 1, versatz: -25 } }, 'dly', 'hex'), '-25');
  assert.equal(zellText(nc[48], 'chn', 'hex'), '50'); assert.equal(zellText(nc[0], 'chn', 'hex'), '..');
  assert.equal(zellText(nc[48], 'rpt', 'hex'), '3'); assert.equal(zellText(nc[0], 'rpt', 'hex'), '.');
  assert.equal(zellText({ note: { ton: 23, vel: 5 } }, 'note', 'hex'), 'lo ');
  for (const u of ['note', 'vol', 'dly', 'chn', 'rpt']) assert.equal(zellText(nc[1], u, 'hex').length, { note: 3, vol: 2, dly: 3, chn: 2, rpt: 1 }[u]);
});

test('effect texts', () => {
  assert.equal(fxText({ knopf: 12, wert: 0x80 }, 'hex'), 'K12 80');
  assert.equal(fxText({ knopf: 3, wert: 0xa0 }, 'hex'), 'K03 A0');
  assert.equal(fxText({ knopf: 12, wert: 128 }, 'dec'), 'K12 128');
  assert.equal(fxText({ kurve: true }, 'hex'), '~~~ ..');
  assert.equal(fxText(null, 'hex'), '... ..');
  assert.equal(fxText(null, 'dec').length, fxText({ knopf: 1, wert: 1 }, 'dec').length);
});

test('knob byte helpers follow D6', () => {
  assert.equal(M.wertZuByte(-1), 0); assert.equal(M.wertZuByte(0), 128); assert.equal(M.wertZuByte(1), 255);
  assert.equal(M.byteZuWert(0), -1); assert.equal(M.byteZuWert(128), 0); assert.equal(M.byteZuWert(255), 1);
});

test('status texts for every sub-column', () => {
  const r = rast(projekt());
  const c = (spur, spalte, zeile, unterspalte, extra = {}) => ({ spur, spalte, zeile, unterspalte, ...extra });
  assert.equal(statusText(r, c(0, 0, 0, 'vol'), 'hex'), 'A lead, row 00, VOL: velocity 96 of 127');
  assert.equal(statusText(r, c(0, 0, 0, 'note'), 'hex'), 'A lead, row 00, NOTE: C-3 (MIDI 60)');
  assert.equal(statusText(r, c(0, 0, 4, 'note'), 'hex'), 'A lead, row 04, NOTE: note off');
  assert.equal(statusText(r, c(0, 0, 48, 'dly'), 'hex'), 'A lead, row 48, DLY: delay +25 % of a sixteenth (0.06 beat)');
  assert.equal(statusText(r, c(0, 0, 52, 'dly'), 'hex'), 'A lead, row 52, DLY: note off 25 % of a sixteenth after the row line');
  assert.equal(statusText(r, c(0, 0, 48, 'chn'), 'hex'), 'A lead, row 48, CHN: plays with chance 50 %');
  assert.equal(statusText(r, c(0, 0, 48, 'rpt'), 'hex'),
    'A lead, row 48, RPT: 3 hits spread over the note length (at least a sixteenth); for hits inside one row put a note off on the next row');
  assert.equal(statusText(r, c(0, 0, 12, 'note'), 'hex'),
    'A lead, row 12, NOTE: off the grid at beat 3.13; retyping puts it on the row line');
  assert.equal(statusText(r, c(0, 0, 1, 'vol'), 'hex'), 'A lead, row 01, VOL: empty');
  assert.equal(statusText(r, c(0, 0, 8, 'dly', { }), 'hex'), 'A lead, row 08, DLY: no delay');
  assert.equal(statusText(r, c(0, 0, 0, 'chn'), 'hex'), 'A lead, row 00, CHN: always plays');
  assert.equal(statusText(r, c(0, 0, 0, 'rpt'), 'hex'), 'A lead, row 00, RPT: single hit');
  assert.equal(statusText(r, c(0, 0, 8, 'fx', { fxspalte: 1 }), 'hex'), 'A lead, row 08, FX: knob 12 offset +0.25 (track knob 0.50 -> 0.75)');
  assert.equal(statusText(r, c(0, 0, 8, 'fx', { fxspalte: 0 }), 'hex'), 'A lead, row 08, FX: knob 3 offset -1.00 (track knob 0.50 -> 0.00)');
  assert.equal(statusText(r, c(2, 0, 7, 'fx', { fxspalte: 0 }), 'hex'), 'C curvy, row 07, FX: drawn curve, edit it in PRODUCTION');
  assert.equal(statusText(r, c(0, 0, 1, 'fx', { fxspalte: 0 }), 'hex'), 'A lead, row 01, FX: empty');
  assert.equal(statusText(r, c(3, 0, 16, 'note'), 'hex'), 'D vox, row 16, audio clip "vox.wav" starts here');
  assert.equal(statusText(r, c(3, 0, 2, 'note'), 'hex'), 'D vox, row 02, audio track');
  assert.equal(statusText(r, c(9, 0, 0, 'note'), 'hex'), '');
});

test('the input is never mutated (frozen input throws on write)', () => {
  const p = frieren(projekt());
  assert.doesNotThrow(() => { projiziere(p, { abschnitt_id: 'a1' }); abschnitte(p); trackerEinstellung(p); });
});

// review fix: data without a tracker origin may overlap; every shown column holds never two sounding notes
const einSpur = (noten) => ({ format: 'cypherdj-projekt/2', name: 'T', tempo_bpm: 120, taktart: [4, 4],
  spuren: [{ id: 's1', nr: 1, name: 'a', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
    clips: [{ id: 'c1', art: 'midi', name: 'a', start_beat: 0, laenge_beats: 16, noten }] }] });

test('projection: an overlapping note moves to the next free column, every column holds one sounding note', () => {
  const r = rast(einSpur([note('n1', 0, 4, 60), note('n2', 1, 1, 64), note('n3', 6, 1, 67)]));
  const sp = r.spuren[0];
  assert.equal(sp.notenspalten.length, 2);
  assert.equal(sp.notenspalten[0][0].note.id, 'n1'); assert.equal(sp.notenspalten[1][4].note.id, 'n2');
  assert.equal(sp.notenspalten[0][16].aus.note_id, 'n1');                 // the off of n1 is in n1's column
  assert.equal(sp.notenspalten[1][8].aus.note_id, 'n2');
  assert.equal(sp.notenspalten[0][24].note.id, 'n3');                     // nothing sounds in column 1 at beat 6: it stays there
  assert.equal(sp.verdeckt, undefined);
});

test('projection: a note after the end of an earlier one stays in its column; touching notes do not overlap', () => {
  const sp = rast(einSpur([note('n1', 0, 1, 60), note('n2', 1, 1, 62), note('n3', 3, 1, 64)])).spuren[0];
  assert.equal(sp.notenspalten.length, 1);
});

test('projection: more than 8 notes sounding at once: the rest is not shown and the track says how many', () => {
  const noten = Array.from({ length: 10 }, (_, i) => note(`n${i + 1}`, i * 0.25, 8, 48 + i));
  const sp = rast(einSpur(noten)).spuren[0];
  assert.equal(sp.notenspalten.length, 8);
  assert.equal(sp.verdeckt, 2);
  assert.equal(sp.notenspalten.flat().filter((z) => z?.note).length, 8);
  assert.equal(rast(projekt()).spuren[0].verdeckt, undefined);            // optional: absent when nothing is hidden
});

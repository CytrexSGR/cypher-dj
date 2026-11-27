// NOTEN (note editor, N16): geometry, hit tests and snapping of the host-neutral surface (public/noten/view.js), pure functions in node.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pr from '../public/production/pianoroll.js';
import {
  TASTEN_BREITE, TON_HOEHE, TREFFER_PX, PX_PRO_S, neueAnsicht, sZuX, xZuS, tonZuY, yZuTon, zoom, scrolle, scrolleTon, notenKasten, trefferNote,
  zielTon, zugOp, rasterLinien, kurvePunkte, tonName, istSchwarz,
} from '../public/noten/view.js';

const note = (id, qa, qe, qton, extra = {}) => ({ id, qa, qe, qton, p: 0.9, ...extra });

test('constants of the interface', () => {
  assert.deepEqual([TASTEN_BREITE, TON_HOEHE, TREFFER_PX, PX_PRO_S], [40, 9, 4, { min: 2, max: 4000 }]);
});

test('neueAnsicht: the source fits the width, the pitch range of the notes is centred', () => {
  const sicht = { quelleS: 10, noten: [note('t1', 0, 1, 50), note('t2', 1, 2, 70, { ton: 72 })] };
  const a = neueAnsicht(sicht, 440, 180);
  assert.equal(a.s0, 0);
  assert.equal(sZuX(a, 10), 440, 'the end of the source sits at the right edge');
  // 20 rows: pitch 61 (middle of 50 and 72) is in the middle row
  assert.ok(a.tonOben - 61 >= 9 && a.tonOben - 61 <= 11, `tonOben ${a.tonOben}`);
  const leer = neueAnsicht({ quelleS: 0, noten: [] }, 440, 180);
  assert.ok(leer.pxProS > 0 && Number.isFinite(leer.tonOben));
  assert.equal(neueAnsicht({ quelleS: 1e6, noten: [] }, 440, 180).pxProS, PX_PRO_S.min, 'clamped to the minimum zoom');
});

test('sZuX and xZuS are inverse; zoom keeps the second under the pointer', () => {
  const a = { s0: 3.5, pxProS: 80, tonOben: 80 };
  for (const s of [0, 3.5, 7.25, 100]) assert.ok(Math.abs(xZuS(a, sZuX(a, s)) - s) < 1e-9);
  assert.equal(sZuX(a, 3.5), TASTEN_BREITE, 'the left edge of the note area is right of the key column');
  for (const [f, x] of [[2, 200], [0.5, 90], [1.25, 41]]) {
    const z = zoom(a, f, x);
    assert.ok(Math.abs(xZuS(z, x) - xZuS(a, x)) < 1e-9, `factor ${f} at ${x}`);
    assert.equal(z.pxProS, 80 * f);
  }
  assert.equal(zoom(a, 1e6, 100).pxProS, PX_PRO_S.max);
  assert.equal(zoom(a, 1e-6, 100).pxProS, PX_PRO_S.min);
  assert.equal(scrolle(a, 80).s0, 4.5);
  assert.equal(scrolle(a, -1e6).s0, 0, 'never before second 0');
  for (const t of [0, 40, 100]) assert.ok(Math.abs(yZuTon(a, tonZuY(a, t)) - t) < 1e-9, 'tonZuY and yZuTon are inverse');
  assert.equal(scrolleTon(a, 5, 180).tonOben, 85);
  assert.equal(scrolleTon(a, 100, 180).tonOben, 127);
  assert.equal(scrolleTon(a, -100, 180).tonOben, 19, 'the top row never goes below the last full screen of rows');
});

test('zielTon: 60.3 dragged one row up -> 61 (halbton), 61.3 (frei, 0.01 steps), next key tone with Shift; clamped at qton +24 and at 127', () => {
  const n = note('t1', 0, 1, 60.3);
  assert.equal(zielTon(n, 1, 'halbton', null), 61);
  assert.equal(zielTon(n, 1, 'frei', null), 61.3);
  assert.equal(zielTon(n, 1.2345, 'frei', null), 61.53, '0.01 semitone steps');
  const cdur = (t) => [0, 2, 4, 5, 7, 9, 11].includes(((t % 12) + 12) % 12) ? t : t + 1;   // a stand-in key: black keys move up to the next white key
  assert.equal(zielTon(n, 1.4, 'tonart', cdur), 62, 'round(61.7) = 62 is a key tone');
  assert.equal(zielTon(note('t1', 0, 1, 60), 1, 'tonart', cdur), 62, '61 is not in the key: the stand-in gives 62');
  assert.equal(zielTon(n, 1, 'tonart', null), 61, 'no key: halbton');
  assert.equal(zielTon(n, 30, 'halbton', null), 84.3, 'qton +24 is the limit');
  assert.equal(zielTon(n, -40, 'frei', null), 36.3, 'qton -24 is the limit');
  assert.equal(zielTon(note('t1', 0, 1, 110), 20, 'halbton', null), 127);
  assert.equal(zielTon(note('t1', 0, 1, 10), -20, 'halbton', null), 0 + 0, 'not below 0');
  assert.equal(zielTon(note('t1', 0, 1, 60, { ton: 64 }), 2, 'halbton', null), 66, 'the drag starts from the current target');
});

test('zugOp gives one um for all selected notes and null for no movement', () => {
  const noten = [note('t1', 0, 1, 60), note('t2', 1, 2, 64, { ton: 65 }), note('t3', 2, 3, 70)];
  const op = zugOp(noten, ['t1', 't2'], 't1', 2, 'halbton', null);
  assert.deepEqual(op, { art: 'ton', ids: ['t1', 't2'], um: 2 });
  assert.equal(zugOp(noten, ['t1', 't2'], 't1', 0.2, 'halbton', null), null, 'the anchor stays on its row: no op');
  assert.equal(zugOp(noten, ['t1'], 't1', 0, 'frei', null), null);
  assert.equal(zugOp(noten, ['t1'], 'tX', 2, 'halbton', null), null, 'unknown anchor');
  assert.equal(zugOp(noten, [], 't1', 2, 'halbton', null), null, 'nothing selected');
  assert.equal(zugOp(noten, ['t1'], 't1', 0.126, 'frei', null).um, 0.13);
  assert.equal(zugOp([note('t1', 0, 1, 60.12346)], ['t1'], 't1', 1, 'halbton', null).um, 0.8765, 'rounded to 1e-4 (61 - 60.12346)');
  // a group in which one note cannot follow is kept inside every span instead of being refused
  const grenze = [note('t1', 0, 1, 60), note('t2', 1, 2, 126)];
  assert.deepEqual(zugOp(grenze, ['t1', 't2'], 't1', 5, 'halbton', null), { art: 'ton', ids: ['t1', 't2'], um: 1 }, 't2 stops at 127');
  assert.deepEqual(zugOp(noten, ['t2'], 't2', -1, 'halbton', null), { art: 'ton', ids: ['t2'], um: -1 }, 'an edited note moves from its target');
});

test('trefferNote finds the bar under the pointer, null between notes', () => {
  const a = { s0: 0, pxProS: 100, tonOben: 70 };
  const noten = [note('t1', 0, 1, 60), note('t2', 2, 3, 62), note('t3', 2.5, 2.7, 62, { ton: 62 })];
  const k1 = notenKasten(a, noten[0]);
  assert.deepEqual([k1.x, k1.w, k1.h], [TASTEN_BREITE, 100, TON_HOEHE]);
  assert.equal(trefferNote(noten, a, k1.x + 50, k1.y + 4), 't1');
  assert.equal(trefferNote(noten, a, k1.x + 150, k1.y + 4), null, 'between the notes');
  assert.equal(trefferNote(noten, a, k1.x + 50, k1.y - 3), null, 'a row above');
  assert.equal(trefferNote(noten, a, 10, k1.y + 4), null, 'the key column hits nothing');
  assert.equal(trefferNote(noten, a, sZuX(a, 2.6), notenKasten(a, noten[2]).y + 4), 't3', 'the later bar wins where bars overlap');
  assert.equal(trefferNote(noten, a, sZuX(a, 2.2), notenKasten(a, noten[1]).y + 4), 't2');
  // a bar of 2 px is still grabbed from a few pixels beside it
  const duenn = [note('t1', 0, 0.02, 60)];
  assert.equal(trefferNote(duenn, a, TASTEN_BREITE + 2 + TREFFER_PX, notenKasten(a, duenn[0]).y + 4), 't1');
  assert.equal(trefferNote(duenn, a, TASTEN_BREITE + 2 + TREFFER_PX + 1, notenKasten(a, duenn[0]).y + 4), null);
});

test('notenKasten: the bar sits at the target pitch, the detected pitch without a target', () => {
  const a = { s0: 0, pxProS: 100, tonOben: 70 };
  const roh = notenKasten(a, note('t1', 0, 1, 60)), bearbeitet = notenKasten(a, note('t1', 0, 1, 60, { ton: 62 }));
  assert.equal(roh.y - bearbeitet.y, 2 * TON_HOEHE, 'two semitones up is two rows up');
  assert.equal(notenKasten(a, note('t1', 0, 1, 60, { ton: 60.5 })).y, roh.y - TON_HOEHE / 2, 'a fractional pitch moves the bar by a fraction of a row');
  assert.equal(notenKasten(a, note('t1', 1, 2, 60, { a: 1.5, e: 1.75 })).w, 25, 'effective start and end');
});

test('rasterLinien: beat lines with bar lines, thinned out when dense, nothing without a grid', () => {
  const raster = { beatBeiS: (s) => s * 2, sBeiBeat: (b) => b / 2, beatsProTakt: 4 };   // 120 BPM
  const a = { s0: 0, pxProS: 100, tonOben: 70 };
  const l = rasterLinien(raster, a, 340);          // 0..3 s: 7 beats 0..6
  assert.deepEqual(l.map((x) => [x.x, x.takt]), [[40, true], [90, false], [140, false], [190, false], [240, true], [290, false], [340, false]]);
  assert.deepEqual(rasterLinien(null, a, 340), []);
  const dicht = rasterLinien(raster, { s0: 0, pxProS: 4, tonOben: 70 }, 440);   // 100 s at 4 px/s: 2 px per beat
  assert.ok(dicht.length > 0 && dicht.length < 100 && dicht.every((x) => x.takt), 'only bar lines, every one a multiple of the bar');
  assert.ok(dicht.every((x) => x.x >= TASTEN_BREITE && x.x <= 440));
});

test('kurvePunkte: the pitch line inside the note, moved by target minus qton, unvoiced frames left out', () => {
  const hopS = 0.01, ct = new Float64Array(200).fill(6000);
  ct[55] = 0;
  const a = { s0: 0, pxProS: 1000, tonOben: 70 };
  const n = note('t1', 0.5, 0.6, 60);
  const p = kurvePunkte({ hopS, ct }, n, a);
  assert.equal(p.length, 10, 'frames 50..60 without the unvoiced 55');
  assert.deepEqual(p[0], [sZuX(a, 0.5), tonZuY(a, 60)]);
  const q = kurvePunkte({ hopS, ct }, { ...n, ton: 62 }, a);
  assert.ok(Math.abs(q[0][1] - tonZuY(a, 62)) < 1e-9, 'moved with the note');
  assert.deepEqual(kurvePunkte(null, n, a), []);
  assert.ok(kurvePunkte({ hopS, ct }, n, { ...a, pxProS: 10 }).length <= 2, 'at most one point per pixel');
});

test('tonName(60) === "C3", istSchwarz(61) === true (same as pianoroll.js for 0..127)', () => {
  assert.equal(tonName(60), 'C3');
  assert.equal(istSchwarz(61), true);
  for (let t = 0; t <= 127; t++) { assert.equal(tonName(t), pr.tonName(t)); assert.equal(istSchwarz(t), pr.istSchwarz(t)); }
});

test('a drag rounds to the nearest semitone, it does not cut: 60.7 dragged one row up -> 62 (not 61)', () => {
  const n = note('t1', 0, 1, 60.7);
  assert.equal(zielTon(n, 1, 'halbton', null), 62);
  assert.equal(zielTon(n, -1, 'halbton', null), 60, '59.7 rounds to 60');
  assert.equal(zugOp([n], ['t1'], 't1', 1, 'halbton', null).um, 1.3, 'um = 62 - 60.7');
  assert.equal(zugOp([n], ['t1'], 't1', -1, 'halbton', null).um, -0.7, 'um = 60 - 60.7');
});

test('zugOp keeps the group inside the lower span limit of every selected note (qton -24 and MIDI 0), rounded inwards', () => {
  // t1 sits 2 semitones above its lower span limit 36: the group can follow the anchor down by 2 at most
  const nahUnten = [note('t1', 0, 1, 60, { ton: 38 }), note('t2', 1, 2, 70)];
  assert.deepEqual(zugOp(nahUnten, ['t1', 't2'], 't2', -5, 'halbton', null), { art: 'ton', ids: ['t1', 't2'], um: -2 });
  // the span limit of a low note is MIDI 0, not qton -24 (which would be negative)
  const nahNull = [note('t1', 0, 1, 10, { ton: 3 }), note('t2', 1, 2, 60)];
  assert.deepEqual(zugOp(nahNull, ['t1', 't2'], 't2', -10, 'halbton', null), { art: 'ton', ids: ['t1', 't2'], um: -3 });
  // the limit is rounded towards zero: a target never ends below it (-2.00006 becomes -2, not -2.0001)
  const fein = [note('t1', 0, 1, 60, { ton: 38.00006 }), note('t2', 1, 2, 70)];
  assert.equal(zugOp(fein, ['t1', 't2'], 't2', -5, 'halbton', null).um, -2);
  // a note that already sits on its lower limit holds the whole group
  assert.equal(zugOp([note('t1', 0, 1, 60, { ton: 36 }), note('t2', 1, 2, 70)], ['t1', 't2'], 't2', -5, 'halbton', null), null);
  // the upper limit the same way (qton +24)
  const nahOben = [note('t1', 0, 1, 60, { ton: 83.5 }), note('t2', 1, 2, 70)];
  assert.equal(zugOp(nahOben, ['t1', 't2'], 't2', 5, 'halbton', null).um, 0.5);
});

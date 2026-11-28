// Harmony helpers (public/harmonie.js): key check, scale membership, snapping, scale steps, chords, inversion, arpeggio, key search.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKALEN, tonartFehler, tonartText, inSkala, istGrundton, rasteEin, stufenSchritt, akkord, akkordGruppen, transponiere, transponiereStufen, umkehrung,
  inTonart, arpeggio, passendeTonarten, stufenAkkord, fuehre,
} from '../public/harmonie.js';

const aMoll = { grundton: 9, skala: 'minor' };
const n = (id, beat, ton, laenge = 1, vel = 100) => ({ id, beat, laenge, ton, vel });

test('a key is checked field by field', () => {
  assert.equal(tonartFehler(aMoll), null);
  assert.match(tonartFehler({ grundton: 12, skala: 'minor' }), /grundton/);
  assert.match(tonartFehler({ grundton: 0, skala: 'moll' }), /skala/);
  assert.match(tonartFehler({ grundton: 0, skala: 'minor', x: 1 }), /unknown field x/);
  assert.match(tonartFehler(null), /object/);
  assert.equal(tonartText(aMoll), 'A minor');
  assert.equal(tonartText({ grundton: 5, skala: 'harmonic_minor' }), 'F harmonic minor');
});

test('every scale starts on the root and stays inside one octave', () => {
  for (const [name, s] of Object.entries(SKALEN)) {
    assert.equal(s[0], 0, name);
    assert.ok(s.every((x, i) => x >= 0 && x < 12 && (i === 0 || x > s[i - 1])), name);
  }
});

test('membership, root and snapping in A minor', () => {
  assert.equal(inSkala(57, aMoll), true);    // A
  assert.equal(inSkala(56, aMoll), false);   // G#
  assert.equal(inSkala(56, null), true);     // no key: everything fits
  assert.equal(istGrundton(69, aMoll), true);
  assert.equal(istGrundton(60, aMoll), false);
  assert.equal(rasteEin(57, aMoll), 57);
  assert.equal(rasteEin(56, aMoll), 55);     // G# lies between G and A: the tie goes down
  assert.equal(rasteEin(61, aMoll), 60);     // C# -> C
  assert.equal(rasteEin(61, null), 61);
});

test('scale steps walk the key and stop at the range', () => {
  assert.equal(stufenSchritt(57, aMoll, 1), 59);     // A -> B
  assert.equal(stufenSchritt(57, aMoll, 2), 60);     // A -> C
  assert.equal(stufenSchritt(57, aMoll, -1), 55);    // A -> G
  assert.equal(stufenSchritt(56, aMoll, 1), 57);     // G# is outside: the next pitch of the key is the step
  assert.equal(stufenSchritt(57, aMoll, 7), 69);     // an octave
  assert.equal(stufenSchritt(127, aMoll, 1), null);
  assert.equal(stufenSchritt(60, null, 3), 63);
});

test('a chord is thirds of the key, a minor triad without a key', () => {
  assert.deepEqual(akkord(57, aMoll), [57, 60, 64]);          // A minor
  assert.deepEqual(akkord(60, aMoll), [60, 64, 67]);          // C major, the triad the key gives on C
  assert.deepEqual(akkord(59, aMoll), [59, 62, 65]);          // B diminished
  assert.deepEqual(akkord(57, aMoll, 4), [57, 60, 64, 67]);   // with the seventh
  assert.deepEqual(akkord(58, aMoll), [57, 60, 64]);          // a pitch outside the key snaps first
  assert.deepEqual(akkord(60, null), [60, 63, 67]);
  assert.deepEqual(akkord(125, null), [125]);
});

test('notes that start together are one chord', () => {
  const g = akkordGruppen([n('c', 4, 64), n('a', 0, 60, 2), n('b', 0, 57, 4), n('d', 4, 59)]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].noten.map((x) => x.id), ['b', 'a']);
  assert.equal(g[0].ende, 4);
  assert.deepEqual(g[1].noten.map((x) => x.ton), [59, 64]);
});

test('transposing moves all notes or none', () => {
  assert.deepEqual(transponiere([n('a', 0, 60), n('b', 0, 64)], -2), [{ id: 'a', ton: 58 }, { id: 'b', ton: 62 }]);
  assert.deepEqual(transponiere([n('a', 0, 126), n('b', 0, 64)], 2), []);
  assert.deepEqual(transponiereStufen([n('a', 0, 57), n('b', 0, 60), n('c', 0, 64)], aMoll, -1), [{ id: 'a', ton: 55 }, { id: 'b', ton: 59 }, { id: 'c', ton: 62 }]);
});

test('an inversion moves the outer note of every chord by an octave', () => {
  const noten = [n('a', 0, 57), n('b', 0, 60), n('c', 0, 64), n('d', 4, 55), n('e', 4, 59), n('f', 4, 62), n('solo', 8, 70)];
  assert.deepEqual(umkehrung(noten, 1), [{ id: 'a', ton: 69 }, { id: 'd', ton: 67 }]);
  assert.deepEqual(umkehrung(noten, -1), [{ id: 'c', ton: 52 }, { id: 'f', ton: 50 }]);
  assert.deepEqual(umkehrung([n('a', 0, 57), n('b', 0, 69)], 1), []);   // the octave is taken already
});

test('notes outside the key move to the key', () => {
  assert.deepEqual(inTonart([n('a', 0, 57), n('b', 0, 61), n('c', 0, 56)], aMoll), [{ id: 'b', ton: 60 }, { id: 'c', ton: 55 }]);
  assert.deepEqual(inTonart([n('a', 0, 61)], null), []);
});

test('an arpeggio plays the chord notes one after the other for the length of the chord', () => {
  const noten = [n('a', 0, 57, 1, 90), n('b', 0, 60, 1, 100), n('c', 0, 64, 1, 110), n('solo', 2, 72, 1)];
  const r = arpeggio(noten, 0.25);
  assert.deepEqual(r.loeschen, ['a', 'b', 'c']);
  assert.deepEqual(r.neu.map((x) => x.ton), [57, 60, 64, 57]);
  assert.deepEqual(r.neu.map((x) => x.beat), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(r.neu.map((x) => x.vel), [90, 100, 110, 90]);
  assert.ok(r.neu.every((x) => x.laenge === 0.25));
  assert.deepEqual(arpeggio(noten, 0.25, 'down').neu.map((x) => x.ton), [64, 60, 57, 64]);
  assert.deepEqual(arpeggio([n('a', 0, 57, 2), n('b', 0, 60, 2), n('c', 0, 64, 2)], 0.25, 'updown').neu.map((x) => x.ton), [57, 60, 64, 60, 57, 60, 64, 60]);
  assert.deepEqual(arpeggio(noten, 0), { loeschen: [], neu: [] });
});

test('the key search finds the key of a progression and its root', () => {
  // Am, F, G, Am: the pitches of A minor and C major; the root decides
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [57, 60, 64]];
  const noten = prog.flatMap((toene, i) => toene.map((ton, j) => n(`n${i}${j}`, i * 4, ton, 4)));
  const erg = passendeTonarten(noten);
  assert.deepEqual(erg[0], { grundton: 9, skala: 'minor', anteil: 1 });
  assert.ok(erg.some((x) => x.grundton === 0 && x.skala === 'major' && x.anteil === 1));
  // one wrong note: the share drops below 1, A minor still wins
  const mitFehler = [...noten, n('x', 15, 61, 1)];
  const e2 = passendeTonarten(mitFehler)[0];
  assert.equal(e2.grundton, 9); assert.equal(e2.skala, 'minor'); assert.ok(e2.anteil < 1 && e2.anteil > 0.9);
  assert.deepEqual(passendeTonarten([]), []);
});

test('a chord on a step of the key, led to the chord before it', () => {
  assert.deepEqual(stufenAkkord(aMoll, 1, 3), [69, 72, 76]);   // A3 C4 E4
  assert.deepEqual(stufenAkkord(aMoll, 6, 3), [77, 81, 84]);   // F4 A4 C5
  assert.deepEqual(stufenAkkord(aMoll, 8, 3), [69, 72, 76]);   // step 8 is step 1 again
  // F major after A minor: A and C stay, F takes the octave next to the middle of the chord before
  assert.deepEqual(fuehre([69, 72, 76], [77, 81, 84]), [69, 72, 77]);
  // G major after that: no common tone, everything stays close
  assert.deepEqual(fuehre([69, 72, 77], [79, 83, 86]), [67, 71, 74]);
  assert.deepEqual(fuehre([], [72, 64, 67]), [64, 67, 72]);
});

// ---------- chord symbols and the live harmony lane ----------
import { akkordSymbol, folgeLesen, laneTonart, laneEintrag, akkordBei } from '../public/harmonie.js';

test('every chord quality has its intervals', () => {
  const soll = {
    '': [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], 5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
    7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], 9: [0, 4, 7, 10, 14], add9: [0, 4, 7, 14],
    m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
  };
  for (const [q, iv] of Object.entries(soll)) assert.deepEqual(akkordSymbol(`C${q}`), { name: `C${q}`, grundton: 0, intervalle: iv }, q);
  assert.equal(akkordSymbol('Bb').grundton, 10);
  assert.equal(akkordSymbol('F#m7b5').grundton, 6);
  assert.deepEqual(akkordSymbol('F#m7b5').intervalle, [0, 3, 6, 10]);
  assert.equal(akkordSymbol('Cb').grundton, 11);
});

test('bad chord symbols throw', () => {
  for (const s of ['', 'H', 'Cx', 'C/E', 'Csus', 'am7', 'Cmaj', 'C7b9', 42]) assert.throws(() => akkordSymbol(s), /^Error: akkord: /, String(s));
});

test('a chord sequence is read with bars and blanks, at most 64', () => {
  assert.deepEqual(folgeLesen('Am7 | Fmaj7 G').map((a) => a.name), ['Am7', 'Fmaj7', 'G']);
  assert.deepEqual(folgeLesen('  '), []);
  assert.equal(folgeLesen(new Array(64).fill('C').join(' ')).length, 64);
  assert.throws(() => folgeLesen(new Array(65).fill('C').join(' ')), /akkord: at most 64/);
  assert.throws(() => folgeLesen('C Q'), /akkord/);
});

test('the lane key is the scale with the most chord tones', () => {
  assert.deepEqual(laneTonart(folgeLesen('Am7 Fmaj7 G')), { grundton: 9, skala: 'minor' });
  assert.deepEqual(laneTonart(folgeLesen('C F G')), { grundton: 0, skala: 'major' });
  assert.throws(() => laneTonart([]), /akkord/);
});

test('a lane entry carries key steps and chord pitch classes', () => {
  const e = laneEintrag({ folge: folgeLesen('Am7 G'), takte_je_akkord: 2, ab_zyklus: 4 });
  assert.deepEqual(e, {
    ab_zyklus: 4, takte_je_akkord: 2, tonart: { grundton: 9, stufen: SKALEN.minor },
    folge: [{ name: 'Am7', grundton: 9, toene: [9, 0, 4, 7] }, { name: 'G', grundton: 7, toene: [7, 11, 2] }],
  });
  const k = laneEintrag({ folge: folgeLesen('C'), takte_je_akkord: 1, ab_zyklus: 0, tonart: { grundton: 2, skala: 'dorian' } });
  assert.deepEqual(k.tonart, { grundton: 2, stufen: SKALEN.dorian });
  assert.throws(() => laneEintrag({ folge: [], takte_je_akkord: 0, ab_zyklus: 0 }), /takte_je_akkord/);
  assert.throws(() => laneEintrag({ folge: [], takte_je_akkord: 1, ab_zyklus: 0, tonart: { grundton: 99, skala: 'minor' } }), /akkord/);
});

test('the chord at a cycle comes from the last entry; an empty entry switches the lane off', () => {
  const a = laneEintrag({ folge: folgeLesen('Am G F'), takte_je_akkord: 2, ab_zyklus: 0 });
  const b = laneEintrag({ folge: folgeLesen('C'), takte_je_akkord: 1, ab_zyklus: 8 });
  const aus = laneEintrag({ folge: [], takte_je_akkord: 1, ab_zyklus: 12 });
  const es = [a, b, aus];
  assert.equal(akkordBei(es, 0).akkord.name, 'Am');
  assert.equal(akkordBei(es, 1).akkord.name, 'Am');
  assert.equal(akkordBei(es, 2).akkord.name, 'G');
  assert.equal(akkordBei(es, 5).akkord.name, 'F');
  assert.equal(akkordBei(es, 6).akkord.name, 'Am');   // wraps
  assert.equal(akkordBei(es, 8).akkord.name, 'C');
  assert.deepEqual(akkordBei(es, 9).tonart, b.tonart);
  assert.equal(akkordBei(es, 12), null);
  assert.equal(akkordBei(es, 99), null);
  assert.equal(akkordBei([a], -1), null);
  assert.equal(akkordBei([], 0), null);
});

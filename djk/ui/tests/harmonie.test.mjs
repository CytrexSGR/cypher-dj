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

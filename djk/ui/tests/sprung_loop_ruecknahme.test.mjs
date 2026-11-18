// Regression (audit C00): deckSprung moves the remembered deck loop before sending and undoes it only when status 6 arrives within
// warteQuittung's 4 s cap. With a 4-bar grid on a running deck ab_beat can lie up to 16 beats (7.5 s at 128 BPM) ahead; the
// core checks "loop stays inside the material" only at ab_beat (core_deck.cpp art 6), so the refusal comes too late.
// No constructor, no server, no core: the real deckSprung/warteQuittung run on a prototype object with stubbed state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Oberflaeche } from '../server.ts';

test('a jump the core refuses at ab_beat (more than 4 s ahead) leaves the loop memory where it was', async () => {
  const bpm = 128, t0 = Date.now(), beat0 = 4.1;   // master just past beat 4: the next multiple of 16 is beat 16, ~5.6 s ahead
  const f = { material_id: 'm', basis_bpm: 128, fassung: 0 };
  const schluessel = `${f.material_id}|${f.basis_bpm}|${f.fassung}`;
  const o = Object.create(Oberflaeche.prototype);
  const gesendet = [];
  o.quittungen = new Map();
  o.kern = { get uhr() { return { beat: beat0 + (Date.now() - t0) / 1000 * bpm / 60, bpm }; } };
  o.aktiverLoop = { 1: { schluessel, start: 100, laenge: 4 } };
  o.setzeAktivenLoop = (deck, l) => { o.aktiverLoop[String(deck)] = l; };   // no file
  o.deckStand = () => ({ deck: 1, z: { status: 3, quell_beat: 100, vorlauf_ms: 0, beats_bis_ende: Infinity }, beat: o.kern.uhr.beat, bpm, f, eins: 0 });
  o.json = () => {};
  o.deckTeil = (adresse, st, ab, raster, extra) => {
    const felder = { id: 77, deck: st.deck, ab_beat: ab, ...extra };
    gesendet.push(felder);
    o.quittungen.set(77, [{ id: 77, status: 1 }]);   // accepted when queued (core_deck.cpp: quittung 1)
    const ms = (ab - o.kern.uhr.beat) * 60 / bpm * 1000;
    setTimeout(() => o.quittungen.get(77).push({ id: 77, status: 6, grund: 'ausserhalb_bereich' }), ms);   // refused at ab_beat
    return felder;
  };
  o.deckSprung({ deck: 1, ziel: 210, raster: 16 }, {});
  assert.equal(gesendet.length, 1);
  const ab = gesendet[0].ab_beat;
  assert.ok((ab - beat0) * 60 / bpm > 4, `ab_beat ${ab} lies more than 4 s ahead`);
  assert.notEqual(o.aktiverLoop['1'].start, 100, 'the memory moved before sending');
  await new Promise((r) => setTimeout(r, (ab - beat0) * 60 / bpm * 1000 + 1500));
  assert.equal(o.aktiverLoop['1'].start, 100, `core refused at ab_beat and kept the loop at 100, server remembers ${o.aktiverLoop['1'].start}`);
});

// A deck rig for the two follow-ups of the review (no constructor, no core): `tempoFaktor` is how fast the master beat really runs against the 128 BPM the
// server read when it sent (a tempo ramp downwards: slower); `abgelehnt(n)` says whether the core refuses the n-th command at its ab_beat (default: all).
function rig(tempoFaktor = 1, abgelehnt = () => true) {
  const bpm = 128, t0 = Date.now(), beat0 = 4.1;
  const f = { material_id: 'm', basis_bpm: 128, fassung: 0 };
  const o = Object.create(Oberflaeche.prototype);
  const gesendet = [];
  const beatJetzt = () => beat0 + (Date.now() - t0) / 1000 * bpm * tempoFaktor / 60;
  o.quittungen = new Map();
  o.kern = { get uhr() { return { beat: beatJetzt(), bpm }; } };
  o.aktiverLoop = { 1: { schluessel: `${f.material_id}|${f.basis_bpm}|${f.fassung}`, start: 100, laenge: 4 } };
  o.setzeAktivenLoop = (deck, l) => { o.aktiverLoop[String(deck)] = l; };
  o.sichereAktiveLoops = () => {};
  o.deckStand = () => ({ deck: 1, z: { status: 3, quell_beat: 100, vorlauf_ms: 0, beats_bis_ende: Infinity }, beat: beatJetzt(), bpm, f, eins: 0 });
  o.json = () => {};
  let nr = 70;
  o.deckTeil = (adresse, st, ab, raster, extra) => {
    const id = ++nr, felder = { id, deck: st.deck, ab_beat: ab, ...extra };
    gesendet.push(felder);
    o.quittungen.set(id, [{ id, status: 1 }]);
    if (abgelehnt(gesendet.length)) setTimeout(() => o.quittungen.get(id).push({ id, status: 6, grund: 'ausserhalb_bereich' }), Math.max(0, (ab - beatJetzt()) * 60 / (bpm * tempoFaktor) * 1000));
    return felder;
  };
  return { o, gesendet, beat0, bpm };
}

test('a jump and a loop length change on the same grid beat, both refused: the memory ends at the old start AND the old length', async () => {
  const { o, gesendet, beat0, bpm } = rig();
  o.deckSprung({ deck: 1, ziel: 210, raster: 16 }, {});
  o.deckLoop({ deck: 1, laenge: 8, raster: 16, behalte_start: true }, {});
  assert.equal(gesendet.length, 2);
  assert.equal(gesendet[0].ab_beat, gesendet[1].ab_beat, 'the same grid beat');
  await new Promise((r) => setTimeout(r, (gesendet[0].ab_beat - beat0) * 60 / bpm * 1000 + 1500));
  assert.deepEqual({ start: o.aktiverLoop['1'].start, laenge: o.aktiverLoop['1'].laenge }, { start: 100, laenge: 4 }, 'start from the jump rollback, length from the length rollback');
});

test('a tempo ramp downwards does not shorten the wait: a refusal at ab_beat is still seen', async () => {
  const { o, gesendet, beat0, bpm } = rig(70 / 128);   // the master slows from 128 to 70 BPM after the send
  o.deckSprung({ deck: 1, ziel: 210, raster: 16 }, {});
  const ab = gesendet[0].ab_beat;
  assert.ok((ab - beat0) * 60 / bpm * 1000 + 1000 < (ab - beat0) * 60 / 70 * 1000, 'at the slowed tempo ab_beat is later than the wait computed at the tempo of the send');
  await new Promise((r) => setTimeout(r, (ab - beat0) * 60 / 70 * 1000 + 1500));
  assert.equal(o.aktiverLoop['1'].start, 100, `the refusal at ab_beat rolled the memory back, it holds ${o.aktiverLoop['1'].start}`);
});

// Second review, point 6: two length taps in a row (4 to 8 to 16) both refused. The second tap's rollback target was the length the FIRST tap had put into the
// memory (8), so the memory ended at 8 while the core still plays 4. The rollback goes to the length the core last confirmed.
const laengenTipp = async (abgelehnt) => {
  const { o, gesendet, beat0, bpm } = rig(1, abgelehnt);
  o.deckLoop({ deck: 1, laenge: 8, raster: 16, behalte_start: true }, {});
  o.deckLoop({ deck: 1, laenge: 16, raster: 16, behalte_start: true }, {});
  assert.equal(gesendet.length, 2);
  assert.equal(o.aktiverLoop['1'].laenge, 16, 'the memory moved before sending');
  await new Promise((r) => setTimeout(r, (gesendet[0].ab_beat - beat0) * 60 / bpm * 1000 + 1500));
  return o.aktiverLoop['1'].laenge;
};
test('two refused length taps in a row (4 to 8 to 16): the memory goes back to 4, what the core plays', async () => {
  assert.equal(await laengenTipp(() => true), 4);
});
test('the first length tap accepted, the second refused: the memory stays at 8, the confirmed length', async () => {
  assert.equal(await laengenTipp((n) => n === 2), 8);
});
test('the first length tap refused, the second accepted: the memory holds 16', async () => {
  assert.equal(await laengenTipp((n) => n === 1), 16);
});

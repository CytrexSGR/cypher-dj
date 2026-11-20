// Loop deck view state (loop deck P2): stand and SSE to view state, play position, grid label, pending and orphaned states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FARBEN, RASTER, beatJetzt, deckAnsicht, laufEreignis, leerLauf, neueUhr, rasterText, spielPos, uhrMelde, zellZustand } from '../public/loopdeck/model.js';

const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n % 16, art: 'loop', sha256: `sha${n}`, beats: 8, bpm: 128, gain_db: 0, frames: 1000, ...extra });
const spur = (nr, extra = {}) => ({ spur_id: `s${nr}`, nr, name: `L1.${nr}`, fader_db: -3, mute: false, filter: 0.25,
  zellen: [zelle(1), null, zelle(3, { art: 'einmal', beats: 4 }), null, null, null, null, null], lauf: leerLauf(), ...extra });
const deck = (spuren) => ({ gruppe_id: 'g1', platz: 1, raster: 'takt', spuren: spuren ?? [1, 2, 3, 4].map((n) => spur(n)) });

test('the palette is the 16 colours of the S8 table', () => {
  assert.equal(FARBEN.length, 16);
  assert.equal(FARBEN[0], '#ff4030'); assert.equal(FARBEN[9], '#3c5aff'); assert.equal(FARBEN[15], '#8c96aa');
});

test('grid labels: 1/4 1/2 1 BAR 4', () => {
  assert.deepEqual(RASTER.map(([, t]) => t), ['1/4', '1/2', '1', 'BAR', '4']);
  assert.equal(rasterText('takt'), 'BAR'); assert.equal(rasterText('4takte'), '4');
});

test('stand to view state: four tracks, eight cells, states, colours', () => {
  const v = deckAnsicht(deck(), 1);
  assert.equal(v.name, 'LOOP 1'); assert.equal(v.da, true); assert.equal(v.raster, 'takt');
  assert.equal(v.spuren.length, 4);
  const s = v.spuren[0];
  assert.equal(s.zellen.length, 8);
  assert.deepEqual(s.zellen.map((z) => z.zustand), ['voll', 'leer', 'voll', 'leer', 'leer', 'leer', 'leer', 'leer']);
  assert.equal(s.zellen[0].farbe, FARBEN[1]); assert.equal(s.zellen[2].art, 'einmal');
  assert.equal(s.faderDb, -3); assert.equal(s.filter, 0.25);
});

test('a deck that does not exist yet is the empty grid', () => {
  const v = deckAnsicht(null, 2);
  assert.equal(v.da, false); assert.equal(v.name, 'LOOP 2'); assert.equal(v.spuren.length, 4);
  assert.ok(v.spuren.every((s) => s.zellen.every((z) => z.zustand === 'leer')));
});

test('an SSE event replaces the run state of exactly one track', () => {
  const stand = { decks: { 1: deck() } };
  assert.equal(laufEreignis(stand, { deck: 1, spur: 2, lauf: { zelle: 3, verwaist: false, ab_beat: 16, versatz_beats: 0, wartend: null, zuletzt: 3 } }), true);
  const v = deckAnsicht(stand.decks[1], 1);
  assert.deepEqual(v.spuren.map((s) => s.spielt), [false, true, false, false]);
  assert.equal(v.spuren[1].zellen[2].zustand, 'spielt'); assert.equal(v.spuren[1].titel, 'cell 3');
  assert.equal(laufEreignis(stand, { deck: 2, spur: 1, lauf: leerLauf() }), false);   // no such deck: nothing changes
});

test('core state 0 (silent) means no cell', () => {
  const stand = { decks: { 1: deck() } };
  laufEreignis(stand, { deck: 1, spur: 1, lauf: { zelle: 0, wartend: { zelle: 0, ab_beat: 8 } } });
  const s = deckAnsicht(stand.decks[1], 1).spuren[0];
  assert.equal(s.spielt, false); assert.equal(s.stoppWartet, true);
});

test('pending: the waiting cell blinks, the playing one stays lit; a pending stop marks the track', () => {
  const lauf = { ...leerLauf(), zelle: 1, ab_beat: 0, wartend: { zelle: 3, ab_beat: 8 } };
  const s = spur(1, { lauf });
  assert.equal(zellZustand(s, 0), 'spielt'); assert.equal(zellZustand(s, 2), 'wartend'); assert.equal(zellZustand(s, 1), 'leer');
  const stopp = deckAnsicht(deck([spur(1, { lauf: { ...lauf, wartend: { zelle: null, ab_beat: 8 } } }), spur(2), spur(3), spur(4)]), 1).spuren[0];
  assert.equal(stopp.stoppWartet, true); assert.equal(stopp.zellen[0].zustand, 'spielt');
});

test('orphaned: the track shows playing, no cell is lit', () => {
  const v = deckAnsicht(deck([spur(1, { lauf: { ...leerLauf(), zelle: 1, verwaist: true } }), spur(2), spur(3), spur(4)]), 1).spuren[0];
  assert.equal(v.spielt, true); assert.equal(v.verwaist, true);
  assert.ok(v.zellen.every((z) => z.zustand !== 'spielt'));
  assert.equal(v.sha, null);
});

test('position math: wraps at the cell length and honours the offset', () => {
  const z = zelle(1, { beats: 8 });
  const lauf = { ...leerLauf(), zelle: 1, ab_beat: 16, versatz_beats: 0 };
  assert.equal(spielPos(lauf, z, 20, 128), 0.5);
  assert.equal(spielPos(lauf, z, 24, 128), 0);        // one full pass: wrapped
  assert.equal(spielPos(lauf, z, 26, 128), 0.25);
  assert.equal(spielPos({ ...lauf, versatz_beats: 2 }, z, 20, 128), 0.75);
  assert.equal(spielPos({ ...lauf, versatz_beats: 6 }, z, 20, 128), 0.25);   // (4 + 6) mod 8 = 2
  assert.equal(spielPos(lauf, z, 10, 128), 0);        // launch not yet in effect: the start position
});

test('position math: a one-shot does not wrap, the length falls back to frames at the tempo', () => {
  const lauf = { ...leerLauf(), zelle: 3, ab_beat: 0 };
  assert.equal(spielPos(lauf, zelle(3, { art: 'einmal', beats: 4 }), 2, 128), 0.5);
  assert.equal(spielPos(lauf, zelle(3, { art: 'einmal', beats: 4 }), 9, 128), 1);
  const z = { ...zelle(1), beats: undefined, bpm: 120, frames: 96000 };   // 2 s at 120 bpm = 4 beats
  assert.equal(spielPos({ ...leerLauf(), zelle: 1, ab_beat: 0 }, z, 1, 120), 0.25);
});

test('no position without clock, length or while orphaned or silent', () => {
  const z = zelle(1), lauf = { ...leerLauf(), zelle: 1 };
  assert.equal(spielPos(lauf, z, null, 128), null);
  assert.equal(spielPos(lauf, { ...z, beats: undefined, frames: null }, 4, 128), null);
  assert.equal(spielPos({ ...lauf, verwaist: true }, z, 4, 128), null);
  assert.equal(spielPos(leerLauf(), z, 4, 128), null);
});

test('the clock extrapolates between events', () => {
  const u = neueUhr();
  assert.equal(beatJetzt(u, 1000), null);
  uhrMelde(u, 32, 120, 1000);
  assert.equal(beatJetzt(u, 3000), 36);   // 2 s at 120 bpm = 4 beats
  assert.equal(beatJetzt(u, 500), 32);    // never backwards
});

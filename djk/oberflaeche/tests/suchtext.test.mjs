// Suchtext → FTS5 (Plan 2026-10-10-mediathek-browser, Task 4.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuche, suchTerme, MAX_TERME } from '../suchtext.ts';

test('Wörter sind Präfixe über alle Spalten, UND-verknüpft', () => {
  assert.deepEqual(parseSuche('kick hard'), { fts: '"kick"* AND "hard"*', ordner: [], zuviele: false });
});
test('feld:wert sucht in einer Spalte; englische und deutsche Namen; Anführungszeichen halten Leerzeichen', () => {
  assert.equal(parseSuche('artist:liebing').fts, 'kuenstler : "liebing"*');
  assert.equal(parseSuche('kuenstler:liebing label:drumcode').fts, 'kuenstler : "liebing"* AND label : "drumcode"*');
  assert.equal(parseSuche('genre:"elektro techno"').fts, 'genre : "elektro techno"*');
  assert.equal(parseSuche('year:2014 title:wolf').fts, 'jahr : "2014"* AND titel : "wolf"*');
  assert.equal(parseSuche('pack:battery instrument:kick').fts, 'pack : "battery"* AND instrument : "kick"*');
});
test('ordner:/folder: wird kein FTS, sondern Pfad-Filter', () => {
  assert.deepEqual(parseSuche('folder:beatport kick'), { fts: '"kick"*', ordner: ['beatport'], zuviele: false });
  assert.deepEqual(parseSuche('ordner:"01 Elektro Techno"'), { fts: null, ordner: ['01 Elektro Techno'], zuviele: false });
});
test('Präfixe für release, Katalognummer (catalog:), isrc, remixer (Review M7)', () => {
  assert.equal(parseSuche('release:"wolf ep" catalog:dc3').fts, 'release : "wolf ep"* AND katalognummer : "dc3"*');
  assert.equal(parseSuche('isrc:gbaaa remixer:lissat').fts, 'isrc : "gbaaa"* AND remixer : "lissat"*');
});
test('unbekanntes Präfix bleibt ein Wort; Anführungszeichen im Wert werden verdoppelt; Zeichen ohne Buchstaben fallen weg', () => {
  assert.equal(parseSuche('bpm:128').fts, '"bpm:128"*');
  assert.equal(parseSuche('a"b').fts, '"a""b"*');
  assert.deepEqual(parseSuche('- * " '), { fts: null, ordner: [], zuviele: false });
  assert.deepEqual(parseSuche(''), { fts: null, ordner: [], zuviele: false });
});
test('suchTerme: dieselbe Zerlegung ohne FTS (für STRUDEL, einfacher Textvergleich)', () => {
  assert.deepEqual(suchTerme('kick name:"a b" ordner:x bpm:128 - *'),
    { terme: [{ spalte: null, wert: 'kick' }, { spalte: 'name', wert: 'a b' }, { spalte: null, wert: 'bpm:128' }], ordner: ['x'], zuviele: false });
});
test('suchTerme: zusätzliche Feldnamen des Aufrufers; ohne sie bleibt es ein Wort; parseSuche kennt sie nie (kein FTS-Spaltenfehler)', () => {
  assert.deepEqual(suchTerme('rolle:bass', ['rolle']).terme, [{ spalte: 'rolle', wert: 'bass' }]);
  assert.deepEqual(suchTerme('rolle:bass').terme, [{ spalte: null, wert: 'rolle:bass' }]);
  assert.equal(parseSuche('rolle:bass').fts, '"rolle:bass"*');
  assert.deepEqual(suchTerme('constructor:x __proto__:y').terme.map((x) => x.spalte), [null, null], 'Objekt-Schlüssel sind keine Felder');
});

test('Review S4-1: NUL und andere Steuerzeichen trennen Wörter wie Leerraum, nie ein Zeichen im FTS-Ausdruck', () => {
  assert.equal(parseSuche('kick\u0000snare').fts, '"kick"* AND "snare"*');
  assert.equal(parseSuche('artist:a\u0000b').fts, 'kuenstler : "a"* AND "b"*', 'NUL beendet den Wert wie ein Leerzeichen');
  assert.equal(parseSuche('kick\u0000').fts, '"kick"*');
  assert.equal(parseSuche('a\u0001b\u007fc\u009dd').fts, '"a"* AND "b"* AND "c"* AND "d"*');
  assert.equal(parseSuche('kick\tsnare\nhat').fts, '"kick"* AND "snare"* AND "hat"*', 'Tab und Zeilenumbruch bleiben Trenner wie bisher');
});
test('Review S4-3: gleiche Terme zählen einmal; zuviele meldet suchTerme (Deckel MAX_TERME)', () => {
  const a = suchTerme(Array(50).fill('kick').join(' '));
  assert.deepEqual([a.terme.length, a.zuviele], [1, false], '50 mal dasselbe Wort ist ein Term');
  assert.equal(suchTerme('KICK kick Kick').terme.length, 1, 'Groß/Klein gleich');
  const w = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  assert.equal(suchTerme(w(MAX_TERME)).zuviele, false, 'genau der Deckel geht');
  assert.equal(suchTerme(w(MAX_TERME + 1)).zuviele, true, 'einer mehr nicht');
  assert.equal(suchTerme(`${w(MAX_TERME - 1)} folder:a`).zuviele, false); assert.equal(suchTerme(`${w(MAX_TERME)} folder:a`).zuviele, true, 'Ordner-Filter zählen mit');
  assert.equal(parseSuche(w(50)).zuviele, true);
});

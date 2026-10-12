// djk/oberflaeche/tests/anschluss.test.mjs
// Anschluss-Vorauswahl (Plan 2026-10-10-anschluss-vorauswahl, T1): reine Regeln, kein I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { camelotZug, energieKlasse, genreNaehe, bewerte } from '../anschluss.ts';

test('camelotZug: alle erlaubten Züge, Gegenteil und Fremdes raus', () => {
  assert.deepEqual(camelotZug('8A', '8A', 'halten'), { zug: 'gleich', punkte: 1 });
  assert.deepEqual(camelotZug('8A', '9a', 'halten'), { zug: 'nachbar', punkte: 0.9 });
  assert.deepEqual(camelotZug('1A', '12A', 'halten'), { zug: 'nachbar', punkte: 0.9 }, 'über 12 hinweg');
  assert.deepEqual(camelotZug('8A', '8B', 'halten'), { zug: 'parallele', punkte: 0.85 });
  assert.deepEqual(camelotZug('8A', '7B', 'halten'), { zug: 'diagonale', punkte: 0.75 });
  assert.deepEqual(camelotZug('8B', '9A', 'halten'), { zug: 'diagonale', punkte: 0.75 });
  assert.equal(camelotZug('8B', '7A', 'halten'), null, 'Gegenrichtung der Diagonale ist nicht erlaubt');
  assert.deepEqual(camelotZug('8A', '10A', 'halten'), { zug: 'boost', punkte: 0.5 });
  assert.deepEqual(camelotZug('8A', '6A', 'halten'), { zug: 'absenken', punkte: 0.45 });
  assert.equal(camelotZug('8A', '3A', 'halten'), null, 'Halbton nur beim Heben');
  assert.deepEqual(camelotZug('8A', '3A', 'heben'), { zug: 'halbton', punkte: 0.3 });
  assert.equal(camelotZug('8A', '11B', 'halten'), null, 'Gegenteil (A-Moll ↔ A-Dur)');
  assert.equal(camelotZug('8A', '5B', 'heben'), null);
  assert.equal(camelotZug('8A', 'x', 'halten'), undefined, 'unlesbar = unbekannt, nicht raus');
  assert.equal(camelotZug(null, '8A', 'halten'), undefined);
});

test('energieKlasse und genreNaehe', () => {
  assert.equal(energieKlasse(5), 0); assert.equal(energieKlasse(6), 1); assert.equal(energieKlasse(7), 1); assert.equal(energieKlasse(8), 2);
  assert.equal(energieKlasse(null), null); assert.equal(energieKlasse(Number.NaN), null);
  assert.equal(genreNaehe('Techno', 'techno'), 1);
  assert.equal(genreNaehe('Techno (Peak Time / Driving)', 'Techno'), 0.6);
  assert.equal(genreNaehe('Tech House', 'Deep House'), 0.6);
  assert.equal(genreNaehe('Techno', 'Deep House'), 0.2);
  assert.equal(genreNaehe(null, 'House'), 0.5);
});

test('bewerte: Tempo-Fenster, Gewichte, Begründungen; raus wird null', () => {
  const lauf = { bpm: 128, camelot: '8A', energie: 7, genre: 'Techno' };
  const a = bewerte(lauf, { bpm: 128, camelot: '9A', energie: 6, genre: 'Techno' }, { fenster: 6, energie: 'halten' });
  // 0,35·1 + 0,25·1 + 0,25·0,9 + 0,15·1 = 0,975
  assert.equal(a.punkte, 0.975);
  assert.equal(a.zug, 'nachbar');
  assert.deepEqual(a.gruende, ['tempo 128→128', 'genre gleich', 'key 8A→9A nachbar', 'energie mittel→mittel']);
  assert.equal(bewerte(lauf, { bpm: 136, camelot: '8A', energie: 7, genre: 'Techno' }, { fenster: 6, energie: 'halten' }), null, '6,25 % > 6 %');
  assert.equal(bewerte(lauf, { bpm: 128, camelot: '11B', energie: 7, genre: 'Techno' }, { fenster: 6, energie: 'halten' }), null, 'Gegenteil');
  const o = bewerte(lauf, { bpm: null, camelot: '8A', energie: 7, genre: 'Techno' }, { fenster: 6, energie: 'halten' });
  // BPM unbekannt schließt nicht aus: 0,35·0,3 + 0,25 + 0,25 + 0,15 = 0,755
  assert.equal(o.punkte, 0.755);
  assert.equal(o.gruende[0], 'tempo unbekannt');
  // Heben um zwei Klassen (niedrig → hoch): 0,35 + 0,25 + 0,25 + 0,15·0,5 = 0,925
  assert.equal(bewerte({ bpm: 128, camelot: '8A', energie: 5, genre: 'Techno' }, { bpm: 128, camelot: '8A', energie: 8, genre: 'Techno' }, { fenster: 6, energie: 'heben' }).punkte, 0.925);
  const h = bewerte(lauf, { bpm: 131.2, camelot: null, energie: 8, genre: null }, { fenster: 6, energie: 'heben' });
  // Tempo 1 − 2,5/6 = 0,5833 · 0,35 = 0,2042; Genre 0,5·0,25 = 0,125; Key 0,3·0,25 = 0,075; Energie +1 Klasse beim Heben 1·0,15
  assert.equal(h.punkte, 0.554);
  assert.equal(h.zug, null);
});

test('camelotZug: Randfälle der Züge', () => {
  assert.equal(camelotZug('8A', '9B', 'halten'), null, 'A→B nur mit d = −1, nicht +1');
  assert.deepEqual(camelotZug('8B', '8A', 'halten'), { zug: 'parallele', punkte: 0.85 });
  assert.equal(camelotZug('8A', '2A', 'halten'), null, 'Tritonus d = 6');
  assert.equal(camelotZug('8A', '1A', 'heben'), null, 'd = +5 ist kein Halbton, auch bei heben');
  assert.equal(camelotZug('8A', '3A', 'senken'), null, 'Halbton nur bei heben');
});

test('bewerte: Energie-Wünsche (Rest 0,85 = Tempo, Genre, Key je voll)', () => {
  const m = (energie) => ({ bpm: 128, camelot: '8A', energie, genre: 'Techno' });
  const p = (l, k, w) => bewerte(m(l), m(k), { fenster: 6, energie: w }).punkte;
  // niedrig = 4, mittel = 7, hoch = 9
  assert.equal(p(7, 4, 'halten'), 0.925); // ±1 Klasse: 0,5·0,15
  assert.equal(p(7, 9, 'halten'), 0.925);
  assert.equal(p(4, 9, 'halten'), 0.85); // ±2: 0
  assert.equal(p(9, 4, 'halten'), 0.85);
  assert.equal(p(9, 7, 'senken'), 1); // −1 Klasse: 1·0,15
  assert.equal(p(9, 9, 'senken'), 0.94); // gleich: 0,6·0,15
  assert.equal(p(7, 9, 'senken'), 0.85); // höher: 0
  assert.equal(p(9, 4, 'senken'), 0.925); // −2 Klassen: 0,5·0,15
  assert.equal(p(7, 9, 'heben'), 1);
  assert.equal(p(7, 7, 'heben'), 0.94); // gleich: 0,6·0,15
  assert.equal(p(7, 4, 'heben'), 0.85); // tiefer: 0
  assert.equal(p(7, null, 'halten'), 0.925); // unbekannt: 0,5·0,15
  assert.equal(p(null, 7, 'heben'), 0.925);
});

test('genreNaehe: Wortgrenze, kompakte Form, Unicode', () => {
  assert.equal(genreNaehe('Nu Disco', 'Nu Jazz'), 0.2, 'gemeinsames Wort "Nu" hat nur 2 Buchstaben');
  assert.equal(genreNaehe('TechHouse', 'Tech House'), 1);
  assert.equal(genreNaehe('Hip-Hop/Rap', 'HipHop'), 0.6);
  assert.equal(genreNaehe('Hip-Hop/Rap', 'Rap'), 0.2, 'kürzere kompakte Form unter 4 Zeichen zählt nicht');
  // bewusst: "électro" steckt nicht in "electrohouse" (Akzent bleibt erhalten), kein gemeinsames Wort
  assert.equal(genreNaehe('Électro', 'Electro House'), 0.2);
  assert.equal(genreNaehe('Électro', 'électro pop'), 0.6, 'Unicode-Wort bleibt ganz');
  assert.equal(genreNaehe('', 'House'), 0.5);
});

test('bewerte: Tempo-Grenze und unbekanntes Tempo', () => {
  const lauf = { bpm: 128, camelot: '8A', energie: 7, genre: 'Techno' };
  const k = (bpm) => ({ bpm, camelot: '8A', energie: 7, genre: 'Techno' });
  const opt = { fenster: 6, energie: 'halten' };
  const g = bewerte(lauf, k(135.68), opt);
  assert.ok(g, '6 % genau ist drin (Fließkomma 6,000000000000005)');
  assert.equal(g.punkte, 0.65); // Tempo 0, sonst 0,65
  assert.equal(bewerte(lauf, k(135.81), opt), null, '6,1 % ist raus');
  for (const l of [null, 0]) {
    const r = bewerte({ ...lauf, bpm: l }, k(128), opt);
    assert.equal(r.gruende[0], 'tempo unbekannt');
    assert.equal(r.punkte, 0.755);
  }
  const r0 = bewerte(lauf, k(0), opt);
  assert.ok(r0, 'Kandidat mit BPM 0 ist nicht raus');
  assert.equal(r0.gruende[0], 'tempo unbekannt');
});

test('bewerte: Halbton nur bei steigender Energieklasse', () => {
  const m = (camelot, energie) => ({ bpm: 128, camelot, energie, genre: 'Techno' });
  const opt = { fenster: 6, energie: 'heben' };
  assert.equal(bewerte(m('8A', 8), m('3A', 5), opt), null, 'sinkend');
  assert.equal(bewerte(m('8A', 7), m('3A', 6), opt), null, 'gleiche Klasse');
  const auf = bewerte(m('8A', 5), m('3A', 8), opt);
  assert.equal(auf.zug, 'halbton');
  assert.equal(auf.punkte, 0.75); // 0,35 + 0,25 + 0,25·0,3 + 0,15·0,5
  assert.equal(bewerte(m('8A', 5), m('3A', null), opt).zug, 'halbton', 'Energie unbekannt: erlaubt');
});

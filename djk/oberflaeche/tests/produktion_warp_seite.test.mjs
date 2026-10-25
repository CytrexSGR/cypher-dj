// Paket 1.13 Warp, Slice 1 (Seite): Ablage schickt warp "auto"; die Welle liegt über W(b) (AK30: jeder Klick eines gewarpten Klick-Loops unter seiner
// Rasterlinie ± 1 px bei Zoom 1); Kürzen am linken Rand verschiebt versatz_beats statt offset_s; das Eingabefeld OFFSET kennt versatz_beats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nutzlast, ablageBefehl } from '../oeffentlich/produktion/ziehen.js';
import { quellSpalten, welleSpalteFuer } from '../oeffentlich/produktion/layout.js';
import { kuerzeLinks, feldBefehl, FELDER } from '../oeffentlich/produktion/clips.js';

const SHA = 'a'.repeat(64);
const projekt = { tempo_bpm: 128, spuren: [{ id: 's1', nr: 1, art: 'audio', clips: [] }] };
const warp = (extra = {}) => ({ an: true, modus: 'repitch', marker: [[0, 0], [30.72, 64]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0, ...extra });
const clip = (w, extra = {}) => ({ id: 'c1', art: 'audio', name: 'k', start_beat: 8, laenge_beats: 16, quelle: { sha256: SHA }, offset_s: 0, gain_db: 0, fade_ein_beats: 0,
  fade_aus_beats: 0, ...(w ? { warp: w } : {}), ...extra });

test('Ablage: warp "auto" geht mit, die Länge von hier bleibt der Rückfall; das Projekttempo ändert die Ablage nie', () => {
  const nutz = nutzlast({ typ: 'loop', sha: SHA, name: 'Loop', pfad_da: true, nur_live: false, dauer_s: 3.84 });
  const r = ablageBefehl(projekt, nutz, 0, 4, 1);
  assert.deepEqual(r.befehl, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 3.84 * 128 / 60, sha256: SHA, warp: 'auto', name: 'Loop' });
  assert.equal(ablageBefehl({ ...projekt, tempo_bpm: 120 }, nutz, 0, 4, 1).befehl.warp, 'auto');
  assert.equal('tempo_setzen' in r.befehl, false);
});

test('AK30: in der Welle eines gewarpten Klick-Loops (125 BPM im 128er Projekt) liegt jeder Klick unter seiner Rasterlinie ± 1 px; ungewarpt nicht', () => {
  const hop = 256, px = 10, c = clip(warp(), { start_beat: 0, laenge_beats: 64 });     // 10 px je Beat; 23 040 Frames je Beat = 90 Spalten
  let daneben = 0, ohneDaneben = 0;
  for (let k = 0; k < 64; k++) {
    const klickSpalte = (k * 23040) / hop;
    const [a0] = quellSpalten(c, 128, hop, px, k * px - 1), [, b1] = quellSpalten(c, 128, hop, px, k * px + 1);
    if (!(a0 <= klickSpalte && klickSpalte < b1)) daneben++;
    const [u0] = quellSpalten(clip(null, { start_beat: 0, laenge_beats: 64 }), 128, hop, px, k * px - 1);
    const [, u1] = quellSpalten(clip(null, { start_beat: 0, laenge_beats: 64 }), 128, hop, px, k * px + 1);
    if (!(u0 <= klickSpalte && klickSpalte < u1)) ohneDaneben++;
  }
  assert.equal(daneben, 0);
  assert.ok(ohneDaneben > 50, `ohne Warp liegen ${ohneDaneben} von 64 Klicks daneben (Negativ-Kontrolle)`);
});

test('Welle: versatz_beats schiebt den Ausschnitt, ein Loop-Clip wiederholt die Welle je Kopie, Warp aus gilt wie bisher', () => {
  const c = clip(warp({ versatz_beats: 2 }), { loop_beats: 4 });
  const [a] = quellSpalten(c, 128, 256, 10, 0);
  assert.ok(Math.abs(a - (2 * 23040) / 256) < 1e-9, 'Clip-Anfang liegt bei Beat 2 der Quelle');
  const [w] = quellSpalten(c, 128, 256, 10, 40);                              // Pixel 40 = Beat 4 = Anfang der zweiten Kopie
  assert.ok(Math.abs(w - a) < 1e-9, 'die zweite Kopie beginnt wieder beim Versatz');
  const aus = clip(warp({ an: false }), { offset_s: 1 });
  assert.equal(quellSpalten(aus, 120, 256, 10, 0)[0], 187.5, 'Warp aus: offset_s zählt');
});

test('Welle: Loop länger als die Quelle: gewarpt überspringt die Stille und zeichnet die nächste Kopie, ungewarpt endet wie bisher; Versatz vor dem Quellanfang ist Stille', () => {
  const hop = 256, px = 10, spalten = 720;                                  // Quelle 3,84 s = 720 Spalten; 8 Beats Inhalt, Loop 12 Beats = 120 px je Kopie
  const c = clip(warp({ marker: [[0, 0], [3.84, 8]] }), { loop_beats: 12, laenge_beats: 36 });
  const f = (clipx, rx) => welleSpalteFuer(clipx, 128, hop, px, rx, spalten);
  assert.ok(Array.isArray(f(c, 70)) && Math.abs(f(c, 70)[0] - 630) < 1e-9, 'Beat 7 der Quelle liegt in der Quelle (Spalte 630)');
  assert.equal(f(c, 100), 'leer', 'Beat 10 liegt hinter dem Quellende (Spalte 900 von 720): Stille, überspringen');
  assert.ok(Array.isArray(f(c, 125)) && Math.abs(f(c, 125)[0] - 45) < 1e-9, 'die zweite Kopie beginnt wieder vorn: Beat 0,5 = Spalte 45');
  const roh = clip(null, { loop_beats: 12, laenge_beats: 36 });
  assert.equal(f(roh, 100), 'ende', 'ungewarpt wie auf main: hinter dem Quellende ist Schluss');
  assert.ok(Array.isArray(f(roh, 10)), 'Negativ-Kontrolle: ungewarpt innerhalb der Quelle wird gezeichnet');
  const vor = clip(warp({ marker: [[0, 0], [3.84, 8]], versatz_beats: -2 }));
  assert.equal(f(vor, 0), 'leer', 'Versatz −2: die ersten 2 Beats liegen vor dem Quellanfang, dort liegt Stille (nicht Spalte 0)');
  assert.ok(Array.isArray(f(vor, 21)) && f(vor, 21)[0] >= 0, 'danach beginnt die Quelle');
});

test('Kürzen links: gewarpt wandert versatz_beats (nie vor den Anfang der Quelle), ungewarpt offset_s wie bisher', () => {
  const c = clip(warp({ versatz_beats: 1 }));
  assert.deepEqual(kuerzeLinks(c, 2, 1, 128), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 10, laenge_beats: 14, versatz_beats: 3 }]);
  assert.deepEqual(kuerzeLinks(c, -5, 1, 128), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 7, laenge_beats: 17, versatz_beats: 0 }],
    'nach links nur so weit, wie die Quelle noch Inhalt hat (versatz 1 → 1 Beat)');
  assert.deepEqual(kuerzeLinks(clip(warp(), { start_beat: 8 }), -2, 1, 128), [], 'versatz 0: nach links nichts');
  const roh = clip(null, { offset_s: 1 });
  assert.deepEqual(kuerzeLinks(roh, 1, 1, 120), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 9, laenge_beats: 15, offset_s: 1.5 }]);
});

test('Eingabefeld OFFSET gewarpt: versatz_beats als clip_aendern, derselbe Wert ergibt keinen Befehl', () => {
  const c = clip(warp({ versatz_beats: 1.5 }));
  assert.equal(FELDER.versatz_beats.max, 100000);
  assert.deepEqual(feldBefehl(c, 'versatz_beats', '2,25'), { befehl: { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 2.25 } });
  assert.deepEqual(feldBefehl(c, 'versatz_beats', '1.5'), { befehl: null });
  assert.match(feldBefehl(c, 'versatz_beats', 'x').fehler, /Offset/);
  assert.match(feldBefehl(c, 'versatz_beats', '1e9').fehler, /Offset/);
});

// Paket 1.13 Warp, Slice 1 (Seite): Ablage schickt warp "auto"; die Welle liegt über W(b) (AK30: jeder Klick eines gewarpten Klick-Loops unter seiner
// Rasterlinie ± 1 px bei Zoom 1); Kürzen am linken Rand verschiebt versatz_beats statt offset_s; das Eingabefeld OFFSET kennt versatz_beats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nutzlast, ablageBefehl } from '../oeffentlich/produktion/ziehen.js';
import { quellSpalten, welleSpalteFuer } from '../oeffentlich/produktion/layout.js';
import { kuerzeLinks, feldBefehl, FELDER } from '../oeffentlich/produktion/clips.js';
import { readFileSync } from 'node:fs';
import { warpAnzeige, EINS_HINWEIS, transposeBefehl, modusBefehl, beatsBefehl, beatsAnzeige, tonErlaubt, BEATS_FELDER, beatsFeldAnsicht, beatsAenderung, TRANSPOSE_MIN, TRANSPOSE_MAX, DETUNE_MAX } from '../oeffentlich/produktion/warp.js';

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

test('Transpose und Detune: Eingabe -> warp_setzen mit genau dem Feld; gleicher Wert = kein Befehl; Grenzen, Komma, nicht ganz, RE-PITCH gesperrt, Gesamtgrenze', () => {
  const c = clip(warp({ modus: 'complex', transpose_st: 3, detune_ct: 10 }));
  assert.deepEqual(transposeBefehl(c, 'transpose_st', '7').befehl, { befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 7 });
  assert.deepEqual(transposeBefehl(c, 'detune_ct', '-12,5').befehl, { befehl: 'warp_setzen', clip_id: 'c1', detune_ct: -12.5 });
  assert.equal(transposeBefehl(c, 'transpose_st', '3').befehl, null, 'derselbe Wert: nichts senden');
  for (const e of ['', 'x', '1.5', String(TRANSPOSE_MAX + 1), String(TRANSPOSE_MIN - 1), '-13']) assert.ok(transposeBefehl(c, 'transpose_st', e).fehler, `transpose_st "${e}"`);
  for (const e of ['', 'x', String(DETUNE_MAX + 0.1)]) assert.ok(transposeBefehl(c, 'detune_ct', e).fehler, `detune_ct "${e}"`);
  assert.ok(transposeBefehl(clip(warp({ modus: 'complex', detune_ct: 10 })), 'transpose_st', String(TRANSPOSE_MAX)).fehler, 'MAX st + 10 ct liegt über der Gesamtgrenze');
  assert.ok(transposeBefehl(clip(warp({ modus: 'complex', detune_ct: -10 })), 'transpose_st', String(TRANSPOSE_MIN)).fehler, 'MIN st − 10 ct liegt unter der Gesamtgrenze');
  assert.ok(transposeBefehl(clip(warp({ modus: 'repitch' })), 'transpose_st', '2').fehler, 'RE-PITCH: gesperrt');
  assert.ok(transposeBefehl(clip(null), 'transpose_st', '2').fehler, 'ohne Warp: gesperrt');
});
test('Transpose und Detune: Positivkontrollen an den Grenzen (MAX und MIN gelten, 50 ct gelten, MAX st mit -50 ct gilt)', () => {
  const c = clip(warp({ modus: 'tones' }));
  assert.equal(transposeBefehl(c, 'transpose_st', String(TRANSPOSE_MAX)).befehl.transpose_st, TRANSPOSE_MAX);
  assert.equal(TRANSPOSE_MIN, -12);
  assert.equal(transposeBefehl(c, 'transpose_st', String(TRANSPOSE_MIN)).befehl.transpose_st, TRANSPOSE_MIN);
  assert.equal(transposeBefehl(c, 'detune_ct', String(DETUNE_MAX)).befehl.detune_ct, DETUNE_MAX);
  assert.equal(transposeBefehl(clip(warp({ modus: 'tones', transpose_st: TRANSPOSE_MAX })), 'detune_ct', '-50').befehl.detune_ct, -50);
});
test('Moduswechsel: auf RE-PITCH schickt Nullen mit, wenn Transpose oder Detune gesetzt ist; sonst nur den Modus', () => {
  assert.deepEqual(modusBefehl(clip(warp({ modus: 'complex', transpose_st: 5 })), 'repitch'), { befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch', transpose_st: 0, detune_ct: 0 });
  assert.deepEqual(modusBefehl(clip(warp({ modus: 'complex', detune_ct: -5 })), 'repitch'), { befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch', transpose_st: 0, detune_ct: 0 });
  assert.deepEqual(modusBefehl(clip(warp({ modus: 'complex' })), 'repitch'), { befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch' });
  assert.deepEqual(modusBefehl(clip(warp({ modus: 'complex', transpose_st: 5 })), 'tones'), { befehl: 'warp_setzen', clip_id: 'c1', modus: 'tones' }, 'tones behält die Verstimmung');
});
test('Anzeige: die Erklärung zu „downbeat?“ ist ein Satz in Englisch und nennt die Eins; Spanne erscheint erst, wenn die Segmente mehr als 0,5 BPM auseinanderliegen', () => {
  assert.ok(/Bar 1/.test(EINS_HINWEIS) && /guess/.test(EINS_HINWEIS));
  const fast = clip(warp({ marker: [[0, 0], [0.5, 1], [1.0, 2], [1.5, 3]], quelle: 'werkstatt' }));
  assert.equal(warpAnzeige(fast).spanne, null, 'gleichmäßiges Tempo: keine Spanne');
  assert.equal(warpAnzeige(clip(warp({ marker: [[0, 0], [0.5, 1], [1.1, 2]], quelle: 'werkstatt' }))).spanne, '100–120');
});
test('AK30-Haltung mit Marker je Schlag und Eins bei Karten-Beat 2: bei 40 px je Beat liegt jeder Klick unter seiner Rasterlinie ± 1 px; der konstante Warp (Ausgleichsgerade) liegt daneben', () => {
  const bpm = (t) => 127.5 + t / 120 + 0.5 * Math.sin(2 * Math.PI * t / 45);   // Tempokurve von b_timemap.py (AK10)
  const fr = [];
  for (let k = 0, t = 0.25; k < 97; k++) { fr.push(Math.round(t * 48000)); t += 60 / bpm(t); }
  const hop = 256, px = 40;
  const marker = fr.map((f, k) => [f / 48000, k - 2]);                              // Beat 0 = Schlag 2 = die erste Eins; die ersten zwei Marker liegen vor dem Clip-Start
  const c = clip(warp({ modus: 'complex', quelle: 'werkstatt', marker }), { start_beat: 0, laenge_beats: 94 });
  const daneben = (clipX) => {
    let n = 0;
    for (let k = 2; k <= 95; k++) {
      const klickSpalte = fr[k] / hop, rx = (k - 2) * px;
      const [a0] = quellSpalten(clipX, 128, hop, px, rx - 1), [, b1] = quellSpalten(clipX, 128, hop, px, rx + 1);
      if (!(a0 <= klickSpalte && klickSpalte < b1)) n++;
    }
    return n;
  };
  assert.equal(daneben(c), 0, 'mit einem Marker je Schlag sitzt jeder Klick');
  assert.equal(quellSpalten(c, 128, hop, px, 0)[0], (fr[2] / 48000 * 48000) / hop, 'die linke Kante des Clips zeigt auf die Eins, nicht auf den Dateianfang');
  let sk = 0, sf = 0, skk = 0, skf = 0;
  fr.forEach((f, k) => { sk += k; sf += f; skk += k * k; skf += k * f; });
  const a = (97 * skf - sk * sf) / (97 * skk - sk * sk), cc = (sf - a * sk) / 97;     // Kleinste Quadrate: Frame = cc + a · k
  const konst = clip(warp({ modus: 'complex', quelle: 'mediathek', marker: [[(cc + a * 2) / 48000, 0], [(cc + a * 96) / 48000, 94]] }), { start_beat: 0, laenge_beats: 94 });
  const kd = daneben(konst);
  assert.ok(kd >= 10, `Negativ-Kontrolle: ${kd} von 94 Klicks liegen beim konstanten Warp außerhalb ±1 px (Amplitude der Drift rund 28 ms = 2 px bei 40 px je Beat)`);
});
test('Karte mit negativem ersten Marker-Beat: Welle zeichnet ab der Eins, nicht davor (kein Sprung in welleSpalteFuer)', () => {
  const c = clip(warp({ modus: 'complex', quelle: 'werkstatt', marker: [[0.5, -2], [1.0, -1], [1.5, 0], [2.0, 1], [2.5, 2]] }), { start_beat: 8, laenge_beats: 4 });
  const sp = welleSpalteFuer(c, 128, 256, 10, 0, 100000);
  assert.ok(Array.isArray(sp)); assert.equal(sp[0], 1.5 * 48000 / 256);
  assert.deepEqual(welleSpalteFuer({ ...c, warp: { ...c.warp, versatz_beats: -2 } }, 128, 256, 10, 0, 100000)[0], 0.5 * 48000 / 256, 'OFFSET −2 zieht das Intro bis zum ersten Schlag herein');
});

// Slice 4, T7: BEATS im Detailbereich
const DETAIL = readFileSync(new URL('../oeffentlich/produktion/detail.js', import.meta.url), 'utf8');
test('BEATS: die Modus-Auswahl hat vier Optionen in der Reihenfolge repitch, beats, complex, tones; die drei Felder stehen im Gerüst, versteckt', () => {
  const sel = DETAIL.match(/data-d="warpmodus"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...sel.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]), ['repitch', 'beats', 'complex', 'tones']);
  assert.match(DETAIL, /data-d="beatsteil" hidden/);
  const r = DETAIL.match(/data-d="beatsraster">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...r.matchAll(/<option value="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]), [['transienten', 'Transients'], ['1/4', '1/4'], ['1/8', '1/8'], ['1/16', '1/16'], ['1/32', '1/32']]);
  const l = DETAIL.match(/data-d="beatsloop">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...l.matchAll(/<option value="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]), [['aus', 'Off'], ['vor', 'Forward'], ['vor_zurueck', 'Back-and-Forth']]);
  assert.match(DETAIL, /data-d="beatshuelle"/);
});
test('BEATS: Anzeige nimmt warp.beats, sonst die Vorgabe; sichtbar nur im Modus beats', () => {
  assert.deepEqual(beatsAnzeige(clip(warp({ modus: 'beats' }))), { sichtbar: true, raster: 'transienten', loop: 'vor', huelle: 100 });
  assert.deepEqual(beatsAnzeige(clip(warp({ modus: 'beats', beats: { raster: '1/8', loop: 'aus', huelle: 40 } }))), { sichtbar: true, raster: '1/8', loop: 'aus', huelle: 40 });
  assert.equal(beatsAnzeige(clip(warp({ modus: 'complex' }))).sichtbar, false);
  assert.equal(beatsAnzeige(clip(null)).sichtbar, false);
});
test('BEATS: eine Änderung schickt genau einen warp_setzen mit dem ganzen beats-Objekt; gleicher Wert und ungültige Hülle schicken nichts', () => {
  const c = clip(warp({ modus: 'beats', beats: { raster: '1/8', loop: 'aus', huelle: 40 } }));
  assert.deepEqual(beatsBefehl(c, 'raster', '1/16'), { befehl: { befehl: 'warp_setzen', clip_id: 'c1', beats: { raster: '1/16', loop: 'aus', huelle: 40 } }, label: 'Warp beats' });
  assert.deepEqual(beatsBefehl(c, 'loop', 'vor_zurueck').befehl.beats, { raster: '1/8', loop: 'vor_zurueck', huelle: 40 });
  assert.deepEqual(beatsBefehl(c, 'huelle', '100').befehl.beats, { raster: '1/8', loop: 'aus', huelle: 100 });
  assert.deepEqual(beatsBefehl(c, 'huelle', '0').befehl.beats.huelle, 0, '0 gilt');
  assert.equal(beatsBefehl(c, 'raster', '1/8').befehl, null, 'gleicher Wert: nichts senden');
  for (const e of ['', 'x', '1.5', '101', '-1', '1e1']) assert.ok(beatsBefehl(c, 'huelle', e).fehler, `huelle "${e}"`);
  assert.ok(beatsBefehl(clip(warp({ modus: 'complex' })), 'raster', '1/4').fehler, 'nicht im Modus beats');
  assert.deepEqual(beatsBefehl(clip(warp({ modus: 'beats' })), 'raster', '1/4').befehl.beats, { raster: '1/4', loop: 'vor', huelle: 100 }, 'Vorgabe füllt den Rest');
});
test('BEATS: Transpose und Detune sind gesperrt (D6b), in complex und tones nicht; der Wechsel auf beats schickt Nullen mit', () => {
  assert.equal(tonErlaubt(warp({ modus: 'beats' })), false);
  assert.equal(tonErlaubt(warp({ modus: 'repitch' })), false);
  assert.equal(tonErlaubt(warp({ modus: 'complex' })), true);
  assert.equal(tonErlaubt(warp({ modus: 'tones' })), true);
  assert.ok(transposeBefehl(clip(warp({ modus: 'beats' })), 'transpose_st', '2').fehler, 'BEATS: gesperrt');
  assert.deepEqual(modusBefehl(clip(warp({ modus: 'complex', transpose_st: 5 })), 'beats'), { befehl: 'warp_setzen', clip_id: 'c1', modus: 'beats', transpose_st: 0, detune_ct: 0 });
  assert.deepEqual(modusBefehl(clip(warp({ modus: 'complex' })), 'beats'), { befehl: 'warp_setzen', clip_id: 'c1', modus: 'beats' });
  assert.equal(warpAnzeige(clip(warp({ modus: 'beats' }))).modus, 'BEATS');
});
test('BEATS: die Felder (Namen, Anzeige, Änderung) kommen aus warp.js; detail.js verdrahtet sie', () => {
  assert.deepEqual(BEATS_FELDER, [['beatsraster', 'raster'], ['beatsloop', 'loop'], ['beatshuelle', 'huelle']], 'alle drei Felder in der Sende-Schleife');
  for (const [name] of BEATS_FELDER) assert.match(DETAIL, new RegExp(`data-d="${name}"`), `${name} steht im Gerüst`);
  const aus = beatsFeldAnsicht(clip(warp({ modus: 'complex' })));
  assert.deepEqual([aus.teilVersteckt, aus.gesperrt], [true, true], 'außerhalb von beats: Block versteckt, Felder gesperrt');
  assert.deepEqual([beatsFeldAnsicht(clip(null)).teilVersteckt, beatsFeldAnsicht(clip(null)).gesperrt], [true, true], 'ohne Warp');
  const an = beatsFeldAnsicht(clip(warp({ modus: 'beats', beats: { raster: '1/8', loop: 'vor_zurueck', huelle: 37 } })));
  assert.deepEqual([an.teilVersteckt, an.gesperrt], [false, false], 'im Modus beats: sichtbar und aktiv');
  assert.deepEqual(an.werte, { beatsraster: '1/8', beatsloop: 'vor_zurueck', beatshuelle: '37' }, 'die Hülle kommt aus dem Clip, nicht fest');
  assert.equal(beatsFeldAnsicht(clip(warp({ modus: 'beats' }))).werte.beatshuelle, '100', 'ohne beats gilt die Vorgabe');
  const c = clip(warp({ modus: 'beats', beats: { raster: '1/8', loop: 'aus', huelle: 40 } }));
  const sendet = { beatsraster: ['1/32', { raster: '1/32', loop: 'aus', huelle: 40 }], beatsloop: ['vor', { raster: '1/8', loop: 'vor', huelle: 40 }], beatshuelle: ['55', { raster: '1/8', loop: 'aus', huelle: 55 }] };
  for (const [name, [eingabe, erwartet]] of Object.entries(sendet)) {
    assert.deepEqual(beatsAenderung(c, name, eingabe), { befehl: { befehl: 'warp_setzen', clip_id: 'c1', beats: erwartet }, label: 'Warp beats' }, `${name}: ganzes Objekt und Label`);
  }
  assert.ok(beatsAenderung(c, 'unbekannt', 'x').fehler);
  assert.match(DETAIL, /for \(const \[name, feld\] of BEATS_FELDER\)/, 'detail.js verdrahtet die Schleife über BEATS_FELDER');
  assert.match(DETAIL, /beatsAenderung\(t\.clip, name, f\.value\)/);
  assert.match(DETAIL, /d\('beatsteil'\)\.hidden = ba\.teilVersteckt/);
  assert.match(DETAIL, /f\.disabled = ba\.gesperrt/);
  assert.match(DETAIL, /f\.value = ba\.werte\[name\]/);
  assert.match(DETAIL, /tonErlaubt\(c\.warp\)/);
});

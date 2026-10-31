// Paket 1.13 Warp, Slice 3b: die Befehle warp_tempo, warp_marker, warp_ab_hier (gerade) und eins_hier als reine Befehle (Undo-Rundlauf, Ablehnungen mit
// Positivkontrolle). Der Server-Durchlauf (Verlauf, Wiedergabe, ein Undo-Schritt) steht in proj_warp_hand_sitzung.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, MAX_MARKER, MAX_BEAT } from '../projekt/modell.ts';
import { wende } from '../projekt/patch.ts';
import { quellSekunde, segmentBpm } from '../projekt/warp.ts';
import { SHA_A, ohneAbgeleitetes } from './hilfen/projekt.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `erwartet ${grund} für ${JSON.stringify(b).slice(0, 110)}`);
const warp = (extra = {}) => ({ an: true, modus: 'complex', marker: [[0, 0], [2, 4], [4, 8]], versatz_beats: 0, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0, ...extra });
// Audio-Spur s1, Clip c1 (Beat 4, 8 Beats) mit Warp: 120 BPM (zwei Beats je Sekunde), ein Clip c2 ohne Warp auf s1, ein MIDI-Clip c3 auf s2
function aufbau(w = warp(), extra = {}) {
  return fuehreListeAus(neuesProjekt('H'), [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA_A, pfad_hinweis: '/x/t.wav', ...extra, ...(w ? { warp: w } : {}) },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 20, laenge_beats: 4, sha256: SHA_A },
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4 }]).projekt;
}
const clip = (p, id = 'c1') => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
function pruefe(p, r) {
  assert.ok(pruefeProjekt(r.projekt).projekt, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
  for (const o of [...r.vor, ...r.zurueck]) assert.ok(!/\/\d+(\/|$)/.test(o.pfad), `Index im Pfad ${o.pfad}`);
}
const bpms = (w) => w.marker.slice(0, -1).map((_, i) => segmentBpm(w.marker, i));

test('warp_tempo ×2: alle Segment-Tempi doppelt, Clip-Länge, Versatz und Loop doppelt, Quellzeiten gleich, quelle hand; :2 stellt es her', () => {
  const p = aufbau(warp({ versatz_beats: 1, eins_unsicher: true }), { loop_beats: 4 });
  const r = fuehreAus(p, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 });
  pruefe(p, r);
  const c = clip(r.projekt);
  assert.deepEqual(bpms(c.warp), bpms(clip(p).warp).map((x) => x * 2));
  assert.deepEqual(c.warp.marker.map((m) => m[0]), [0, 2, 4], 'die Quellzeiten bleiben');
  assert.deepEqual([c.laenge_beats, c.warp.versatz_beats, c.loop_beats, c.warp.quelle, c.warp.eins_unsicher], [16, 2, 8, 'hand', true]);
  assert.equal(r.betrifft_wiedergabe, true);
  const z = fuehreAus(r.projekt, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 });
  pruefe(r.projekt, z);
  assert.deepEqual([clip(z.projekt).warp.marker, clip(z.projekt).laenge_beats, clip(z.projekt).warp.versatz_beats, clip(z.projekt).loop_beats],
    [clip(p).warp.marker, 8, 1, 4], ':2 nach ×2 ist der Ausgangszustand (bis auf quelle)');
  assert.deepEqual(clip(r.projekt, 'c2'), clip(p, 'c2'), 'ein anderer Clip bleibt unberührt');
});

test('warp_tempo: Ablehnungen (Faktor, kein Warp, MIDI, Tempo-Band, Länge, Loop, Fades, unbekanntes Argument) und die Positivkontrolle an der Grenze', () => {
  const p = aufbau();
  for (const f of [1, 3, 0, -2, '2', null]) lehntAb(p, { befehl: 'warp_tempo', clip_id: 'c1', faktor: f }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_tempo', clip_id: 'c2', faktor: 2 }, 'kein_warp');
  lehntAb(p, { befehl: 'warp_tempo', clip_id: 'c3', faktor: 2 }, 'feld_nur_audio');
  lehntAb(p, { befehl: 'warp_tempo', clip_id: 'c9', faktor: 2 }, 'clip_unbekannt');
  lehntAb(p, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2, extra: 1 }, 'argument_unbekannt');
  const schnell = aufbau(warp({ marker: [[0, 0], [1, 7]] }));                      // 420 BPM
  lehntAb(schnell, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }, 'warp_faktor');           // 840 > 800
  assert.doesNotThrow(() => fuehreAus(aufbau(warp({ marker: [[0, 0], [1, 6.5]] })), { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }), 'Positivkontrolle: 390 → 780 geht');
  lehntAb(aufbau(warp({ marker: [[0, 0], [1, 0.4]] })), { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 }, 'warp_faktor');   // 24 → 12 < 15
  lehntAb(aufbau(warp(), { loop_beats: 0.1 }), { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 }, 'argument_ungueltig');         // Loop 0,05 < 1/16
  const fades = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', fade_ein_beats: 3, fade_aus_beats: 3 }).projekt;
  lehntAb(fades, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 }, 'fade_zu_lang');           // Länge 4 < 6
  assert.doesNotThrow(() => fuehreAus(fades, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }), 'Positivkontrolle: ×2 mit denselben Fades geht');
  lehntAb(aufbau(warp(), { laenge_beats: 60000 }), { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }, 'argument_ungueltig');   // 120000 > MAX_BEAT 100000
  assert.doesNotThrow(() => fuehreAus(aufbau(warp(), { laenge_beats: 40000 }), { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }), 'Positivkontrolle: 80000 liegt unter der Grenze');
});

test('warp_marker: setzen (mit und ohne beat), löschen, verschieben; je ein Befehl, Länge des Clips bleibt, quelle hand', () => {
  const p = aufbau();
  const setze = fuehreAus(p, { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1, beat: 3 }] });
  pruefe(p, setze); assert.deepEqual(clip(setze.projekt).warp.marker, [[0, 0], [1, 3], [2, 4], [4, 8]]);
  assert.equal(clip(setze.projekt).warp.quelle, 'hand'); assert.equal(clip(setze.projekt).laenge_beats, 8);
  const gleich = fuehreAus(p, { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1 }] });
  pruefe(p, gleich); assert.deepEqual(clip(gleich.projekt).warp.marker, [[0, 0], [1, 2], [2, 4], [4, 8]], 'ohne beat: das Raster dort, der Klang ändert sich nicht');
  const weg = fuehreAus(p, { befehl: 'warp_marker', clip_id: 'c1', loesche: [4] });
  pruefe(p, weg); assert.deepEqual(clip(weg.projekt).warp.marker, [[0, 0], [4, 8]]);
  const quelle = fuehreAus(p, { befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 4, neu_quell_s: 2.5 }] });
  pruefe(p, quelle); assert.deepEqual(clip(quelle.projekt).warp.marker, [[0, 0], [2.5, 4], [4, 8]]);
  const beat = fuehreAus(p, { befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 4, neu_beat: 5 }] });
  pruefe(p, beat); assert.deepEqual(clip(beat.projekt).warp.marker, [[0, 0], [2, 5], [4, 8]]);
  const alles = fuehreAus(p, { befehl: 'warp_marker', clip_id: 'c1', loesche: [0], verschiebe: [{ beat: 4, neu_beat: 5 }], setze: [{ quell_s: 3, beat: 6.5 }] });
  pruefe(p, alles); assert.deepEqual(clip(alles.projekt).warp.marker, [[2, 5], [3, 6.5], [4, 8]]);
});

test('warp_marker: Ablehnungen (unbekannter Beat, Überholen, zu steiles Segment, zu viele, kein Warp, Form) und Positivkontrollen', () => {
  const p = aufbau();
  const b = { befehl: 'warp_marker', clip_id: 'c1' };
  lehntAb(p, { ...b, loesche: [5] }, 'marker_unbekannt');
  lehntAb(p, { ...b, verschiebe: [{ beat: 3, neu_beat: 4 }] }, 'marker_unbekannt');
  lehntAb(p, { ...b, verschiebe: [{ beat: 4, neu_quell_s: 4.5 }] }, 'warp_marker');                 // über den letzten Marker hinaus: nicht mehr steigend
  lehntAb(p, { ...b, verschiebe: [{ beat: 4, neu_quell_s: 0 }] }, 'warp_marker');                   // auf die Quellzeit des ersten
  lehntAb(p, { ...b, verschiebe: [{ beat: 4, neu_beat: 20 }] }, 'warp_marker');                     // Beat über den nächsten Marker
  lehntAb(p, { ...b, verschiebe: [{ beat: 4, neu_beat: 0.1 }] }, 'warp_faktor');                  // Segment (0,0)-(2,0,1) hat 3 BPM
  assert.doesNotThrow(() => fuehreAus(p, { ...b, verschiebe: [{ beat: 4, neu_beat: 0.5 }] }), 'Positivkontrolle: 15 BPM sind die untere Grenze');
  lehntAb(p, { ...b, loesche: [0, 4, 8] }, 'warp_marker');
  lehntAb(p, { ...b, loesche: [0, 4] }, 'warp_marker');                                               // ein Marker bleibt: zu wenig
  const viele = Array.from({ length: MAX_MARKER - 3 }, (_, i) => ({ quell_s: 5 + i * 0.01, beat: 9 + i * 0.02 }));
  assert.doesNotThrow(() => fuehreAus(p, { ...b, setze: viele }), 'Positivkontrolle: genau 4096 Marker');
  lehntAb(p, { ...b, setze: [...viele, { quell_s: 99, beat: 99 }] }, 'warp_marker');                 // 4097
  lehntAb(aufbau(null), { ...b, loesche: [4] }, 'kein_warp');
  lehntAb(p, { ...b }, 'argument_ungueltig');
  lehntAb(p, { ...b, setze: [] }, 'argument_ungueltig');
  lehntAb(p, { ...b, setze: [{ quell_s: 1, beat: 3, name: 'x' }] }, 'argument_unbekannt');
  lehntAb(p, { ...b, setze: [{ beat: 3 }] }, 'argument_ungueltig');
  lehntAb(p, { ...b, setze: [{ quell_s: -1 }] }, 'argument_ungueltig');
  lehntAb(p, { ...b, setze: [{ quell_s: 1e8 }] }, 'argument_ungueltig');
  lehntAb(p, { ...b, loesche: ['4'] }, 'argument_ungueltig');
  lehntAb(p, { ...b, verschiebe: [{ beat: 4 }] }, 'argument_ungueltig');
  lehntAb(p, { ...b, kram: 1, loesche: [4] }, 'argument_unbekannt');
  lehntAb(p, { ...b, clip_id: 'c3', loesche: [4] }, 'feld_nur_audio');
  lehntAb(p, { ...b, setze: [{ quell_s: 2, beat: 4 }] }, 'warp_marker');                             // derselbe Marker noch einmal: nicht streng steigend
});

test('warp_ab_hier gerade: ab dem Beat ein Segment mit dem Tempo dort; hinter dem letzten Marker ändert sich nichts; start braucht den Server', () => {
  const p = aufbau(warp({ marker: [[0, 0], [1, 2], [2, 3], [4, 7]] }));                              // 120, 60, 120 BPM
  const r = fuehreAus(p, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 2, art: 'gerade' });
  pruefe(p, r); assert.deepEqual(clip(r.projekt).warp.marker, [[0, 0], [1, 2], [4, 5]], 'das Segment ab Beat 2 hat 60 BPM');
  assert.equal(clip(r.projekt).warp.quelle, 'hand'); assert.equal(clip(r.projekt).laenge_beats, 8, 'die Länge des Clips bleibt');
  const mitte = fuehreAus(p, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 2.5, art: 'gerade' });
  pruefe(p, mitte); assert.deepEqual(clip(mitte.projekt).warp.marker, [[0, 0], [1, 2], [1.5, 2.5], [4, 5]]);
  const nichts = fuehreAus(p, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 7, art: 'gerade' });
  assert.deepEqual([nichts.vor.length, nichts.zurueck.length], [0, 0], 'Negativkontrolle: hinter dem letzten Marker gibt es nichts zu begradigen');
  lehntAb(p, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 2, art: 'start' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 2, art: 'schief' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_ab_hier', clip_id: 'c1', art: 'gerade' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_ab_hier', clip_id: 'c2', beat: 2, art: 'gerade' }, 'kein_warp');
  lehntAb(p, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 2, art: 'gerade', x: 1 }, 'argument_unbekannt');
});

test('eins_hier: die Stelle wird Beat 0, der Klang bleibt, der Versatz bleibt, die Länge folgt dem Ende der Quelle, eins_unsicher false', () => {
  const p = aufbau(warp({ marker: [[0.5, -2], [1, -1], [1.5, 0], [2, 1], [4, 5]], eins_unsicher: true }));
  const r = fuehreAus(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 2 });
  pruefe(p, r);
  const c = clip(r.projekt);
  assert.deepEqual(c.warp.marker, [[0.5, -3], [1, -2], [1.5, -1], [2, 0], [4, 4]]);
  assert.deepEqual([c.warp.eins_unsicher, c.warp.quelle, c.warp.versatz_beats, c.laenge_beats], [false, 'hand', 0, 7], 'Länge 8 − 1 Beat');
  // der Klang bleibt: die Quelle, die am Ende des Fensters klingt, ist dieselbe
  const w0 = clip(p).warp, w1 = c.warp;
  assert.equal(quellSekunde(w1.marker, w1.versatz_beats + c.laenge_beats), quellSekunde(w0.marker, w0.versatz_beats + clip(p).laenge_beats), 'dasselbe Ende der Quelle');
  assert.equal(quellSekunde(w1.marker, 0), 2, 'der Clip beginnt an der neuen Eins (Quellzeit 2)');
  const frueh = fuehreAus(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 1 });                  // eine Eins früher: der Clip wird einen Beat länger
  pruefe(p, frueh); assert.deepEqual([clip(frueh.projekt).laenge_beats, clip(frueh.projekt).warp.marker[0]], [9, [0.5, -1]]);
  lehntAb(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 6 }, 'beat_ausserhalb');                // 6 s = Beat 9 hinter dem Ende des Clips (Länge 8)
  assert.equal(clip(fuehreAus(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 5 }).projekt).laenge_beats, 1, 'Positivkontrolle: 5 s = Beat 7, ein Beat bleibt');
  const fades = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', fade_aus_beats: 6 }).projekt;
  lehntAb(fades, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 5 }, 'fade_zu_lang');
  lehntAb(p, { befehl: 'eins_hier', clip_id: 'c2', quell_s: 1 }, 'kein_warp');
  lehntAb(p, { befehl: 'eins_hier', clip_id: 'c1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: -1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 1, beat: 2 }, 'argument_unbekannt');
});

test('tempo_vom_clip: der Befehl allein lehnt ab (der Server schreibt ihn um); ohne Warp, MIDI und unbekannter Clip melden ihren Grund', () => {
  const p = aufbau();
  lehntAb(p, { befehl: 'tempo_vom_clip', clip_id: 'c1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'tempo_vom_clip', clip_id: 'c2' }, 'kein_warp');
  lehntAb(p, { befehl: 'tempo_vom_clip', clip_id: 'c3' }, 'feld_nur_audio');
  lehntAb(p, { befehl: 'tempo_vom_clip', clip_id: 'c9' }, 'clip_unbekannt');
  lehntAb(p, { befehl: 'tempo_vom_clip', clip_id: 'c1', bpm: 100 }, 'argument_unbekannt');
});

test('eins_hier mit versatz_beats ≠ 0: der Versatz bleibt, der Clip beginnt versatz Beats NACH der neuen Eins (gewollt, D3a), die Länge folgt', () => {
  const p = aufbau(warp({ versatz_beats: 2 }));
  const r = fuehreAus(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 1 });                       // 1 s = Beat 2
  pruefe(p, r);
  const c = clip(r.projekt);
  assert.deepEqual(c.warp.marker, [[0, -2], [2, 2], [4, 6]]);
  assert.deepEqual([c.warp.versatz_beats, c.laenge_beats], [2, 6], 'der Versatz bleibt 2, die Länge 8 − 2');
  assert.equal(quellSekunde(c.warp.marker, 0), 1, 'die neue Eins liegt bei Quellzeit 1 s');
  assert.equal(quellSekunde(c.warp.marker, c.warp.versatz_beats), 2, 'der Clip beginnt 2 Beats nach der Eins, bei 2 s');
  assert.equal(quellSekunde(c.warp.marker, c.warp.versatz_beats + c.laenge_beats), quellSekunde(clip(p).warp.marker, 2 + 8), 'dasselbe Ende der Quelle');
});

test('eins_hier: der Loop wird auf die neue Länge gekappt, ein kürzerer bleibt (Positivkontrolle)', () => {
  const lang = fuehreAus(aufbau(warp(), { loop_beats: 7 }), { befehl: 'eins_hier', clip_id: 'c1', quell_s: 1 });   // Länge 8 → 6
  assert.deepEqual([clip(lang.projekt).laenge_beats, clip(lang.projekt).loop_beats], [6, 6], 'loop 7 > 6 wird 6');
  const kurz = fuehreAus(aufbau(warp(), { loop_beats: 4 }), { befehl: 'eins_hier', clip_id: 'c1', quell_s: 1 });
  assert.equal(clip(kurz.projekt).loop_beats, 4, 'loop 4 ≤ 6 bleibt');
});

test('eins_hier: Länge 0 (die Eins genau am Ende des Clips) ist beat_ausserhalb; ein Beat davor geht (Positivkontrolle)', () => {
  const p = aufbau();
  lehntAb(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 4 }, 'beat_ausserhalb');                // 4 s = Beat 8 = Länge des Clips
  assert.equal(clip(fuehreAus(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 3.5 }).projekt).laenge_beats, 1);
});

test('eins_hier: eine Länge über MAX_BEAT ist argument_ungueltig (wie warp_tempo), knapp darunter geht', () => {
  const p = aufbau(warp({ marker: [[1, 0], [3, 4]] }), { laenge_beats: MAX_BEAT - 2 });
  assert.equal(clip(fuehreAus(p, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 0 }).projekt).laenge_beats, MAX_BEAT, 'Positivkontrolle: genau MAX_BEAT');
  const p2 = aufbau(warp({ marker: [[1, 0], [3, 4]] }), { laenge_beats: MAX_BEAT - 1 });
  lehntAb(p2, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 0 }, 'argument_ungueltig');             // Beat −2 → Länge MAX_BEAT + 1
});

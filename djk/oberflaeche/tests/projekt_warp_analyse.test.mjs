// Paket 1.13 Warp, Slice 3a (Task 13): ankunftBefehle, die reine Entscheidung bei Ankunft der Karte; brauchtAnalyse; klingtGerade (D1: nie unter einem klingenden
// Clip umschalten). T11: unangefasst heißt marker, quelle, versatz_beats, eins_unsicher wie beim Auftrag; an, modus, Transpose, Detune bleiben; die Länge folgt der
// Karte nur, wenn sie noch der Wert beim Auftrag ist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ankunftBefehle, brauchtAnalyse, klingtGerade, ANALYSE_AB_S } from '../projekt/warp_analyse.ts';
import { autoWarp } from '../projekt/warp.ts';
import { warpPruefung } from '../projekt/modell.ts';
import { karteLinear } from './hilfen/karte.mjs';

const KARTE = { marker: karteLinear(40, { t0: 0.5, bpm: 120 }).map(([s, b]) => [s, b - 2]), eins_unsicher: true };
const q = (extra = {}) => ({ typ: 'track', bpm: 120, takte: null, dauer_s: 100, karte: KARTE, ...extra });
const medWarp = (extra = {}) => ({ an: true, modus: 'complex', marker: [[0, 0], [100, 200]], versatz_beats: 0, quelle: 'mediathek', transpose_st: 0, detune_ct: 0, eins_unsicher: true, ...extra });
const clip = (warp, extra = {}) => ({ id: 'c1', art: 'audio', laenge_beats: 200, quelle: { sha256: 'a'.repeat(64) }, ...(warp ? { warp } : {}), ...extra });

test('Mediathek-Warp unangefasst: werkstatt-Warp mit den Einstellungen des Nutzers (Modus, Transpose, an), Länge folgt der Karte', () => {
  const w = medWarp();
  const a = ankunftBefehle(clip(w), { warp: w, laenge_beats: 200 }, q());
  assert.equal(a.befehle.length, 2);
  assert.equal(a.befehle[0].befehl, 'warp_setzen'); assert.equal(a.befehle[0].warp.quelle, 'werkstatt'); assert.equal(a.befehle[0].warp.marker.length, 40);
  assert.equal(warpPruefung(a.befehle[0].warp), null);
  assert.deepEqual(a.befehle[1], { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: autoWarp(q()).laenge_beats });
  const eigen = medWarp({ modus: 'tones', transpose_st: 3, detune_ct: -10, an: false });
  const b = ankunftBefehle(clip(eigen), { warp: medWarp(), laenge_beats: 200 }, q());
  assert.deepEqual([b.befehle[0].warp.modus, b.befehle[0].warp.transpose_st, b.befehle[0].warp.detune_ct, b.befehle[0].warp.an], ['tones', 3, -10, false], 'die Einstellungen bleiben');
});
test('Clip ohne Warp (Auto-Warp fand kein Tempo) und unverändert: Warp und Länge aus der Karte; Clip ohne Warp, aber Warp erschien (von Hand): angefasst', () => {
  const a = ankunftBefehle(clip(null, { laenge_beats: 3 }), { warp: null, laenge_beats: 3 }, q());
  assert.equal(a.befehle[0].warp.modus, 'complex'); assert.equal(a.befehle[1].befehl, 'clip_aendern');
  assert.deepEqual(ankunftBefehle(clip(medWarp()), { warp: null, laenge_beats: 3 }, q()), { lassen: 'angefasst' });
});
test('angefasst: Marker, Quelle, Versatz oder eins_unsicher geändert → nichts; Länge vom Nutzer geändert → nur der Warp, nicht die Länge (Negativ-Kontrollen zum ersten Test)', () => {
  const w = medWarp();
  for (const f of [{ marker: [[0, 0], [100, 201]] }, { quelle: 'hand' }, { versatz_beats: 1 }, { eins_unsicher: undefined }]) {
    assert.deepEqual(ankunftBefehle(clip({ ...w, ...f }), { warp: w, laenge_beats: 200 }, q()), { lassen: 'angefasst' }, JSON.stringify(f));
  }
  const b = ankunftBefehle(clip(w, { laenge_beats: 64 }), { warp: w, laenge_beats: 200 }, q());
  assert.equal(b.befehle.length, 1); assert.equal(b.befehle[0].befehl, 'warp_setzen');
});
test('keine Karte / schon Werkstatt / Karte unbrauchbar: nichts tun, mit Grund', () => {
  const w = medWarp();
  assert.deepEqual(ankunftBefehle(clip(w), { warp: w, laenge_beats: 200 }, q({ karte: null })), { lassen: 'keine_karte' });
  const fallend = { marker: KARTE.marker.map(([s, b]) => [s, b]), eins_unsicher: false }; fallend.marker[10][0] = fallend.marker[9][0];
  assert.deepEqual(ankunftBefehle(clip(w), { warp: w, laenge_beats: 200 }, q({ karte: fallend })), { lassen: 'keine_karte' });
  const k = autoWarp(q()).warp;
  assert.deepEqual(ankunftBefehle(clip(k), { warp: k, laenge_beats: 47 }, q()), { lassen: 'schon_werkstatt' });
});
test('brauchtAnalyse: nur lange Tracks ohne Karte, deren beste Quelle Mediathek, Takte oder nichts ist', () => {
  assert.equal(ANALYSE_AB_S, 60);
  const ohne = { typ: 'track', bpm: 120, takte: null, dauer_s: 100, karte: null };
  assert.equal(brauchtAnalyse(ohne, autoWarp(ohne)), true);
  assert.equal(brauchtAnalyse({ ...ohne, bpm: null }, autoWarp({ ...ohne, bpm: null })), true, 'kein Tempo: auch');
  assert.equal(brauchtAnalyse({ ...ohne, dauer_s: 59.9 }, autoWarp({ ...ohne, dauer_s: 59.9 })), false);
  assert.equal(brauchtAnalyse({ ...ohne, dauer_s: 60 }, autoWarp({ ...ohne, dauer_s: 60 })), true, 'genau 60 s zählen als lang');
  assert.equal(brauchtAnalyse({ ...ohne, typ: 'loop' }, autoWarp({ ...ohne, typ: 'loop' })), false);
  assert.equal(brauchtAnalyse({ ...ohne, typ: 'oneshot' }, autoWarp({ ...ohne, typ: 'oneshot' })), false);
  assert.equal(brauchtAnalyse({ ...ohne, karte: KARTE }, autoWarp({ ...ohne, karte: KARTE })), false);
  const t = { ...ohne, traktor: { anker_s: 0.1, bpm: 128 } };
  assert.equal(brauchtAnalyse(t, autoWarp(t)), false, 'Traktor genügt');
});
test('klingtGerade (D1): nur bei spielendem Transport (status 2) und Kopf in [start, start + Länge); der Start zählt, das Ende nicht; stehend, wartend, Freeze, ohne Kernstand: nein', () => {
  const clip = { start_beat: 16, laenge_beats: 8 };
  const arr = (status, projekt_beat) => ({ status, projekt_beat });
  assert.equal(klingtGerade(arr(2, 20), clip), true);
  assert.equal(klingtGerade(arr(2, 16), clip), true, 'der Start gehört zum Clip');
  assert.equal(klingtGerade(arr(2, 23.999), clip), true);
  assert.equal(klingtGerade(arr(2, 24), clip), false, 'das Ende nicht');
  assert.equal(klingtGerade(arr(2, 15.999), clip), false);
  assert.equal(klingtGerade(arr(2, 400), clip), false);
  for (const status of [0, 1, 3]) assert.equal(klingtGerade(arr(status, 20), clip), false, `status ${status}: der Kopf steht im Clip, aber nichts klingt`);
  assert.equal(klingtGerade(null, clip), false, 'ohne Kernstand');
});

test('Review 1: ein BEATS-Clip behält bei Ankunft der Karte seine beats-Parameter; ohne beats kommt keiner dazu', () => {
  const beats = { raster: '1/8', loop: 'vor_zurueck', huelle: 40 };
  const w = medWarp({ modus: 'beats', beats });
  const a = ankunftBefehle(clip(w), { warp: medWarp({ modus: 'beats' }), laenge_beats: 200 }, q());
  assert.deepEqual(a.befehle[0].warp.beats, beats);
  assert.equal(a.befehle[0].warp.modus, 'beats');
  assert.equal(warpPruefung(a.befehle[0].warp), null);
  const ohne = ankunftBefehle(clip(medWarp()), { warp: medWarp(), laenge_beats: 200 }, q());
  assert.equal('beats' in ohne.befehle[0].warp, false);
});

// Paket 1.13 Warp, Slice 5: Transpose und Detune. AK2 (Bereich, ganz, Detune, RE-PITCH, Gesamtgrenze, je mit Positivkontrolle), pitchFaktor (Wertetest), Übersetzer
// (pitch nur bei != 1, Wert gleich 2^(st/12 + ct/1200)), Befehl (ein Befehl, Undo-Rundlauf, Modus-Wechsel auf repitch mit Nullen), Rückgabe von proj_lage/proj_warp (AK28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, warpPruefung, pitchFaktor, TRANSPOSE_MIN, TRANSPOSE_MAX, DETUNE_MAX, GESAMT_CT_MIN, GESAMT_CT_MAX } from '../projekt/modell.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { wende } from '../projekt/patch.ts';
import { SHA_A, ohneAbgeleitetes, specProjekt, kopie } from './hilfen/projekt.mjs';

const warp = (extra = {}) => ({ an: true, modus: 'complex', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0, ...extra });
const grund = (w) => warpPruefung(w)?.grund ?? null;
const lehntAb = (p, b, g) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === g, `erwartet ${g} für ${JSON.stringify(b)}`);
function aufbau(w = warp()) {
  return fuehreListeAus(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA_A, pfad_hinweis: '/x/loop.wav', warp: w }]).projekt;
}
const clip = (p) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === 'c1');

test('AK2 Bereich: Transpose MIN..MAX ganz gilt (D1, Andreas 2026-10-28: −12..+24), MIN−1, MAX+1 und nicht ganz nicht; Detune ±DETUNE_MAX gilt, darüber nicht; je in COMPLEX und TONES', () => {
  for (const modus of ['complex', 'tones']) {
    assert.equal(TRANSPOSE_MIN, -12); assert.equal(TRANSPOSE_MAX, 24);   // die Entscheidung als Zahl, nicht nur als Name
    for (const st of [TRANSPOSE_MIN, -1, 0, 1, 7, TRANSPOSE_MAX]) assert.equal(grund(warp({ modus, transpose_st: st })), null, `${modus} ${st} st`);
    assert.equal(grund(warp({ modus, transpose_st: TRANSPOSE_MAX + 1 })), 'argument_ungueltig');
    assert.equal(grund(warp({ modus, transpose_st: TRANSPOSE_MIN - 1 })), 'argument_ungueltig', `${modus} −13 st: unter −12 liegt der Anschlag über dem Lage-Gate`);
    assert.equal(grund(warp({ modus, transpose_st: 0.5 })), 'argument_ungueltig');
    assert.equal(grund(warp({ modus, transpose_st: '7' })), 'argument_ungueltig');
    for (const ct of [-DETUNE_MAX, -12.5, 0, 33.3, DETUNE_MAX]) assert.equal(grund(warp({ modus, detune_ct: ct })), null, `${modus} ${ct} ct`);
    assert.equal(grund(warp({ modus, detune_ct: DETUNE_MAX + 0.0001 })), 'argument_ungueltig');
    assert.equal(grund(warp({ modus, detune_ct: -DETUNE_MAX - 1 })), 'argument_ungueltig');
  }
});
test('AK2 Gesamtgrenze: Transpose · 100 + Detune höchstens GESAMT_CT_MAX (die Grenze der Maschine, Bungee 2 Oktaven); an der Kante gilt es, einen Cent darüber nicht', () => {
  assert.equal(GESAMT_CT_MAX, TRANSPOSE_MAX * 100); assert.equal(GESAMT_CT_MIN, TRANSPOSE_MIN * 100);
  assert.equal(grund(warp({ transpose_st: TRANSPOSE_MAX, detune_ct: 0 })), null);
  assert.equal(grund(warp({ transpose_st: TRANSPOSE_MAX, detune_ct: 1 })), 'argument_ungueltig', 'MAX st + 1 ct liegt über der Grenze');
  assert.equal(grund(warp({ transpose_st: TRANSPOSE_MIN, detune_ct: 0 })), null);
  assert.equal(grund(warp({ transpose_st: TRANSPOSE_MIN, detune_ct: -1 })), 'argument_ungueltig', 'MIN st − 1 ct liegt unter der Grenze');
  assert.equal(grund(warp({ transpose_st: TRANSPOSE_MIN, detune_ct: DETUNE_MAX })), null);
  assert.equal(grund(warp({ transpose_st: TRANSPOSE_MAX, detune_ct: -DETUNE_MAX })), null, 'Detune gegen die Richtung ist erlaubt');
});
test('AK2 RE-PITCH: Transpose oder Detune ungleich 0 wird abgelehnt (transpose_repitch), 0 geht; transpose_spaeter gibt es nicht mehr', () => {
  assert.equal(grund(warp({ modus: 'repitch' })), null);
  assert.equal(grund(warp({ modus: 'repitch', transpose_st: 1 })), 'transpose_repitch');
  assert.equal(grund(warp({ modus: 'repitch', detune_ct: 5 })), 'transpose_repitch');
  assert.equal(grund(warp({ modus: 'complex', transpose_st: 2 })), null, 'Slice 2 lehnte das mit transpose_spaeter ab');
});
test('pitchFaktor: feste Werte, 2^(st/12 + ct/1200)', () => {
  assert.equal(pitchFaktor(0, 0), 1);
  assert.equal(pitchFaktor(12, 0), 2);
  assert.equal(pitchFaktor(-12, 0), 0.5);
  assert.equal(pitchFaktor(7, 0), 1.4983070768766815);
  assert.ok(Math.abs(pitchFaktor(0, 50) - 1.0293022366434921) < 1e-15);
  assert.ok(Math.abs(1000 * pitchFaktor(7, 0) - 1498.307) < 1e-3, 'AK9: 1498,31 Hz');
});
test('Übersetzer: pitch nur bei ungleich 1 in warp (Datei ohne Transpose bleibt Zeichen für Zeichen), Wert aus Transpose und Detune', () => {
  const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A ? 2_000_000 : null) };
  const projekt = (w) => { const p = kopie(specProjekt()); p.format = 'cypherdj-projekt/2'; Object.assign(p.spuren[0].clips[0], { laenge_beats: 8, warp: w }); return p; };
  const ohne = uebersetze(projekt(warp()), opt);
  assert.equal('pitch' in ohne.spuren[0].clips[0].warp, false);
  assert.deepEqual(Object.keys(ohne.spuren[0].clips[0].warp), ['modus', 'w']);
  const sieben = uebersetze(projekt(warp({ transpose_st: 7 })), opt).spuren[0].clips[0].warp;
  assert.equal(sieben.pitch, 1.4983070768766815); assert.equal(sieben.modus, 2);
  const detune = uebersetze(projekt(warp({ modus: 'tones', detune_ct: -50 })), opt).spuren[0].clips[0].warp;
  assert.ok(Math.abs(detune.pitch - 2 ** (-50 / 1200)) < 1e-15); assert.equal(detune.modus, 3);
  const summe = uebersetze(projekt(warp({ transpose_st: -3, detune_ct: 30 })), opt).spuren[0].clips[0].warp;
  assert.ok(Math.abs(summe.pitch - 2 ** (-270 / 1200)) < 1e-15);
  assert.equal(JSON.parse(JSON.stringify(sieben)).pitch, sieben.pitch, 'JSON-Rundlauf ohne Verlust');
  // Warp aus: keine Wiedergabe-Warp, also kein pitch, auch mit Transpose im Modell
  const aus = uebersetze(projekt(warp({ an: false, transpose_st: 7 })), opt);
  assert.equal(JSON.stringify(aus).includes('pitch'), false);
});
test('Befehl warp_setzen: transpose_st und detune_ct einzeln und zusammen, ein Undo-Schritt; RE-PITCH mit Nullen im selben Befehl; ohne Nullen abgelehnt', () => {
  const p = aufbau();
  const r = fuehreAus(p, { befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 7, detune_ct: -20 });
  assert.equal(clip(r.projekt).warp.transpose_st, 7); assert.equal(clip(r.projekt).warp.detune_ct, -20); assert.equal(r.betrifft_wiedergabe, true);
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'Undo stellt den Stand her');
  lehntAb(r.projekt, { befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch' }, 'transpose_repitch');   // ohne Nullen
  const rp = fuehreAus(r.projekt, { befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch', transpose_st: 0, detune_ct: 0 });
  assert.equal(clip(rp.projekt).warp.modus, 'repitch'); assert.equal(clip(rp.projekt).warp.transpose_st, 0);
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', transpose_st: TRANSPOSE_MAX + 1 }, 'argument_ungueltig');
  assert.ok(pruefeProjekt(r.projekt).projekt, 'das Projekt mit Transpose ist gültig (Laden vom Datenträger)');
  // Teilen und Duplizieren erhalten Transpose
  const t = fuehreAus(r.projekt, { befehl: 'clip_teilen', clip_id: 'c1', beat: 8 });
  assert.ok(t.projekt.spuren[0].clips.every((c) => c.warp.transpose_st === 7));
});

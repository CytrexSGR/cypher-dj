import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { naechsterRaster, abBeat, sprungDelta, rasterRunden, hotcueDatei, leseHotcues, schreibeHotcues, rasterSchritt, RASTER_MAX, rasterDatei, leseRaster, schreibeRaster, einsSetzen } from '../deck_bedienung.ts';

test('naechsterRaster: kleinstes Vielfaches ≥ b; Raster 0 = b', () => {
  assert.equal(naechsterRaster(17.2, 4), 20);
  assert.equal(naechsterRaster(20, 4), 20);
  assert.equal(naechsterRaster(17.2, 0.25), 17.25);
  assert.equal(naechsterRaster(17.2, 0), 17.2);
});

test('abBeat: jetzt + Vorlauf (mindestens 0,05), dann aufs Raster; ohne Raster nur Vorlauf', () => {
  assert.equal(abBeat(100.0, 0.01, 4), 104);
  assert.equal(abBeat(103.97, 0.05, 4), 108);
  assert.equal(abBeat(100.0, 0.01, 0), 100.05);
});

test('sprungDelta: läuft → Position bei ab_beat, Delta aufs Raster gerundet; steht → exakt', () => {
  const o = { laeuft: true, quell: 37.3, beat: 100, ab: 104, ziel: 64 };   // q_ab 41,3 → roh 22,7
  assert.equal(sprungDelta({ ...o, raster: 1 }), 23);
  assert.equal(sprungDelta({ ...o, raster: 16 }), 16);
  assert.ok(Math.abs(sprungDelta({ ...o, raster: 0 }) - 22.7) < 1e-9);
  // steht (Plan-Review E9 Befund 7): das Ziel rastet auf das Raster ab der Takt-Eins ein, Delta = Rasterstelle − Position
  assert.ok(Math.abs(sprungDelta({ ...o, laeuft: false, raster: 4, eins: 0 }) - (64 - 37.3)) < 1e-9);
  assert.ok(Math.abs(sprungDelta({ ...o, laeuft: false, raster: 4, eins: 1, ziel: 63.2 }) - (65 - 37.3)) < 1e-9);
  assert.ok(Math.abs(sprungDelta({ ...o, laeuft: false, raster: 0, ziel: 63.2 }) - (63.2 - 37.3)) < 1e-9);
});

test('rasterRunden: aufs Raster ab der Takt-Eins, bei aus auf 1 Beat (Plan-Review E9 Befund 8)', () => {
  assert.equal(rasterRunden(12.4, 1, 0), 12);
  assert.equal(rasterRunden(13.9, 4, 0), 12);
  assert.equal(rasterRunden(13.9, 4, 1), 13);     // Takt-Eins bei Quell-Beat 1: Takte bei 1, 5, 9, 13
  assert.equal(rasterRunden(12.6, 0, 3), 13);
  assert.equal(rasterRunden(12.3, 0.25, 0), 12.25);
});

test('Hotcue-Datei: Pfad je Fassung, fehlend → {}, atomar ohne Reste', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  const datei = hotcueDatei(d, { material_id: 'c1c0000000000301', basis_bpm: 128, fassung: 1 });
  assert.equal(datei, path.join(d, 'c1c0000000000301_128000_r1.json'));
  assert.deepEqual(leseHotcues(datei), {});
  schreibeHotcues(datei, { 1: { quell_beat: 12, art: 'shot' } });
  assert.deepEqual(leseHotcues(datei), { 1: { quell_beat: 12, art: 'shot' } });
  assert.deepEqual(fs.readdirSync(d), ['c1c0000000000301_128000_r1.json']);
  fs.writeFileSync(datei, '{kaputt');
  assert.deepEqual(leseHotcues(datei), {}, 'kaputte Datei → leer statt Wurf');
});

test('Review E9 F8: kaputte Hotcue-Datei wird beim Schreiben gesichert, nicht still überschrieben', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));
  const datei = hotcueDatei(d, { material_id: 'c1c0000000000301', basis_bpm: 128, fassung: 1 });
  fs.writeFileSync(datei, '{"1": {"quell_beat": 4, "art": "shot"}, kaputt');
  schreibeHotcues(datei, { 2: { quell_beat: 8, art: 'shot' } });
  const reste = fs.readdirSync(d).filter((n) => n.includes('.kaputt-'));
  assert.equal(reste.length, 1);
  assert.equal(fs.readFileSync(path.join(d, reste[0]), 'utf8'), '{"1": {"quell_beat": 4, "art": "shot"}, kaputt');
  assert.deepEqual(leseHotcues(datei), { 2: { quell_beat: 8, art: 'shot' } });
  schreibeHotcues(datei, { 3: { quell_beat: 12, art: 'shot' } });   // Negativ: heile Datei → keine weitere Sicherung
  assert.equal(fs.readdirSync(d).filter((n) => n.includes('.kaputt-')).length, 1);
});

test('Plan Grid: rasterSchritt rechnet ms in Frames (48 je ms), hält ±1 s', () => {
  assert.equal(rasterSchritt(0, 5), 240);
  assert.equal(rasterSchritt(240, -1), 192);
  assert.equal(rasterSchritt(-100, 0.5), -76);
  assert.equal(rasterSchritt(191900, 5), RASTER_MAX);
  assert.equal(rasterSchritt(-191900, -5), -RASTER_MAX);
});

test('SET (Takt-Eins am Kopf): ganze Beats in den Versatz, Eins fällt auf die ERSTE Eins im Track, Grenze ±4 s', () => {
  const fpb = 22500, erster = 3129;   // 128 BPM, Antistius
  // Andreas' Fall 2026-09-28: Kopf auf dem ersten Schlag (Quell 0), Versatz −10 ms, Eins der Analyse 2.
  // +2 Beats (44520) legte die Eins auf den 5. Schlag: erster Takt ohne Anzeige, Laden sprang dorthin. Richtig: −2.
  assert.deepEqual(einsSetzen({ v: -480, quell: 0, eins: 2, fpb, erster }), { k: -2, v: -45480 });
  // Kopf auf Quell 5: erste Eins im Track 4 Beats früher (Frame 25629 = 1,14 Beats)
  assert.deepEqual(einsSetzen({ v: 0, quell: 5, eins: 2, fpb, erster }), { k: -1, v: -22500 });
  // schon auf einer Eins: nichts
  assert.deepEqual(einsSetzen({ v: -480, quell: 6, eins: 2, fpb, erster }), { k: 0, v: -480 });
  // Kopf knapp neben dem Beat rundet auf den nächsten
  assert.deepEqual(einsSetzen({ v: 0, quell: 3.04, eins: 2, fpb, erster }), { k: 1, v: 22500 });
  assert.deepEqual(einsSetzen({ v: 480, quell: 4, eins: 2, fpb, erster }), { k: -2, v: 480 - 45000 });
  // zu langsam für ±4 s: null
  assert.equal(einsSetzen({ v: 0, quell: 3, eins: 0, fpb: 70000, erster }), null);
});

test('Plan Grid: Raster-Datei je Fassung schreiben und lesen, kaputt/fehlend/außerhalb = 0', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-raster-'));
  const f = { material_id: '1ac28792d355a38b', basis_bpm: 128, fassung: 1 };
  const datei = rasterDatei(d, f);
  assert.equal(path.basename(datei), '1ac28792d355a38b_128000_r1.json');
  assert.equal(leseRaster(datei), 0);
  schreibeRaster(datei, -192);
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), { versatz_frames: -192 });
  assert.equal(leseRaster(datei), -192);
  fs.writeFileSync(datei, '{kaputt');
  assert.equal(leseRaster(datei), 0);
  fs.writeFileSync(datei, JSON.stringify({ versatz_frames: 192001 }));
  assert.equal(leseRaster(datei), 0);
  fs.writeFileSync(datei, JSON.stringify({ versatz_frames: 1.5 }));
  assert.equal(leseRaster(datei), 0);
  assert.ok(!fs.readdirSync(d).some((n) => n.includes('.neu')));
});

// --- Fassungsübergreifend: Raster-Datei der nächstälteren Fassung (2026-10-11, Bericht grid-phase M7) ---------------

import { rasterErbe, einsNachFix, einsZeile, haengeKorrekturAn, letzteEinsZeile } from '../deck_bedienung.ts';

const FPB = 22500;   // 128 BPM bei 48 kHz
function rasterOrdnerMit(dateien) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-erbe-'));
  for (const [name, v] of Object.entries(dateien)) fs.writeFileSync(path.join(d, name), typeof v === 'string' ? v : JSON.stringify({ versatz_frames: v }));
  return d;
}
const M = '929d8039c3732eed';
const fass = (r, bpm = 128) => ({ material_id: M, basis_bpm: bpm, fassung: r });

test('rasterErbe FEHLERFALL: r2 ohne Datei übernimmt die Korrektur von r1 (vorher 0, Andreas musste wieder um 2 Beats korrigieren)', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480 });
  assert.equal(leseRaster(rasterDatei(d, fass(2))), 0);                                    // alter Weg: verloren
  const e = rasterErbe(d, fass(2), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB });
  assert.deepEqual(e, { v: -45480, von: 1 });                                              // ganze Beats UND Feinversatz
});

test('rasterErbe: eigene Datei der geladenen Fassung geht vor, Erbe nur bei fehlender Datei (Negativ-Kontrolle)', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480, [`${M}_128000_r2.json`]: 0 });
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: 0, von: null });   // 0 gespeichert heißt: 0
});

test('rasterErbe: die nächstältere Fassung zählt, nicht die älteste und nie eine neuere', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480, [`${M}_128000_r3.json`]: 120, [`${M}_128000_r5.json`]: 999 });
  assert.deepEqual(rasterErbe(d, fass(4), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: 120, von: 3 });
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: -45480, von: 1 });
  assert.deepEqual(rasterErbe(d, fass(1), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: -45480, von: null });   // r1 hat eine eigene Datei
});

test('rasterErbe: andere Basis oder anderes Material erben nicht', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480, [`ffffffffffffffff_130000_r1.json`]: 77 });
  assert.deepEqual(rasterErbe(d, fass(2, 130), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: 0, von: null });
  assert.deepEqual(rasterErbe(d, { material_id: 'aaaaaaaaaaaaaaaa', basis_bpm: 128, fassung: 2 }, { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: 0, von: null });
});

test('rasterErbe: kaputte ältere Datei wird übersprungen, die davor gilt', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45000, [`${M}_128000_r2.json`]: '{kaputt' });
  assert.deepEqual(rasterErbe(d, fass(3), { einsVon: () => ({ eins: 2, esf: 0 }), fpb: FPB }), { v: -45000, von: 1 });
});

test('rasterErbe: nicht doppelt – hat die neue Fassung die Eins schon eingebaut (3 → 1, K −2), bleibt nur der Feinversatz', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480 });
  const einsVon = (r) => ({ eins: r === 1 ? 3 : 1, esf: 0 });
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon, fpb: FPB }), { v: -480, von: 1 });
  // Negativ-Kontrolle: Eins unverändert → nichts abgezogen
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: () => ({ eins: 3, esf: 0 }), fpb: FPB }), { v: -45480, von: 1 });
  // Eins unbekannt (fassung.json fehlt): nichts abgezogen
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: () => null, fpb: FPB }), { v: -45480, von: 1 });
});

test('rasterErbe: Ergebnis über RASTER_MAX wird nicht vererbt', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: RASTER_MAX });
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: (r) => ({ eins: 2, esf: r === 1 ? 1000 : 0 }), fpb: FPB }), { v: 0, von: null });   // RASTER_MAX + 1000 Frames
});

test('einsNachFix: ganze Beats im Versatz sind die neue Eins (580de: Eins 3, −2 Beats → 1)', () => {
  assert.equal(einsNachFix({ v: -45000, fpb: FPB, eins: 3, letzte: null }), 1);
  assert.equal(einsNachFix({ v: -45480, fpb: FPB, eins: 2, letzte: null }), 0);            // 929d/bfdd: −2 Beat −10 ms
  assert.equal(einsNachFix({ v: 45000, fpb: FPB, eins: 2, letzte: null }), 0);
  assert.equal(einsNachFix({ v: -22500, fpb: FPB, eins: 0, letzte: null }), 3);
});

test('einsNachFix NEGATIV: Feinversatz allein, volle Takte, schon geschriebene Zeile → nichts zu schreiben', () => {
  assert.equal(einsNachFix({ v: 480, fpb: FPB, eins: 2, letzte: null }), null);            // 10 ms
  assert.equal(einsNachFix({ v: -10000, fpb: FPB, eins: 2, letzte: null }), null);         // < ½ Beat
  assert.equal(einsNachFix({ v: -90000, fpb: FPB, eins: 2, letzte: null }), null);         // −4 Beats = Eins mod 4 gleich
  assert.equal(einsNachFix({ v: -45000, fpb: FPB, eins: 3, letzte: 1 }), null);            // dieselbe Zeile steht schon
});

test('einsNachFix: zurückgenommene Korrektur überschreibt die offene Zeile', () => {
  assert.equal(einsNachFix({ v: 0, fpb: FPB, eins: 3, letzte: 1 }), 3);
});

test('einsZeile + haengeKorrekturAn: gültige Zeile (Schema korrektur), append-only, letzteEinsZeile liest sie zurück', () => {
  const mo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-korr-'));
  assert.equal(letzteEinsZeile(mo), null);                                                  // keine Datei
  fs.writeFileSync(path.join(mo, 'korrekturen.jsonl'), '{"zeit":"2026-10-09T21:49:38","von":"werkstatt","art":"raster","fassung":"128000_r1","ab_quell_beat":-1000000.0,"bis_quell_beat":1000571.0,"versatz_ms":-6.75,"nr":null,"text":"x"}\n');
  assert.equal(letzteEinsZeile(mo), null);                                                  // nur eine Raster-Zeile
  const z = einsZeile(fass(1), 1, -2, 'FIX', new Date('2026-10-11T03:04:05Z'));
  assert.deepEqual(z, { zeit: '2026-10-11T03:04:05', von: 'andreas', art: 'eins', fassung: '128000_r1', ab_quell_beat: 1,
    bis_quell_beat: null, versatz_ms: null, nr: null, text: 'FIX: Eins um −2 Beats gesetzt, Lage 1' });
  haengeKorrekturAn(mo, z);
  const zeilen = fs.readFileSync(path.join(mo, 'korrekturen.jsonl'), 'utf8').trimEnd().split('\n');
  assert.equal(zeilen.length, 2);
  assert.equal(letzteEinsZeile(mo), 1);
});

// --- Review B1/B3 (2026-10-11): Verschiebung des ersten Schlags, Eins-Abzug nur aus dieser Raster-Korrektur -------------------

const lage = (esf, v, eins) => esf + v + eins * FPB;   // absolute Lage der Eins im Audio (Frames)

test('rasterErbe B1 FEHLERFALL 929d: r2 hat den ersten Schlag um −324 Frames verschoben (Auto-Phase), Andreas’ Lage bleibt exakt', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480 });
  const einsVon = (r) => (r === 1 ? { eins: 2, esf: 3129 } : { eins: 2, esf: 2805 });
  const e = rasterErbe(d, fass(2), { einsVon, fpb: FPB });
  assert.deepEqual(e, { v: -45156, von: 1 });                                               // vorher −45480 = 6,75 ms daneben
  assert.equal(lage(2805, e.v, 2), lage(3129, -45480, 2));                                  // Abstand 0 Frames
});

test('rasterErbe B1 FEHLERFALL 9b44: esf 2483 → 1975, Andreas’ −384 wird +124 (vorher 10,58 ms daneben)', () => {
  const N = '9b444bee7d0805b8';
  const d = rasterOrdnerMit({ [`${N}_128000_r1.json`]: -384 });
  const einsVon = (r) => ({ eins: 0, esf: r === 1 ? 2483 : 1975 });
  const e = rasterErbe(d, { material_id: N, basis_bpm: 128, fassung: 2 }, { einsVon, fpb: FPB });
  assert.deepEqual(e, { v: 124, von: 1 });
  assert.equal(lage(1975, e.v, 0), lage(2483, -384, 0));
});

test('rasterErbe B1 NEGATIV: gleicher erster Schlag und gleiche Eins → Wert unverändert (580de, 6b09, bfdd)', () => {
  for (const [v, eins, esf] of [[-45000, 3, 0], [-720, 2, 2677], [-45480, 2, 2933]]) {
    const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: v });
    assert.deepEqual(rasterErbe(d, fass(2), { einsVon: () => ({ eins, esf }), fpb: FPB }), { v, von: 1 });
  }
});

test('rasterErbe B3: Werkstatt-Eins 2 → 0 bei reinem Feinversatz −720 wird NICHT zurückgedreht', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -720 });
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: (r) => ({ eins: r === 1 ? 2 : 0, esf: 0 }), fpb: FPB }), { v: -720, von: 1 });
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: (r) => ({ eins: r === 1 ? 0 : 2, esf: 0 }), fpb: FPB }), { v: -720, von: 1 });
});

test('rasterErbe B3: ganze Beats im Versatz, aber die neue Eins passt nicht dazu (anderer Ursprung) → kein Abzug', () => {
  const d = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480 });   // K −2: 2 → 0 wäre passend, 2 → 1 nicht
  assert.deepEqual(rasterErbe(d, fass(2), { einsVon: (r) => ({ eins: r === 1 ? 2 : 1, esf: 0 }), fpb: FPB }), { v: -45480, von: 1 });
});

// --- Hotcues erben (2026-10-11): quell_beat ist Beat der Karte, Frame = erster_schlag_frame + Versatz + quell_beat·fpb (kern deck.h:325) ---

import { hotcuesErbe } from '../deck_bedienung.ts';

function hotOrdnerMit(dateien) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hoterbe-'));
  for (const [name, v] of Object.entries(dateien)) fs.writeFileSync(path.join(d, name), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
}
// Fassungsdaten je r: { eins, esf }; Raster-Ordner wie in der Seite (rasterErbe liefert den wirksamen Versatz je Fassung)
function erbeMit(hot, raster, fassungen, f) {
  const einsVon = (r) => fassungen[r] ?? null;
  return hotcuesErbe(hot, f, { fpb: FPB, esf: (r) => fassungen[r]?.esf ?? null,
    rasterV: (r) => rasterErbe(raster, { ...f, fassung: r }, { einsVon, fpb: FPB }).v });
}
const HOT1 = { 1: { quell_beat: 246, art: 'shot' }, 2: { quell_beat: 184, art: 'loop', laenge: 4 } };

test('hotcuesErbe: erster Schlag verschoben (esf −324), kein Raster: gleiche Audio-Stelle = +324/fpb Beat', () => {
  const h = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1 });
  const e = erbeMit(h, rasterOrdnerMit({}), { 1: { eins: 2, esf: 3129 }, 2: { eins: 2, esf: 2805 } }, fass(2));
  assert.equal(e.von, 1);
  assert.equal(e.hotcues[1].quell_beat, 246.0144); assert.equal(e.hotcues[1].art, 'shot');
  assert.deepEqual(e.hotcues[2], { quell_beat: 184.0144, art: 'loop', laenge: 4 });
  // Frame im Audio bleibt: 3129 + 246·fpb = 2805 + 246.0144·fpb
  assert.ok(Math.abs((3129 + 246 * FPB) - (2805 + 246.0144 * FPB)) < 1);
});

test('hotcuesErbe: mit geerbtem Raster bleibt der Anker (esf+v) gleich, quell_beat unverändert (929d)', () => {
  const h = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1 });
  const r = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480 });
  const e = erbeMit(h, r, { 1: { eins: 2, esf: 3129 }, 2: { eins: 2, esf: 2805 } }, fass(2));
  assert.equal(e.hotcues[1].quell_beat, 246);
});

test('hotcuesErbe: Eins in die neue Fassung eingebaut (2 → 0, Raster −2 Beats): Hotcue wandert −2 Beats mit, 246 → 244', () => {
  const h = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1 });
  const r = rasterOrdnerMit({ [`${M}_128000_r1.json`]: -45480 });
  const e = erbeMit(h, r, { 1: { eins: 2, esf: 3129 }, 2: { eins: 0, esf: 3129 } }, fass(2));
  assert.equal(e.hotcues[1].quell_beat, 244); assert.equal(e.hotcues[2].quell_beat, 182);
});

test('hotcuesErbe NEGATIV: gleicher Anker und gleiche Eins → unverändert; eigene Hotcues der neuen Fassung werden nie überschrieben', () => {
  const eigene = { 3: { quell_beat: 10, art: 'shot' } };
  const h = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1, [`${M}_128000_r2.json`]: eigene });
  const fa = { 1: { eins: 2, esf: 3129 }, 2: { eins: 2, esf: 2805 } };
  assert.deepEqual(erbeMit(h, rasterOrdnerMit({}), fa, fass(2)), { hotcues: eigene, von: null });
  // auch eine absichtlich leere Datei (alle gelöscht) ist eigen
  const h2 = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1, [`${M}_128000_r2.json`]: {} });
  assert.deepEqual(erbeMit(h2, rasterOrdnerMit({}), fa, fass(2)), { hotcues: {}, von: null });
  const h3 = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1 });
  assert.equal(erbeMit(h3, rasterOrdnerMit({}), { 1: { eins: 2, esf: 5 }, 2: { eins: 2, esf: 5 } }, fass(2)).hotcues[1].quell_beat, 246);
});

test('hotcuesErbe: Lücke r1 → r3 (r2 ohne Datei) erbt von r1, mit Verschiebung r1 → r3; ist r2 da, gilt r2', () => {
  const fa = { 1: { eins: 2, esf: 3000 }, 2: { eins: 2, esf: 2900 }, 3: { eins: 2, esf: 2700 } };
  const h = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1 });
  const e = erbeMit(h, rasterOrdnerMit({}), fa, fass(3));
  assert.equal(e.von, 1); assert.equal(e.hotcues[1].quell_beat, Math.round((246 + 300 / FPB) * 1e4) / 1e4);
  const h2 = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1, [`${M}_128000_r2.json`]: { 1: { quell_beat: 50, art: 'shot' } } });
  const e2 = erbeMit(h2, rasterOrdnerMit({}), fa, fass(3));
  assert.equal(e2.von, 2); assert.equal(e2.hotcues[1].quell_beat, Math.round((50 + 200 / FPB) * 1e4) / 1e4);
});

test('hotcuesErbe: nirgends Hotcues → leer; andere Basis, anderes Material, neuere Fassung erben nicht', () => {
  const fa = { 1: { eins: 2, esf: 1 }, 2: { eins: 2, esf: 1 } };
  assert.deepEqual(erbeMit(hotOrdnerMit({}), rasterOrdnerMit({}), fa, fass(2)), { hotcues: {}, von: null });
  const h = hotOrdnerMit({ [`${M}_130000_r1.json`]: HOT1, [`ffffffffffffffff_128000_r1.json`]: HOT1, [`${M}_128000_r3.json`]: HOT1 });
  assert.deepEqual(erbeMit(h, rasterOrdnerMit({}), fa, fass(2)), { hotcues: {}, von: null });
});

test('hotcuesErbe: kaputte ältere Datei wird übersprungen; fehlt eine esf, bleibt die Stelle unverschoben', () => {
  const h = hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1, [`${M}_128000_r2.json`]: '{kaputt' });
  const e = erbeMit(h, rasterOrdnerMit({}), { 1: { eins: 2, esf: 1 }, 3: { eins: 2, esf: 1 } }, fass(3));
  assert.equal(e.von, 1);
  const e2 = erbeMit(hotOrdnerMit({ [`${M}_128000_r1.json`]: HOT1 }), rasterOrdnerMit({}), {}, fass(2));
  assert.equal(e2.hotcues[1].quell_beat, 246);
});

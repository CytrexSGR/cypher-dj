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

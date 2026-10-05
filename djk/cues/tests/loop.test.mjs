// Loops (Andreas, 2026-09-26: "neue loop mit 4 oder 8 takten"): Länge, Ende-Sekunde/-Takt (raster.js), Schema-Rundlauf
// mit laenge_takte -> ende_s/ende_takt (speicher.ts), Traktor-Loop-Rundung auf die nächste Zweierpotenz.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { loopLaengeS, loopEndeS, loopFelder, naechsteLoopLaenge, LAENGEN_TAKTE, taktSchlag } from '../oeffentlich/raster.js';
import { speichere, lade, EingabeFehler } from '../speicher.ts';
import { mp3, tmpOrdner } from './hilfen.mjs';

const R = { bpm: 120, eins_s: 0.5 }; // Takt 2 s
const nahe = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('Loop-Länge und -Ende: 4 Takte bei 120 BPM = 8 s, Ende landet auf einer Takt-Eins', () => {
  nahe(loopLaengeS(R, 4), 8);
  nahe(loopEndeS(R, 0.5, 4), 8.5);
  const f = loopFelder(R, 0.5, 4);
  nahe(f.ende_s, 8.5);
  assert.equal(f.ende_takt, 5); // Takt 1 bei 0,5 s, Takt 5 vier Takte weiter
  assert.deepEqual([taktSchlag(R, f.ende_s).takt, taktSchlag(R, f.ende_s).schlag], [5, 1]);
});

test('naechsteLoopLaenge: rundet im log2-Raum (3 -> 4, 6 -> 8 (näher an log2 8 als log2 4), 24 -> 32, 0.6 -> 1)', () => {
  assert.equal(naechsteLoopLaenge(3), 4);
  assert.equal(naechsteLoopLaenge(6), 8);
  assert.equal(naechsteLoopLaenge(24), 32);
  assert.equal(naechsteLoopLaenge(0.6), 1);
  assert.deepEqual(LAENGEN_TAKTE, [1, 2, 4, 8, 16, 32]);
});

function aufbau(t) {
  const d = tmpOrdner(t);
  const wurzel = path.join(d, 'musik');
  const daten = path.join(d, 'daten');
  const rel = path.join('ordner', 'Loop_Track.mp3');
  mp3(path.join(wurzel, rel), { f: 100, dauer: 70, meta: { title: 'Loop', TBPM: '120', TKEY: '8A' } });
  return { daten, wurzel, rel };
}
const META = { titel: 'Loop', artist: null, tbpm: 120, tkey: '8A' };

test('Speichern eines Loop-Cues: laenge_takte -> ende_s/ende_takt aus dem Raster, Rundlauf gleich', (t) => {
  const { wurzel, daten, rel } = aufbau(t);
  const e = { raster: { bpm: 120, eins_s: 0.5, quelle: 'andreas' }, cues: [
    { slot: 1, s: 4.5, name: 'loop 4', farbe: '#2fd6c3', quantisiert: true, laenge_takte: 4 },
  ] };
  const d = speichere(daten, wurzel, rel, META, e, 70);
  const zurueck = lade(daten, rel);
  assert.deepEqual(zurueck, d);
  const c = d.cues[0];
  assert.equal(c.laenge_takte, 4);
  nahe(c.ende_s, 4.5 + 8, 1e-6);
  assert.equal(c.ende_takt, taktSchlag({ bpm: 120, eins_s: 0.5 }, c.ende_s).takt);
});

test('Fehlerfall: ungültige laenge_takte wirft EingabeFehler, Datei unverändert', (t) => {
  const { wurzel, daten, rel } = aufbau(t);
  const gut = { raster: { bpm: 120, eins_s: 0.5, quelle: 'andreas' }, cues: [{ slot: 1, s: 1, laenge_takte: 4 }] };
  speichere(daten, wurzel, rel, META, gut, 70);
  const dateiPfad = path.join(daten, fs.readdirSync(daten)[0]);
  const vorher = fs.readFileSync(dateiPfad, 'utf8');
  assert.throws(() => speichere(daten, wurzel, rel, META, { raster: gut.raster, cues: [{ slot: 1, s: 1, laenge_takte: 3 }] }, 70), EingabeFehler);
  assert.throws(() => speichere(daten, wurzel, rel, META, { raster: gut.raster, cues: [{ slot: 1, s: 1, laenge_takte: 0 }] }, 70), EingabeFehler);
  assert.equal(fs.readFileSync(dateiPfad, 'utf8'), vorher);
});

test('Negativ-Kontrolle: Cue ohne laenge_takte bleibt ein normaler Hotcue (kein ende_s/ende_takt)', (t) => {
  const { wurzel, daten, rel } = aufbau(t);
  const d = speichere(daten, wurzel, rel, META, { raster: { bpm: 120, eins_s: 0.5, quelle: 'andreas' }, cues: [{ slot: 2, s: 3, name: '' }] }, 70);
  assert.equal(d.cues[0].laenge_takte, undefined);
  assert.equal(d.cues[0].ende_s, undefined);
});

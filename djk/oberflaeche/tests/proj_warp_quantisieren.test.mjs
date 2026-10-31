// Slice 4, T12 (Sitzung): audio_quantisieren setzt je Transient einen Hand-Marker auf das Raster; ein Undo-Schritt; Gründe; Grenzen lehnen ab statt zu kürzen
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { schreibeWav } from '../pruef/w1_wav.mjs';
import { fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';

const SR = 48000;
function burstWav(pfad, stellen, dauer) {   // Stereo, Rausch-Bursts an bekannten Stellen (Sekunden)
  let x = 7; const z = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 31 - 1; };
  const n = Math.round(dauer * SR), d = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const v = z() * 1e-4; d[2 * i] = v; d[2 * i + 1] = v; }
  for (const s of stellen) for (let j = 0; j < 0.03 * SR; j++) { const v = z() * 0.8 * Math.exp(-j / (0.003 * SR)); const i = Math.round(s * SR) + j; d[2 * i] += v; d[2 * i + 1] += v; }
  schreibeWav(pfad, d, 2, SR);
  return pfad;
}
const STELLEN = [0.5, 1.0, 2.0, 3.0];
const DICHT = [0.2615, 0.3615, 1.0];              // bei 13 Beats je Sekunde: Beat 3,4 und 4,7; auf Raster 1 rücken sie auf 3 und 5
function aufbau(t) {
  // liefert { s, arr }
  const d = tmpOrdner(t, 'djk-quant-');
  fs.mkdirSync(path.join(d, 'daten'), { recursive: true });
  const w1 = burstWav(path.join(d, 'daten', 'drums.wav'), STELLEN, 3.84);
  const w2 = burstWav(path.join(d, 'daten', 'dicht.wav'), DICHT, 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 1, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w1 },
    { n: 2, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w2 },
  ]);
  return sitzung(t, { katalog });
}
const aendern = (s, befehle) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'T', befehle }, 'andreas');
const fehlerVon = async (p) => { try { await p; } catch (e) { return { fehler: e.fehler ?? e.grund, e }; } return null; };
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;
const marker = (s, id = 'c1') => clips(s).find((c) => c.id === id).warp.marker;
const lage = (s, id = 'c1') => s.warpLage(id, null, null, null).j.warp;
const eintraege = (s) => s.verlaufListe().j.length;
const q = (extra = {}) => ({ befehl: 'audio_quantisieren', clip_id: 'c1', raster: '1/16', ...extra });

const ARR = new WeakMap();                         // Sitzung → Arbeitsordner (für das Löschen der Dekodier-Dateien)
async function offen(t, n = 1, clipExtra = {}) {
  const { s, arr } = aufbau(t);
  ARR.set(s, arr);
  await s.neu('Q', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(n), warp: 'auto', ...clipExtra }]);
  return s;
}
const dekodiert = (s, id = 'c1') => warteBis(() => clips(s).find((c) => c.id === id).dekodiert === 'fertig', 15000);

test('Stärke 1: je Transient ein Marker auf einem 1/16, quelle hand; Undo stellt die Marker exakt her; Stärke 0,5 halbiert den Weg', async (t) => {
  const s = await offen(t);
  const vorher = structuredClone(marker(s));
  assert.ok(await dekodiert(s));
  const tr = lage(s).transienten;
  assert.equal(tr.length, 4);
  const n0 = eintraege(s);
  const b = (m, sek) => { const i = m.findIndex((p) => Math.abs(p[0] - sek) < 1e-9); return i < 0 ? null : m[i][1]; };
  const r = await aendern(s, [q()]);
  assert.equal(r.code, 200);
  const m = marker(s);
  for (const sek of tr) { const beat = b(m, sek); assert.ok(beat !== null, `Marker an ${sek}`); assert.ok(Math.abs(beat / 0.25 - Math.round(beat / 0.25)) < 1e-9, `Beat ${beat} auf 1/16`); }
  assert.equal(clips(s)[0].warp.quelle, 'hand');
  assert.equal(clips(s)[0].laenge_beats, 8, 'die Länge bleibt');
  assert.equal(eintraege(s), n0 + 1, 'ein Verlaufseintrag');
  await s.umkehr('undo', { rev: s.aktuell().j.projekt.rev }, 'andreas');
  assert.deepEqual(marker(s), vorher, 'ein Undo stellt die Marker exakt her');
  // Stärke 0,5: genau halber Weg zum Raster (Negativkontrolle zu Stärke 1)
  const roh = tr.map((sek) => { const mm = marker(s); const lo = mm[0], hi = mm[mm.length - 1]; return lo[1] + (sek - lo[0]) * (hi[1] - lo[1]) / (hi[0] - lo[0]); });
  await aendern(s, [q({ staerke: 0.5 })]);
  const m5 = marker(s);
  tr.forEach((sek, i) => { const z = Math.round(roh[i] / 0.25) * 0.25; assert.ok(Math.abs(b(m5, sek) - (roh[i] + 0.5 * (z - roh[i]))) < 1e-9, `Transient ${i} auf halbem Weg`); });
});

test('Gründe: keine_transienten (leeres Fenster), argument_ungueltig (Raster, Stärke, Fenster)', async (t) => {
  const s = await offen(t);
  assert.ok(await dekodiert(s));
  const stand = JSON.stringify(marker(s));
  assert.equal((await fehlerVon(aendern(s, [q({ raster: '1/3' })])))?.fehler, 'argument_ungueltig');
  assert.equal((await fehlerVon(aendern(s, [q({ staerke: 1.5 })])))?.fehler, 'argument_ungueltig');
  assert.equal((await fehlerVon(aendern(s, [q({ von_beat: 'x' })])))?.fehler, 'argument_ungueltig');
  assert.equal((await fehlerVon(aendern(s, [q({ unbekannt: 1 })])))?.fehler, 'argument_unbekannt');
  for (const k of ['von_beat', 'bis_beat']) {
    assert.equal((await fehlerVon(aendern(s, [q({ [k]: 1e12 })])))?.fehler, 'argument_ungueltig', `${k} über MAX_BEAT`);
    assert.equal((await fehlerVon(aendern(s, [q({ [k]: -1e12 })])))?.fehler, 'argument_ungueltig', `${k} unter −MAX_BEAT`);
  }
  assert.equal((await fehlerVon(aendern(s, [q({ von_beat: 6.9, bis_beat: 7 })])))?.fehler, 'keine_transienten', 'ein Fenster ohne Transient');
  assert.equal(JSON.stringify(marker(s)), stand, 'keine Ablehnung ändert etwas');
  // Negativkontrolle: ein Fenster MIT Transient geht
  assert.equal((await aendern(s, [q({ von_beat: 0, bis_beat: 2.5 })])).code, 200);
});

test('transienten_fehlen: ohne die Dekodier-Dateien kennt der Server die Transienten nicht (deterministisch, ohne Zeitabhängigkeit)', async (t) => {
  const s = await offen(t);
  assert.ok(await dekodiert(s));
  // deterministisch: die Dekodier-Dateien weg (.f32 und .transienten.json), dann kennt der Server die Transienten nicht
  const audio = path.join(ARR.get(s), 'audio');
  const weg = fs.readdirSync(audio).filter((n) => n.endsWith('.f32') || n.endsWith('.transienten.json'));
  assert.ok(weg.length >= 1, `Dekodier-Dateien gefunden: ${weg}`);
  for (const n of weg) fs.rmSync(path.join(audio, n));
  const stand = JSON.stringify(marker(s));
  assert.equal((await fehlerVon(aendern(s, [q()])))?.fehler, 'transienten_fehlen', 'ohne Dekodier-Dateien');
  assert.equal(JSON.stringify(marker(s)), stand);
});

test('Grenzverletzung: ein Segment über 800 BPM lehnt ab (warp_faktor), die Marker werden nicht gekürzt', async (t) => {
  const s = await offen(t, 2);
  assert.ok(await dekodiert(s));
  const e0 = await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: { an: true, modus: 'repitch', marker: [[0, 0], [3.84, 49.92]], versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 } }]);
  assert.equal(e0.code, 200, '780 BPM sind erlaubt');
  const stand = JSON.stringify(marker(s)), n0 = eintraege(s);
  const f = await fehlerVon(aendern(s, [q({ raster: '1/4' })]));
  assert.equal(f?.fehler, 'warp_faktor', `Grund: ${f?.fehler}`);
  assert.equal(JSON.stringify(marker(s)), stand, 'unverändert, nichts gekürzt');
  assert.equal(eintraege(s), n0, 'kein Verlaufseintrag');
});

test('Konflikt mit einem stehenbleibenden Marker lehnt mit quantisieren_konflikt ab (nie still verwerfen)', async (t) => {
  const s = await offen(t);
  assert.ok(await dekodiert(s));
  assert.ok(Math.abs(lage(s).transienten[2] - 2.0) < 0.004);
  // Transient bei 2,0 s liegt auf Beat 4,159 und wird auf 4,25 gezogen; der Marker [2,01; 4,18] steht dahinter in der Zeit, aber davor im Beat
  const warp = (marker) => ({ befehl: 'warp_setzen', clip_id: 'c1', warp: { an: true, modus: 'repitch', marker, versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 } });
  await aendern(s, [warp([[0, 0], [2.01, 4.18], [3.84, 8]])]);
  const stand = JSON.stringify(marker(s)), n0 = eintraege(s);
  const f = await fehlerVon(aendern(s, [q({ raster: '1/16', von_beat: 4, bis_beat: 4.17 })]));
  assert.equal(f?.fehler, 'quantisieren_konflikt', `Grund: ${f?.fehler}`);
  assert.equal(JSON.stringify(marker(s)), stand, 'unverändert');
  assert.equal(eintraege(s), n0, 'kein Verlaufseintrag');
  // Negativkontrolle: Stärke 0 setzt denselben Transienten ohne Verschiebung, die Reihenfolge hält
  assert.equal((await aendern(s, [q({ raster: '1/16', von_beat: 4, bis_beat: 4.17, staerke: 0 })])).code, 200);
});

test('ohne Server (fuehreListeAus direkt): argument_ungueltig, braucht den Server', async (t) => {
  const s = await offen(t);
  const p = s.aktuell().j.projekt;
  assert.throws(() => fuehreListeAus(p, [q()]), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig' && /Server/.test(e.message));
});

// ---- Fix-Runde: Raster im Projekt (D13), Bereich des Clips, Raster-Abbildung, Modus/Versatz bleiben, Loop ----
const imRaster = (beat, r) => Math.abs(beat / r - Math.round(beat / r)) < 1e-9;
test('D13: start_beat 0,1 und versatz_beats 0,3: die Treffer landen im Projekt auf Vielfachen des Rasters; Negativkontrolle off = 0', async (t) => {
  const s = await offen(t, 1, { start_beat: 0.1 });
  assert.ok(await dekodiert(s));
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 0.3 }]);
  const c = clips(s)[0], off = c.start_beat - c.warp.versatz_beats;
  assert.ok(Math.abs(off - -0.2) < 1e-9, `off ${off}`);
  const tr = lage(s).transienten;
  await aendern(s, [q()]);
  const m = marker(s);
  for (const sek of tr) {
    const p = m.find((x) => Math.abs(x[0] - sek) < 1e-9);
    assert.ok(p, `Marker an ${sek}`);
    assert.ok(imRaster(p[1] + off, 0.25), `Projekt-Beat ${p[1] + off} auf 1/16`);
  }
  assert.ok(tr.some((sek) => !imRaster(m.find((x) => Math.abs(x[0] - sek) < 1e-9)[1], 0.25)), 'und in Clip-Beats liegt mindestens einer daneben (sonst prüft der Test nichts)');
});
test('Standardbereich = der Bereich des Clips: ein Treffer vor dem ersten Marker wird quantisiert; ein Loop-Clip nimmt nur die erste Kopie', async (t) => {
  const s = await offen(t);
  assert.ok(await dekodiert(s));
  const tr = lage(s).transienten;
  // erster Marker hinter dem ersten Treffer (0,5 s): der Treffer liegt links davon
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: { an: true, modus: 'repitch', marker: [[0.9, 2], [3.84, 8]], versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 } }]);
  await aendern(s, [q()]);
  const p = marker(s).find((x) => Math.abs(x[0] - tr[0]) < 1e-9);
  assert.ok(p && imRaster(p[1], 0.25), `Treffer vor dem ersten Marker: ${JSON.stringify(p)}`);
});
test('Loop-Clip: der Standardbereich endet nach loop_beats (nur die erste Kopie)', async (t) => {
  const s = await offen(t);
  assert.ok(await dekodiert(s));
  const tr = lage(s).transienten;                      // 0,5 1,0 2,0 3,0 s = Beat 1,04 2,08 4,17 6,25 bei 125 BPM
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 4 }]);
  await aendern(s, [q()]);
  const m = marker(s);
  assert.ok(m.some((x) => Math.abs(x[0] - tr[1]) < 1e-9), 'Treffer in der ersten Kopie');
  assert.ok(!m.some((x) => Math.abs(x[0] - tr[2]) < 1e-9) && !m.some((x) => Math.abs(x[0] - tr[3]) < 1e-9), 'Treffer dahinter bleiben');
});
test('Raster 1/4, 1/8, 1/16, 1/32 werden richtig abgebildet (1, 0,5, 0,25, 0,125 Beat)', async (t) => {
  for (const [name, r] of [['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125]]) {
    const s = await offen(t);
    assert.ok(await dekodiert(s));
    const tr = lage(s).transienten, m0 = marker(s), bei = (sek) => (sek - m0[0][0]) * (m0[1][1] - m0[0][1]) / (m0[1][0] - m0[0][0]) + m0[0][1];
    await aendern(s, [q({ raster: name })]);
    const m = marker(s);
    for (const sek of tr) assert.ok(Math.abs(m.find((x) => Math.abs(x[0] - sek) < 1e-9)[1] - Math.round(bei(sek) / r) * r) < 1e-9, `${name}: ${sek}`);
  }
});
test('Quantize eines BEATS-Clips behält Modus, beats-Parameter und versatz_beats', async (t) => {
  const s = await offen(t);
  assert.ok(await dekodiert(s));
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'beats', beats: { raster: '1/8', loop: 'vor_zurueck', huelle: 60 } }, { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 0.5 }]);
  const vor = clips(s)[0].warp;
  assert.equal(vor.versatz_beats, 0.5);
  await aendern(s, [q()]);
  const nach = clips(s)[0].warp;
  assert.deepEqual([nach.modus, nach.versatz_beats, nach.quelle], ['beats', 0.5, 'hand']);
  assert.deepEqual(nach.beats, vor.beats);
  assert.deepEqual([nach.transpose_st, nach.detune_ct, nach.an], [vor.transpose_st, vor.detune_ct, vor.an]);
});

// Schlussrunde Punkt 4 (Mutation M4: der Standard von_beat = versatz_beats durch −1e9 ersetzt blieb grün): ein Treffer vor dem Versatz des Clips gehört nicht zum Standardbereich
test('Standardbereich beginnt am versatz_beats: Treffer davor werden nicht quantisiert (mit von_beat 0 schon, Negativkontrolle)', async (t) => {
  const neuMitVersatz = async () => {
    const s = await offen(t);
    assert.ok(await dekodiert(s));
    await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 3 }]);   // Bereich ab Beat 3 = Quellsekunde 1,44: bleiben 2,0 s und 3,0 s
    return s;
  };
  const hat = (m, sek) => m.some((p) => Math.abs(p[0] - sek) < 0.005);   // Treffer liegen auf ein paar Frames genau (Detektor)
  const s = await neuMitVersatz();
  assert.deepEqual(lage(s).transienten.map((x) => Math.round(x * 10)), [20, 30], 'Voraussetzung: im Bereich liegen nur die Schläge bei 2,0 und 3,0 s');
  await aendern(s, [q()]);
  const m = marker(s);
  assert.ok(hat(m, 2.0) && hat(m, 3.0), 'die Treffer im Bereich sind quantisiert');
  assert.ok(!hat(m, 0.5) && !hat(m, 1.0), 'die Treffer vor dem Versatz nicht');
  const s2 = await neuMitVersatz();
  await aendern(s2, [q({ von_beat: 0 })]);
  assert.ok(hat(marker(s2), 0.5) && hat(marker(s2), 1.0), 'Negativkontrolle: mit ausdrücklichem von_beat 0 sind sie dabei, der Test sieht den Unterschied');
});

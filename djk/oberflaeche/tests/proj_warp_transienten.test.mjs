// Slice 4, T9 (Sitzung): proj_warp trägt die Transienten der Quelle; ein BEATS-Clip nach Transienten schreibt je Transient eine Einheit (live und im Export gleich)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { schreibeWav } from '../pruef/w1_wav.mjs';

const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));
const SR = 48000, STELLEN_S = [0.5, 1.0, 2.0, 3.0];
function burstWav(pfad) {   // 3,84 s Stereo, Rausch-Bursts an bekannten Stellen
  let x = 7; const z = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 31 - 1; };
  const n = Math.round(3.84 * SR), d = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const v = z() * 1e-4; d[2 * i] = v; d[2 * i + 1] = v; }
  for (const s of STELLEN_S) for (let j = 0; j < 0.03 * SR; j++) { const v = z() * 0.8 * Math.exp(-j / (0.003 * SR)); const i = Math.round(s * SR) + j; d[2 * i] += v; d[2 * i + 1] += v; }
  schreibeWav(pfad, d, 2, SR);
  return pfad;
}
function aufbau(t) {
  const d = tmpOrdner(t, 'djk-trans-');
  fs.mkdirSync(path.join(d, 'daten'), { recursive: true });
  const w = burstWav(path.join(d, 'daten', 'drums.wav'));
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w }]);
  return sitzung(t, { katalog });
}
const aendern = (s, befehle) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'T', befehle }, 'andreas');
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;
const beats = (raster) => ({ befehl: 'warp_setzen', clip_id: 'c1', modus: 'beats', beats: { raster, loop: 'vor', huelle: 100 } });
const neueWiedergabe = (s, arr) => lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`));

test('proj_warp: transienten_zahl null solange nicht dekodiert, dann Quellsekunden im Fenster, gedeckelt durch transienten_max; BEATS schreibt je Transient eine Einheit', async (t) => {
  const { s, arr } = aufbau(t);
  await s.neu('Tr', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1), warp: 'auto' }]);
  const vorher = s.warpLage('c1', null, null, null).j.warp;
  assert.ok(vorher.transienten_zahl === null || typeof vorher.transienten_zahl === 'number');
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000), 'dekodiert');
  const lage = s.warpLage('c1', null, null, null).j.warp;
  assert.equal(lage.transienten_zahl, 4);
  assert.equal(lage.transienten_gezeigt, 4);
  lage.transienten.forEach((q, i) => assert.ok(Math.abs(q - STELLEN_S[i]) <= 0.002, `Transient ${i}: ${q}`));
  const eng = s.warpLage('c1', null, null, null, null, 2).j.warp;
  assert.deepEqual([eng.transienten.length, eng.transienten_gezeigt, eng.transienten_zahl], [2, 2, 4], 'transienten_max deckelt, die Zahl bleibt');
  // Fenster in Projekt-Beats: 125 BPM-Quelle, 8 Beats = 3,84 s; 2 bis 4 Beats = Quellsekunde 0,96 bis 1,92
  const fenster = s.warpLage('c1', 2, 4, null).j.warp;
  assert.deepEqual(fenster.transienten.map((q) => Math.round(q * 10)), [10], 'nur der Schlag bei 1,0 s liegt im Fenster');
  assert.equal(fenster.transienten_zahl, 4, 'die Zahl gilt für den ganzen Clip');
  // BEATS nach Transienten: Anfangs-Einheit + 4
  await aendern(s, [beats('transienten')]);
  assert.ok(await warteBis(() => (neueWiedergabe(s, arr).spuren[0]?.clips[0]?.warp?.modus === 1), 15000));
  const e = neueWiedergabe(s, arr).spuren[0].clips[0].warp.e;
  assert.equal(e.length, 5, 'eine Einheit am Anfang plus je Transient');
  assert.deepEqual(e.map((u) => Math.round(u[1] / 480)), [0, 50, 100, 200, 300], 'Quell-Frames der Einheiten (±10 ms gerundet)');
  // Negativkontrolle: Raster 1/4 schreibt Einheiten je Beat, unabhängig von den Transienten
  await aendern(s, [beats('1/4')]);
  assert.ok(await warteBis(() => (neueWiedergabe(s, arr).spuren[0]?.clips[0]?.warp?.e?.length === 8), 15000));
});

test('Live und Export tragen für einen BEATS-Clip nach Transienten dasselbe e', async (t) => {
  const { s, arr } = aufbau(t);
  await s.neu('Tr2', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1), warp: 'auto' }]);
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000));
  await aendern(s, [beats('transienten')]);
  assert.ok(await warteBis(() => (neueWiedergabe(s, arr).spuren[0]?.clips[0]?.warp?.modus === 1), 15000));
  const live = neueWiedergabe(s, arr).spuren[0].clips[0].warp.e;
  const r = s.schreibeWiedergabeFuer(s.aktuell().j.projekt);
  const export_ = lies(r.datei).spuren[0].clips[0].warp.e;
  assert.deepEqual(export_, live); assert.equal(live.length, 5);
});

test('proj_lage meldet den Modus beats und das gesetzte beats-Objekt am Clip; ohne gesetztes beats fehlt das Feld (Vorgabe gilt)', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Tr3', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1), warp: 'auto' }]);
  const lage = () => s.aktuell('noten_zahl').j.projekt.spuren[0].clips[0].warp;
  assert.equal(lage().modus, 'complex', 'Ausgang');
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'beats' }]);
  assert.equal(lage().modus, 'beats'); assert.equal('beats' in lage(), false, 'ohne gesetztes beats kein Feld');
  await aendern(s, [beats('1/8')]);
  assert.deepEqual([lage().modus, lage().beats], ['beats', { raster: '1/8', loop: 'vor', huelle: 100 }]);
});

// Schlussrunde Punkt 1: transienten_quelle liefert die Transienten der Quelle unabhängig von Markern und Fenster (Quellsekunden), damit der Editor sie selbst über die Marker abbildet
test('proj_warp transienten_quelle: alle Transienten der Quelle, auch außerhalb des Clip-Bereichs und des Fensters; ohne den Parameter bleibt es beim Bereich', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Tq', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1), warp: 'auto' }]);
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000), 'dekodiert');
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 3 }]);     // Bereich: Beat 0 bis 3 = Quellsekunde 0 bis 1,44
  const bereich = s.warpLage('c1', null, null, null).j.warp;
  assert.equal(bereich.transienten_zahl, 2, 'im Clip-Bereich: 0,5 und 1,0');
  const quelle = s.warpLage('c1', 3, 4, null, null, null, true).j.warp;
  assert.equal(quelle.transienten.length, 4, 'ganze Quelle, trotz Fenster 3 bis 4 und kürzerem Clip');
  quelle.transienten.forEach((q, i) => assert.ok(Math.abs(q - STELLEN_S[i]) <= 0.002));
  assert.equal(quelle.transienten_zahl, 2, 'die Zahl bleibt die im Clip-Bereich');
  assert.equal(s.warpLage('c1', null, null, null, null, 2, true).j.warp.transienten.length, 2, 'transienten_max deckelt auch hier');
});

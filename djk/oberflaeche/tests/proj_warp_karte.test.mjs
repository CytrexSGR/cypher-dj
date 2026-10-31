// Paket 1.13 Warp, Slice 3a (Task 3, AK19-Server, AK28-Teil): clip_neu warp "auto" und warp_auto lösen die Werkstatt-Karte aus der Ablage auf (Schlüssel: die sha des
// Clips), die Wiedergabe /2 trägt alle Marker mit Beat minus Versatz und Quell-Frames, proj_warp liest sie zurück, die Eins liegt auf dem Projekt-Beat des Clip-Starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, wav, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { karteLinear, schreibeKarte, baueMarken } from './hilfen/karte.mjs';

const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));
// Track 6: Karte, Eins bei Karten-Beat 2 (1,5 s), unsicher; Track 7: nur BPM 120, keine Karte; Dauer 25 s im Katalog
function aufbau(t, extra = {}) {
  const d = tmpOrdner(t, 'djk-karte-');
  const w = wav(path.join(d, 'daten'), 'track.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 6, typ: 'track', werk_id: 2, titel: 'Song', bpm: 120, dauer_s: 25, pfad: w },
    { n: 7, typ: 'track', werk_id: 3, titel: 'Ohne', bpm: 120, dauer_s: 25, pfad: w },
  ]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(6), { karte: karteLinear(40, { t0: 0.5, bpm: 120 }), eins: 2, unsicher: true });
  const e = sitzung(t, { katalog, analyse, ...extra });
  return { ...e, analyse, d };
}
const clipNeu = (n, extra = {}) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: ksha(n), warp: 'auto', ...extra });
const aendern = (s, befehle, label = 'Test') => s.aendern({ rev: s.aktuell().j.projekt.rev, label, befehle }, 'andreas');
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;
async function offen(s, name = 'Karte') { await s.neu(name, 'andreas'); await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]); }

test('clip_neu warp auto mit Karte: alle Schläge als Marker, Eins = Beat 0, Länge 47 aus der Karte; die Wiedergabe /2 trägt die 40 Marker', async (t) => {
  const { s, arr } = aufbau(t);
  await offen(s);
  const r = await aendern(s, [clipNeu(6)]);
  assert.equal(r.j.hinweise, undefined);
  const c = clips(s)[0];
  assert.equal(c.warp.quelle, 'werkstatt'); assert.equal(c.warp.modus, 'complex'); assert.equal(c.warp.eins_unsicher, true);
  assert.equal(c.warp.marker.length, 40); assert.deepEqual(c.warp.marker.slice(0, 3), [[0.5, -2], [1, -1], [1.5, 0]]);
  assert.equal(c.warp.versatz_beats, 0);
  assert.equal(c.laenge_beats, 47, 'die Länge kommt aus der Karte (Eins bis Dateiende), nicht aus dem Rückfall 1');
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000));
  assert.ok(await warteBis(() => lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`)).spuren[0]?.clips.length === 1, 15000));
  const w = lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`)).spuren[0].clips[0].warp;
  assert.equal(w.modus, 2); assert.equal(w.w.length, 40);
  assert.deepEqual(w.w[0], [-2, 24000]); assert.deepEqual(w.w[2], [0, 72000]);   // Beat minus Versatz 0, Quell-Frame = Sekunden · 48 000
  assert.equal('pitch' in w, false);
});

test('AK19 Server: die Eins liegt auf dem Projekt-Beat des Clip-Starts (Takt 5 = Beat 16); proj_warp liest eins_unsicher und die Gegenprobe', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  await aendern(s, [clipNeu(6, { start_beat: 16 })]);
  const eins = s.warpLage('c1', null, null, 16).j;
  assert.equal(eins.bei.quell_s, 1.5, 'bei Projekt-Beat 16 klingt die Quellsekunde der ersten Eins');
  assert.equal(eins.bei.warum, undefined);
  assert.equal(s.warpLage('c1', null, null, 17).j.bei.quell_s, 2, 'ein Beat später: 0,5 s weiter (120 BPM)');
  assert.equal(eins.warp.eins_unsicher, true); assert.equal(eins.warp.marker_zahl, 40);
  assert.equal(eins.warp.marker[2].projekt_beat, 16, 'der Marker mit Beat 0 liegt auf Projekt-Beat 16');
  assert.equal(eins.warp.marker[0].projekt_beat, 14, 'die ersten Marker liegen vor dem Clip-Start (Beat −2): sie klingen nicht');
});

test('Negativ-Kontrolle: derselbe Aufbau ohne Karte (Track 7) warpt aus der BPM, nicht aus der Karte; eine Karte mit fremder sha im Dokument zählt nicht', async (t) => {
  const { s, analyse } = aufbau(t);
  schreibeKarte(analyse, ksha(7), { karte: karteLinear(40), quellSha: ksha(9) });   // Ordner passt, Dokument gehört einer anderen Datei
  await offen(s);
  await aendern(s, [clipNeu(7)]);
  const c = clips(s)[0];
  assert.equal(c.warp.quelle, 'mediathek'); assert.equal(c.warp.marker.length, 2);
});

test('warp_auto auf einem ungewarpten Clip: warp_setzen mit der Karte, die Länge bleibt', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  const o = clipNeu(6, { laenge_beats: 8 }); delete o.warp;
  await aendern(s, [o]);
  assert.equal(clips(s)[0].warp, undefined);
  await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c1' }]);
  const c = clips(s)[0];
  assert.equal(c.warp.quelle, 'werkstatt'); assert.equal(c.warp.marker.length, 40); assert.equal(c.laenge_beats, 8);
});

test('ohne Ablage-Option (null) liest der Server keine Karte, Prüfinstanzen haben keine Vorgabe', async (t) => {
  const { s } = aufbau(t, { analyse: null });
  await offen(s);
  await aendern(s, [clipNeu(6)]);
  assert.equal(clips(s)[0].warp.quelle, 'mediathek', 'die Karte liegt in der Ablage, aber die Option sagt null');
});

test('Traktor-Raster: Track ohne Karte, mit Raster in der Mediathek → quelle traktor, zwei Marker, eins_unsicher; mit Karte gewinnt die Karte', async (t) => {
  const d = tmpOrdner(t, 'djk-trk-');
  const w = wav(path.join(d, 'daten'), 'track.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 8, typ: 'track', werk_id: 4, titel: 'Raster', bpm: 124, dauer_s: 300, pfad: w },
    { n: 6, typ: 'track', werk_id: 2, titel: 'Beides', bpm: 124, dauer_s: 25, pfad: w },
  ]);
  const mediathek = baueMarken(path.join(d, 'mt.sqlite'), [{ sha: ksha(8), start_s: 0.0575918, bpm: 128 }, { sha: ksha(6), start_s: 0.2, bpm: 128 }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(6), { karte: karteLinear(40, { t0: 0.5, bpm: 120 }), eins: 2 });
  const { s } = sitzung(t, { katalog, analyse, mediathek });
  await offen(s);
  await aendern(s, [clipNeu(8), clipNeu(6, { start_beat: 1000 })]);   // der Traktor-Clip ist 300 s = rund 640 Beats lang
  const [traktor, beides] = clips(s);
  assert.equal(traktor.warp.quelle, 'traktor'); assert.equal(traktor.warp.marker.length, 2); assert.equal(traktor.warp.eins_unsicher, true);
  assert.deepEqual(traktor.warp.marker[0], [0.0575918, 0]);
  assert.equal(beides.warp.quelle, 'werkstatt', 'Karte vor Traktor');
});

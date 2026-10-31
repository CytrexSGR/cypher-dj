// Paket 1.13 Warp, Slice 3a (Task 15, AK2-Teil Grenzen): Marker hinter dem Ende der Quelle (Dauer aus dem Katalog) werden abgelehnt (warp_marker); 4096 Marker gelten,
// 4097 nicht; jede Ablehnung mit Positivkontrolle. Eine Karte mit 4097 Markern fällt auf die nächste Quelle (karte_zu_gross).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sitzung, wav } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { karteLinear, schreibeKarte } from './hilfen/karte.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const warp = (marker, extra = {}) => ({ an: true, modus: 'complex', marker, versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0, ...extra });
const linie = (n, bis) => Array.from({ length: n }, (_, i) => [Math.round((i * bis / (n - 1)) * 1e6) / 1e6, i]);   // n Marker, 1 Beat je Schritt, letzte Quellzeit = bis
function aufbau(t) {
  const d = tmpOrdner(t, 'djk-grenzen-');
  const w = wav(path.join(d, 'daten'), 'x.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'track', werk_id: 1, bpm: 120, dauer_s: 600, pfad: w }, { n: 2, typ: 'track', werk_id: 2, bpm: 120, dauer_s: 600, pfad: w }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(2), { karte: karteLinear(4097, { t0: 0, bpm: 480 }), dauer_s: 600 });   // 4097 Schläge, Segment 480 BPM (gültig), letzter bei 510 s
  return sitzung(t, { katalog, analyse, mediathek: null }).s;
}
const aendern = (s, befehle) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Test', befehle }, 'andreas');

test('Marker außerhalb der Quelle: der letzte Marker darf höchstens 0,05 s hinter der Katalog-Dauer liegen; ohne Katalogdauer, unverändert oder weiter innen kein Einwand', async (t) => {
  const s = aufbau(t);
  await s.neu('Grenzen', 'andreas');
  const roh = { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1) };
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, roh]);
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: warp([[0, 0], [600, 1200]]) }]);                 // genau auf der Dauer: gilt
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: warp([[0, 0], [600.04, 1200]]) }]);              // Rundungsspielraum: gilt
  for (const letzter of [600.06, 700, 900]) {
    const e = await fehlerVon(aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: warp([[0, 0], [letzter, 1200]]) }]));
    assert.equal(e?.grund, 'warp_marker', `letzter Marker bei ${letzter} s`);
    assert.equal(e.code, 400); assert.match(String(e.extra.text), /behind the end of the source/);
  }
  assert.equal(s.aktuell().j.projekt.spuren[0].clips[0].warp.marker[1][0], 600.04, 'die Ablehnung hat nichts geändert');
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', an: false }]);                                          // ein Befehl, der die Marker nicht ändert: kein Einwand
  assert.equal(s.aktuell().j.projekt.spuren[0].clips[0].warp.an, false);
});

test('4096 Marker gelten, 4097 nicht (warp_marker); eine Karte mit 4097 Markern fällt auf die BPM zurück, mit Hinweis karte_zu_gross', async (t) => {
  const s = aufbau(t);
  await s.neu('Grenzen2', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1) }]);
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: warp(linie(4096, 500)) }]);
  const e = await fehlerVon(aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: warp(linie(4097, 500)) }]));
  assert.equal(e?.grund, 'warp_marker', 'die Prüfung des Modells (BefehlFehler); alsAntwort macht daraus den HTTP-Code');
  const r = await aendern(s, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 9000, laenge_beats: 1, sha256: ksha(2), warp: 'auto' }]);
  assert.deepEqual(r.j.hinweise, [{ index: 0, hinweis: 'karte_zu_gross' }]);
  assert.equal(s.aktuell().j.projekt.spuren[0].clips[1].warp.quelle, 'mediathek');
});

test('Segment-Tempo (AK2-Faktor in der absoluten Form, D4): 15 und 800 BPM gelten, darunter und darüber warp_faktor', async (t) => {
  const s = aufbau(t);
  await s.neu('Grenzen3', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1) }]);
  const segment = (bpm) => warp([[0, 0], [60, bpm]]);   // 60 s Quelle, bpm Beats: das Segment-Tempo ist bpm
  for (const gut of [15, 800]) await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: segment(gut) }]);
  for (const schlecht of [14.9, 800.1]) {
    const f = await fehlerVon(aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: segment(schlecht) }]));
    assert.equal(f?.grund, 'warp_faktor', `Segment-Tempo ${schlecht}`);
  }
  assert.equal(s.aktuell().j.projekt.spuren[0].clips[0].warp.marker[1][1], 800, 'die Ablehnung hat nichts geändert');
});

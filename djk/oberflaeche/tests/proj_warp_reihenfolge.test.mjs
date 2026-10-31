// Paket 1.13 Warp, Slice 3a (Task 9, AK20): die Quellen-Reihenfolge werkstatt > traktor > takte > mediathek; keine Quelle: kein Warp und Hinweis kein_tempo; One-Shot
// bleibt aus (ohne Hinweis). Jeder Fall ist ein eigener Katalogeintrag, der genau diese Quelle (und alle schwächeren) hat; Negativ-Kontrolle: derselbe Eintrag ohne
// die stärkere Quelle fällt eine Stufe zurück.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sitzung, wav } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { baueMarken, karteLinear, schreibeKarte } from './hilfen/karte.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
function aufbau(t) {
  const d = tmpOrdner(t, 'djk-reihe-');
  const w = wav(path.join(d, 'daten'), 'x.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 1, typ: 'track', werk_id: 1, bpm: 124, dauer_s: 25, pfad: w },                       // Karte + Traktor + BPM
    { n: 2, typ: 'track', werk_id: 2, bpm: 124, dauer_s: 25, pfad: w },                       // Traktor + BPM
    { n: 3, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w },                        // Takte + BPM
    { n: 4, typ: 'track', werk_id: 4, bpm: 128, dauer_s: 25, pfad: w },                       // nur BPM
    { n: 5, typ: 'loop', dauer_s: 3.84, pfad: w },                                            // nichts
    { n: 6, typ: 'oneshot', instrument: 'kick', dauer_s: 0.25, pfad: w },                     // One-Shot
    { n: 7, typ: 'track', werk_id: 7, bpm: 124, dauer_s: 25, pfad: w },                       // unbrauchbare Karte + Traktor
  ]);
  const mediathek = baueMarken(path.join(d, 'mt.sqlite'), [{ sha: ksha(1), start_s: 0.2, bpm: 128 }, { sha: ksha(2), start_s: 0.1, bpm: 128 }, { sha: ksha(7), start_s: 0.1, bpm: 128 }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(1), { karte: karteLinear(40, { t0: 0.5, bpm: 120 }), eins: 0 });
  const fallend = karteLinear(40, { t0: 0.5, bpm: 120 }); fallend[10][0] = fallend[9][0];
  schreibeKarte(analyse, ksha(7), { karte: fallend });
  return sitzung(t, { katalog, analyse, mediathek }).s;
}
const clipNeu = (n, beat, extra = {}) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: beat, laenge_beats: 1, sha256: ksha(n), warp: 'auto', ...extra });
const aendern = (s, befehle) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Test', befehle }, 'andreas');
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;

test('AK20: ein Fall je Quelle in einem Aufruf; die Länge kommt aus dem Warp, kein Hinweis außer bei „keine Quelle“ und „unbrauchbare Karte“', async (t) => {
  const s = aufbau(t);
  await s.neu('Reihenfolge', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]);
  const r = await aendern(s, [clipNeu(1, 0), clipNeu(2, 100), clipNeu(3, 200), clipNeu(4, 300), clipNeu(5, 400, { laenge_beats: 2 }), clipNeu(6, 500, { laenge_beats: 0.5 }), clipNeu(7, 600)]);
  const c = clips(s), quelle = (i) => c[i].warp?.quelle ?? null;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(quelle), ['werkstatt', 'traktor', 'takte', 'mediathek', null, null, 'traktor']);
  assert.equal(c[0].warp.marker.length, 40); assert.equal(c[1].warp.marker.length, 2); assert.equal(c[2].warp.marker.length, 2);
  assert.equal(c[4].laenge_beats, 2, 'ohne Quelle gilt laenge_beats des Aufrufers'); assert.equal(c[5].laenge_beats, 0.5);
  assert.deepEqual(r.j.hinweise, [{ index: 4, hinweis: 'kein_tempo' }, { index: 6, hinweis: 'karte_unbrauchbar' }], 'One-Shot: kein Hinweis');
  assert.equal(c[1].warp.eins_unsicher, true); assert.equal(c[3].warp.eins_unsicher, true, 'Track mit BPM: Eins unbekannt'); assert.equal(c[0].warp.eins_unsicher, undefined);
});

test('Negativ-Kontrolle: dieselben Einträge ohne ihre stärkere Quelle fallen eine Stufe zurück (ohne Ablage: Traktor, ohne Mediathek: BPM)', async (t) => {
  const d = tmpOrdner(t, 'djk-reihe2-');
  const w = wav(path.join(d, 'daten'), 'x.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'track', werk_id: 1, bpm: 124, dauer_s: 25, pfad: w }]);
  const mediathek = baueMarken(path.join(d, 'mt.sqlite'), [{ sha: ksha(1), start_s: 0.2, bpm: 128 }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(1), { karte: karteLinear(40) });
  for (const [opt, soll] of [[{ analyse, mediathek }, 'werkstatt'], [{ analyse: null, mediathek }, 'traktor'], [{ analyse: null, mediathek: null }, 'mediathek']]) {
    const { s } = sitzung(t, { katalog, ...opt });
    await s.neu(`R${soll}`, 'andreas');
    await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1, 0)]);
    assert.equal(clips(s)[0].warp.quelle, soll);
  }
});

test('warp_auto: ohne Quelle 409 kein_tempo mit Index (auch One-Shot), mit Quelle ein Warp; die Länge bleibt', async (t) => {
  const s = aufbau(t);
  await s.neu('Auto2', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]);
  const roh = (n, beat, extra = {}) => { const o = clipNeu(n, beat, extra); delete o.warp; return o; };
  await aendern(s, [roh(5, 0, { laenge_beats: 2 }), roh(6, 10, { laenge_beats: 0.5 }), roh(2, 20, { laenge_beats: 8 })]);
  for (const id of ['c1', 'c2']) {
    const e = await fehlerVon(aendern(s, [{ befehl: 'warp_auto', clip_id: id }]));
    assert.deepEqual([e.code, e.fehler, e.extra.index], [409, 'kein_tempo', 0], id);
  }
  await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c3' }]);
  assert.equal(clips(s)[2].warp.quelle, 'traktor'); assert.equal(clips(s)[2].laenge_beats, 8);
});

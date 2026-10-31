// Paket 1.13 Warp, Slice 3a (Task 12): Analyse auf Abruf, Verwaltung. Ein langer Track (track, ab 60 s) ohne Karte und ohne Traktor-Raster löst einen Auftrag aus
// (je sha256 einer, ein Lauf zugleich, weitere warten), der Hinweis sagt es, /proj/aktuell zeigt den Zustand, SSE meldet jede Änderung. Der Starter ist eine
// Attrappe (tests lassen nie die Werkstatt laufen; tests/hilfen/analyse.mjs); Task 13 testet die Ankunft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ksha } from './hilfen/katalog.mjs';
import { aufbau } from './hilfen/analyse.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const clipNeu = (n, beat, extra = {}) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: beat, laenge_beats: 1, sha256: ksha(n), warp: 'auto', ...extra });
const aendern = (s, befehle, q = 'andreas') => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Test', befehle }, q);
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;
async function offen(s, name = 'Analyse') { await s.neu(name, 'andreas'); await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]); }
const analyseEreignisse = (k) => k.verteilt.filter((e) => e.f?.analyse).map((e) => [e.f.clip_id, e.f.analyse]);

test('D1: Track mit BPM ohne Karte: sofort der Mediathek-Warp (F2), der Auftrag läuft, Hinweis analyse_angefordert, /proj/aktuell und SSE zeigen ihn', async (t) => {
  const { s, k, starter } = aufbau(t);
  await offen(s);
  const r = await aendern(s, [clipNeu(1, 0)]);
  assert.equal(clips(s)[0].warp.quelle, 'mediathek');
  assert.notEqual(clips(s)[0].laenge_beats, 1, 'Länge aus dem Warp, nicht die des Aufrufers');
  assert.deepEqual(r.j.hinweise, [{ index: 0, hinweis: 'analyse_angefordert' }]);
  assert.deepEqual(starter.aufrufe.map((a) => a[0]), [ksha(1)]);
  assert.deepEqual(s.aktuell().j.analyse, [{ clip_id: 'c1', status: 'laeuft' }]);
  assert.deepEqual(s.aktuell('noten_zahl').j.analyse, [{ clip_id: 'c1', status: 'laeuft' }], 'proj_lage sieht es auch');
  assert.equal(s.aktuell('rev').j.analyse, undefined);
  assert.ok(analyseEreignisse(k).some(([c, a]) => c === 'c1' && a === 'laeuft'));
});

test('Track ohne jedes Tempo: kein Warp, Hinweis nur analyse_angefordert (nicht kein_tempo), Länge des Aufrufers; zu kurz, Loop, Karte, Traktor starten nichts (Negativ-Kontrollen)', async (t) => {
  const { s, starter } = aufbau(t);
  await offen(s);
  const r = await aendern(s, [clipNeu(2, 0, { laenge_beats: 3 })]);
  assert.equal(clips(s)[0].warp, undefined); assert.equal(clips(s)[0].laenge_beats, 3);
  assert.deepEqual(r.j.hinweise, [{ index: 0, hinweis: 'analyse_angefordert' }]);
  assert.equal(starter.aufrufe.length, 1);
  const n = await aendern(s, [clipNeu(3, 100, { laenge_beats: 2 }), clipNeu(4, 200, { laenge_beats: 2 }), clipNeu(5, 300), clipNeu(6, 600)]);
  assert.deepEqual(n.j.hinweise, [{ index: 0, hinweis: 'kein_tempo' }, { index: 1, hinweis: 'kein_tempo' }]);
  assert.equal(starter.aufrufe.length, 1, 'kurzer Track, Loop, Track mit Karte, Track mit Traktor: kein Auftrag');
  assert.equal(clips(s)[3].warp.quelle, 'werkstatt'); assert.equal(clips(s)[4].warp.quelle, 'traktor');
});

test('dieselbe sha doppelt: ein Auftrag, der zweite Hinweis ist analyse_laeuft, beide Clips stehen in der Liste; eine zweite sha wartet (ein Lauf zugleich) und startet nach dem Ende der ersten', async (t) => {
  const { s, k, starter } = aufbau(t);
  await offen(s);
  await aendern(s, [clipNeu(1, 0)]);
  const zwei = await aendern(s, [clipNeu(1, 100), clipNeu(7, 200)]);
  assert.deepEqual(zwei.j.hinweise, [{ index: 0, hinweis: 'analyse_laeuft' }, { index: 1, hinweis: 'analyse_angefordert' }]);
  assert.equal(starter.aufrufe.length, 1);
  const stand = s.aktuell().j.analyse;
  assert.deepEqual(stand, [{ clip_id: 'c1', status: 'laeuft' }, { clip_id: 'c2', status: 'laeuft' }, { clip_id: 'c3', status: 'wartet' }]);
  starter.beende(ksha(1));
  assert.equal(starter.aufrufe.length, 2, 'die wartende sha startet, sobald der Platz frei ist');
  assert.deepEqual(s.aktuell().j.analyse, [{ clip_id: 'c3', status: 'laeuft' }]);
  assert.ok(analyseEreignisse(k).some(([c, a]) => c === 'c3' && a === 'wartet'));
});

test('T6 warp_auto: bei einem langen Track ohne Tempo 200 mit Hinweis und ohne Änderung (rev bleibt), bei einem kurzen weiter 409 kein_tempo; mit BPM wie bisher ein Warp plus Auftrag', async (t) => {
  const { s, starter } = aufbau(t);
  await offen(s);
  const roh = (n, beat, extra = {}) => { const o = clipNeu(n, beat, extra); delete o.warp; return o; };
  await aendern(s, [roh(2, 0, { laenge_beats: 3 }), roh(3, 100, { laenge_beats: 2 }), roh(1, 200, { laenge_beats: 8 })]);
  const rev = s.aktuell().j.projekt.rev, verlauf = s.verlaufListe().j.length;
  const a = await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c1' }]);
  assert.equal(a.code, 200); assert.deepEqual(a.j.hinweise, [{ index: 0, hinweis: 'analyse_angefordert' }]);
  assert.equal(s.aktuell().j.projekt.rev, rev, 'nichts geändert'); assert.equal(s.verlaufListe().j.length, verlauf);
  const e = await fehlerVon(aendern(s, [{ befehl: 'warp_auto', clip_id: 'c2' }]));
  assert.deepEqual([e.code, e.fehler], [409, 'kein_tempo']);
  const m = await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c3' }]);
  assert.equal(m.code, 200); assert.equal(clips(s)[2].warp.quelle, 'mediathek', 'mit Library-BPM sofort der Warp (F2)');
  assert.equal(clips(s)[2].laenge_beats, 8, 'warp_auto lässt die Länge');
  assert.deepEqual(m.j.hinweise, [{ index: 0, hinweis: 'analyse_angefordert' }]);
  assert.ok(s.aktuell().j.projekt.rev > rev, 'und eine Änderung: der Clip ist gewarpt');
  assert.equal(starter.aufrufe.length, 1, 'c1 und c3 sind verschiedene shas, der Platz ist belegt: c3 wartet');
});

test('Ende mit Fehler: SSE analyse fehler mit Grund, die Liste ist leer, der Clip behält seinen Warp; die sha gilt als gescheitert: warp_auto und neues Ablegen warpen sofort aus der Library-BPM, ohne neuen Auftrag und ohne Hinweis; ohne analysierer oder ohne Ablage (null) bleibt alles wie vor Slice 3a', async (t) => {
  const { s, k, starter } = aufbau(t);
  await offen(s);
  await aendern(s, [clipNeu(1, 0)]);
  starter.beende(ksha(1), { ok: false, grund: 'RuntimeError: In RhythmExtractor2013.compute' });
  assert.equal(s.aktuell().j.analyse, undefined);
  assert.deepEqual(k.verteilt.filter((e) => e.f?.analyse === 'fehler').map((e) => e.f.grund), ['RuntimeError: In RhythmExtractor2013.compute']);
  assert.equal(clips(s)[0].warp.quelle, 'mediathek', 'der Clip behält den Warp aus der Library-BPM');
  const danach = await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c1' }]);   // die sha gilt als gescheitert: kein zweiter Auftrag, kein Hinweis
  assert.equal(danach.j.hinweise, undefined); assert.equal(starter.aufrufe.length, 1);
  const neu = await aendern(s, [clipNeu(1, 400)]);
  assert.equal(clips(s)[1].warp.quelle, 'mediathek'); assert.equal(neu.j.hinweise, undefined); assert.equal(starter.aufrufe.length, 1);
  for (const extra of [{ analysierer: null }, { analyse: null }]) {
    const x = aufbau(t, extra);
    await offen(x.s, `Ohne${Object.keys(extra)[0]}`);
    const r = await aendern(x.s, [clipNeu(2, 0, { laenge_beats: 3 })]);
    assert.deepEqual(r.j.hinweise, [{ index: 0, hinweis: 'kein_tempo' }], JSON.stringify(Object.keys(extra)));
    assert.equal(x.starter.aufrufe.length, 0);
  }
});

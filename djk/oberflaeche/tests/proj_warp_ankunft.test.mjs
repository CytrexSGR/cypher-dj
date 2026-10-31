// Paket 1.13 Warp, Slice 3a (Task 13): die Ankunft der Analyse schaltet den Clip um: ein Verlaufseintrag Auto-Warp mit der Quelle des Auslösers, Undo stellt den Stand
// davor her; verworfen wird bei Projektwechsel, gelöschtem Clip, angefasstem Warp, fehlender Karte und (Cypher) KI-Stopp; die Freeze-Sperre hält die Ankunft auf;
// D1: solange der Clip klingt (Transport spielt, Kopf im Clip), wartet sie.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { warteBis, arrNr } from './hilfen/proj_kontext.mjs';
import { ksha } from './hilfen/katalog.mjs';
import { karteLinear, schreibeKarte } from './hilfen/karte.mjs';
import { aufbau } from './hilfen/analyse.mjs';

const clipNeu = (n, beat, extra = {}) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: beat, laenge_beats: 1, sha256: ksha(n), warp: 'auto', ...extra });
const aendern = (s, befehle, q = 'andreas') => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Test', befehle }, q);
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;
async function offen(s, name) { await s.neu(name, 'andreas'); await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]); }
const karte = (analyse, n = 1) => schreibeKarte(analyse, ksha(n), { karte: karteLinear(40, { t0: 0.5, bpm: 120 }), eins: 2, unsicher: true, dauer_s: 100 });
const verworfen = (k) => k.verteilt.filter((e) => e.f?.analyse === 'verworfen').map((e) => e.f.grund);
const kopf = (s, status, projekt_beat) => s.ereignis('/zustand/arr', { ...arrNr(0), status, projekt_beat });   // wie der Kern es meldet: status 2 spielt, 0 steht
const mitte = (s) => clips(s)[0].start_beat + clips(s)[0].laenge_beats / 2;

test('D1: Track mit BPM, Karte kommt: aus dem Mediathek-Warp wird der werkstatt-Warp mit 40 Markern, Länge aus der Karte, ein Eintrag Auto-Warp (Quelle andreas), Undo stellt den Mediathek-Warp her, SSE fertig', async (t) => {
  const { s, k, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft1');
  await aendern(s, [clipNeu(1, 0)]);
  assert.equal(clips(s)[0].warp.quelle, 'mediathek');
  const vorher = s.verlaufListe().j.length, laenge0 = clips(s)[0].laenge_beats;
  karte(analyse); starter.beende(ksha(1));
  assert.ok(await warteBis(() => clips(s)[0].warp.quelle === 'werkstatt', 5000), 'der Clip schaltet um');
  const c = clips(s)[0];
  assert.equal(c.warp.marker.length, 40); assert.equal(c.warp.eins_unsicher, true); assert.notEqual(c.laenge_beats, laenge0);
  const v = s.verlaufListe().j;
  assert.equal(v.length, vorher + 1, 'genau ein Eintrag'); assert.deepEqual([v.at(-1).label, v.at(-1).quelle], ['Auto-Warp', 'andreas']);
  assert.ok(await warteBis(() => k.verteilt.some((e) => e.f?.analyse === 'fertig'), 2000));
  assert.equal(s.aktuell().j.analyse, undefined);
  await s.umkehr('undo', { rev: s.aktuell().j.projekt.rev }, 'andreas');
  assert.equal(clips(s)[0].warp.quelle, 'mediathek'); assert.equal(clips(s)[0].laenge_beats, laenge0, 'Undo nimmt Warp und Länge zusammen zurück');
});

test('Track ohne jedes Tempo: Clip kam ohne Warp, nach der Ankunft Warp und Länge aus der Karte', async (t) => {
  const { s, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft2');
  await aendern(s, [clipNeu(2, 0, { laenge_beats: 3 })]);
  assert.equal(clips(s)[0].warp, undefined);
  karte(analyse, 2); starter.beende(ksha(2));
  assert.ok(await warteBis(() => clips(s)[0].warp?.quelle === 'werkstatt', 5000));
  assert.notEqual(clips(s)[0].laenge_beats, 3);
});

test('Einstellungen des Nutzers bleiben (Modus tones, Transpose 3); ein von Hand ersetzter Warp wird nicht überschrieben (verworfen: angefasst)', async (t) => {
  const { s, k, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft3');
  await aendern(s, [clipNeu(1, 0), clipNeu(7, 200)]);
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'tones', transpose_st: 3 }]);
  const hand = { an: true, modus: 'complex', marker: [[0, 0], [10, 20]], versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 };
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c2', warp: hand }]);
  karte(analyse, 1); karte(analyse, 7);
  starter.beende(ksha(1));
  assert.ok(await warteBis(() => clips(s)[0].warp.quelle === 'werkstatt', 5000));
  assert.deepEqual([clips(s)[0].warp.modus, clips(s)[0].warp.transpose_st], ['tones', 3]);
  starter.beende(ksha(7));
  assert.ok(await warteBis(() => verworfen(k).includes('angefasst'), 5000));
  assert.equal(clips(s)[1].warp.quelle, 'hand', 'Negativ-Kontrolle: der Handwarp bleibt');
});

test('verworfen: Clip gelöscht, Projekt gewechselt, Analyse ohne Karte in der Ablage; nichts geschrieben', async (t) => {
  const { s, k, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft4');
  await aendern(s, [clipNeu(1, 0), clipNeu(7, 200)]);
  await aendern(s, [{ befehl: 'clip_loeschen', clip_id: 'c1' }]);
  const eintraege = s.verlaufListe().j.length;
  karte(analyse, 1); starter.beende(ksha(1));
  assert.ok(await warteBis(() => verworfen(k).includes('clip_weg'), 5000));
  starter.beende(ksha(7));                                                        // ok, aber keine Karte in der Ablage geschrieben
  assert.ok(await warteBis(() => verworfen(k).includes('keine_karte'), 5000));
  assert.equal(s.verlaufListe().j.length, eintraege, 'verworfen heißt: kein Eintrag');
  const aufrufe = starter.aufrufe.length;                                         // ok ohne Karte: die sha gilt als gescheitert, warp_auto fordert nichts mehr an
  const nochmal = await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c2' }]);
  assert.equal(clips(s)[0].warp.quelle, 'mediathek'); assert.equal(starter.aufrufe.length, aufrufe, 'kein zweiter Auftrag');
  assert.equal(nochmal.j.hinweise, undefined, 'und kein Hinweis analyse_angefordert');
  const x = aufbau(t);
  await offen(x.s, 'Ankunft5');
  await aendern(x.s, [clipNeu(1, 0)]);
  await x.s.neu('Anderes Projekt', 'andreas');
  karte(x.analyse, 1); x.starter.beende(ksha(1));
  assert.ok(await warteBis(() => verworfen(x.k).includes('projekt_weg'), 5000));
});

test('T10 Cypher: Quelle des Eintrags ist cypher; nach KI-Stopp schreibt die Ankunft nicht (verworfen: ki_gestoppt), die Karte bleibt in der Ablage', async (t) => {
  const { s, k, starter, analyse } = aufbau(t);
  await s.neu('Ankunft6', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }], 'cypher');                   // Cyphers eigene Spur: sie schreibt nicht auf Andreas' Spuren
  await aendern(s, [clipNeu(1, 0), clipNeu(7, 200)], 'cypher');
  karte(analyse, 1); starter.beende(ksha(1));
  assert.ok(await warteBis(() => clips(s)[0].warp.quelle === 'werkstatt', 5000));
  assert.equal(s.verlaufListe().j.at(-1).quelle, 'cypher');
  k.ki = true;
  karte(analyse, 7); starter.beende(ksha(7));
  assert.ok(await warteBis(() => verworfen(k).includes('ki_gestoppt'), 5000));
  assert.equal(clips(s)[1].warp.quelle, 'mediathek'); assert.ok(fs.existsSync(`${analyse}/${ksha(7).slice(0, 16)}/material.json`));
});

test('Freeze-Sperre: die Ankunft wartet, bis die Wiedergabe wieder änderbar ist, und schreibt dann (Negativ-Kontrolle: solange gesperrt bleibt der Clip)', async (t) => {
  const { s, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft7');
  await aendern(s, [clipNeu(1, 0)]);
  const frei = s.sperreLaden();
  karte(analyse, 1); starter.beende(ksha(1));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(clips(s)[0].warp.quelle, 'mediathek', 'gesperrt: die Ankunft wartet');
  frei();
  assert.ok(await warteBis(() => clips(s)[0].warp.quelle === 'werkstatt', 5000), 'frei: sie schreibt');
});

test('D1: klingt der Clip (Transport spielt, Kopf im Clip), wartet die Ankunft ohne zu verwerfen und meldet es einmal; steht der Transport, schreibt sie', async (t) => {
  const { s, k, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft8');
  await aendern(s, [clipNeu(1, 0)]);
  kopf(s, 2, mitte(s));
  karte(analyse, 1); starter.beende(ksha(1));
  await new Promise((r) => setTimeout(r, 300));                                   // analyseWarteMs 20: viele Prüfungen
  assert.equal(clips(s)[0].warp.quelle, 'mediathek', 'klingt: die Ankunft wartet');
  assert.deepEqual(verworfen(k), [], 'und verwirft nicht');
  assert.equal(k.verteilt.filter((e) => e.f?.analyse === 'karte_bereit').length, 1, 'die Seite erfährt es einmal');
  kopf(s, 0, mitte(s));                                                           // der Transport steht, der Kopf bleibt im Clip
  assert.ok(await warteBis(() => clips(s)[0].warp.quelle === 'werkstatt', 5000), 'steht: sie schreibt');
  assert.equal(s.verlaufListe().j.at(-1).label, 'Auto-Warp');
});

test('D1: der Transport spielt, aber der Kopf liegt außerhalb des Clips (davor oder dahinter): die Ankunft schreibt sofort', async (t) => {
  for (const [name, start, kopfBei] of [['davor', 64, (c) => c.start_beat - 8], ['dahinter', 0, (c) => c.start_beat + c.laenge_beats + 8]]) {
    const { s, starter, analyse } = aufbau(t);
    await offen(s, `Ankunft9-${name}`);
    await aendern(s, [clipNeu(1, start)]);
    kopf(s, 2, kopfBei(clips(s)[0]));
    karte(analyse, 1); starter.beende(ksha(1));
    assert.ok(await warteBis(() => clips(s)[0].warp.quelle === 'werkstatt', 5000), `Kopf ${name}: sie schreibt trotz laufendem Transport`);
  }
});

test('D1: während des Wartens verwirft ein Projektwechsel die Ankunft (projekt_weg), ohne zu schreiben; ein angefasster Warp auch (angefasst)', async (t) => {
  const { s, k, starter, analyse } = aufbau(t);
  await offen(s, 'Ankunft10');
  await aendern(s, [clipNeu(1, 0), clipNeu(7, 400)]);
  kopf(s, 2, mitte(s));                                                           // der Kopf steht in c1; c2 (Beat 400) wird nach dem Wechsel gebraucht
  karte(analyse, 1); starter.beende(ksha(1));
  await new Promise((r) => setTimeout(r, 100));
  const hand = { an: true, modus: 'complex', marker: [[0, 0], [10, 20]], versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 };
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', warp: hand }]);       // der Nutzer greift ein, während die Ankunft wartet
  assert.ok(await warteBis(() => verworfen(k).includes('angefasst'), 5000), 'angefasst: verworfen bei der nächsten Prüfung, ohne auf den Stopp zu warten');
  assert.equal(clips(s)[0].warp.quelle, 'hand');
  karte(analyse, 7); starter.beende(ksha(7));                                     // c2 liegt bei Beat 400, außerhalb des Kopfs: sie wartet nicht
  assert.ok(await warteBis(() => clips(s)[1].warp.quelle === 'werkstatt', 5000));
  const x = aufbau(t);
  await offen(x.s, 'Ankunft11');
  await aendern(x.s, [clipNeu(1, 0)]);
  kopf(x.s, 2, mitte(x.s));
  karte(x.analyse, 1); x.starter.beende(ksha(1));
  await new Promise((r) => setTimeout(r, 100));
  await x.s.neu('Anderes Projekt', 'andreas');
  assert.ok(await warteBis(() => verworfen(x.k).includes('projekt_weg'), 5000), 'Projektwechsel: die wartende Ankunft endet');
});

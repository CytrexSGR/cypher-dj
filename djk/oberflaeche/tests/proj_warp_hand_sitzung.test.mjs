// Paket 1.13 Warp, Slice 3b: die Befehle von Hand durch die echte Sitzung. Je Befehl genau ein Verlaufseintrag und genau ein Undo-Schritt (AK21), die
// Wiedergabe trägt die neuen Beats, Quelle cypher und KI-Stopp (AK28), tempo_vom_clip über tempo_setzen samt Sperren, Warp From Here (Start) mit dem Katalog,
// Set 1.1.1 Here mit dem Rückweg in korrekturen.jsonl des Bestands (D3) und die Eins-Korrektur beim nächsten Auto-Warp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sitzung, wav, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { karteLinear, schreibeKarte, schreibeBestand } from './hilfen/karte.mjs';
import { quellSekunde, beatBeiQuelle } from '../projekt/warp.ts';
import { REPO_PFADE } from '../pfade.ts';

const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));
const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const KARTE = karteLinear(40, { t0: 0.5, bpm: 120 });         // Schlag i bei 0,5 + i · 0,5 s
// Track 6 (Karte, Eins bei Karten-Beat 2, unsicher), Track 7 (nur BPM 100, keine Karte), beide mit Dauer 25 s
function aufbau(t, extra = {}, mitBestand = false, bestandOpt = {}) {
  const d = tmpOrdner(t, 'djk-hand-');
  const w = wav(path.join(d, 'daten'), 'track.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 6, typ: 'track', werk_id: 2, titel: 'Song', bpm: 120, dauer_s: 25, pfad: w },
    { n: 7, typ: 'track', werk_id: 3, titel: 'Ohne', bpm: 100, dauer_s: 25, pfad: w },
  ]);
  const analyse = path.join(d, 'analyse'), bestand = path.join(d, 'bestand');
  schreibeKarte(analyse, ksha(6), { karte: KARTE, eins: 2, unsicher: true });
  if (mitBestand) schreibeBestand(bestand, ksha(6), { karte: KARTE, eins: 2, unsicher: true, ...bestandOpt });
  const e = sitzung(t, { katalog, analyse, ...(mitBestand ? { bestand } : {}), ...extra });
  return { ...e, analyse, bestand };
}
const clipNeu = (n, extra = {}) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: ksha(n), warp: 'auto', ...extra });
const aendern = (s, befehle, label = 'Test', quelle = 'andreas') => s.aendern({ rev: s.aktuell().j.projekt.rev, label, befehle }, quelle);
const projekt = (s) => s.aktuell().j.projekt;
const clips = (s) => projekt(s).spuren[0].clips;
const stand = (s) => JSON.stringify([projekt(s).tempo_bpm, clips(s).map((c) => [c.id, c.start_beat, c.laenge_beats, c.loop_beats ?? null, c.warp ?? null])]);
const eintraege = (s) => s.verlaufListe().j.length;
async function offen(s, n = 6, extra = {}) {
  await s.neu('Hand', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]);
  await aendern(s, [clipNeu(n, extra)]);
}

// Die Befehle von Hand, je Task kommt eine Zeile dazu. Clip c1 ist der Track 6: 40 Marker, Eins bei Karten-Beat 2 (Quellzeit 1,5 s) → Marker-Beat 0, Länge 47
const BEFEHLE = [
  ['warp_tempo', { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }],
  ['warp_marker setzen', { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1.75 }] }],
  ['warp_marker löschen', { befehl: 'warp_marker', clip_id: 'c1', loesche: [3] }],
  ['warp_marker verschieben', { befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 3, neu_quell_s: 3.1 }] }],
  ['warp_ab_hier gerade', { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 10, art: 'gerade' }],
  ['eins_hier', { befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }],
  ['tempo_vom_clip', { befehl: 'tempo_vom_clip', clip_id: 'c1' }],
  ['warp_ab_hier start', { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 10, art: 'start' }],
];

test('AK21: jeder Befehl ist ein Verlaufseintrag und ein Undo-Schritt; Redo stellt ihn her', async (t) => {
  for (const [name, b] of BEFEHLE) {
    const { s } = aufbau(t, { analysierer: null });
    await offen(s);
    await aendern(s, [{ befehl: 'tempo_setzen', bpm: 128 }]);   // sonst ändert tempo_vom_clip nichts: die Karte hat 120
    const vorher = stand(s), n0 = eintraege(s), l0 = clips(s)[0].laenge_beats;
    const r = await aendern(s, [b], name);
    assert.equal(r.code, 200, `${name}: ${JSON.stringify(r.j).slice(0, 200)}`);
    const nachher = stand(s);
    assert.notEqual(nachher, vorher, `${name} ändert das Projekt`);
    assert.equal(eintraege(s), n0 + 1, `${name}: genau ein Verlaufseintrag`);
    const l1 = clips(s)[0].laenge_beats;   // getrennt vom Stand: die Clip-Länge muss beim ×2 eigens verdoppelt werden (AK21)
    if (name === 'warp_tempo') assert.equal(l1, l0 * 2, `${name}: laenge_beats doppelt`);
    const u = await s.umkehr('undo', { rev: projekt(s).rev }, 'andreas');
    assert.equal(u.code, 200); assert.equal(stand(s), vorher, `${name}: ein Undo stellt den Stand davor her`);
    assert.equal(clips(s)[0].laenge_beats, l0, `${name}: Undo stellt laenge_beats her`);
    const w = await s.umkehr('redo', { rev: projekt(s).rev }, 'andreas');
    assert.equal(w.code, 200); assert.equal(stand(s), nachher, `${name}: Redo`);
    assert.equal(clips(s)[0].laenge_beats, l1, `${name}: Redo stellt laenge_beats her`);
  }
});

test('warp_tempo ×2: die Wiedergabe trägt die doppelten Beats, die Clip-Länge ist doppelt, jedes Segment-Tempo verdoppelt (proj_warp)', async (t) => {
  const { s, arr } = aufbau(t);
  await offen(s);
  const vor = s.warpLage('c1', null, null, null, 4096).j;
  assert.equal(vor.laenge_beats, 47);
  await aendern(s, [{ befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }], 'Tempo x2');
  const nach = s.warpLage('c1', null, null, null, 4096).j;
  assert.equal(nach.laenge_beats, 94, 'AK21: Clip-Länge in Beats doppelt');
  assert.equal(nach.warp.quelle, 'hand');
  assert.deepEqual(nach.warp.marker.map((m) => m.segment_bpm).slice(0, 39), vor.warp.marker.map((m) => m.segment_bpm * 2).slice(0, 39), 'AK21: alle Segment-BPM verdoppelt');
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000));
  const dat = path.join(arr, `wiedergabe-${projekt(s).wiedergabe_rev}.json`);
  assert.ok(await warteBis(() => fs.existsSync(dat) && lies(dat).spuren[0]?.clips.length === 1, 15000));
  const w = lies(dat).spuren[0].clips[0].warp.w;
  assert.deepEqual(w[2], [0, 72000]); assert.deepEqual(w[3], [2, 96000], 'Marker 3: Quellzeit 2,0 s = Frame 96000 bei Beat 2 statt 1');
});

test('tempo_vom_clip: das Projekttempo wird das Fenstertempo des Clips (Karte: 120), über tempo_setzen, mit den Sperren des Tempos', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  assert.equal(projekt(s).tempo_bpm, 120, 'Ausgangslage: das Projekttempo ist schon 120');
  await aendern(s, [{ befehl: 'tempo_setzen', bpm: 128 }]);
  const r = await aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }], 'Set project tempo');
  assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 200)); assert.equal(projekt(s).tempo_bpm, 120);
  await aendern(s, [{ befehl: 'tempo_setzen', bpm: 128 }]);
  s.lage.decks.set(1, 2);                                      // ein Deck spielt
  assert.equal((await fehlerVon(aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }])))?.fehler, 'deck_laeuft', 'die Sperre des Tempos greift');
  assert.equal(projekt(s).tempo_bpm, 128);
  s.lage.decks.clear();
  // der Befehl sieht den Stand nach den Befehlen davor: nach :2 hat der Clip 60 BPM, nach ×2 wären es 240 (außerhalb 60..200: alles oder nichts)
  const halb = await aendern(s, [{ befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 }, { befehl: 'tempo_vom_clip', clip_id: 'c1' }]);
  assert.equal(halb.code, 200); assert.equal(projekt(s).tempo_bpm, 60);
  const vor = stand(s);
  const e = await fehlerVon(aendern(s, [{ befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 },
    { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }, { befehl: 'tempo_vom_clip', clip_id: 'c1' }]));
  assert.equal(e?.fehler ?? e?.grund, 'tempo_bereich'); assert.equal(stand(s), vor, 'nichts geändert');
  const ohne = await fehlerVon(aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c9' }]));
  assert.equal(ohne?.fehler ?? ohne?.grund, 'clip_unbekannt');
});

test('tempo_vom_clip mit verbogener Karte: das Fenstertempo ist das Mittel über das gespielte Stück, nicht das erste oder letzte Segment', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  // Marker ab Beat 20 weg, dafür (20,0 s, Beat 40): die Beats 19 bis 40 laufen mit 140 BPM, dahinter gilt dieses Randsegment. Das erste Segment bleibt 120 BPM.
  await aendern(s, [{ befehl: 'warp_marker', clip_id: 'c1', loesche: Array.from({ length: 18 }, (_, i) => i + 20) }, { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 20, beat: 40 }] }]);
  const w = s.warpLage('c1', null, null, null, 4096).j.warp;
  assert.deepEqual([w.marker[0].segment_bpm, w.marker.at(-2).segment_bpm], [120, 140], 'Aufbau: erstes Segment 120, letztes 140');
  assert.equal(clips(s)[0].laenge_beats, 47);
  // Fenster: Beat 0 bei 1,5 s; Beat 47 liegt 7 Beats hinter dem letzten Marker (Beat 40 bei 20 s) bei 140 BPM, also bei 23 s: 60 · 47 / 21,5 = 131,163
  await aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }]);
  assert.equal(projekt(s).tempo_bpm, 131.163);
  assert.notEqual(projekt(s).tempo_bpm, 120, 'nicht das erste Segment'); assert.notEqual(projekt(s).tempo_bpm, 140, 'nicht das letzte');
});

test('Warp From Here (Start): rechts vom Beat gilt der Auto-Warp der Karte, am Anschluss ohne Sprung; hinter der Karte kein_tempo', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  // erst von Hand verbiegen: ab Beat 10 (Quellzeit 6,5) bleibt nur ein langsames Segment (43,6 BPM) bis Quellzeit 12
  await aendern(s, [{ befehl: 'warp_marker', clip_id: 'c1', loesche: Array.from({ length: 27 }, (_, i) => i + 11) }, { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 12, beat: 14 }] }]);
  const verbogen = s.warpLage('c1', null, null, null, 4096).j.warp.marker;
  assert.ok(verbogen.length < 20);
  const r = await aendern(s, [{ befehl: 'warp_ab_hier', clip_id: 'c1', beat: 10, art: 'start' }], 'Warp from here (start)');
  assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 200));
  const w = s.warpLage('c1', null, null, null, 4096).j.warp;
  assert.equal(w.quelle, 'hand'); assert.equal(w.marker.find((m) => m.beat === 10).quell_s, 6.5, 'der Anschluss liegt, wo der Clip bei Beat 10 klang');
  const rechts = w.marker.filter((m) => m.beat > 10);
  assert.ok(rechts.length > 10, 'die Marker der Karte stehen wieder, nicht die verbogenen');
  assert.ok(rechts.every((m) => Math.abs(m.segment_bpm ?? 120) === 120 || m.segment_bpm === null), 'rechts 120 BPM wie die Karte');
  assert.equal(w.marker.find((m) => m.beat === 11).quell_s, 7, 'Beat 11 einen halben Schlag (0,5 s) hinter Beat 10');
  assert.equal((await fehlerVon(aendern(s, [{ befehl: 'warp_ab_hier', clip_id: 'c1', beat: 5000, art: 'start' }])))?.fehler, 'kein_tempo', 'hinter der Karte: kein Tempo für den Rest');
});

// Die Python-Seite liest, was TypeScript schrieb: Schema korrektur.schema.json und die Regel der Kette (kette.eins_und_hotcues)
function pythonLiest(materialOrdner) {
  const py = process.env.CYPHERDJ_PYTHON ?? path.join(REPO_PFADE.werkstatt, '.venv', 'bin', 'python');
  const code = ['import json,sys', 'from pathlib import Path', 'from werkstatt import bestand, kette', 'o = Path(sys.argv[1])',
    'z = bestand.korrekturen_lesen(o)', '[bestand.pruefe("korrektur.schema.json", x) for x in z]',
    'm = bestand.lies_json(o / "material.json")', 'print(json.dumps({"zeilen": len(z), "eins": kette.eins_und_hotcues(m, z)[0]}))'].join('\n');
  const r = spawnSync(py, ['-c', code, materialOrdner], { cwd: REPO_PFADE.werkstatt, encoding: 'utf8' });
  assert.equal(r.status, 0, `python: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('Set 1.1.1 Here → korrekturen.jsonl: eine Zeile von andreas im Bestand, gültig nach Schema, die Kette liest die neue Lage; der nächste Auto-Warp übernimmt sie', async (t) => {
  const { s, bestand } = aufbau(t, {}, true);
  await offen(s);
  const ordner = path.join(bestand, ksha(6).slice(0, 16));
  assert.equal(fs.existsSync(path.join(ordner, 'korrekturen.jsonl')), false, 'Ausgangslage: keine Korrektur');
  // Quellzeit 3,0 s = Karten-Beat 5 (0,5 + 5 · 0,5): Lage 1
  const r = await aendern(s, [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }], 'Set 1.1.1 here');
  assert.equal(r.code, 200); assert.deepEqual(r.j.hinweise, [{ index: 0, hinweis: 'eins_gemeldet' }]);
  const zeilen = fs.readFileSync(path.join(ordner, 'korrekturen.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z));
  assert.equal(zeilen.length, 1);
  assert.deepEqual([zeilen[0].von, zeilen[0].art, zeilen[0].fassung, zeilen[0].ab_quell_beat, zeilen[0].bis_quell_beat], ['andreas', 'eins', '128000_r1', 5, null]);
  assert.deepEqual(pythonLiest(ordner), { zeilen: 1, eins: 1 }, 'Schema gültig; die Kette liest Lage 1 statt der 2 aus der Analyse');
  // der nächste Auto-Warp dieses Tracks (zweiter Clip) nimmt die Korrektur: Eins = Karten-Beat 1, sicher
  await aendern(s, [clipNeu(6, { start_beat: 100 })]);
  const neu = s.warpLage('c2', null, null, null, 4096).j.warp;
  assert.equal(neu.eins_unsicher, false); assert.equal(neu.marker[0].beat, -1, 'erster Marker = Karten-Beat 0 − Eins 1');
  assert.equal((beatBeiQuelle(neu.marker.map((m) => [m.quell_s, m.beat]), 3)) % 4, 0, 'die Stelle 3,0 s liegt auf einer Eins (Beat durch 4 teilbar)');
  // Verlauf: das Projekt ist die Wahrheit des Clips, das Deck die der Analyse; Undo nimmt nur das Projekt zurück
  await s.umkehr('undo', { rev: projekt(s).rev }, 'andreas');
});
test('Set 1.1.1 Here: ohne Bestand-Material, bei fremder sha, ohne Fassung und bei Schreibfehler → Hinweis, die Projektänderung gilt trotzdem', async (t) => {
  // kein Bestand angeschlossen
  const a = aufbau(t); await offen(a.s);
  const ra = await aendern(a.s, [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }]);
  assert.deepEqual(ra.j.hinweise, [{ index: 0, hinweis: 'eins_nur_hier' }]); assert.equal(clips(a.s)[0].warp.quelle, 'hand');
  // Bestand mit anderer sha im Dokument (Gegenprobe schlägt an)
  const b = aufbau(t, {}, true, { quellSha: ksha(99) }); await offen(b.s);
  const rb = await aendern(b.s, [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }]);
  assert.deepEqual(rb.j.hinweise, [{ index: 0, hinweis: 'eins_nur_hier' }]);
  assert.equal(fs.existsSync(path.join(b.bestand, ksha(6).slice(0, 16), 'korrekturen.jsonl')), false);
  // Material ohne Fassung: nichts, was das Deck neu rechnen könnte
  const c = aufbau(t, {}, true, { fassungen: [] }); await offen(c.s);
  assert.deepEqual((await aendern(c.s, [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }])).j.hinweise, [{ index: 0, hinweis: 'eins_nur_hier' }]);
  // Schreibfehler: der Ordner ist nicht beschreibbar
  const d = aufbau(t, {}, true); await offen(d.s);
  const ordner = path.join(d.bestand, ksha(6).slice(0, 16));
  fs.chmodSync(ordner, 0o555);
  let rd;
  try { rd = await aendern(d.s, [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }]); } finally { fs.chmodSync(ordner, 0o755); }
  assert.equal(rd.code, 200); assert.deepEqual(rd.j.hinweise, [{ index: 0, hinweis: 'eins_rueckweg_fehler' }]);
  assert.equal(clips(d.s)[0].warp.quelle, 'hand', 'die Projektänderung gilt trotz des Schreibfehlers');
  assert.ok(d.k.protokoll.some((z) => z.typ === 'eins_korrektur_fehler'), 'und steht im Protokoll');
  // Positivkontrolle derselben Anordnung: beschreibbar → geschrieben
  const re = await aendern(d.s, [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3.5 }]);
  assert.deepEqual(re.j.hinweise, [{ index: 0, hinweis: 'eins_gemeldet' }]);
  assert.equal(pythonLiest(ordner).zeilen, 1);
});
test('Eins-Korrektur aus dem Bestand beim Auto-Warp (D3): von andreas macht die Eins sicher, von werkstatt nicht; ohne Bestand bleibt die Eins der Analyse', async (t) => {
  const fall = async (opt, korrekturen) => {
    const e = aufbau(t, {}, opt, { korrekturen });
    await offen(e.s);
    return clips(e.s)[0].warp;
  };
  const ohne = await fall(false, []);
  assert.deepEqual([ohne.marker[0][1], ohne.eins_unsicher], [-2, true], 'Negativkontrolle: ohne Bestand Eins 2 und unsicher');
  const leer = await fall(true, []);
  assert.deepEqual([leer.marker[0][1], leer.eins_unsicher], [-2, true], 'Bestand ohne Korrektur ändert nichts');
  const hand = await fall(true, [{ von: 'andreas', ab_quell_beat: 1 }]);
  assert.deepEqual([hand.marker[0][1], hand.eins_unsicher], [-1, undefined], 'andreas: Lage 1, sicher');
  const kette = await fall(true, [{ von: 'andreas', ab_quell_beat: 3 }, { von: 'andreas', ab_quell_beat: 133 }]);
  assert.equal(kette.marker[0][1], -1, 'die letzte Zeile gilt, Lage = ab_quell_beat mod 4 (133 mod 4 = 1)');
  const werk = await fall(true, [{ von: 'werkstatt', ab_quell_beat: 0 }]);
  assert.deepEqual([werk.marker[0][1], werk.eins_unsicher], [0, true], 'werkstatt: Lage 0, aber unsicher bleibt');
  const raster = await fall(true, [{ von: 'andreas', art: 'raster', ab_quell_beat: 1 }]);
  assert.deepEqual([raster.marker[0][1], raster.eins_unsicher], [-2, true], 'andere Arten zählen nicht');
});

test('AK28: Cypher setzt Marker, ×2 und Set 1.1.1 über die Sitzung (Quelle cypher im Verlauf), liest sie mit warpLage zurück; KI-Stopp lehnt jeden Befehl ab', async (t) => {
  const { s, k } = aufbau(t);
  await offen(s);
  const r = await aendern(s, [{ befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1.75 }] }, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 },
    { befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }], 'Cypher editiert', 'cypher');
  assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 200));
  assert.equal(s.verlaufListe().j.at(-1).quelle, 'cypher');
  const w = s.warpLage('c1', null, null, null, 4096).j.warp;
  assert.equal(w.marker_zahl, 41); assert.equal(w.quelle, 'hand'); assert.equal(w.eins_unsicher, false);
  assert.equal(w.marker.find((m) => m.quell_s === 3).beat, 0, 'die Stelle 3,0 s ist Beat 0');
  k.ki = true;
  for (const [name, b] of BEFEHLE) {
    const e = await fehlerVon(aendern(s, [b], name, 'cypher'));
    assert.equal(e?.fehler, 'ki_gestoppt', `${name}: KI-Stopp`);
  }
  const andreas = await aendern(s, [BEFEHLE[0][1]], 'Andreas', 'andreas');
  assert.equal(andreas.code, 200, 'Negativkontrolle: Andreas ist vom KI-Stopp nicht betroffen');
});

test('tempo_vom_clip: die Aufnahme-Sperre des Tempos greift (beschaeftigt, Tempo bleibt); nach dem Ende der Aufnahme geht es durch', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  await aendern(s, [{ befehl: 'tempo_setzen', bpm: 128 }]);
  s.setzeAufnahmeLauf({});
  const e = await fehlerVon(aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }]));
  assert.equal(e?.fehler ?? e?.grund, 'beschaeftigt'); assert.equal(projekt(s).tempo_bpm, 128, 'das Tempo bleibt');
  s.setzeAufnahmeLauf(null);
  const ok = await aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }]);
  assert.equal(ok.code, 200); assert.equal(projekt(s).tempo_bpm, 120);
});

test('tempo_vom_clip mit loop_beats: das Fenster ist die Loop-Länge, nicht die Clip-Länge (verbogene Karte)', async (t) => {
  const { s } = aufbau(t);
  await offen(s);
  await aendern(s, [{ befehl: 'warp_marker', clip_id: 'c1', loesche: Array.from({ length: 18 }, (_, i) => i + 20) }, { befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 20, beat: 40 }] }]);
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 30 }]);
  const w = s.warpLage('c1', null, null, null, 4096).j.warp.marker.map((m) => [m.quell_s, m.beat]);
  const erwartet = Math.round(60 * 30 / (quellSekunde(w, 30) - quellSekunde(w, 0)) * 1000) / 1000;
  await aendern(s, [{ befehl: 'tempo_vom_clip', clip_id: 'c1' }]);
  assert.equal(projekt(s).tempo_bpm, erwartet);
  assert.notEqual(erwartet, 131.163, 'Negativkontrolle: nicht das Tempo der ganzen Clip-Länge (47 Beats)');
});

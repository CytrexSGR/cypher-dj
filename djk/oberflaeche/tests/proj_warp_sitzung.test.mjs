// Paket 1.13 Warp, Slice 1 (Sitzung): clip_neu mit warp "auto" und warp_auto lösen das Tempo aus dem Katalog auf (loop mit takte, track mit BPM, One-Shot
// nie, ohne Tempo ein Hinweis), die Wiedergabe wird /2 mit den Markern, proj_lage zeigt den Warp ohne Marker-Liste, proj_warp (warpLage) liest sie mit
// Segment-Tempo und der Gegenprobe W(bei_beat).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sitzung, wav, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));

function aufbau(t) {
  const d = tmpOrdner(t, 'djk-warp-');
  const w = wav(path.join(d, 'daten'), 'loop.wav', 3.84), kick = wav(path.join(d, 'daten'), 'kick.wav', 0.25);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 1, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w },                  // 2 Takte bei 125 BPM
    { n: 2, typ: 'oneshot', instrument: 'kick', dauer_s: 0.25, pfad: kick },
    { n: 3, typ: 'track', werk_id: 1, titel: 'Song', bpm: 128, dauer_s: 3.84, pfad: w }, // nur BPM
    { n: 4, typ: 'loop', dauer_s: 3.84, pfad: w },                                       // ohne Tempo
    { n: 5, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w, schutz: 'ableton' },
  ]);
  return sitzung(t, { katalog });
}
const clipNeu = (n, extra = {}) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: ksha(n), warp: 'auto', ...extra });
const aendern = (s, befehle, label = 'Test') => s.aendern({ rev: s.aktuell().j.projekt.rev, label, befehle }, 'andreas');
const clips = (s) => s.aktuell().j.projekt.spuren[0].clips;
const stand = (s) => clips(s).map((c) => [c.id, c.start_beat, c.laenge_beats, c.warp ?? null]);   // ohne dekodiert: das ändert sich von allein

test('clip_neu warp auto: Loop mit Takten → Warp aus dem Katalog, Länge aus der Karte; Wiedergabe /2 mit den Markern', async (t) => {
  const { s, arr } = aufbau(t);
  await s.neu('Warp', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]);
  const r = await aendern(s, [clipNeu(1)]);
  assert.equal(r.j.hinweise, undefined, 'kein Hinweis, das Tempo war bekannt');
  const c = clips(s)[0];
  // D10 (Nachbesserung 4): ein Loop ohne Drum-Angabe im Katalog bekommt COMPLEX (Tonhöhe bleibt), die Wiedergabe trägt Modus 2
  assert.deepEqual(c.warp, { an: true, modus: 'complex', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 });
  assert.equal(c.laenge_beats, 8, 'die Länge kommt aus dem Warp (2 Takte), nicht aus dem Rückfall 1');
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000), 'der Clip wird dekodiert');
  assert.ok(await warteBis(() => lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`)).spuren[0]?.clips.length === 1, 15000));
  const w = lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`));
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.spuren[0].clips[0].warp, { modus: 2, w: [[0, 0], [8, 184320]] });
});

test('clip_neu warp auto: Track mit BPM (eins_unsicher), One-Shot nie, ohne Tempo Hinweis kein_tempo; Ableton-Schutz bleibt', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Warp2', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }]);
  await aendern(s, [clipNeu(3)]);
  const track = clips(s)[0];
  assert.equal(track.warp.quelle, 'mediathek'); assert.equal(track.warp.eins_unsicher, true);
  assert.ok(Math.abs(track.laenge_beats - 3.84 * 128 / 60) < 1e-12);
  const one = await aendern(s, [clipNeu(2, { laenge_beats: 0.5, start_beat: 40 })]);
  const kick = clips(s)[1];
  assert.equal('warp' in kick, false, 'One-Shot warpt nie'); assert.equal(kick.laenge_beats, 0.5, 'die Länge des Aufrufers gilt'); assert.equal(one.j.hinweise, undefined);
  const ohne = await aendern(s, [clipNeu(4, { laenge_beats: 2, start_beat: 50 })]);
  assert.deepEqual(ohne.j.hinweise, [{ index: 0, hinweis: 'kein_tempo' }]);
  const stumm = clips(s)[2];
  assert.equal('warp' in stumm, false); assert.equal(stumm.laenge_beats, 2);
  const e = await fehlerVon(aendern(s, [clipNeu(5, { start_beat: 60 })]));
  assert.deepEqual([e.code, e.fehler], [409, 'nur_live']);
  // ohne warp-Argument bleibt alles wie bisher
  await aendern(s, [{ ...clipNeu(1, { start_beat: 70, laenge_beats: 3 }), warp: undefined }]);
  assert.equal('warp' in clips(s)[3], false); assert.equal(clips(s)[3].laenge_beats, 3);
});

test('warp_auto auf einem vorhandenen Clip: Warp aus dem Katalog, Länge bleibt; ohne Tempo 409 kein_tempo; Clip ohne Katalogeintrag', async (t) => {
  const { s, d, arr, wurzel } = aufbau(t);
  await s.neu('Warp3', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1, { warp: 'aus', laenge_beats: 3 }), clipNeu(4, { warp: 'aus', start_beat: 20, laenge_beats: 3 })]);
  assert.equal('warp' in clips(s)[0], false);
  await aendern(s, [{ befehl: 'warp_auto', clip_id: 'c1' }]);
  assert.equal(clips(s)[0].warp.quelle, 'takte'); assert.equal(clips(s)[0].laenge_beats, 3, 'die Länge ändert warp_auto nicht');
  const e = await fehlerVon(aendern(s, [{ befehl: 'warp_auto', clip_id: 'c2' }]));
  assert.deepEqual([e.code, e.fehler, e.extra.index], [409, 'kein_tempo', 0]);
  const e2 = await fehlerVon(aendern(s, [{ befehl: 'warp_auto', clip_id: 'c9' }]));
  assert.equal(e2.grund, 'clip_unbekannt', 'der Befehl meldet es (der Bereich bildet es auf 404 ab)');
  // ein Clip derselben Liste existiert vor dem Batch noch nicht: der Grund sagt das (nicht „braucht den Katalog“, nicht clip_unbekannt)
  const e3 = await fehlerVon(aendern(s, [clipNeu(1, { warp: 'aus', start_beat: 40 }), { befehl: 'warp_auto', clip_id: 'c3' }]));
  assert.deepEqual([e3.code, e3.fehler, e3.extra.index], [409, 'warp_auto_neuer_clip', 1]);
  // ohne Katalog (503 katalog_fehlt) und mit einem Katalog ohne diesen Eintrag (404 sha_unbekannt): die Sitzung wird neu auf denselben Ordnern geöffnet
  const slug = s.aktuell().j.slug, vorher = stand(s);
  s.schliesse();
  const ohneKatalog = sitzung(t, { wurzel, arbeitsordner: arr });
  await ohneKatalog.s.oeffnen(slug, 'andreas');
  const e4 = await fehlerVon(aendern(ohneKatalog.s, [{ befehl: 'warp_auto', clip_id: 'c1' }]));
  assert.deepEqual([e4.code, e4.fehler, e4.extra.index], [503, 'katalog_fehlt', 0], 'warp_auto ohne Katalog');
  const e5 = await fehlerVon(aendern(ohneKatalog.s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1, { start_beat: 80 })]));
  assert.deepEqual([e5.code, e5.fehler, e5.extra.index], [503, 'katalog_fehlt', 1], 'clip_neu mit warp auto ohne Katalog');
  assert.deepEqual(stand(ohneKatalog.s), vorher, 'nichts wurde geändert');
  ohneKatalog.s.schliesse();   // das Projekt hält seine Sperre, bis die Sitzung zu ist
  const andererKatalog = baueKatalog(path.join(d, 'kat2'), [{ n: 9, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84 }]);
  const fremd = sitzung(t, { katalog: andererKatalog, wurzel, arbeitsordner: arr });
  await fremd.s.oeffnen(slug, 'andreas');
  const e6 = await fehlerVon(aendern(fremd.s, [{ befehl: 'warp_auto', clip_id: 'c1' }]));
  assert.deepEqual([e6.code, e6.fehler, e6.extra.index], [404, 'sha_unbekannt', 0], 'warp_auto auf einen Clip, dessen sha der Katalog nicht kennt');
  assert.deepEqual(stand(fremd.s), vorher, 'nichts wurde geändert');
});

test('proj_lage zeigt den Warp ohne Marker-Liste; proj_warp liest Marker, Segment-Tempo und die Gegenprobe W(bei_beat)', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Warp4', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1)]);
  const lage = s.aktuell('noten_zahl').j.projekt.spuren[0].clips[0];
  assert.equal(lage.warp.marker, undefined); assert.equal(lage.warp.marker_zahl, 2); assert.equal(lage.warp.quelle, 'takte');
  assert.equal(s.aktuell().j.projekt.spuren[0].clips[0].warp.marker.length, 2, 'die Seite bekommt alles');
  const j = s.warpLage('c1', null, null, 6).j;
  assert.equal(j.warp.marker_zahl, 2); assert.equal(j.warp.marker[0].projekt_beat, 4); assert.equal(j.warp.marker[1].projekt_beat, 12);
  assert.ok(Math.abs(j.warp.marker[0].segment_bpm - 125) < 1e-9); assert.equal(j.warp.marker[1].segment_bpm, null);
  assert.ok(Math.abs(j.bei.quell_s - 0.96) < 1e-12, 'Projekt-Beat 6 = Clip-Beat 2 = 0,96 s');
  assert.equal(s.warpLage('c1', 5, 20, null).j.warp.marker.length, 1, 'von_beat/bis_beat filtern nach Projekt-Beat');
  assert.deepEqual(s.warpLage('c1', null, null, null).j.bei, undefined);
  const e = await fehlerVon(Promise.resolve().then(() => s.warpLage('c9', null, null, null)));
  assert.deepEqual([e.code, e.fehler], [404, 'clip_unbekannt']);
  await aendern(s, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 30, laenge_beats: 1, sha256: ksha(2) }]);
  assert.equal(s.warpLage('c2', null, null, null).j.warp, null, 'Clip ohne Warp: warp null');
});

// Slice 5 (AK28): Cypher stellt Transpose und Detune über proj_aendern ein und liest sie mit proj_lage und proj_warp zurück; die Wiedergabe trägt pitch;
// der KI-Stopp gilt unverändert (kein neuer Mechanismus); ein Warp-Wechsel auf RE-PITCH ohne Nullen bleibt abgelehnt.
test('Transpose über die Sitzung (AK28): warp_setzen von cypher, proj_lage und proj_warp zeigen es, Verlauf cypher, Wiedergabe trägt pitch; KI-Stopp: ki_gestoppt', async (t) => {
  const { s, k, arr } = aufbau(t);
  await s.neu('Warp5', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1)]);
  assert.ok(await warteBis(() => clips(s)[0].dekodiert === 'fertig', 15000), 'der Clip wird dekodiert');
  const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Up a fifth', befehle: [{ befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 7 }] }, 'cypher');
  assert.equal(r.code, 200);
  assert.equal(s.aktuell('noten_zahl').j.projekt.spuren[0].clips[0].warp.transpose_st, 7, 'proj_lage');
  assert.equal(s.warpLage('c1', null, null, null).j.warp.transpose_st, 7, 'proj_warp');
  assert.equal(s.warpLage('c1', null, null, null).j.warp.detune_ct, 0);
  assert.equal(s.verlaufListe().j.at(-1).quelle, 'cypher'); assert.equal(s.verlaufListe().j.at(-1).label, 'Up a fifth');
  const nr = () => s.aktuell().j.projekt.wiedergabe_rev;
  assert.ok(await warteBis(() => { try { return lies(path.join(arr, `wiedergabe-${nr()}.json`)).spuren[0]?.clips.length === 1; } catch { return false; } }, 15000));
  assert.deepEqual(lies(path.join(arr, `wiedergabe-${nr()}.json`)).spuren[0].clips[0].warp, { modus: 2, w: [[0, 0], [8, 184320]], pitch: 1.4983070768766815 });
  const e = await fehlerVon(aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', modus: 'repitch' }]));
  assert.deepEqual([e.code ?? 409, e.grund ?? e.fehler], [409, 'transpose_repitch'], 'RE-PITCH mit Transpose bleibt abgelehnt');
  k.ki = true;
  const g = await fehlerVon(s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'stop', befehle: [{ befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 5 }] }, 'cypher'));
  assert.deepEqual([g.code, g.fehler], [409, 'ki_gestoppt']);
  assert.equal(clips(s)[0].warp.transpose_st, 7, 'der Stopp hat nichts geändert');
  assert.equal((await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Andreas', befehle: [{ befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 5 }] }, 'andreas')).code, 200);
});

// N4-7 (Nachbesserung 4): Rundreise über die Platte. Ein Projekt mit gewarpten Clips (Auto-Warp aus Takten, aus der Library-BPM, ein Warp von Hand mit
// drei Markern und Versatz) wird gespeichert, die Sitzung endet, eine neue Sitzung auf denselben Ordnern öffnet es wieder: project.json trägt das
// Format /2 und den Warp, das Öffnen liefert denselben Warp, und die neu geschriebene Wiedergabe gleicht der vorherigen (ohne die Nummer).
// Gegenprobe: ein Projekt ohne Warp bleibt auf der Platte ohne Warp-Feld und seine Wiedergabe bleibt /1.
function rundreiseAufbau(t) {
  const d = tmpOrdner(t, 'djk-warp-rr-');
  const w = wav(path.join(d, 'daten'), 'loop.wav', 3.84), kick = wav(path.join(d, 'daten'), 'kick.wav', 0.25);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 1, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w },
    { n: 2, typ: 'oneshot', instrument: 'kick', dauer_s: 0.25, pfad: kick },
    { n: 3, typ: 'track', werk_id: 1, titel: 'Song', bpm: 128, dauer_s: 3.84, pfad: w },
  ]);
  const a = sitzung(t, { katalog });
  // null, solange die Datei noch nicht geschrieben ist (das Schreiben folgt dem Dekodieren)
  const wiedergabe = (arr, s) => { try { return lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`)); } catch { return null; } };
  const warpDerClips = (s) => s.aktuell().j.projekt.spuren[0].clips.map((c) => c.warp ?? null);
  return { a, katalog, wiedergabe, warpDerClips };
}
const VON_HAND = { an: true, modus: 'repitch', marker: [[0, 0], [1.2, 2], [3.84, 8]], versatz_beats: 0.5, quelle: 'hand', transpose_st: 0, detune_ct: 0 };

test('Rundreise über die Platte: gespeichert, neu geöffnet in einer neuen Sitzung: derselbe Warp, dieselbe Wiedergabe /2', async (t) => {
  const { a, katalog, wiedergabe, warpDerClips } = rundreiseAufbau(t);
  const s = a.s;
  await s.neu('Rundreise', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1), clipNeu(3, { start_beat: 20 }), clipNeu(2, { start_beat: 40, laenge_beats: 0.5 }),
    clipNeu(1, { start_beat: 50, warp: 'aus', laenge_beats: 4 })]);
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c4', warp: VON_HAND }, { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 1.5 }]);
  const vorher = warpDerClips(s);
  assert.equal(vorher.filter((x) => x).length, 3, 'drei Clips mit Warp (Takte, Library-BPM, von Hand), der One-Shot ohne');
  assert.equal(vorher[0].versatz_beats, 1.5); assert.equal(vorher[1].quelle, 'mediathek'); assert.equal(vorher[1].eins_unsicher, true); assert.deepEqual(vorher[3], VON_HAND);
  assert.equal(vorher[2], null, 'der One-Shot hat keinen Warp');
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].clips.every((c) => c.dekodiert === 'fertig'), 15000), 'alle Clips dekodiert');
  assert.ok(await warteBis(() => wiedergabe(a.arr, s)?.spuren[0]?.clips.length === 4, 15000), 'die Wiedergabe trägt alle vier Clips');
  const vorW = wiedergabe(a.arr, s), slug = s.aktuell().j.slug;
  assert.equal(vorW.format, 'cypherdj-arr/2');
  assert.equal(vorW.spuren[0].clips.filter((c) => c.warp).length, 3, 'drei Clips mit Warp in der Wiedergabe');
  // auf der Platte: project.json (Format /2) trägt den Warp in der Form des Speichers
  const platte = lies(path.join(a.wurzel, slug, 'project.json'));
  assert.equal(platte.format, 'cypherdj-projekt/2');
  assert.deepEqual(platte.spuren[0].clips.map((c) => c.warp ?? null), vorher, 'der Warp auf der Platte gleicht dem im Speicher');
  assert.equal('warp' in platte.spuren[0].clips[2], false, 'der One-Shot trägt auf der Platte kein Warp-Feld');
  s.schliesse();
  // neue Sitzung auf denselben Ordnern = Server-Neustart
  const b = sitzung(t, { katalog, wurzel: a.wurzel, arbeitsordner: a.arr });   // b.arr und b.wurzel sind die Ordner einer ungenutzten Hülle: gelesen wird a.arr
  const r = await b.s.oeffnen(slug, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(warpDerClips(b.s), vorher, 'nach dem Öffnen derselbe Warp, Clip für Clip');
  assert.ok(await warteBis(() => b.s.aktuell().j.projekt.spuren[0].clips.every((c) => c.dekodiert === 'fertig'), 15000));
  assert.ok(await warteBis(() => wiedergabe(a.arr, b.s)?.spuren[0]?.clips.length === 4, 15000));
  const nachW = wiedergabe(a.arr, b.s);
  assert.notEqual(nachW.nr, vorW.nr, 'eine neue Wiedergabe wurde geschrieben, nicht die alte gelesen');
  const { nr: _a, ...vorOhneNr } = vorW, { nr: _b, ...nachOhneNr } = nachW;
  assert.deepEqual(nachOhneNr, vorOhneNr, 'die Wiedergabe nach der Rundreise gleicht der vorherigen, Zeichen für Zeichen (ohne Nummer)');
  b.s.schliesse();
});

test('Rundreise, Gegenprobe: ein Projekt ohne Warp bleibt auf der Platte ohne Warp-Feld, die Wiedergabe /1', async (t) => {
  const { a, katalog, wiedergabe } = rundreiseAufbau(t);
  await a.s.neu('Ohne', 'andreas');
  await aendern(a.s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(2, { start_beat: 4, laenge_beats: 0.5 }), clipNeu(1, { start_beat: 8, warp: 'aus', laenge_beats: 4 })]);
  assert.ok(await warteBis(() => a.s.aktuell().j.projekt.spuren[0].clips.every((c) => c.dekodiert === 'fertig'), 15000));
  assert.ok(await warteBis(() => wiedergabe(a.arr, a.s)?.spuren[0]?.clips.length === 2, 15000));
  const slug = a.s.aktuell().j.slug, vorW = wiedergabe(a.arr, a.s);
  assert.equal(vorW.format, 'cypherdj-arr/1');
  assert.equal(JSON.stringify(lies(path.join(a.wurzel, slug, 'project.json'))).includes('"warp"'), false, 'auf der Platte kommt kein Warp-Feld vor');
  a.s.schliesse();
  const b = sitzung(t, { katalog, wurzel: a.wurzel, arbeitsordner: a.arr });   // b.arr und b.wurzel sind die Ordner einer ungenutzten Hülle: gelesen wird a.arr
  await b.s.oeffnen(slug, 'andreas');
  assert.ok(await warteBis(() => b.s.aktuell().j.projekt.spuren[0].clips.every((c) => c.dekodiert === 'fertig'), 15000));
  assert.ok(await warteBis(() => wiedergabe(a.arr, b.s)?.spuren[0]?.clips.length === 2, 15000));
  const nachW = wiedergabe(a.arr, b.s);
  assert.equal(nachW.format, 'cypherdj-arr/1');
  const { nr: _a, ...vorOhneNr } = vorW, { nr: _b, ...nachOhneNr } = nachW;
  assert.deepEqual(nachOhneNr, vorOhneNr);
  b.s.schliesse();
});

// Nachtrag zu Task 10 (Mutation M6 überlebte: bis_beat war in keinem Fall wirksam): die Marker liegen bei Projekt-Beat 4 und 12
test('proj_warp: bis_beat filtert nach Projekt-Beat (Mutation M6), von und bis zusammen, ein leerer Bereich liefert keine Marker', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Warp5', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1)]);
  const n = (von, bis) => s.warpLage('c1', von, bis, null).j.warp.marker.map((x) => x.projekt_beat);
  assert.deepEqual(n(null, null), [4, 12]);
  assert.deepEqual(n(null, 8), [4], 'bis_beat 8 schneidet den Marker bei 12 ab');
  assert.deepEqual(n(null, 12), [4, 12], 'die Grenze gehört dazu');
  assert.deepEqual(n(5, 11), [], 'zwischen den Markern: leer');
  assert.deepEqual(n(4, 12), [4, 12]);
});

// Review-Nachzug Task 10, Befund MAJOR: die Gegenprobe W(bei_beat) gilt je Loop-Kopie (jede Kopie beginnt wieder bei versatz_beats), nicht ausserhalb
// des Clips und nicht bei an false (dort spielt der Clip ungewarpt über offset_s). Der Clip: Start 0, Länge 16, Loop 4, Auto-Warp [[0,0],[3.84,8]]
// (0,48 s je Beat), die Kopien spielen je Beat 0 bis 4 des Warps.
test('proj_warp Gegenprobe: je Loop-Kopie, mit Versatz, ausserhalb des Clips und bei an false quell_s null mit warum', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Warp6', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1, { start_beat: 0 })]);
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 16, loop_beats: 4 }]);
  const bei = (b) => s.warpLage('c1', null, null, b).j.bei;
  const nah = (b, soll) => { const x = bei(b); assert.ok(x.quell_s !== null && Math.abs(x.quell_s - soll) < 1e-9, `bei ${b}: ${JSON.stringify(x)}, erwartet ${soll}`); assert.equal(x.warum, undefined); };
  nah(2, 0.96);     // erste Kopie
  nah(6, 0.96);     // zweite Kopie: Beat 2 der Kopie, nicht Beat 6 des Warps (2,88 s)
  nah(14, 0.96);    // vierte Kopie
  nah(4, 0);        // Kopie 1 beginnt wieder bei 0
  nah(15.5, 1.68);  // Beat 3,5 der letzten Kopie
  for (const b of [-3, -0.01, 16, 20]) assert.deepEqual(bei(b), { projekt_beat: b, quell_s: null, warum: 'ausserhalb' }, `bei ${b}: vor dem Clip oder ab seinem Ende (halboffen)`);
  // Versatz: jede Kopie beginnt bei Beat 1 des Warps
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 1 }]);
  nah(6, 1.44); nah(4, 0.48);
  // an false: die Marker bleiben, der Clip spielt ungewarpt über offset_s, es gibt keine Quellsekunde aus dem Warp
  await aendern(s, [{ befehl: 'warp_setzen', clip_id: 'c1', an: false }]);
  assert.deepEqual(bei(6), { projekt_beat: 6, quell_s: null, warum: 'warp_aus' });
  assert.deepEqual(bei(20), { projekt_beat: 20, quell_s: null, warum: 'ausserhalb' }, 'ausserhalb gilt vor warp_aus');
  assert.equal(s.warpLage('c1', null, null, null).j.warp.marker_zahl, 2, 'die Marker bleiben bei an false');
});

test('proj_warp Gegenprobe ohne Loop: Länge nicht ein Vielfaches, letzte Beat-Grenze; Negativ-Kontrolle gleicht dem bisherigen Fall', async (t) => {
  const { s } = aufbau(t);
  await s.neu('Warp7', 'andreas');
  await aendern(s, [{ befehl: 'spur_neu', art: 'audio' }, clipNeu(1)]);          // Start 4, Länge 8, kein Loop
  const bei = (b) => s.warpLage('c1', null, null, b).j.bei;
  assert.ok(Math.abs(bei(6).quell_s - 0.96) < 1e-12, 'ohne Loop wie bisher: Clip-Beat 2 = 0,96 s');
  assert.ok(Math.abs(bei(11.5).quell_s - 3.6) < 1e-9);
  assert.deepEqual(bei(12), { projekt_beat: 12, quell_s: null, warum: 'ausserhalb' }, 'Clip-Ende ist halboffen');
  assert.deepEqual(bei(3.99), { projekt_beat: 3.99, quell_s: null, warum: 'ausserhalb' });
  // Loop 3 bei Länge 8: die dritte Kopie hat nur 2 Beats
  await aendern(s, [{ befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 3 }]);
  assert.ok(Math.abs(bei(10.5).quell_s - 0.24) < 1e-9, 'Beat 6,5 des Clips = Beat 0,5 der dritten Kopie');
  assert.ok(Math.abs(bei(11.9).quell_s - 0.912) < 1e-9);
});

// Slice 3a (Task 6): proj_warp mit Zusammenfassung und Deckel; proj_lage mit festem Feld eins_unsicher
import { schreibeKarte, karteLinear } from './hilfen/karte.mjs';
async function mitKarte(t, n) {
  const d = tmpOrdner(t, 'djk-warpdeckel-');
  const w = wav(path.join(d, 'daten'), 'track.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 6, typ: 'track', werk_id: 2, titel: 'Song', bpm: 120, dauer_s: 1200, pfad: w }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(6), { karte: karteLinear(n, { t0: 0.5, bpm: 240 }), eins: 0, unsicher: false, dauer_s: 1200 });   // 240 BPM: 0,25 s je Beat
  const { s } = sitzung(t, { katalog, analyse });
  await s.neu('Deckel', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'y', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: ksha(6), warp: 'auto' }] }, 'andreas');
  return s;
}
test('proj_warp: ohne Wunsch höchstens 200 Marker, mit marker_zahl, marker_gezeigt, weiter_ab_projekt_beat, Tempo und erstem Marker; marker_max und von/bis begrenzen', async (t) => {
  const s = await mitKarte(t, 865);
  const j = s.warpLage('c1', null, null, null).j;
  assert.equal(j.warp.marker_zahl, 865); assert.equal(j.warp.marker.length, 200); assert.equal(j.warp.marker_gezeigt, 200);
  assert.equal(j.warp.weiter_ab_projekt_beat, 200, 'der 201. Marker liegt bei Projekt-Beat 200 (Clip-Start 0, Versatz 0)');
  assert.deepEqual(j.warp.erster_marker, { quell_s: 0.5, beat: 0 });
  assert.equal(j.warp.tempo.mittel_bpm, 240); assert.equal(j.warp.tempo.min_bpm, 240); assert.equal(j.warp.tempo.max_bpm, 240);
  const alle = s.warpLage('c1', null, null, null, 4096).j;
  assert.equal(alle.warp.marker.length, 865); assert.equal(alle.warp.weiter_ab_projekt_beat, undefined, 'alles gezeigt: kein Weiter');
  assert.equal(s.warpLage('c1', null, null, null, 5).j.warp.marker.length, 5);
  const fenster = s.warpLage('c1', 300, 310, null).j.warp;
  assert.equal(fenster.marker.length, 11); assert.equal(fenster.marker_gezeigt, 11); assert.equal(fenster.weiter_ab_projekt_beat, undefined);
  assert.equal(fenster.marker_zahl, 865, 'marker_zahl ist die Zahl im Clip, nicht die der Antwort');
  const grosses = s.warpLage('c1', 100, null, null, 50).j.warp;
  assert.equal(grosses.marker.length, 50); assert.equal(grosses.marker[0].projekt_beat, 100); assert.equal(grosses.weiter_ab_projekt_beat, 150);
});
test('proj_warp: bis zu 4096 Marker bleiben unter dem Deckel von 200 nicht kurz; die Antwort mit Vorgabe ist unter 20 KB, die ungefilterte Liste nicht (Negativ-Kontrolle)', async (t) => {
  const s = await mitKarte(t, 2000);
  assert.ok(JSON.stringify(s.warpLage('c1', null, null, null).j).length < 20000);
  assert.ok(JSON.stringify(s.warpLage('c1', null, null, null, 4096).j).length > 100000, 'ohne Deckel kämen 2000 Marker (rund 130 KB bei diesen runden Zahlen, 170 KB bei echten)');
});
test('proj_lage: eins_unsicher ist ein festes Feld (auch false), marker_zahl wie bisher, keine Marker-Liste', async (t) => {
  const s = await mitKarte(t, 40);
  const lage = s.aktuell('noten_zahl').j.projekt.spuren[0].clips[0].warp;
  assert.equal(lage.eins_unsicher, false); assert.equal(lage.marker_zahl, 40); assert.equal(lage.marker, undefined); assert.equal(lage.quelle, 'werkstatt');
});

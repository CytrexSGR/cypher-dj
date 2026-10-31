// Paket 1.13 Warp, Slice 1, Nachbesserung 4 / N4-1: die Projekt-Attrappe (pruef/proj_attrappe.mjs) kennt den Warp. Die Ablage der Seite schickt
// clip_neu mit warp 'auto' (ziehen.js); ohne diese Erweiterung lehnte die Attrappe den Befehl mit argument_unbekannt ab (probe_clips.mjs Punkt 2.12 wäre rot).
// Die Attrappe rechnet wie der Server: warp_setzen und Warp-Objekte über S2 (befehle.ts, warpPruefung), 'auto' aus Katalogdaten (autoWarp), die sie über
// POST /attrappe/katalog bekommt; ein Eintrag ohne Tempo oder ohne Katalogdaten ergibt einen ungewarpten Clip, warp_auto ohne Tempo den Grund kein_tempo.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';
import { nutzlast, ablageBefehl } from '../oeffentlich/produktion/ziehen.js';

const SHA = 'a'.repeat(64), SHA_LOOP = 'b'.repeat(64), SHA_EINS = 'c'.repeat(64);
async function oben() {
  const stroeme = new Set();
  const srv = http.createServer((q, a) => {
    if (q.url === '/strom') { a.writeHead(200, { 'content-type': 'text/event-stream' }); a.write(`data: ${JSON.stringify({ a: '/uhr', f: { beat: 0, bpm: 120 } })}\n\n`); stroeme.add(a); q.on('close', () => stroeme.delete(a)); return; }
    a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { for (const a of stroeme) a.end(); srv.closeAllConnections(); srv.close(r); }) };
}
const post = async (url, weg, d) => { const r = await fetch(url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { status: r.status, j: await r.json() }; };
async function mitSpur(at) {
  await post(at.url, '/proj/neu', { name: 'Warp' });
  const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 }] });
  return { spur: a.j.projekt.spuren[0].id, rev: a.j.rev, projekt: a.j.projekt };
}
const katalog = (at) => post(at.url, '/attrappe/katalog', { eintraege: [
  { sha: SHA_LOOP, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84 }, { sha: SHA_EINS, typ: 'oneshot', bpm: null, takte: null, dauer_s: 0.5 }] });
const mitAttrappe = async (fn) => { const o = await oben(), at = await starteProjAttrappe({ oben: o.url }); try { await fn(at); } finally { await at.stoppe(); await o.stoppe(); } };

test('N4-1 Ablage der Seite (clip_neu mit warp "auto") wird angenommen; ohne Katalogdaten bleibt der Clip ungewarpt, die Länge von der Ablage', () => mitAttrappe(async (at) => {
  const { spur, rev, projekt } = await mitSpur(at);
  const b = ablageBefehl(projekt, nutzlast({ typ: 'oneshot', sha: SHA, name: 'Kick 1', pfad_da: true, nur_live: false, dauer_s: 0.5 }), 0, 4, 1).befehl;
  assert.equal(b.warp, 'auto', 'das ist der Befehl, den die Seite beim Ablegen schickt');
  const r = await post(at.url, '/proj/aendern', { rev, label: 'Add clip', befehle: [b] });
  assert.deepEqual([r.status, r.j.fehler], [200, undefined]);
  const c = r.j.projekt.spuren[0].clips[0];
  assert.equal('warp' in c, false, 'Negativ-Kontrolle: kein Tempo in der Library, also kein Warp (wie der Server für Einträge ohne Tempo)');
  assert.equal(c.laenge_beats, 0.5 * 128 / 60);
  assert.equal((await post(at.url, '/proj/aendern', { rev: r.j.rev, label: 'x', befehle: [{ ...b, spur_id: spur, warp: 'aus', start_beat: 8 }] })).status, 200, 'warp "aus" geht ebenso');
}));

test('N4-1 clip_neu warp "auto" mit Katalogeintrag: Warp aus Takten, Länge in Beats vom Warp; One-Shot nie; Hinweis fehlt, wenn der Typ nicht warpt', () => mitAttrappe(async (at) => {
  const { spur, rev } = await mitSpur(at);
  assert.equal((await katalog(at)).status, 200);
  const neu = (sha, beat) => ({ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: beat, laenge_beats: 1, sha256: sha, warp: 'auto' });
  const r = await post(at.url, '/proj/aendern', { rev, label: 'Add clip', befehle: [neu(SHA_LOOP, 0), neu(SHA_EINS, 16)] });
  assert.equal(r.status, 200);
  const [loop, eins] = r.j.projekt.spuren[0].clips;
  assert.deepEqual(loop.warp, { an: true, modus: 'complex', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 },
    'Slice 2 D10: ein Loop ohne Drum-Angabe warpt mit COMPLEX');
  assert.equal(loop.laenge_beats, 8, 'zwei Takte = 8 Beats, unabhängig vom Projekttempo 128 und von laenge_beats des Aufrufers');
  assert.equal('warp' in eins, false, 'One-Shot nie');
  assert.equal(eins.laenge_beats, 1, 'dann gilt laenge_beats des Aufrufers');
}));

test('N4-1 clip_neu mit Warp-Objekt: wird wie im Modell geprüft (Grund warp_marker), ein gültiges steht im Clip', () => mitAttrappe(async (at) => {
  const { spur, rev } = await mitSpur(at);
  const warp = { an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'hand', transpose_st: 0, detune_ct: 0 };
  const neu = (w) => ({ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, warp: w });
  const schlecht = await post(at.url, '/proj/aendern', { rev, label: 'x', befehle: [neu({ ...warp, marker: [[0, 0], [0, 8]] })] });
  assert.deepEqual([schlecht.status, schlecht.j.fehler], [409, 'warp_marker']);
  const gut = await post(at.url, '/proj/aendern', { rev, label: 'x', befehle: [neu(warp)] });
  assert.equal(gut.status, 200);
  assert.deepEqual(gut.j.projekt.spuren[0].clips[0].warp, warp);
}));

test('N4-1 warp_setzen rechnet S2 (an, kein_warp), warp_auto löst aus dem Katalog auf: Warp gesetzt, Länge bleibt; ohne Tempo 409 kein_tempo', () => mitAttrappe(async (at) => {
  const { spur, rev } = await mitSpur(at);
  await katalog(at);
  const alle = (sha, beat) => ({ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: beat, laenge_beats: 4, sha256: sha, warp: 'aus' });
  const a = await post(at.url, '/proj/aendern', { rev, label: 'Add clip', befehle: [alle(SHA_LOOP, 0), alle(SHA_EINS, 8), alle(SHA, 16)] });
  const [c1, c2, c3] = a.j.projekt.spuren[0].clips.map((c) => c.id);
  const ohne = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'x', befehle: [{ befehl: 'warp_setzen', clip_id: c1, an: false }] });
  assert.deepEqual([ohne.status, ohne.j.fehler], [409, 'kein_warp'], 'warp_setzen mit Einzelfeld braucht einen vorhandenen Warp (S2)');
  const auto = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'Warp clip', befehle: [{ befehl: 'warp_auto', clip_id: c1 }] });
  assert.equal(auto.status, 200);
  const w = auto.j.projekt.spuren[0].clips[0];
  assert.deepEqual([w.warp.quelle, w.warp.marker, w.laenge_beats], ['takte', [[0, 0], [3.84, 8]], 4], 'Warp aus der Library, die Länge bleibt');
  const aus = await post(at.url, '/proj/aendern', { rev: auto.j.rev, label: 'Warp off', befehle: [{ befehl: 'warp_setzen', clip_id: c1, an: false }] });
  assert.equal(aus.j.projekt.spuren[0].clips[0].warp.an, false);
  for (const id of [c2, c3]) {
    const r = await post(at.url, '/proj/aendern', { rev: aus.j.rev, label: 'x', befehle: [{ befehl: 'warp_auto', clip_id: id }] });
    assert.deepEqual([r.status, r.j.fehler], [409, 'kein_tempo'], 'One-Shot und Quelle ohne Katalogdaten: kein Tempo');
  }
  const stand = (await (await fetch(at.url + 'proj/aktuell')).json()).projekt;
  assert.equal(stand.rev, aus.j.rev, 'abgelehnt heißt nicht gebucht');
  const fremd = await post(at.url, '/proj/aendern', { rev: aus.j.rev, label: 'x', befehle: [{ befehl: 'warp_auto', clip_id: 'c99' }] });
  assert.deepEqual([fremd.status, fremd.j.fehler], [404, 'clip_unbekannt']);
  // Gesamtreview Minor 1: warp_auto auf einem MIDI-Clip meldet den Grund von warp_setzen, nicht „braucht den Katalog“
  const inst = await post(at.url, '/proj/aendern', { rev: aus.j.rev, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] });
  const sp = inst.j.projekt.spuren.at(-1).id;
  const mc = await post(at.url, '/proj/aendern', { rev: inst.j.rev, label: 'x', befehle: [{ befehl: 'clip_neu', spur_id: sp, art: 'midi', start_beat: 0, laenge_beats: 4 }] });
  const mid = mc.j.projekt.spuren.at(-1).clips[0].id;
  const midi = await post(at.url, '/proj/aendern', { rev: mc.j.rev, label: 'x', befehle: [{ befehl: 'warp_auto', clip_id: mid }] });
  assert.deepEqual([midi.status, midi.j.fehler], [409, 'feld_nur_audio']);
}));

// Fix-Runde Slice 4, Punkt 7: audio_quantisieren in der Attrappe. Sie hat keine dekodierte Quelle und damit keine Transienten; wie der Server ohne Transienten
// (sitzung.ts: 409 transienten_fehlen) lehnt sie ab. Vorher fiel der Befehl in wende() und endete mit einem Grund, den es für ihn nicht gibt.
test('Fix-Runde Punkt 7: audio_quantisieren in der Attrappe: gültig 409 transienten_fehlen, falsche Felder und Werte wie der Server, unbekannter Clip wie S2', () => mitAttrappe(async (at) => {
  const { spur, rev } = await mitSpur(at);
  await katalog(at);
  const a = await post(at.url, '/proj/aendern', { rev, label: 'Add clip', befehle: [{ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA_LOOP, warp: 'auto' }] });
  const id = a.j.projekt.spuren[0].clips[0].id;
  const q = (extra) => post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'Quantize audio', befehle: [{ befehl: 'audio_quantisieren', clip_id: id, raster: '1/16', ...extra }] });
  const fehler = (r) => [r.status, r.j.fehler];
  assert.deepEqual(fehler(await q({})), [409, 'transienten_fehlen']);
  assert.deepEqual(fehler(await q({ staerke: 0.5, von_beat: 0, bis_beat: 4 })), [409, 'transienten_fehlen']);
  assert.deepEqual(fehler(await q({ raster: '1/3' })), [400, 'argument_ungueltig'], 'Raster wie der Server');
  assert.deepEqual(fehler(await q({ staerke: 2 })), [400, 'argument_ungueltig']);
  assert.deepEqual(fehler(await q({ unsinn: 1 })), [400, 'argument_unbekannt'], 'unbekanntes Feld (S2-Prüfung)');
  const fremd = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'x', befehle: [{ befehl: 'audio_quantisieren', clip_id: 'gibt-es-nicht', raster: '1/16' }] });
  assert.deepEqual(fehler(fremd), [404, 'clip_unbekannt'], 'unbekannter Clip: der Grund von S2');
  const w = await post(at.url, '/proj/aendern', { rev: a.j.rev, label: 'x', befehle: [{ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: 16, laenge_beats: 1, sha256: SHA, warp: 'aus' }] });
  const ungewarpt = w.j.projekt.spuren[0].clips[1].id;
  const r = await post(at.url, '/proj/aendern', { rev: w.j.rev, label: 'x', befehle: [{ befehl: 'audio_quantisieren', clip_id: ungewarpt, raster: '1/16' }] });
  assert.deepEqual(fehler(r), [409, 'kein_warp'], 'ein Clip ohne Warp: der Grund von S2');
}));

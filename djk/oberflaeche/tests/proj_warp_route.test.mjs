// Paket 1.13, Task 10 (Review-Nachzug): die Route GET /proj/warp und die kurze Antwort der Werkzeuge, durch den echten Seiten-Server (Stapel mit
// Kern-Attrappe). Gemessen wird, was der Sitzungstest nicht sieht: die Reihenfolge der Argumente der Route (von_beat, bis_beat, bei_beat), zahlArg
// (leerer Wert = fehlt, Unzahl = 400 argument_ungueltig) und hinweise in der kurzen Antwort von /proj/aendern?antwort=kurz.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { wav } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

async function aufbau(t) {
  const d = tmpOrdner(t, 'djk-warp-route-');
  const w = wav(path.join(d, 'daten'), 'loop.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [
    { n: 1, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w },     // Warp [[0,0],[3.84,8]]
    { n: 4, typ: 'loop', dauer_s: 3.84, pfad: w },                          // ohne Tempo: Hinweis kein_tempo
  ]);
  const { url } = await stapel(t, { katalog });
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Warp Route' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Setup', befehle: [{ befehl: 'spur_neu', art: 'audio' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: ksha(1), warp: 'auto' }] }, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  return { url, rev: a.j.projekt.rev };
}
const beats = (j) => j.warp.marker.map((x) => x.projekt_beat);

test('GET /proj/warp: von_beat, bis_beat und bei_beat kommen in der richtigen Reihenfolge an (die Marker liegen bei Projekt-Beat 4 und 12)', async (t) => {
  const { url } = await aufbau(t);
  const alle = await ruf(url, 'GET', '/proj/warp?clip_id=c1');
  assert.equal(alle.code, 200, JSON.stringify(alle.j));
  assert.deepEqual(beats(alle.j), [4, 12]); assert.equal(alle.j.bei, undefined, 'ohne bei_beat keine Gegenprobe');
  // von_beat 5 allein: nur der Marker bei 12; vertauscht (von 20, bis 5) bliebe nichts übrig
  assert.deepEqual(beats((await ruf(url, 'GET', '/proj/warp?clip_id=c1&von_beat=5&bis_beat=20')).j), [12], 'von_beat 5 bis_beat 20');
  assert.deepEqual(beats((await ruf(url, 'GET', '/proj/warp?clip_id=c1&bis_beat=8')).j), [4], 'bis_beat 8');
  assert.deepEqual(beats((await ruf(url, 'GET', '/proj/warp?clip_id=c1&von_beat=5&bis_beat=8')).j), [], 'zwischen den Markern: leer');
  const bei = await ruf(url, 'GET', '/proj/warp?clip_id=c1&bei_beat=6&von_beat=5&bis_beat=20');
  assert.ok(Math.abs(bei.j.bei.quell_s - 0.96) < 1e-12, `bei_beat 6 = Clip-Beat 2 = 0,96 s: ${JSON.stringify(bei.j.bei)}`);
  assert.equal(bei.j.bei.projekt_beat, 6);
  // leerer Wert zählt als fehlend (zahlArg), Zahl als Text mit Dezimalpunkt wird gelesen
  assert.deepEqual(beats((await ruf(url, 'GET', '/proj/warp?clip_id=c1&von_beat=&bis_beat=')).j), [4, 12]);
  assert.equal((await ruf(url, 'GET', '/proj/warp?clip_id=c1&bei_beat=4.5')).j.bei.projekt_beat, 4.5);
});

test('GET /proj/warp: Unzahl in einem Argument ist 400 argument_ungueltig mit dem Namen des Arguments; fehlende und unbekannte clip_id', async (t) => {
  const { url } = await aufbau(t);
  for (const k of ['von_beat', 'bis_beat', 'bei_beat']) {
    for (const v of ['abc', 'NaN', 'Infinity']) {
      const r = await ruf(url, 'GET', `/proj/warp?clip_id=c1&${k}=${v}`);
      assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], `${k}=${v}`);
      assert.ok(String(r.j.detail ?? r.j.text).includes(k), `die Meldung nennt ${k}: ${JSON.stringify(r.j)}`);
    }
  }
  const ohne = await ruf(url, 'GET', '/proj/warp');
  assert.deepEqual([ohne.code, ohne.j.fehler], [400, 'argument_ungueltig']);
  const unbekannt = await ruf(url, 'GET', '/proj/warp?clip_id=c9');
  assert.deepEqual([unbekannt.code, unbekannt.j.fehler], [404, 'clip_unbekannt']);
});

test('?antwort=kurz von /proj/aendern trägt hinweise (kein_tempo), ohne Hinweis fehlt das Feld', async (t) => {
  const { url, rev } = await aufbau(t);
  const mit = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev, label: 'ohne Tempo', befehle: [
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 40, laenge_beats: 2, sha256: ksha(4), warp: 'auto' }] }, CYPHER);
  assert.equal(mit.code, 200, JSON.stringify(mit.j));
  assert.equal(mit.j.projekt, undefined, 'die kurze Antwort trägt kein Projekt');
  assert.deepEqual(mit.j.hinweise, [{ index: 0, hinweis: 'kein_tempo' }]);
  // Negativ-Kontrolle: ein Auto-Warp mit bekanntem Tempo hat keinen Hinweis, das Feld fehlt ganz
  const ohne = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev: mit.j.rev, label: 'mit Tempo', befehle: [
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 60, laenge_beats: 1, sha256: ksha(1), warp: 'auto' }] }, CYPHER);
  assert.equal(ohne.code, 200, JSON.stringify(ohne.j));
  assert.equal('hinweise' in ohne.j, false);
});

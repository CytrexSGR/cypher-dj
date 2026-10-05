// Cue-Speichern und Wiederladen: Schema djk.cues/1, Schlüssel (Pfad, Größe, sha1 erste MiB), Takt/Schlag vom Server,
// Fehlerfälle ohne Schreiben, leerer Stand entfernt die Datei, MP3 bleibt unverändert. Dazu der HTTP-Weg (CueServer).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { speichere, lade, dateiName, zaehleAlle, sha1ErsteMib, EingabeFehler, SCHEMA } from '../speicher.ts';
import { CueServer } from '../server.ts';
import { mp3, tmpOrdner } from './hilfen.mjs';

const META = { titel: 'T', artist: 'A', tbpm: 120, tkey: '8A' };
const fp = (p) => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');

function aufbau(t) {
  const d = tmpOrdner(t);
  const wurzel = path.join(d, 'musik');
  const daten = path.join(d, 'daten');
  const rel = path.join('ordner', '1_Lied_Mix.mp3');
  mp3(path.join(wurzel, rel), { f: 100, dauer: 70, meta: { title: 'Lied', TBPM: '120', TKEY: '8A', EnergyLevel: '6' } }); // > 1 MiB
  return { d, wurzel, daten, rel, abs: path.join(wurzel, rel) };
}

test('Speichern und Wiederladen: Felder, Takt/Schlag vom Raster, Schlüssel mit Größe und sha1 der ersten MiB', (t) => {
  const { wurzel, daten, rel, abs } = aufbau(t);
  const vorher = { h: fp(abs), m: fs.statSync(abs).mtimeMs };
  assert.ok(fs.statSync(abs).size > (1 << 20), 'Testdatei größer als 1 MiB');
  const e = { raster: { bpm: 120, eins_s: 2.5, quelle: 'andreas' }, cues: [
    { slot: 2, s: 4.5, name: 'drop', farbe: '#FF5A1F', quantisiert: true },
    { slot: 1, s: 0.5, name: '', farbe: 'kaputt', quantisiert: true },
    { slot: 3, s: 5.75, name: 'vocal', farbe: '#d45cf0', quantisiert: false },
  ] };
  const d = speichere(daten, wurzel, rel, META, e, 70);
  const zurueck = lade(daten, rel);
  assert.deepEqual(zurueck, d);
  assert.equal(zurueck.schema, SCHEMA);
  assert.equal(path.basename(fs.readdirSync(daten)[0]), dateiName(rel));
  const erste = Buffer.alloc(1 << 20); const fd = fs.openSync(abs, 'r'); fs.readSync(fd, erste, 0, erste.length, 0); fs.closeSync(fd);
  assert.deepEqual(zurueck.schluessel, { pfad_rel: rel, groesse: fs.statSync(abs).size, sha1_erste_mib: crypto.createHash('sha1').update(erste).digest('hex') });
  assert.deepEqual(zurueck.raster, { bpm: 120, eins_s: 2.5, erste_eins_s: 0.5, erster_schlag_s: 0, erste_eins_quell_beat: 1, quelle: 'andreas' });
  assert.deepEqual(zurueck.cues.map((c) => [c.slot, c.s, c.takt, c.schlag, c.quell_beat, c.name, c.farbe, c.quantisiert]), [
    [1, 0.5, 1, 1, 1, '', '#2fd6c3', true],
    [2, 4.5, 3, 1, 9, 'drop', '#ff5a1f', true],
    [3, 5.75, 3, 3, 11.5, 'vocal', '#d45cf0', false],
  ]);
  assert.ok(zurueck.cues.every((c) => !Number.isNaN(Date.parse(c.gesetzt))));
  assert.deepEqual([...zaehleAlle(daten)], [[rel, 3]]);
  // Zeitstempel "gesetzt" bleibt bei unverändertem Cue, "angelegt" bleibt
  const d2 = speichere(daten, wurzel, rel, META, { ...e, cues: e.cues.filter((c) => c.slot !== 3) }, 70);
  assert.equal(d2.cues.find((c) => c.slot === 2).gesetzt, d.cues.find((c) => c.slot === 2).gesetzt);
  assert.equal(d2.angelegt, d.angelegt);
  assert.equal(d2.cues.length, 2);
  // MP3 nur gelesen
  assert.equal(fp(abs), vorher.h); assert.equal(fs.statSync(abs).mtimeMs, vorher.m);
});

test('Fehlerfall: ungültige Eingaben werfen EingabeFehler und ändern die Datei nicht', (t) => {
  const { wurzel, daten, rel } = aufbau(t);
  const gut = { raster: { bpm: 120, eins_s: 0.5, quelle: 'andreas' }, cues: [{ slot: 1, s: 1, name: 'a', farbe: '#ffffff' }] };
  speichere(daten, wurzel, rel, META, gut, 70);
  const vorher = fs.readFileSync(path.join(daten, dateiName(rel)), 'utf8');
  const schlecht = [
    null, { cues: [] }, { raster: { bpm: 12, eins_s: 0 }, cues: [] }, { raster: { bpm: 120 }, cues: [] },
    { raster: gut.raster, cues: 'x' },
    { raster: gut.raster, cues: [{ slot: 9, s: 1 }] },
    { raster: gut.raster, cues: [{ slot: 0, s: 1 }] },
    { raster: gut.raster, cues: [{ slot: 1, s: 1 }, { slot: 1, s: 2 }] },
    { raster: gut.raster, cues: [{ slot: 1, s: 71 }] },
    { raster: gut.raster, cues: [{ slot: 1, s: -1 }] },
    { raster: gut.raster, cues: [{ slot: 1, s: 'eins' }] },
  ];
  for (const e of schlecht) assert.throws(() => speichere(daten, wurzel, rel, META, e, 70), EingabeFehler, JSON.stringify(e));
  assert.equal(fs.readFileSync(path.join(daten, dateiName(rel)), 'utf8'), vorher);
  assert.deepEqual(fs.readdirSync(daten), [dateiName(rel)], 'keine .tmp-Reste');
});

test('Leerer Stand: alle Cues weg mit Vorschlagsraster entfernt die Datei; mit eigenem Raster bleibt sie (Negativ-Kontrolle)', (t) => {
  const { wurzel, daten, rel } = aufbau(t);
  speichere(daten, wurzel, rel, META, { raster: { bpm: 120, eins_s: 0.5, quelle: 'traktor' }, cues: [{ slot: 1, s: 1 }] }, 70);
  assert.equal(speichere(daten, wurzel, rel, META, { raster: { bpm: 120, eins_s: 0.5, quelle: 'traktor' }, cues: [] }, 70), null);
  assert.deepEqual(fs.readdirSync(daten), []);
  const d = speichere(daten, wurzel, rel, META, { raster: { bpm: 120, eins_s: 0.52, quelle: 'andreas' }, cues: [] }, 70);
  assert.equal(d.cues.length, 0);
  assert.equal(lade(daten, rel).raster.eins_s, 0.52);
  assert.deepEqual([...zaehleAlle(daten)], [[rel, 0]]);
});

test('HTTP: PUT/GET über den Server, 400 ohne Schreiben, 404 für fremde Pfade, Range fürs Abhören, Schlüsselprüfung', async (t) => {
  const { d, wurzel, daten, rel, abs } = aufbau(t);
  const s = new CueServer({ port: 0, wurzel, nml: null, daten, cache: path.join(d, 'cache') });
  await s.starte();
  t.after(() => s.stoppe());
  const u = (p, q = rel) => `http://127.0.0.1:${s.port}${p}?rel=${encodeURIComponent(q)}`;
  const tr = await (await fetch(`http://127.0.0.1:${s.port}/api/tracks`)).json();
  assert.deepEqual(tr.tracks.map((x) => [x.rel, x.titel, x.bpm, x.tonart, x.energie, x.cues]), [[rel, 'Lied', 120, '8A', 6, 0]]);
  const put = await fetch(u('/api/cues'), { method: 'PUT', body: JSON.stringify({ raster: { bpm: 120, eins_s: 0.5, quelle: 'auto' }, cues: [{ slot: 4, s: 8.5, name: 'break', farbe: '#3b8cff', quantisiert: true }] }) });
  assert.equal(put.status, 200);
  const get = await (await fetch(u('/api/cues'))).json();
  assert.equal(get.schluessel_passt, true);
  assert.deepEqual(get.datei.cues.map((c) => [c.slot, c.takt, c.schlag, c.name]), [[4, 5, 1, 'break']]);
  assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/api/tracks`)).json()).tracks[0].cues, 1);
  const vorher = fs.readFileSync(path.join(daten, dateiName(rel)), 'utf8');
  const falsch = await fetch(u('/api/cues'), { method: 'PUT', body: JSON.stringify({ raster: { bpm: 120, eins_s: 0.5 }, cues: [{ slot: 1, s: 9999 }] }) });
  assert.equal(falsch.status, 400);
  assert.match((await falsch.json()).fehler, /außerhalb/);
  assert.equal((await fetch(u('/api/cues'), { method: 'PUT', body: '{kein json' })).status, 400);
  assert.equal(fs.readFileSync(path.join(daten, dateiName(rel)), 'utf8'), vorher);
  for (const q of ['../../etc/passwd', '/etc/passwd', 'fehlt.mp3']) assert.equal((await fetch(u('/api/cues', q))).status, 404, q);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/../server.ts`)).status, 404);
  const r = await fetch(u('/api/audio'), { headers: { range: 'bytes=100-199' } });
  assert.equal(r.status, 206);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), fs.readFileSync(abs).subarray(100, 200));
  // Welle: erst gerechnet, dann aus dem Cache
  const w1 = await fetch(u('/api/welle')); const w2 = await fetch(u('/api/welle'));
  assert.equal(w1.headers.get('x-aus-cache'), 'true', 'PUT hat die Welle für die Dauer schon gerechnet');
  assert.equal(w2.headers.get('x-aus-cache'), 'true');
  // Datei ersetzt (erste MiB anders): Schlüssel passt nicht mehr, Cues bleiben lesbar
  const b = fs.readFileSync(abs); b[5000] ^= 0xff; fs.writeFileSync(abs, b);
  assert.equal(sha1ErsteMib(abs) === JSON.parse(vorher).schluessel.sha1_erste_mib, false);
  const nach = await (await fetch(u('/api/cues'))).json();
  assert.equal(nach.schluessel_passt, false);
  assert.equal(nach.datei.cues.length, 1);
});

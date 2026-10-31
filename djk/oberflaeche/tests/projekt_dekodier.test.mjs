// D1 S2-Kern, Dekodier-Cache (Spec 2.8): ffmpeg → f32, 48 kHz, Stereo, <arbeitsordner>/audio/<sha256>.f32. Echtes ffmpeg, synthetische WAV.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DekodierCache, DekodierFehler } from '../projekt/dekodier.ts';
import { tmpOrdner } from './hilfen/projekt.mjs';

const sha = (c) => c.repeat(64);
// Quelle per ffmpeg -f lavfi: Sinus, Kanalzahl und Rate wählbar
function wav(dir, name, { kanaele = 2, rate = 44100, dauer = 0.5, freq = 440 } = {}) {
  const p = path.join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dauer}:sample_rate=${rate}`, '-ac', String(kanaele), '-y', p]);
  return p;
}
const lies = (datei) => { const b = fs.readFileSync(datei); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const spitze = (f, k) => { let m = 0; for (let i = k; i < f.length; i += 2) m = Math.max(m, Math.abs(f[i])); return m; };
function aufbau(t, opt = {}) {
  const dir = tmpOrdner(t); const arr = path.join(dir, 'arr'); const ereignisse = [];
  const c = new DekodierCache(arr, { bei: (e) => ereignisse.push(e), ...opt });
  return { dir, arr, c, ereignisse };
}

test('Stereo-Quelle 44,1 kHz → f32le, 48 kHz, 2 Kanäle: frames aus der Dateigröße, Zustand fertig, Datei unter audio/<sha>.f32', async (t) => {
  const { dir, arr, c, ereignisse } = aufbau(t);
  const q = wav(dir, 'st.wav', { rate: 44100, dauer: 0.5 });
  assert.equal(c.zustand(sha('1')), 'nein');
  assert.equal(c.fordereAn(sha('1'), q), 'laeuft');
  assert.equal(c.zustand(sha('1')), 'laeuft');
  assert.equal(await c.bereit(sha('1')), 'fertig'); assert.equal(c.zustand(sha('1')), 'fertig');
  const d = path.join(arr, 'audio', `${sha('1')}.f32`);
  assert.equal(c.datei(sha('1')), d); assert.ok(fs.existsSync(d));
  assert.equal(c.frames(sha('1')), fs.statSync(d).size / 8);
  assert.ok(Math.abs(c.frames(sha('1')) - 24000) <= 2, `0,5 s bei 48 kHz = 24000 Frames (gemessen ${c.frames(sha('1'))})`);
  const f = lies(d); assert.ok(spitze(f, 0) > 0.05 && spitze(f, 1) > 0.05, 'beide Kanäle tragen Signal');
  assert.deepEqual(ereignisse.map((e) => [e.sha, e.zustand]), [[sha('1'), 'laeuft'], [sha('1'), 'fertig']]);
  assert.deepEqual(fs.readdirSync(path.join(arr, 'audio')), [`${sha('1')}.f32`], 'kein .teil-Rest');
});

test('Mono-Quelle ergibt Stereo (beide Kanäle gleich, nicht leer); die Dateigröße ist 8 Bytes je Frame', async (t) => {
  const { dir, c } = aufbau(t);
  const q = wav(dir, 'mono.wav', { kanaele: 1, rate: 48000, dauer: 0.25 });
  c.fordereAn(sha('2'), q); assert.equal(await c.bereit(sha('2')), 'fertig');
  const f = lies(c.datei(sha('2')));
  assert.equal(f.length % 2, 0); assert.ok(Math.abs(f.length / 2 - 12000) <= 2, `Frames ${f.length / 2}`);
  assert.ok(spitze(f, 0) > 0.05, 'Signal da');
  let gleich = true; for (let i = 0; i < f.length; i += 2) if (f[i] !== f[i + 1]) { gleich = false; break; }
  assert.equal(gleich, true, 'links = rechts');
  assert.equal(c.frames(sha('2')) * 8, fs.statSync(c.datei(sha('2'))).size);
});

test('fertig bleibt fertig: erneutes fordereAn startet kein ffmpeg (Zähler im Wrapper), meldet fertig sofort', async (t) => {
  const dir = tmpOrdner(t); const log = path.join(dir, 'ff.log'); const wrap = path.join(dir, 'ffw.sh');
  fs.writeFileSync(wrap, `#!/bin/sh\necho "start $$" >> "${log}"\nsleep 0.2\nffmpeg "$@"\nrc=$?\necho "ende $$" >> "${log}"\nexit $rc\n`, { mode: 0o755 });
  const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [wrap] }); const q = wav(dir, 'a.wav');
  c.fordereAn(sha('3'), q); await c.bereit(sha('3'));
  assert.equal(c.fordereAn(sha('3'), q), 'fertig'); assert.equal(await c.bereit(sha('3')), 'fertig');
  assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter((z) => z.startsWith('start')).length, 1);
});

test('Warteschlange ohne Verdrängen, eine Dekodierung zur Zeit: vier Aufträge laufen nacheinander, keiner geht verloren, nie zwei zugleich', async (t) => {
  const dir = tmpOrdner(t); const log = path.join(dir, 'ff.log'); const wrap = path.join(dir, 'ffw.sh');
  fs.writeFileSync(wrap, `#!/bin/sh\necho "start $$" >> "${log}"\nsleep 0.25\nffmpeg "$@"\nrc=$?\necho "ende $$" >> "${log}"\nexit $rc\n`, { mode: 0o755 });
  const ereignisse = []; const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [wrap], bei: (e) => ereignisse.push(e) });
  const q = wav(dir, 'a.wav', { dauer: 0.2 }); const shas = ['4', '5', '6', '7'].map(sha);
  for (const s of shas) assert.equal(c.fordereAn(s, q), 'laeuft');
  assert.deepEqual(shas.map((s) => c.zustand(s)), ['laeuft', 'laeuft', 'laeuft', 'laeuft'], 'auch die Wartenden gelten als laeuft');
  const ergebnis = await Promise.all(shas.map((s) => c.bereit(s)));
  assert.deepEqual(ergebnis, ['fertig', 'fertig', 'fertig', 'fertig']);
  const z = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]);
  assert.deepEqual(z, ['start', 'ende', 'start', 'ende', 'start', 'ende', 'start', 'ende'], 'nie überlappend');
  assert.deepEqual(ereignisse.filter((e) => e.zustand === 'fertig').map((e) => e.sha), shas, 'Reihenfolge der Anforderung');
  assert.equal(c.fordereAn(shas[0], q), 'fertig');
});

test('Doppelte Anforderung derselben sha, während sie wartet oder läuft, ergibt EINEN Lauf und EIN laeuft-Ereignis', async (t) => {
  const { dir, c, ereignisse } = aufbau(t); const q = wav(dir, 'a.wav');
  c.fordereAn(sha('8'), q); c.fordereAn(sha('8'), q); c.fordereAn(sha('8'), q);
  await c.bereit(sha('8'));
  assert.deepEqual(ereignisse.map((e) => e.zustand), ['laeuft', 'fertig']);
});

test('Fehler: Quelle fehlt, kein Audio (Textdatei), leere Datei → fehler mit Grund; keine Datei im Cache; Ereignis; erneuter Versuch möglich', async (t) => {
  const { dir, arr, c, ereignisse } = aufbau(t);
  assert.equal(c.fordereAn(sha('a'), path.join(dir, 'gibtsnicht.wav')), 'fehler'); assert.equal(c.fehlerGrund(sha('a')), 'quelle_fehlt'); assert.equal(c.zustand(sha('a')), 'fehler');
  const text = path.join(dir, 'text.wav'); fs.writeFileSync(text, 'das ist kein Audio, nur Text, aber lang genug fuer eine Erkennung');
  c.fordereAn(sha('b'), text); assert.equal(await c.bereit(sha('b')), 'fehler'); assert.equal(c.fehlerGrund(sha('b')), 'ffmpeg_fehler');
  const leer = path.join(dir, 'leer.wav'); fs.writeFileSync(leer, '');
  c.fordereAn(sha('c'), leer); assert.equal(await c.bereit(sha('c')), 'fehler');
  for (const s of ['b', 'c']) assert.ok(!fs.existsSync(path.join(arr, 'audio', `${sha(s)}.f32`)));
  assert.ok(!fs.existsSync(path.join(arr, 'audio')) || fs.readdirSync(path.join(arr, 'audio')).length === 0, 'weder Datei noch .teil');
  assert.deepEqual(ereignisse.filter((e) => e.sha === sha('b')).map((e) => e.zustand), ['laeuft', 'fehler']);
  assert.ok(ereignisse.find((e) => e.sha === sha('a')).grund === 'quelle_fehlt');
  // erneuter Versuch mit gutem Material unter derselben sha → fertig
  const gut = wav(dir, 'gut.wav'); assert.equal(c.fordereAn(sha('b'), gut), 'laeuft'); assert.equal(await c.bereit(sha('b')), 'fertig');
});

test('Eine Fehlerquelle in der Mitte hält die Schlange nicht an: danach kommt der nächste dran', async (t) => {
  const { dir, c } = aufbau(t); const gut = wav(dir, 'g.wav'); const schlecht = path.join(dir, 's.wav'); fs.writeFileSync(schlecht, 'xx');
  c.fordereAn(sha('d'), gut); c.fordereAn(sha('e'), schlecht); c.fordereAn(sha('f'), gut);
  assert.deepEqual(await Promise.all(['d', 'e', 'f'].map((s) => c.bereit(sha(s)))), ['fertig', 'fehler', 'fertig']);
});

test('Grenze Quelldauer: länger als die Dauergrenze → fehler zu_lang, keine Datei (Grenze im Test 1 s statt 15 min); genau an der Grenze geht', async (t) => {
  const { dir, arr, c } = aufbau(t, { dauerGrenzeS: 1 });
  c.fordereAn(sha('1'), wav(dir, 'lang.wav', { dauer: 2.5 })); assert.equal(await c.bereit(sha('1')), 'fehler'); assert.equal(c.fehlerGrund(sha('1')), 'zu_lang');
  assert.ok(!fs.existsSync(path.join(arr, 'audio', `${sha('1')}.f32`)));
  c.fordereAn(sha('2'), wav(dir, 'kurz.wav', { dauer: 0.9 })); assert.equal(await c.bereit(sha('2')), 'fertig');
  c.fordereAn(sha('3'), wav(dir, 'genau.wav', { dauer: 1, rate: 48000 })); assert.equal(await c.bereit(sha('3')), 'fertig', 'genau die Grenze ist erlaubt');
  assert.equal(new DekodierCache(path.join(dir, 'a2')).dauerGrenzeS, 900, 'Vorgabe 15 min');
});

test('Grenze Dateigröße: Ergebnis über der Größengrenze → fehler zu_gross, keine Datei (Grenze im Test klein; Vorgabe 2 GB)', async (t) => {
  const { dir, arr, c } = aufbau(t, { groesseGrenze: 40_000 });
  c.fordereAn(sha('1'), wav(dir, 'g.wav', { dauer: 0.5 })); assert.equal(await c.bereit(sha('1')), 'fehler'); assert.equal(c.fehlerGrund(sha('1')), 'zu_gross');
  assert.ok(!fs.existsSync(path.join(arr, 'audio', `${sha('1')}.f32`)));
  assert.equal(new DekodierCache(path.join(dir, 'a2')).groesseGrenze, 2 * 1024 ** 3);
});

test('Zeitlimit: hängt ffmpeg, wird er beendet → fehler zeitlimit, Schlange läuft weiter', async (t) => {
  const dir = tmpOrdner(t); const wrap = path.join(dir, 'haengt.sh');
  fs.writeFileSync(wrap, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [wrap], zeitlimitMs: 300 }); const t0 = Date.now();
  c.fordereAn(sha('1'), wav(dir, 'a.wav')); assert.equal(await c.bereit(sha('1')), 'fehler'); assert.equal(c.fehlerGrund(sha('1')), 'zeitlimit');
  assert.ok(Date.now() - t0 < 5000);
});

test('Aufräumen beim Start: .teil toter PIDs weg, einer lebenden PID (eigener Prozess) bleibt; fertige Dateien bleiben', (t) => {
  const dir = tmpOrdner(t); const ad = path.join(dir, 'arr', 'audio'); fs.mkdirSync(ad, { recursive: true });
  const tot = execFileSync('sh', ['-c', 'echo $$']).toString().trim();   // diese Shell-PID lebt nicht mehr
  fs.writeFileSync(path.join(ad, `${sha('1')}.${tot}.teil`), 'x'); fs.writeFileSync(path.join(ad, `${sha('2')}.${process.pid}.teil`), 'x'); fs.writeFileSync(path.join(ad, `${sha('3')}.f32`), Buffer.alloc(16));
  const c = new DekodierCache(path.join(dir, 'arr'));
  assert.deepEqual(fs.readdirSync(ad).sort(), [`${sha('2')}.${process.pid}.teil`, `${sha('3')}.f32`].sort());
  assert.equal(c.zustand(sha('3')), 'fertig', 'von einem früheren Server fertig gestellt: gilt weiter'); assert.equal(c.frames(sha('3')), 2);
});

test('Eingaben: sha muss 64 Hex-Zeichen sein (kein Pfad-Trick), Quelle muss ein String sein; nicht aufgetretene sha → nein / frames null', (t) => {
  const { c } = aufbau(t);
  for (const s of ['abc', '../../etc/passwd', sha('G'), sha('a') + 'a', '']) assert.throws(() => c.fordereAn(s, '/x'), (e) => e instanceof DekodierFehler && e.grund === 'sha_ungueltig');
  assert.throws(() => c.zustand('xyz'), DekodierFehler);
  assert.throws(() => c.fordereAn(sha('a'), 5), (e) => e.grund === 'quelle_ungueltig');
  assert.equal(c.zustand(sha('9')), 'nein'); assert.equal(c.frames(sha('9')), null); assert.match(c.datei(sha('9')), /audio\/9{64}\.f32$/, 'datei() nennt den Ort, auch wenn es sie noch nicht gibt');
});

test('Ereignis-Rückruf, der wirft, bricht die Schlange nicht ab', async (t) => {
  const { dir, c } = aufbau(t, { bei: () => { throw new Error('SSE kaputt'); } }); const q = wav(dir, 'a.wav');
  c.fordereAn(sha('1'), q); c.fordereAn(sha('2'), q);
  assert.deepEqual(await Promise.all([c.bereit(sha('1')), c.bereit(sha('2'))]), ['fertig', 'fertig']);
});

test('Kanalzahl mit Anhang: ffprobe csv druckt bei Seitendaten (ReplayGain) "2," statt "2" → trotzdem fertig; ohne Zahl bleibt es ffmpeg_fehler', async (t) => {
  // Fund der S3a-Zielabnahme (2026-10-29): Queen of Pain (Beatport-MP3 mit side_data_list) kam als "2," und wurde zu NaN, der Clip blieb auf fehler
  const dir = tmpOrdner(t); const q = wav(dir, 'st.wav');
  const probe = (aus) => { const p = path.join(dir, `probe-${aus.replace(/\W/g, '_')}.sh`); fs.writeFileSync(p, `#!/bin/sh\nprintf '${aus}\\n'\n`, { mode: 0o755 }); return [p]; };
  const c = new DekodierCache(path.join(dir, 'arr'), { ffprobe: probe('2,') });
  c.fordereAn(sha('e'), q); assert.equal(await c.bereit(sha('e')), 'fertig');
  const k = new DekodierCache(path.join(dir, 'arr2'), { ffprobe: probe(',2') });
  k.fordereAn(sha('f'), q); assert.equal(await k.bereit(sha('f')), 'fehler', 'Negativ-Kontrolle: keine führende Zahl');
  assert.equal(k.fehlerGrund(sha('f')), 'ffmpeg_fehler');
});

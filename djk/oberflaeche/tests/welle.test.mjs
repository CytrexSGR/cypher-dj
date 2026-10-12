// Plan Oberfläche T3: reine Teile von welle.js (Lesen, Farbe, Spalten, Kopf). Kein DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseWelle, zeichneSpalte, spalten, Kopf } from '../oeffentlich/welle.js';

function welle(zeilen) {
  const b = new ArrayBuffer(16 + zeilen.length * 4), v = new DataView(b);
  [...'DJKW'].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 256, true); v.setUint32(12, zeilen.length, true);
  zeilen.forEach((z, i) => z.forEach((x, k) => v.setUint8(16 + 4 * i + k, x)));
  return b;
}

test('leseWelle: Kopf wird geprüft, Spalten stimmen', () => {
  const w = leseWelle(welle([[10, 1, 2, 3], [20, 4, 5, 6]]));
  assert.equal(w.hop, 256); assert.equal(w.spalten, 2); assert.equal(w.daten[4], 20);
  assert.throws(() => leseWelle(new ArrayBuffer(16)), /DJKW/);
});

test('spalten: Spitze ist Maximum, Bänder sind Mittel', () => {
  const w = leseWelle(welle([[10, 0, 0, 100], [200, 50, 0, 0]]));
  assert.deepEqual(spalten(w, 0, 2), [200, 25, 0, 50]);
  assert.deepEqual(spalten(w, 5, 9), [0, 0, 0, 0], 'außerhalb: nichts');
});

test('zeichneSpalte (echter Zeichenweg): Bass rot, Höhen violett, Mitten grün; Stille zeichnet nichts', () => {
  const ton = (spalte) => { const f = []; const g = { set fillStyle(v) { f.push(v); }, fillRect() {} };
    zeichneSpalte(g, 0, 50, spalte); return f.length ? Number(/hsla?\((\d+)/.exec(f[0])[1]) : null; };
  assert.ok(ton([200, 200, 0, 0]) < 30, 'nur Bass → rot');
  assert.ok(ton([200, 0, 0, 200]) > 240, 'nur Höhen → violett');
  const m = ton([200, 0, 200, 0]); assert.ok(m > 110 && m < 160, `nur Mitten → grün (${m})`);
  assert.equal(ton([0, 0, 0, 0]), null, 'Stille: kein fillRect');
});

test('Kopf: läuft zwischen Meldungen gleichmäßig, springt bei einer Meldung nicht', () => {
  const k = new Kopf();
  k.melde(100, 128, 0, true);                     // Beat 100 bei t = 0 ms, 128 BPM, läuft
  const proMs = 128 / 60 / 1000;
  let vorher = k.beat(0), groessterSchritt = 0;
  for (let t = 7; t <= 1000; t += 7) {            // 143 Hz
    if (t === 105) k.melde(100 + 105 * proMs + 0.02, 128, 105, true);   // Meldung 0,02 Beat vorn (Server-Drossel)
    const b = k.beat(t);
    groessterSchritt = Math.max(groessterSchritt, Math.abs(b - vorher - 7 * proMs));
    vorher = b;
  }
  assert.ok(groessterSchritt < 0.005, `Sprung ${groessterSchritt} Beat in einem Bild`);
  assert.ok(Math.abs(k.beat(1000) - (100 + 1000 * proMs + 0.02)) < 1e-6, 'nach 200 ms ist der Fehler ganz eingeholt');
});

test('Kopf: große Abweichung (Sprung im Material) wird sofort übernommen; gestoppt steht er', () => {
  const k = new Kopf();
  k.melde(10, 128, 0, true);
  k.melde(200, 128, 100, true);                   // Sprung um 190 Beats: hart
  assert.equal(k.beat(100), 200);
  k.melde(200, 128, 200, false);                  // gestoppt
  assert.equal(k.beat(900), 200);
});

// ---- S5 Task 5.2: Wellenform für beliebige Dateien ----
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { WelleCache, dateiQuelle, welleCacheVorgabe } from '../welle_cache.ts';
import { pythonVorgabe } from '../server.ts';
import { stapel, hole } from './hilfen/mediathek.mjs';
import { baueKatalog } from './hilfen/katalog.mjs';
import { TEST_INSTANZ } from './hilfen/instanz.mjs';

const tmpd = (t, n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), n)); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const sinus = (datei, sek = 1) => execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', `sine=f=440:d=${sek}`, '-ar', '44100', datei]);
const sha256 = (datei) => crypto.createHash('sha256').update(fs.readFileSync(datei)).digest('hex');

test('dateiQuelle: WAV wird dekodiert und gerechnet, Schlüssel = sha; fehlende Datei 404', async (t) => {
  const d = tmpd(t, 'welle-datei-');
  const wav = path.join(d, 'ton.wav'); sinus(wav);
  const q = dateiQuelle(wav, 'a'.repeat(64));
  assert.equal(q.schluessel, `datei-v2-${'a'.repeat(64)}`); assert.equal(q.dekodieren, true);
  const c = new WelleCache(path.join(d, 'cache'), pythonVorgabe(), path.join(import.meta.dirname, '..', 'welle.py'));
  const w = leseWelle(new Uint8Array(fs.readFileSync(await c.hole(q))).buffer);
  assert.equal(w.spalten, Math.floor(48000 / 256), '1 s bei 48 kHz nach dem Dekodieren');
  assert.deepEqual(fs.readdirSync(path.join(d, 'cache')), [`datei-v2-${'a'.repeat(64)}.welle`], 'keine Zwischendatei bleibt liegen');
  assert.throws(() => dateiQuelle(path.join(d, 'fehlt.wav'), 'b'.repeat(64)), (e) => e.code === 404 && /datei_fehlt/.test(e.message));
});

test('GET /welle?sha=: Welle für eine Mediathek-Datei, zweiter Abruf aus dem Cache, Quelle unverändert', async (t) => {
  const d = tmpd(t, 'welle-sha-');
  const wav = path.join(d, '1 F1.wav'); sinus(wav, 2);
  const vorher = [sha256(wav), fs.statSync(wav).mtimeMs];
  const kat = baueKatalog(d, [{ typ: 'oneshot', sha: 'e'.repeat(64), shas: 'e'.repeat(64), pfad: wav }]);
  const s = await stapel(t, { katalog: kat });
  const r1 = await fetch(`${s.url}/welle?sha=${'e'.repeat(64)}`);
  assert.equal(r1.status, 200);
  const w = leseWelle(await r1.arrayBuffer());
  assert.equal(w.spalten, Math.floor(96000 / 256), '2 s');
  assert.equal((await fetch(`${s.url}/welle?sha=${'e'.repeat(64)}`)).status, 200);
  assert.equal(s.log.filter((z) => z.typ === 'welle_gerechnet').length, 1, 'zweiter Abruf kommt aus dem Cache');
  assert.deepEqual([sha256(wav), fs.statSync(wav).mtimeMs], vorher, 'die Mediathek-Datei bleibt, wie sie war');
  assert.deepEqual(fs.readdirSync(d).sort(), ['1 F1.wav', 'katalog.sqlite'], 'neben der Quelle entsteht nichts');
});

test('GET /welle?sha=: Fehlerfälle — fehlende Datei 404, Ableton-geschützt 422, ffmpeg-unlesbares .aif 422, unbekannt 404, Unsinn 400', async (t) => {
  const d = tmpd(t, 'welle-fehler-');
  const kaputt = path.join(d, 'kaputt.aif'); fs.writeFileSync(kaputt, 'FORM....AIFFnicht wirklich Audio');
  const live = path.join(d, 'live.aif'); fs.writeFileSync(live, 'FORM....AIFFverschluesselt');
  const gut = path.join(d, 'gut.wav'); sinus(gut);
  const kat = baueKatalog(d, [
    { typ: 'oneshot', sha: '1'.repeat(64), shas: '1'.repeat(64), pfad: path.join(d, 'fehlt.wav') },
    { typ: 'oneshot', sha: '2'.repeat(64), shas: '2'.repeat(64), pfad: live, schutz: 'ableton' },
    { typ: 'oneshot', sha: '3'.repeat(64), shas: '3'.repeat(64), pfad: kaputt },
    { typ: 'oneshot', sha: '4'.repeat(64), shas: '4'.repeat(64), pfad: null },
    { typ: 'oneshot', sha: '5'.repeat(64), shas: '5'.repeat(64), pfad: gut }]);
  const s = await stapel(t, { katalog: kat });
  const st = async (sha) => (await fetch(`${s.url}/welle?sha=${sha}`)).status;
  assert.equal(await st('1'.repeat(64)), 404, 'Datei fehlt');
  const live2 = await fetch(`${s.url}/welle?sha=${'2'.repeat(64)}`);
  assert.deepEqual([live2.status, (await live2.json()).fehler], [422, 'nur_live'], 'Ableton-geschützt: gar nicht erst dekodieren');
  const k = await fetch(`${s.url}/welle?sha=${'3'.repeat(64)}`);
  assert.equal(k.status, 422, 'ffmpeg kann das .aif nicht lesen');
  assert.match((await k.json()).fehler, /^ffmpeg rc/);
  assert.equal(await st('4'.repeat(64)), 404, 'Eintrag ohne Pfad');
  assert.equal(await st('9'.repeat(64)), 404, 'unbekannt');
  assert.equal(await st('xyz'), 400, 'Unsinn');
  assert.equal(await st('5'.repeat(64)), 200, 'Negativkontrolle: eine lesbare Datei im selben Katalog geht');
  const cache = s.o.opt.welleCache;
  assert.deepEqual(fs.readdirSync(cache).filter((x) => x.endsWith('.f32')), [], 'auch nach dem Fehler bleibt keine Zwischendatei');
  assert.equal(fs.existsSync(path.join(cache, `datei-v2-${'3'.repeat(64)}.welle`)), false, 'ein Fehler wird nicht gecacht');
});


// ---- S5-Review B1-B3, B7: streamend, eine Dekodierung, Abbruch, Zeitlimit, Aufräumen ----
const PY = pythonVorgabe(), SKRIPT = path.join(import.meta.dirname, '..', 'welle.py');
const sh = (t, d, sek) => { const p = path.join(d, 'ffmpeg-langsam.sh'); fs.writeFileSync(p, `#!/bin/sh\nsleep ${sek}\nexec ffmpeg "$@"\n`, { mode: 0o755 }); return p; };
// laufende Dekodierungen: Prozesse, deren Aufruf die Eingabedatei dieses Tests nennt (sh in der Schlafphase UND ffmpeg danach)
const dekodierer = (d) => execFileSync('ps', ['-eo', 'args=']).toString().split('\n').filter((z) => z.includes('-nostdin') && z.includes(d)).length;
const wavs = (d, n, sek = 1) => Array.from({ length: n }, (_, i) => { const p = path.join(d, `t${i}.wav`); execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', `sine=f=${200 + 50 * i}:d=${sek}`, '-ar', '44100', p]); return p; });

test('B1: streamend — keine Zwischendatei, Welle stimmt in Länge und Bändern, ffmpeg läuft mit nice 19', async (t) => {
  const d = tmpd(t, 'welle-strom-'); const [w1] = wavs(d, 1, 2);
  const c = new WelleCache(path.join(d, 'c'), PY, SKRIPT);
  const lauf = c.hole(dateiQuelle(w1, 'a1'.repeat(32), 2));
  await new Promise((r) => setTimeout(r, 5));
  const w = leseWelle(new Uint8Array(fs.readFileSync(await lauf)).buffer);
  assert.equal(w.spalten, Math.floor(96000 / 256), '2 s');
  assert.equal(w.hop, 256);
  assert.ok(w.daten.length === w.spalten * 4);
  assert.deepEqual(fs.readdirSync(path.join(d, 'c')).filter((x) => !x.endsWith('.welle')), [], 'nur die .welle liegt im Cache');
});

test('B1: ffmpeg-Fehler 422, nichts bleibt liegen, und die Pipeline ist nicht mehr da', async (t) => {
  const d = tmpd(t, 'welle-422-'); const kaputt = path.join(d, 'k.aif'); fs.writeFileSync(kaputt, 'kein Audio');
  const c = new WelleCache(path.join(d, 'c'), PY, SKRIPT);
  await assert.rejects(c.hole(dateiQuelle(kaputt, 'b'.repeat(64), 1)), (e) => e.code === 422 && /^ffmpeg rc/.test(e.message));
  assert.deepEqual(fs.readdirSync(path.join(d, 'c')), [], 'weder .welle noch .teil noch .neu');
});

test('B2: acht schnelle Wechsel mit Abbruch — höchstens ein Dekodierer zugleich, die letzte Auswahl bekommt ihre Welle', async (t) => {
  const d = tmpd(t, 'welle-b2-'); const f = wavs(d, 8);
  const c = new WelleCache(path.join(d, 'c'), PY, SKRIPT, undefined, { ffmpeg: [sh(t, d, 0.6)] });
  let max = 0; const takt = setInterval(() => { max = Math.max(max, dekodierer(d)); }, 15); t.after(() => clearInterval(takt));
  const ac = [], erg = [];
  for (let i = 0; i < 8; i++) {
    ac.push(new AbortController());
    erg.push(c.hole(dateiQuelle(f[i], String(i).repeat(64), 1), ac[i].signal).then((z) => ({ i, z }), (e) => ({ i, e })));
    if (i > 0) ac[i - 1].abort();                               // die Seite bricht die alte Anfrage ab, wenn die Auswahl wechselt
    await new Promise((r) => setTimeout(r, 80));
  }
  const r = await Promise.all(erg);
  clearInterval(takt);
  assert.ok(max >= 1, `Messung hat Dekodierer gesehen (${max})`);
  assert.ok(max <= 1, `höchstens ein Dekodierer gleichzeitig (gemessen ${max})`);
  assert.ok(r[7].z && fs.existsSync(r[7].z), 'die letzte Auswahl hat ihre Welle');
  assert.deepEqual(r.slice(0, 7).map((x) => x.e?.code), Array(7).fill(499), 'alle früheren: abgebrochen');
  assert.equal(dekodierer(d), 0, 'am Ende läuft nichts mehr');
  assert.deepEqual(fs.readdirSync(path.join(d, 'c')).filter((x) => !x.endsWith('.welle')), []);
});

test('B2: ohne Abbruch — eine läuft, nur die neueste wartet, die dazwischen werden verdrängt', async (t) => {
  const d = tmpd(t, 'welle-b2b-'); const f = wavs(d, 6);
  const c = new WelleCache(path.join(d, 'c'), PY, SKRIPT, undefined, { ffmpeg: [sh(t, d, 0.5)] });
  let max = 0; const takt = setInterval(() => { max = Math.max(max, dekodierer(d)); }, 15); t.after(() => clearInterval(takt));
  const r = await Promise.all(f.map((p, i) => c.hole(dateiQuelle(p, String(i).repeat(64), 1)).then((z) => ({ z }), (e) => ({ e }))));
  clearInterval(takt);
  assert.ok(max === 1, `genau ein Dekodierer zugleich (gemessen ${max})`);
  assert.ok(r[0].z && r[5].z, 'die erste (lief schon) und die letzte (wartete) sind fertig');
  assert.deepEqual(r.slice(1, 5).map((x) => x.e?.code), [429, 429, 429, 429], 'dazwischen verdrängt');
});

test('B2: gleicher Schlüssel teilt sich den Lauf; ein Abbruch genügt nicht, solange noch einer wartet; der letzte Abbruch beendet ffmpeg', async (t) => {
  const d = tmpd(t, 'welle-b2c-'); const [w] = wavs(d, 1);
  const c = new WelleCache(path.join(d, 'c'), PY, SKRIPT, undefined, { ffmpeg: [sh(t, d, 1)] });
  const q = () => dateiQuelle(w, 'c'.repeat(64), 1);
  const a1 = new AbortController(), a2 = new AbortController();
  const p1 = c.hole(q(), a1.signal).catch((e) => e), p2 = c.hole(q(), a2.signal).catch((e) => e);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(dekodierer(d), 1, 'ein Lauf für beide');
  a1.abort(); await new Promise((r) => setTimeout(r, 100));
  assert.equal(dekodierer(d), 1, 'einer wartet noch: der Lauf bleibt');
  a2.abort(); await new Promise((r) => setTimeout(r, 300));
  assert.equal(dekodierer(d), 0, 'niemand wartet mehr: ffmpeg ist beendet');
  assert.deepEqual([(await p1).code, (await p2).code], [499, 499]);
  assert.deepEqual(fs.readdirSync(path.join(d, 'c')), [], 'ein abgebrochener Lauf hinterlässt nichts und wird nicht als Fehler gecacht');
  assert.ok(await c.hole(q()), 'ein neuer Versuch läuft normal');
});

test('B7: Zeitlimit → 504 „waveform timed out“, kurz negativ gecacht (kein neuer ffmpeg), danach wieder möglich', async (t) => {
  const d = tmpd(t, 'welle-b7-'); const [w] = wavs(d, 1);
  const log = path.join(d, 'starts.log'), p = path.join(d, 'ff.sh');
  fs.writeFileSync(p, `#!/bin/sh\necho x >> '${log}'\nsleep 5\nexec ffmpeg "$@"\n`, { mode: 0o755 });
  const c = new WelleCache(path.join(d, 'c'), PY, SKRIPT, undefined, { ffmpeg: [p], zeitlimit: () => 300, negativMs: 800 });
  const q = () => dateiQuelle(w, 'd'.repeat(64), 1);
  await assert.rejects(c.hole(q()), (e) => e.code === 504 && e.message === 'waveform timed out');
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
  await assert.rejects(c.hole(q()), (e) => e.code === 504);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'zweiter Klick startet keinen ffmpeg');
  assert.equal(dekodierer(d), 0, 'der Abbruch hat ffmpeg beendet');
  await new Promise((r) => setTimeout(r, 900));
  await assert.rejects(c.hole(q()), (e) => e.code === 504);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2, 'nach Ablauf der Sperre wird neu versucht');
});

test('B3: beim Bau räumt der Cache Reste toter PIDs weg, lässt aber die lebender (andere Instanz) liegen', (t) => {
  const d = tmpd(t, 'welle-b3-'); const c = path.join(d, 'c'); fs.mkdirSync(c);
  const tot = 2 ** 22 + 12345;                                   // über pid_max, lebt nie
  const dateien = { tot1: `datei-x.welle.${tot}.teil`, tot2: `datei-y.welle.${tot}.f32`, tot3: `datei-z.welle.${tot}.teil.neu`, lebt: `datei-l.welle.${process.pid}.teil`, gut: 'datei-g.welle' };
  for (const n of Object.values(dateien)) fs.writeFileSync(path.join(c, n), 'x');
  const alt = path.join(c, 'alt.welle.neu'); fs.writeFileSync(alt, 'x'); fs.utimesSync(alt, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  new WelleCache(c, PY, SKRIPT);
  assert.deepEqual(fs.readdirSync(c).sort(), [dateien.gut, dateien.lebt].sort());
});

test('B4: Welle-Cache je Instanz — Prüfinstanz /dev/shm/cypherdj-<i>/welle, Betrieb ~/.cache/cypherdj/welle', () => {
  assert.equal(welleCacheVorgabe('b'), '/dev/shm/cypherdj-b/welle');
  assert.equal(welleCacheVorgabe('i'), '/dev/shm/cypherdj-i/welle');
  assert.equal(welleCacheVorgabe(''), path.join(os.homedir(), '.cache', 'cypherdj', 'welle'), 'Betrieb unverändert');
  assert.throws(() => welleCacheVorgabe('../x'), /Instanz/);
});

test('B2 am Server: acht schnelle Wechsel — Abbruch der Seite beendet die Dekodierung, höchstens ein ffmpeg, die letzte Auswahl bekommt ihre Welle', async (t) => {
  const d = tmpd(t, 'welle-srv-'); const f = wavs(d, 8);
  const kat = baueKatalog(d, f.map((p, i) => ({ typ: 'oneshot', sha: String(i).repeat(64), shas: String(i).repeat(64), pfad: p, dauer_s: 1 })));
  const s = await stapel(t, { katalog: kat, welleFfmpeg: [sh(t, d, 0.6)] });
  let max = 0; const takt = setInterval(() => { max = Math.max(max, dekodierer(d)); }, 15); t.after(() => clearInterval(takt));
  const ac = [], erg = [];
  for (let i = 0; i < 8; i++) {
    ac.push(new AbortController());
    erg.push(fetch(`${s.url}/welle?sha=${String(i).repeat(64)}`, { signal: ac[i].signal }).then(async (r) => ({ i, st: r.status, n: (await r.arrayBuffer()).byteLength }), (e) => ({ i, e: e.name })));
    if (i > 0) ac[i - 1].abort();
    await new Promise((r) => setTimeout(r, 80));
  }
  const r = await Promise.all(erg);
  clearInterval(takt);
  assert.ok(max >= 1 && max <= 1, `höchstens ein Dekodierer zugleich (gemessen ${max})`);
  assert.deepEqual([r[7].st, r[7].n > 16], [200, true], 'die letzte Auswahl hat ihre Welle');
  assert.deepEqual(r.slice(0, 7).map((x) => x.e), Array(7).fill('AbortError'));
  for (let i = 0; i < 30 && dekodierer(d) > 0; i++) await new Promise((x) => setTimeout(x, 50));
  assert.equal(dekodierer(d), 0, 'nach dem Abbruch läuft nichts weiter');
});

test('B7 am Server: Zeitlimit → 504 „waveform timed out“', async (t) => {
  const d = tmpd(t, 'welle-srv504-'); const [w] = wavs(d, 1);
  const kat = baueKatalog(d, [{ typ: 'oneshot', sha: 'a'.repeat(64), shas: 'a'.repeat(64), pfad: w, dauer_s: 0 }]);
  const slow = path.join(d, 'z.sh'); fs.writeFileSync(slow, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const s = await stapel(t, { katalog: kat, welleFfmpeg: [slow], welleZeitlimit: () => 300 });
  const r = await fetch(`${s.url}/welle?sha=${'a'.repeat(64)}`);
  assert.deepEqual([r.status, (await r.json()).fehler], [504, 'waveform timed out']);
});

test('B4: --welle-cache gilt; ohne Schalter hat eine Prüfinstanz ihren Cache unter /dev/shm, nie den des Betriebs', async (t) => {
  const d = tmpd(t, 'welle-cli-');
  const start = async (args) => {
    const p = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.ts'), '--port', '39555', '--bestand', d, '--arbeitsbestand', path.join(d, 'ab'), ...args],
      { env: { ...process.env, CYPHERDJ_INSTANZ: TEST_INSTANZ }, stdio: ['ignore', 'pipe', 'pipe'] });
    let aus = ''; p.stdout.on('data', (x) => { aus += x; });
    for (let i = 0; i < 100 && !/oberflaeche: http/.test(aus); i++) await new Promise((r) => setTimeout(r, 50));
    p.kill('SIGTERM'); if (p.exitCode === null && p.signalCode === null) await new Promise((r) => p.once('exit', r));   // schon beendet (z. B. Port belegt): nicht ewig warten
    return aus;
  };
  assert.match(await start(['--welle-cache', path.join(d, 'mein-cache')]), new RegExp(`welle-cache ${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/mein-cache`));
  assert.match(await start([]), new RegExp(`welle-cache /dev/shm/cypherdj-${TEST_INSTANZ}/welle`));
});

test('B2 am Server: schließt die Seite die Anfrage, endet ffmpeg sofort (nicht erst nach seiner Laufzeit)', async (t) => {
  const d = tmpd(t, 'welle-srvabbr-'); const [w] = wavs(d, 1);
  const kat = baueKatalog(d, [{ typ: 'oneshot', sha: 'a'.repeat(64), shas: 'a'.repeat(64), pfad: w, dauer_s: 1 }]);
  const s = await stapel(t, { katalog: kat, welleFfmpeg: [sh(t, d, 4)] });
  const ac = new AbortController();
  const lauf = fetch(`${s.url}/welle?sha=${'a'.repeat(64)}`, { signal: ac.signal }).catch((e) => e.name);
  for (let i = 0; i < 40 && dekodierer(d) === 0; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(dekodierer(d), 1, 'die Dekodierung läuft');
  const t0 = Date.now(); ac.abort(); assert.equal(await lauf, 'AbortError');
  while (dekodierer(d) > 0 && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25));
  assert.ok(Date.now() - t0 < 1500, `ffmpeg endete ${Date.now() - t0} ms nach dem Abbruch (Laufzeit wäre 4 s)`);
});

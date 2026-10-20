// D1 S3, Slice 2: Render-Aufruf (projekt/render.ts) gegen das Test-Doppel tests/hilfen/render_attrappe.mjs und Lautheit
// (projekt/lautheit.ts) mit dem echten ffmpeg. Kein Netz, kein Kern; Kindprozesse und Dateien in tmp. Das Doppel folgt render_main.cpp (K3,
// 05a91adb): Test 7 hält seine Rückgaben fest, damit S3 gegen dieselben Fälle prüft, die der echte Render kennt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { leseRenderAntwort, reglerAusProjekt, rendere, RenderFehler } from '../projekt/render.ts';
import { leseEbur128, messeLautheit } from '../projekt/lautheit.ts';
import { specProjekt, tmpOrdner } from './hilfen/projekt.mjs';

const ATTRAPPE_DATEI = path.join(import.meta.dirname, 'hilfen', 'render_attrappe.mjs');
const ATTRAPPE = [process.execPath, ATTRAPPE_DATEI];

function aufbau(t, wiedergabe = { format: 'cypherdj-arr/1', nr: 7, spuren: [] }) {
  const d = tmpOrdner(t, 'djk-s3-render-');
  fs.writeFileSync(path.join(d, `wiedergabe-${wiedergabe.nr}.json`), JSON.stringify(wiedergabe));
  const regler = path.join(d, 'regler.json');
  fs.writeFileSync(regler, JSON.stringify({ 'spur/1/fader': -6, 'spur/1/pan': 0, 'spur/1/mute': 0, 'spur/1/solo': 0 }));
  const protokoll = path.join(d, 'protokoll.jsonl');
  return { d, regler, protokoll, auf: { programm: ATTRAPPE, nr: wiedergabe.nr, von_beat: 0, bis_beat: 8, bpm: 120, aus: path.join(d, 'x.wav'),
    arbeitsordner: d, spurRegler: regler, instanz: 'c', zeitlimitMs: 20000 } };
}
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('reglerAusProjekt: vier Pfade je Spur in Kern-Einheiten (dB, −1..1, 0/1), nach Spur-Slot sortiert', () => {
  const p = specProjekt();
  p.spuren[1].fader_db = -7.5; p.spuren[1].pan = -0.25; p.spuren[2].mute = true; p.spuren[0].solo = true;
  p.spuren.reverse();
  assert.deepEqual(reglerAusProjekt(p), {
    'spur/1/fader': 0, 'spur/1/pan': 0, 'spur/1/mute': 0, 'spur/1/solo': 1,
    'spur/2/fader': -7.5, 'spur/2/pan': -0.25, 'spur/2/mute': 0, 'spur/2/solo': 0,
    'spur/3/fader': 0, 'spur/3/pan': 0, 'spur/3/mute': 1, 'spur/3/solo': 0,
  });
  assert.deepEqual(Object.keys(reglerAusProjekt(p)).slice(0, 2), ['spur/1/fader', 'spur/1/pan']);
});

test('rendere: Kommandozeile laut K3, Instanz in der Umgebung, Antwort mit regler_quelle kern; ohne Neustart-Zustand projekt', async (t) => {
  const { auf, protokoll } = aufbau(t);
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll }, () => rendere(auf));
  assert.deepEqual(r, { datei: auf.aus, frames: 192000, spitze_db: -6.021, regler_quelle: 'kern' });
  assert.equal(fs.statSync(auf.aus).size, 44 + 192000 * 8);
  const z = JSON.parse(fs.readFileSync(protokoll, 'utf8').trim());
  assert.deepEqual(z.argv, ['--nr', '7', '--von-beat', '0', '--bis-beat', '8', '--bpm', '120', '--aus', auf.aus, '--arr-ordner', auf.arbeitsordner,
    '--spur-regler', auf.spurRegler]);
  assert.equal(z.instanz, 'c');
  assert.deepEqual(z.regler['spur/1/fader'], -6);
  const p = await mitUmgebung({ RENDER_ATTRAPPE_ZUSTAND: 'fehlt' }, () => rendere({ ...auf, von_beat: 4.5, bis_beat: 6, aus: path.join(auf.arbeitsordner, 'y.wav') }));
  assert.deepEqual([p.regler_quelle, p.frames], ['projekt', 36000]);
});

test('rendere: Rückgabe ≠ 0 ist render_fehler mit Rückgabe und letzter stderr-Zeile; Zeitlimit; Wirt-Spur 5; fehlende Wiedergabe 4; Ziel besteht 8', async (t) => {
  const { auf } = aufbau(t);
  await assert.rejects(mitUmgebung({ RENDER_ATTRAPPE_RC: '4' }, () => rendere(auf)),
    (e) => e instanceof RenderFehler && e.grund === 'render_fehler' && e.rc === 4 && /Attrappe endet mit 4/.test(e.message));
  await assert.rejects(mitUmgebung({ RENDER_ATTRAPPE_SCHLAF_MS: '3000' }, () => rendere({ ...auf, zeitlimitMs: 300 })), /Zeitlimit 300 ms/);
  await assert.rejects(rendere({ ...auf, nr: 8 }), (e) => e.rc === 4 && /datei_fehlt/.test(e.message));
  const w = aufbau(t, { format: 'cypherdj-arr/1', nr: 9, spuren: [{ nr: 3, art: 'wirt', slot: 1, noten: [] }] });
  await assert.rejects(rendere(w.auf), (e) => e.rc === 5 && /wirt_nicht_eingefroren/.test(e.message));
  await assert.rejects(rendere({ ...auf, programm: ['/gibt/es/nicht/cypherdj-render'] }), (e) => e instanceof RenderFehler && e.rc === 127);
  fs.writeFileSync(auf.aus, 'schon da');
  await assert.rejects(rendere(auf), (e) => e.rc === 8 && /Ziel besteht/.test(e.message) && /besteht schon/.test(e.message));
  assert.equal(fs.readFileSync(auf.aus, 'utf8'), 'schon da', 'der Render ersetzt nie');
  assert.match(new RenderFehler('x', 8).text, /^the export render failed/, 'englischer text (Spec 6.34)');
});

test('leseRenderAntwort: ohne regler_quelle (K3 ohne Nachtrag 6.20) und ohne frames ist render_fehler; letzte Zeile zählt', () => {
  assert.deepEqual(leseRenderAntwort('Hinweis\n{"datei":"/x.wav","frames":10,"spitze_db":-1,"regler_quelle":"projekt"}\n'),
    { datei: '/x.wav', frames: 10, spitze_db: -1, regler_quelle: 'projekt' });
  assert.throws(() => leseRenderAntwort('{"datei":"/x.wav","frames":10,"spitze_db":-1,"regler":436}'), /regler_quelle/);
  assert.throws(() => leseRenderAntwort('{"datei":"/x.wav","spitze_db":-1,"regler_quelle":"kern"}'), /frames/);
  assert.throws(() => leseRenderAntwort(''), /kein JSON/);
});

test('leseEbur128: Zahlen aus der Zusammenfassung, -inf wird −200, ohne Summary null', () => {
  const text = '[Parsed_ebur128_0 @ 0x1] t: 4.9 I: -27.8 LUFS\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n'
    + '    Threshold: -24.2 LUFS\n\n  Loudness range:\n    LRA:         6.3 LU\n    Threshold: -34.0 LUFS\n\n  True peak:\n    Peak:       -0.4 dBFS\n';
  assert.deepEqual(leseEbur128(text), { lufs_i: -14.2, lra: 6.3, true_peak_dbtp: -0.4 });
  assert.deepEqual(leseEbur128(text.replace('-0.4 dBFS', '-inf dBFS')).true_peak_dbtp, -200);
  assert.equal(leseEbur128('kein Summary hier'), null);
  assert.equal(leseEbur128(text.replace(/LRA:.*\n/, '')), null);
});

test('messeLautheit: echtes ffmpeg über die WAV der Attrappe (Sinus −6 dBFS), ffmpeg fehlt und Fehler ergeben null mit Grund', async (t) => {
  const { auf } = aufbau(t);
  await rendere(auf);
  const l = await messeLautheit(auf.aus);
  assert.equal(l.loudness_fehler, undefined, JSON.stringify(l));
  // Sinus 440 Hz, Spitze 0,5 auf beiden Kanälen: K-gewichtet etwa −6 dB LUFS-I; True Peak nahe −6 dBFS; konstant, LRA 0
  assert.ok(l.lufs_i > -8 && l.lufs_i < -4, `LUFS-I ${l.lufs_i}`);
  assert.ok(l.true_peak_dbtp > -6.5 && l.true_peak_dbtp < -5.5, `True Peak ${l.true_peak_dbtp}`);
  assert.equal(l.lra, 0);
  assert.deepEqual(await messeLautheit(auf.aus, ['/gibt/es/nicht/ffmpeg']),
    { lufs_i: null, lra: null, true_peak_dbtp: null, loudness_fehler: 'ffmpeg_fehlt: /gibt/es/nicht/ffmpeg' });
  const kaputt = path.join(auf.arbeitsordner, 'kaputt.wav'); fs.writeFileSync(kaputt, 'keine wav');
  const k = await messeLautheit(kaputt);
  assert.deepEqual([k.lufs_i, k.lra, k.true_peak_dbtp], [null, null, null]);
  assert.match(k.loudness_fehler, /^ffmpeg_fehler: Rückgabe \d+/);
});

test('Render-Doppel wie render_main.cpp (K3 05a91adb): Rückgaben 2, 3, 8 und Spur-Regler-Prüfung auch bei Zustand', (t) => {
  const { d, regler } = aufbau(t);
  const lauf = (argv, env = {}) => {
    const r = spawnSync(process.execPath, [ATTRAPPE_DATEI, ...argv], { env: { ...process.env, ...env }, encoding: 'utf8' });
    return [r.status, r.stderr.trim().split('\n').at(-1)];
  };
  const basis = (aus, extra = []) => ['--nr', '7', '--von-beat', '0', '--bis-beat', '4', '--bpm', '120', '--aus', path.join(d, aus), '--arr-ordner', d, ...extra];
  assert.equal(lauf(basis('a.wav', ['--spur-regler', regler]))[0], 0, 'Negativ-Kontrolle: gültiger Aufruf');
  assert.equal(lauf(basis('a.wav', ['--spur-regler', regler]))[0], 8, 'Ziel besteht: nie ersetzen');
  assert.equal(lauf([...basis('b.wav'), '--unbekannt', '1'])[0], 2, 'unbekannte Option: hilfe(), Rückgabe 2');
  const kaputt = path.join(d, 'kaputt.json');
  fs.writeFileSync(kaputt, JSON.stringify({ 'spur/9/fader': 0 }));
  assert.deepEqual(lauf(basis('c.wav', ['--spur-regler', kaputt]))[0], 2, 'ungültige Spur-Regler-Datei: 2, auch wenn der Zustand gilt');
  fs.writeFileSync(kaputt, JSON.stringify({ 'spur/1/fader': 7 }));
  assert.equal(lauf(basis('c.wav', ['--spur-regler', kaputt]))[0], 2, 'fader über +6 dB');
  fs.writeFileSync(kaputt, JSON.stringify({ 'spur/1/mute': 0.5 }));
  assert.equal(lauf(basis('c.wav', ['--spur-regler', kaputt]))[0], 2, 'mute nicht ganzzahlig');
  assert.equal(lauf(basis('c.wav', ['--spur-regler', path.join(d, 'gibtsnicht.json')]))[0], 2, 'Spur-Regler-Datei fehlt');
  assert.deepEqual(lauf(basis('d.wav'), { RENDER_ATTRAPPE_ZUSTAND: 'fehlt' }), [3, 'Neustart-Zustand: fehlt, und keine --spur-regler (Spec 6.20)']);
  assert.equal(lauf(basis('d.wav', ['--ohne-zustand']))[0], 3, '--ohne-zustand ohne --spur-regler');
  assert.equal(lauf(basis('d.wav', ['--ohne-zustand', '--zustand', '/x']))[0], 2, '--ohne-zustand und --zustand zusammen');
  const b = ['--nr', '7', '--von-beat', '0', '--bis-beat', '2049', '--bpm', '120', '--aus', path.join(d, 'e.wav'), '--arr-ordner', d];
  assert.equal(lauf(b)[0], 2, 'über 2048 Beats (RENDER_MAX_BEATS)');
  assert.equal(lauf(basis('e.wav').map((x) => (x === '120' ? '128x' : x)))[0], 2, 'Zahl streng gelesen (Fix L8)');
  assert.equal(lauf(basis('f.wav', ['--ohne-zustand', '--spur-regler', regler]))[0], 0, '--ohne-zustand mit Spur-Reglern');
  assert.equal(fs.existsSync(path.join(d, 'c.wav')) || fs.existsSync(path.join(d, 'd.wav')) || fs.existsSync(path.join(d, 'e.wav')), false, 'kein Ziel bei Fehlern');
});

// Fix-Runde S3, R3 (Quality-Review: wrapper_mit_kind 4002 ms bei Zeitlimit 300): ein Render-Programm, das einen Enkel startet, der stdout offen hält.
// Das Zeitlimit tötet die ganze Prozessgruppe und entscheidet ohne close; der Enkel lebt danach nicht weiter. Negativ-Kontrolle: ein Programm mit
// Enkel, das rechtzeitig fertig wird, ist kein Zeitlimit.
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
test('R3: Zeitlimit tötet die Prozessgruppe (auch den Enkel, der stdout hält) und entscheidet ohne close', async (t) => {
  const { d, auf } = aufbau(t);
  const pidDatei = path.join(d, 'enkel.pid');
  // sh startet einen Enkel (sleep 30, erbt stdout) und wartet; $0.. sind die Render-Argumente
  const programm = ['sh', '-c', `sleep 30 & echo $! > ${pidDatei}; wait`];
  const t0 = Date.now();
  await assert.rejects(rendere({ ...auf, programm, zeitlimitMs: 300 }), (e) => e instanceof RenderFehler && /Zeitlimit 300 ms/.test(e.message));
  const dauer = Date.now() - t0;
  t.diagnostic(`Zeitlimit nach ${dauer} ms`);
  assert.ok(dauer < 1500, `entschieden ohne auf close zu warten (${dauer} ms)`);
  const enkel = Number(fs.readFileSync(pidDatei, 'utf8'));
  for (let n = 0; n < 50 && lebt(enkel); n++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(lebt(enkel), false, `der Enkel ${enkel} ist mit der Gruppe beendet`);
  // Negativ-Kontrolle: Enkel endet vor dem Programm, das Programm meldet gültig; kein Zeitlimit
  const gut = ['sh', '-c', `sleep 0.1 & wait; echo '{"datei":"x.wav","frames":1,"spitze_db":-6,"regler_quelle":"kern"}'`];
  const r = await rendere({ ...auf, programm: gut, zeitlimitMs: 3000 });
  assert.equal(r.frames, 1);
});

// Fix-Runde 2 S3, F4 (Re-Review: seit R3 läuft der Render als eigene Prozessgruppe und bekommt Strg-C an den Server nicht mehr mit): ein Abbruch
// über abbruch (AbortSignal) tötet die ganze Gruppe sofort, auch den Enkel, und entscheidet ohne close. Ein schon abgebrochenes Signal startet nichts.
// Negativ-Kontrolle: ein Signal, das nie feuert, ändert nichts am Lauf.
test('F4: abbruch tötet die Prozessgruppe sofort (auch den Enkel); schon abgebrochen startet nichts; ohne Abbruch läuft der Render durch', async (t) => {
  const { d, auf } = aufbau(t);
  const pidDatei = path.join(d, 'enkel-f4.pid');
  const programm = ['sh', '-c', `sleep 30 & echo $! > ${pidDatei}; wait`];
  const ac = new AbortController();
  const lauf = rendere({ ...auf, programm, zeitlimitMs: 20_000, abbruch: ac.signal });
  for (let n = 0; n < 100 && !(fs.existsSync(pidDatei) && fs.readFileSync(pidDatei, 'utf8').trim()); n++) await new Promise((r) => setTimeout(r, 20));
  const enkel = Number(fs.readFileSync(pidDatei, 'utf8'));
  assert.ok(lebt(enkel), 'der Enkel läuft vor dem Abbruch');
  const t0 = Date.now();
  ac.abort();
  await assert.rejects(lauf, (e) => e instanceof RenderFehler && /abgebrochen/.test(e.message) && /server is shutting down/.test(e.text));
  const dauer = Date.now() - t0;
  t.diagnostic(`Abbruch nach ${dauer} ms`);
  assert.ok(dauer < 1500, `entschieden ohne auf close oder Zeitlimit zu warten (${dauer} ms)`);
  for (let n = 0; n < 50 && lebt(enkel); n++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(lebt(enkel), false, `der Enkel ${enkel} ist mit der Gruppe beendet`);
  const gut = ['sh', '-c', `echo '{"datei":"x.wav","frames":1,"spitze_db":-6,"regler_quelle":"kern"}'`];
  const pid2 = path.join(d, 'nie.pid');
  await assert.rejects(rendere({ ...auf, programm: ['sh', '-c', `echo $$ > ${pid2}`], zeitlimitMs: 3000, abbruch: AbortSignal.abort() }),
    (e) => e instanceof RenderFehler && /server is shutting down/.test(e.text));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(pid2), false, 'mit schon abgebrochenem Signal startet kein Render');
  const r = await rendere({ ...auf, programm: gut, zeitlimitMs: 3000, abbruch: new AbortController().signal });
  assert.equal(r.frames, 1, 'Negativ-Kontrolle: ein Signal, das nie feuert');
});

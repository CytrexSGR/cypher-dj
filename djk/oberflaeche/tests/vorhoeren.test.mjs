// Vorhören als Kern-Eingang (Plan 2026-10-10-mediathek-browser, S7): Kopfhörer-Prüfung zuerst, Verhalten je Typ, Kanten
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Vorhoeren, kopfhoererAus, kantenZeilen, nurCueAus } from '../vorhoeren.ts';
import { stapel, post, hole } from './hilfen/mediathek.mjs';
import { standardKatalog, ksha } from './hilfen/katalog.mjs';

function attrappe({ dauer = 200, fehler = null } = {}) {
  const k = new EventEmitter(); k.befehle = []; k.spielt = false;
  k.starte = async () => { k.befehle.push('starte'); };
  k.laden = (p) => { k.befehle.push(`laden ${p}`); setImmediate(() => (fehler ? k.emit('fehler', fehler) : k.emit('geladen', { pfad: p, dauer_s: dauer }))); };
  k.play = () => { k.spielt = true; k.befehle.push('play'); };
  k.pause = () => { k.spielt = false; k.befehle.push('pause'); };
  k.springe = (s) => k.befehle.push(`springe ${s}`);
  k.loop = (a, b) => k.befehle.push(`loop ${a} ${b}`);
  k.loopAus = () => k.befehle.push('loop_aus');
  k.geschaetztePosition = () => 50;
  return k;
}
// Review S7 m5: der Klient meldet bei Loops kurz vor B fälschlich „ended" und setzt spielt = false (vorhoerer-klient.ts:111)
const neu = (o = {}) => { const k = attrappe(o); const kd = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vh-')), 'kanten');
  return { k, kd, v: new Vorhoeren({ kopfhoererDa: async () => o.kopf ?? true, kernNurCue: () => o.nurCue ?? true, klient: () => k, kantenDatei: kd, instanz: '' }) }; };

test('nurCueAus: Fähigkeiten-Datei mit lebendem cypherdj-kern und nur_cue erz/8 — sonst nein', () => {
  const comm = (pid) => (pid === 4711 ? 'cypherdj-kern' : pid === 4712 ? 'node' : null);
  assert.equal(nurCueAus('{"pid":4711,"nur_cue":"erz/8"}', comm), true);
  assert.equal(nurCueAus('{"pid":4711}', comm), false, 'alter Kern-Stand ohne Feld');
  assert.equal(nurCueAus('{"pid":4712,"nur_cue":"erz/8"}', comm), false, 'PID gehört nicht dem Kern');
  assert.equal(nurCueAus('{"pid":4713,"nur_cue":"erz/8"}', comm), false, 'tote PID (alter Kern neu gestartet)');
  assert.equal(nurCueAus(null, comm), false, 'keine Datei');
  assert.equal(nurCueAus('{kaputt', comm), false);
});

test('Kern ohne Nur-Cue: 503 kern_ohne_vorhoerkanal, KEIN Befehl, keine Kanten', async () => {
  const { k, v, kd } = neu({ nurCue: false });
  await assert.rejects(v.spiele({ pfad: '/a.wav', typ: 'track', sha: 'a' }), (e) => e.code === 503 && e.fehler === 'kern_ohne_vorhoerkanal');
  assert.deepEqual(k.befehle, []);
  assert.equal(fs.existsSync(kd), false);
});

test('Loop: ein falsches „ended" des Klienten lässt den Loop spielen; beim Sample ist ended das Ende', async () => {
  const { k, v } = neu();
  await v.spiele({ pfad: '/l.wav', typ: 'loop', sha: 'l' });
  k.spielt = false; k.emit('ended');
  assert.equal((await v.stand()).spielt, true, 'Loop läuft weiter (Review S7 m5)');
  assert.equal(k.spielt, true, 'Klient wieder auf spielt, sonst stünde seine Positionsschätzung');
  await v.spiele({ pfad: '/s.wav', typ: 'oneshot', sha: 's' });
  k.spielt = false; k.emit('ended');
  assert.equal((await v.stand()).spielt, false);
});

test('kopfhoererAus: cue_L des Kerns mit einer Verbindung = Kopfhörer da; ohne Verbindung nicht', () => {
  const mit = 'cypherdj-kern:cue_L\n  |-> alsa_output.usb-FIIO_FIIO_KA11-01.analog-stereo:playback_FL\ncypherdj-kern:cue_R\n  |-> alsa_output.usb-FIIO_FIIO_KA11-01.analog-stereo:playback_FR\n';
  assert.equal(kopfhoererAus(mit, 'cypherdj-kern'), true);
  assert.equal(kopfhoererAus('cypherdj-kern:cue_L\ncypherdj-kern:cue_R\n', 'cypherdj-kern'), false, 'Port ohne Kante');
  assert.equal(kopfhoererAus(mit, 'cypherdj-kern-i'), false, 'anderer Kern');
});

test('kantenZeilen: Vorhörer-Ausgänge an rueck_erz_8 des Kerns, je Instanz', () => {
  assert.deepEqual(kantenZeilen(''), ['cypherdj-vorhoerer-mt:aus_L\tcypherdj-kern:rueck_erz_8_L', 'cypherdj-vorhoerer-mt:aus_R\tcypherdj-kern:rueck_erz_8_R']);
  assert.deepEqual(kantenZeilen('i'), ['cypherdj-vorhoerer-mt-i:aus_L\tcypherdj-kern-i:rueck_erz_8_L', 'cypherdj-vorhoerer-mt-i:aus_R\tcypherdj-kern-i:rueck_erz_8_R']);
});

test('ohne Kopfhörer: 409 kein_kopfhoerer und KEIN Befehl an den Vorhörer', async () => {
  const { k, v } = neu({ kopf: false });
  await assert.rejects(v.spiele({ pfad: '/a.wav', typ: 'track', sha: 'a' }), (e) => e.code === 409 && e.fehler === 'kein_kopfhoerer');
  assert.deepEqual(k.befehle, []);
});

test('Track ab 25 %, Loop geloopt, Sample einmal; Kanten einmal geschrieben', async () => {
  const { k, v, kd } = neu();
  await v.spiele({ pfad: '/t.mp3', typ: 'track', sha: 't' });
  await v.spiele({ pfad: '/l.wav', typ: 'loop', sha: 'l' });
  await v.spiele({ pfad: '/s.wav', typ: 'oneshot', sha: 's' });
  assert.deepEqual(k.befehle, ['starte', 'laden /t.mp3', 'loop_aus', 'springe 50', 'play',
    'laden /l.wav', 'loop 0 200', 'play', 'laden /s.wav', 'loop_aus', 'play']);
  assert.equal(fs.readFileSync(kd, 'utf8'), kantenZeilen('').join('\n') + '\n');
  await v.spiele({ pfad: '/t.mp3', typ: 'track', sha: 't' });
  assert.equal(fs.readFileSync(kd, 'utf8').split('\n').filter(Boolean).length, 2, 'Kanten nicht doppelt');
});

test('springe: Track ±8 Takte bei BPM, sonst ±15 s; Loop ← an den Anfang', async () => {
  const { k, v } = neu();
  await v.spiele({ pfad: '/t.mp3', typ: 'track', sha: 't', bpm: 120 });
  k.befehle.length = 0;
  v.springe(1); v.springe(-1);
  assert.deepEqual(k.befehle, ['springe 66', 'springe 34'], '8 Takte bei 120 BPM = 16 s, ab Position 50');
  await v.spiele({ pfad: '/t2.mp3', typ: 'track', sha: 't2' });
  k.befehle.length = 0; v.springe(1);
  assert.deepEqual(k.befehle, ['springe 65']);
  await v.spiele({ pfad: '/l.wav', typ: 'loop', sha: 'l' });
  k.befehle.length = 0; v.springe(-1); v.springe(1);
  assert.deepEqual(k.befehle, ['springe 0']);
});

test('Ladefehler (unbekanntes Format) → 422 mit Grund; stand und stopp', async () => {
  const { v } = neu({ fehler: 'ffmpeg: Invalid data found when processing input: /x.aif' });
  await assert.rejects(v.spiele({ pfad: '/x.aif', typ: 'oneshot', sha: 'x' }), (e) => e.code === 422 && /Invalid data/.test(e.fehler));
  const g = neu();
  await g.v.spiele({ pfad: '/t.mp3', typ: 'track', sha: 't' });
  assert.deepEqual(await g.v.stand(), { sha: 't', typ: 'track', s: 50, dauer_s: 200, spielt: true, kopfhoerer: true });
  g.v.stoppe();
  assert.equal(g.k.befehle.at(-1), 'pause');
});
// ---- Server: POST/GET /vorhoeren mit Attrappe statt Vorhörer-Prozess ----
async function mitServer(t, o = {}) {
  const kat = standardKatalog(t);
  const { k, v } = neu(o);
  const s = await stapel(t, { katalog: kat.datei, vorhoeren: v });
  return { s, k, v, kat };
}
const sha = (n) => ksha(n);

test('Server: Sample mit schutz ableton → 409 nur_live, ohne einen Befehl an den Vorhörer', async (t) => {
  const { s, k } = await mitServer(t);
  const r = await post(s.url, '/vorhoeren', { sha: sha(13) });
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'nur_live');
  assert.deepEqual(k.befehle, []);
});

test('Server: Datei fehlt → 409 datei_fehlt; unbekannte sha → 404', async (t) => {
  const { s, k } = await mitServer(t);
  const r = await post(s.url, '/vorhoeren', { sha: sha(2) });
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'datei_fehlt');
  assert.equal((await post(s.url, '/vorhoeren', { sha: sha(999) })).code, 404);
  assert.deepEqual(k.befehle, []);
});

test('Server: Kopfhörer aus → 409 kein_kopfhoerer, kein Befehl', async (t) => {
  const { s, k } = await mitServer(t, { kopf: false });
  const r = await post(s.url, '/vorhoeren', { sha: sha(21) });
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'kein_kopfhoerer');
  assert.deepEqual(k.befehle, []);
});

test('Server: Kern ohne Nur-Cue → 503 kern_ohne_vorhoerkanal, kein Befehl', async (t) => {
  const { s, k } = await mitServer(t, { nurCue: false });
  const r = await post(s.url, '/vorhoeren', { sha: sha(21) });
  assert.equal(r.code, 503); assert.equal(r.j.fehler, 'kern_ohne_vorhoerkanal');
  assert.deepEqual(k.befehle, []);
});

test('Server: Sample spielt; Track nur per mid (Listen-Zeile) spielt; springe kommt an; stopp pausiert', async (t) => {
  const { s, k } = await mitServer(t);
  const r = await post(s.url, '/vorhoeren', { sha: sha(21) });
  assert.equal(r.code, 200); assert.equal(r.j.ok, true); assert.equal(r.j.typ, 'oneshot');
  const m = await post(s.url, '/vorhoeren', { mid: sha(1).slice(0, 16) });
  assert.equal(m.code, 200); assert.equal(m.j.typ, 'track'); assert.equal(m.j.sha, sha(1));
  k.befehle.length = 0;
  assert.equal((await post(s.url, '/vorhoeren', { aktion: 'springe', richtung: -1 })).code, 200);
  assert.deepEqual(k.befehle, ['springe 35'], 'ohne BPM −15 s ab Position 50');
  const g = await hole(s.url, '/vorhoeren');
  assert.equal(g.code, 200); assert.equal(g.j.spielt, true); assert.equal(g.j.kopfhoerer, true);
  assert.equal((await post(s.url, '/vorhoeren', { aktion: 'stopp' })).code, 200);
  assert.equal(k.befehle.at(-1), 'pause');
  assert.equal((await hole(s.url, '/vorhoeren')).j.spielt, false);
});

test('Server: fremde Herkunft und kein JSON werden wie bei /muster abgewiesen', async (t) => {
  const { s, k } = await mitServer(t);
  assert.equal((await post(s.url, '/vorhoeren', { sha: sha(21) }, { origin: 'http://boese.example' })).code, 403);
  const r = await fetch(s.url + '/vorhoeren', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
  assert.deepEqual(k.befehle, []);
});

// ---- S7-Review (REVIEW-SERVER.md): B1 Wettlauf, B2 toter Vorhörer, B3 Kern ohne Nur-Cue / Ende räumt Kanten ----
// Attrappe wie der echte Vorhörer: jedes laden() antwortet nach seiner eigenen Verzögerung mit dem Pfad, den es lud
function zeitAttrappe(verzoegerung = {}, verwirft = false) {
  const k = new EventEmitter(); k.befehle = []; k.spielt = false; k.gestoppt = 0; const timer = new Set();
  k.starte = async () => { k.befehle.push('starte'); };
  k.laden = (p) => {
    k.befehle.push(`laden ${p}`);
    if (verwirft) { for (const t of timer) clearTimeout(t); timer.clear(); }   // echter Vorhörer: ein neuerer Wunsch schießt die laufende Dekodierung ab
    const t = setTimeout(() => k.emit('geladen', { pfad: p, dauer_s: p.length * 10 }), verzoegerung[p] ?? 5); t.unref(); timer.add(t);
  };
  k.play = () => { k.spielt = true; k.befehle.push('play'); };
  k.pause = () => { k.spielt = false; k.befehle.push('pause'); };
  k.springe = (s) => k.befehle.push(`springe ${s}`);
  k.loop = (a, b) => k.befehle.push(`loop ${a} ${b}`);
  k.loopAus = () => k.befehle.push('loop_aus');
  k.geschaetztePosition = () => 1;
  k.stoppe = async () => { k.gestoppt++; };
  return k;
}
function neuZeit(verzoegerung, o = {}, verwirft = false) {
  const klienten = []; const ctx = { nurCue: true };
  const kd = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vh-')), 'kanten');
  const v = new Vorhoeren({ kopfhoererDa: async () => true, kernNurCue: () => ctx.nurCue, kantenDatei: kd, instanz: '',
    klient: () => { const k = zeitAttrappe(verzoegerung, verwirft); klienten.push(k); return k; }, ...o });
  return { v, klienten, ctx, kd };
}
const warteMs = (ms) => new Promise((r) => setTimeout(r, ms));

test('B1: zwei schnelle Anfragen: die ältere wird sofort als überholt abgewiesen, nur die neueste spielt, mit IHRER Dauer', async () => {
  const { v, klienten } = neuZeit({ '/lang-erste.mp3': 120, '/b.mp3': 20 });
  const erste = v.spiele({ pfad: '/lang-erste.mp3', typ: 'oneshot', sha: 'a' });
  await warteMs(30);
  const zweite = v.spiele({ pfad: '/b.mp3', typ: 'oneshot', sha: 'b' });
  const [r1, r2] = await Promise.allSettled([erste, zweite]);
  assert.equal(r1.status, 'rejected'); assert.equal(r1.reason.code, 409); assert.equal(r1.reason.fehler, 'ueberholt');
  assert.equal(r2.status, 'fulfilled');
  const k = klienten[0];
  assert.equal(k.befehle.filter((b) => b === 'play').length, 1, 'genau ein play, nur für die neueste');
  assert.ok(k.befehle.indexOf('laden /b.mp3') < k.befehle.indexOf('play'));
  const s = await v.stand();
  assert.equal(s.sha, 'b'); assert.equal(s.dauer_s, '/b.mp3'.length * 10, 'Dauer der neuesten Datei, nicht der ersten'); assert.equal(s.spielt, true);
});

test('B1: drei Anfragen im Abstand: nur die dritte spielt, die anderen sind überholt', async () => {
  const { v, klienten } = neuZeit({ '/1.mp3': 100, '/2.mp3': 100, '/3.mp3': 10 }, {}, true);
  const a = v.spiele({ pfad: '/1.mp3', typ: 'track', sha: '1' });
  a.catch(() => {});   // die überholte Anfrage wird sofort abgewiesen, bevor die Allsettled-Zeile sie anfasst
  await warteMs(20); const b = v.spiele({ pfad: '/2.mp3', typ: 'track', sha: '2' });
  b.catch(() => {});
  await warteMs(20); const c = v.spiele({ pfad: '/3.mp3', typ: 'track', sha: '3' });
  const r = await Promise.allSettled([a, b, c]);
  assert.deepEqual(r.map((x) => x.status), ['rejected', 'rejected', 'fulfilled']);
  assert.ok(r.slice(0, 2).every((x) => x.reason.fehler === 'ueberholt'));
  assert.equal(klienten[0].befehle.filter((x) => x === 'play').length, 1);
  assert.equal((await v.stand()).sha, '3');
});

test('B1: dieselbe Datei zweimal (doppelte Leertaste): die erste ist überholt, die zweite spielt', async () => {
  const { v, klienten } = neuZeit({ '/t.mp3': 60 });
  const a = v.spiele({ pfad: '/t.mp3', typ: 'track', sha: 't' });
  await warteMs(10); const b = v.spiele({ pfad: '/t.mp3', typ: 'track', sha: 't' });
  const [r1, r2] = await Promise.allSettled([a, b]);
  assert.equal(r1.reason?.fehler, 'ueberholt'); assert.equal(r2.status, 'fulfilled');
  assert.equal(klienten[0].befehle.filter((x) => x === 'play').length, 1);
  assert.equal((await v.stand()).spielt, true);
});

test('B1: ein geladen für eine ANDERE Datei beantwortet die Anfrage nicht', async () => {
  const { v, klienten } = neuZeit({ '/x.mp3': 60 });
  const p = v.spiele({ pfad: '/x.mp3', typ: 'oneshot', sha: 'x' });
  await warteMs(10);
  klienten[0].emit('geladen', { pfad: '/fremd.mp3', dauer_s: 999 });
  await p;
  assert.equal((await v.stand()).dauer_s, '/x.mp3'.length * 10, 'die Dauer der fremden Datei (999) zählt nicht');
});

test('B1: stopp während des Ladens bricht die wartende Anfrage ab, nichts wird gespielt', async () => {
  const { v, klienten } = neuZeit({ '/s.mp3': 60 });
  const p = v.spiele({ pfad: '/s.mp3', typ: 'oneshot', sha: 's' });
  await warteMs(10); v.stoppe();
  await assert.rejects(p, (e) => e.fehler === 'ueberholt');
  assert.equal(klienten[0].befehle.includes('play'), false);
});

test('B2: stirbt der Vorhörer, startet die nächste Anfrage einen neuen und der Stand ist zurückgesetzt', async () => {
  const { v, klienten } = neuZeit({});
  await v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' });
  assert.equal((await v.stand()).spielt, true);
  klienten[0].emit('beendet');                                  // kill -9: der Klient meldet den Tod des Kindes
  const s = await v.stand();
  assert.equal(s.spielt, false, 'Stand zurückgesetzt, nicht weiter spielt:true');
  await v.spiele({ pfad: '/b.mp3', typ: 'oneshot', sha: 'b' });
  assert.equal(klienten.length, 2, 'ein neuer Klient wurde gebaut');
  assert.ok(klienten[1].befehle.includes('starte') && klienten[1].befehle.includes('play'));
  assert.equal(klienten[0].gestoppt >= 1, true, 'der tote Klient wurde freigegeben (Socket)');
});

test('B3: stand() bei Kern ohne Nur-Cue: Vorhörer beendet, Kanten der Oberfläche weg, nichts spielt', async () => {
  const { v, klienten, ctx, kd } = neuZeit({});
  fs.mkdirSync(path.dirname(kd), { recursive: true });
  fs.writeFileSync(kd, 'cypherdj-wirt:aus_L\tcypherdj-kern:rueck_erz_2_L\n');   // Zeile eines Wirts: bleibt
  await v.spiele({ pfad: '/a.mp3', typ: 'loop', sha: 'a' });
  assert.ok(fs.readFileSync(kd, 'utf8').includes('cypherdj-vorhoerer-mt:aus_L'));
  ctx.nurCue = false;                                           // Rückweg auf den alten Kern
  const s = await v.stand();
  assert.equal(s.spielt, false);
  assert.equal(klienten[0].gestoppt, 1, 'Vorhörer beendet');
  assert.equal(fs.readFileSync(kd, 'utf8'), 'cypherdj-wirt:aus_L\tcypherdj-kern:rueck_erz_2_L\n', 'nur die eigenen Zeilen weg, Wirt-Zeile bleibt');
});

test('B3: ende() (SIGTERM der Oberfläche) entfernt die Kanten-Zeilen; ohne Temp-Reste', async () => {
  const { v, kd } = neuZeit({});
  fs.mkdirSync(path.dirname(kd), { recursive: true });
  fs.writeFileSync(kd, 'cypherdj-wirt:aus_L\tcypherdj-kern:rueck_erz_3_L\n');
  await v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' });
  await v.ende();
  assert.equal(fs.readFileSync(kd, 'utf8'), 'cypherdj-wirt:aus_L\tcypherdj-kern:rueck_erz_3_L\n');
  assert.deepEqual(fs.readdirSync(path.dirname(kd)), ['kanten'], 'atomar umgeschrieben: keine Temp-Datei bleibt');
  await v.ende();                                               // zweimal darf nichts werfen
});

test('Server B1: zwei schnelle POSTs: eine Antwort 409 ueberholt, die neueste 200', async (t) => {
  const kat = standardKatalog(t);
  const { v } = neuZeit({ [kat.daten + '/Drums/Kick/Kick 01.wav']: 150 });
  const s = await stapel(t, { katalog: kat.datei, vorhoeren: v });
  const a = post(s.url, '/vorhoeren', { sha: sha(21) });
  await warteMs(30);
  const b = post(s.url, '/vorhoeren', { sha: sha(22) });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.code, 409); assert.equal(ra.j.fehler, 'ueberholt');
  assert.equal(rb.code, 200); assert.equal(rb.j.sha, sha(22));
});

test('B3: hat sich der Vorhörer selbst beendet (Riegel-Wache) und der Kern meldet kein Nur-Cue, räumt stand() die Kanten trotzdem', async () => {
  const { v, klienten, ctx, kd } = neuZeit({});
  await v.spiele({ pfad: '/a.mp3', typ: 'loop', sha: 'a' });
  klienten[0].emit('beendet');                                  // Vorhörer endet von selbst (Wache), this.k ist danach null
  ctx.nurCue = false;
  const s = await v.stand();
  assert.equal(s.spielt, false);
  assert.equal(fs.readFileSync(kd, 'utf8'), '', 'eigene Kanten-Zeilen weg, auch ohne laufenden Klienten');
});

// ---- M1: der Vorhörer dekodiert höchstens die ersten 30 min (Speicher); die Antwort sagt es ----
test('M1: Datei über der Grenze: stand() meldet gekuerzt:true; darunter nicht', async () => {
  const lang = neuZeit({}); lang.klienten.length = 0;
  const kurz = neuZeit({});
  // Dauer kommt aus dem Vorhörer: die Attrappe liefert pfad.length·10 s, also ein Pfad mit 180 Zeichen = 1800 s
  const pfadLang = '/' + 'x'.repeat(179);
  await lang.v.spiele({ pfad: pfadLang, typ: 'track', sha: 'l' });
  const s = await lang.v.stand();
  assert.equal(s.dauer_s, 1800); assert.equal(s.gekuerzt, true);
  await kurz.v.spiele({ pfad: '/kurz.mp3', typ: 'track', sha: 'k' });
  assert.equal((await kurz.v.stand()).gekuerzt, undefined);
});

// ---- Rest-Fixes (REVIEW-FIX.md): F2 Abbruch der überholten Ladung, F3 Sperre der Kanten-Datei, N1 Stand nach überholter Ladung ----
import { spawn } from 'node:child_process';
test('F2: die neueste Anfrage wartet nicht auf die Ladung der überholten (die nie antwortet, wie ein hängendes Laufwerk)', async () => {
  const { v, klienten } = neuZeit({ '/lang.mp3': 60_000, '/b.mp3': 10 });
  const t0 = Date.now();
  const a = v.spiele({ pfad: '/lang.mp3', typ: 'track', sha: 'l' });
  await warteMs(30);
  const b = v.spiele({ pfad: '/b.mp3', typ: 'oneshot', sha: 'b' });
  const [ra, rb] = await Promise.race([Promise.allSettled([a, b]), warteMs(3000).then(() => 'zeit')]);
  assert.notEqual(ra, undefined, 'beide Anfragen kamen binnen 3 s zurück');
  assert.equal(ra.status, 'rejected'); assert.equal(ra.reason.fehler, 'ueberholt'); assert.equal(rb.status, 'fulfilled');
  assert.ok(Date.now() - t0 < 1500, `neueste nach ${Date.now() - t0} ms`);
  assert.ok(klienten[0].befehle.indexOf('laden /lang.mp3') < klienten[0].befehle.indexOf('laden /b.mp3'));
});

test('N1: kommt das geladen einer überholten Datei, die im Vorhörer schon getauscht wurde, meldet stand() nicht mehr die vorige', async () => {
  const { v, klienten } = neuZeit({ '/b.mp3': 100, '/c.mp3': 400 });
  await v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' });
  assert.equal((await v.stand()).sha, 'a');
  const b = v.spiele({ pfad: '/b.mp3', typ: 'track', sha: 'b' }).catch(() => {});
  await warteMs(20);
  const c = v.spiele({ pfad: '/c.mp3', typ: 'track', sha: 'c' });
  await warteMs(150);                                           // b ist überholt, sein geladen kam trotzdem (Vorhörer hat getauscht), c lädt noch
  const s = await v.stand();
  assert.equal(s.spielt, false, 'der Vorhörer hält eine fremde Datei bei 0: kein spielt:true der vorigen');
  await c; await b;
  assert.equal((await v.stand()).sha, 'c');
});

const flockHalten = (ordner, ms) => new Promise((ok) => {
  const p = spawn('flock', ['-x', ordner, 'sleep', String(ms / 1000)], { stdio: 'ignore' });
  setTimeout(() => ok(p), 150);                                 // Sperre ist gegriffen
});
test('F3: kantenWeg wartet auf die Sperre des Ordners (dieselbe wie bei djk-instrumente) und verliert keine angehängte Zeile', async () => {
  const { v, kd } = neuZeit({});
  const ordner = path.dirname(kd);
  await v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' });
  const p = await flockHalten(ordner, 800);                     // „djk-instrumente“ hängt gerade an
  const t0 = Date.now();
  const ende = v.ende();                                        // räumt die eigenen Zeilen: muss warten
  await warteMs(200);
  fs.appendFileSync(kd, 'cypherdj-wirt:aus_L\tcypherdj-kern:rueck_erz_2_L\n');   // die Wirt-Zeile kommt unter der Sperre dazu
  await ende;
  assert.ok(Date.now() - t0 >= 600, `wartete auf die Sperre (${Date.now() - t0} ms)`);
  assert.equal(fs.readFileSync(kd, 'utf8'), 'cypherdj-wirt:aus_L\tcypherdj-kern:rueck_erz_2_L\n', 'die Wirt-Zeile ist nicht verloren');
  p.kill();
});

// ---- Review 5ca46dfb: R1 stand nach stopp, R2 fehler nach Pfad, R3 flock asynchron, kantenWeg im 503-Pfad in try ----
test('R1: stopp während des Ladens, der Vorhörer tauscht die Datei trotzdem: stand() meldet nicht die vorige', async () => {
  const { v, klienten } = neuZeit({ '/b.mp3': 100 });
  await v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' });
  const b = v.spiele({ pfad: '/b.mp3', typ: 'track', sha: 'b' }).catch(() => {});
  await warteMs(20); v.stoppe();                                // erwartet ist danach null
  await warteMs(120);                                           // sein geladen kommt trotzdem: der Vorhörer hält b bei 0
  const s = await v.stand();
  assert.equal(s.spielt, false); assert.equal(s.sha, undefined, 'nicht „sha a“ mit der Dauer der falschen Datei');
  await b;
  v.springe(1);
  assert.equal(klienten[0].befehle.filter((x) => x.startsWith('springe')).length, 1, 'springe ohne Element tut nichts (nur das Anfangs-springe)');
});

test('R2: ein fehler für eine ANDERE Datei weist die laufende Anfrage nicht mit 422 ab', async () => {
  const { v, klienten } = neuZeit({ '/b.mp3': 80 });
  const p = v.spiele({ pfad: '/b.mp3', typ: 'oneshot', sha: 'b' });
  await warteMs(20);
  klienten[0].emit('fehler', 'ffmpeg rc 1, 0 Frames: /kaputt-a.mp3');   // der Fehler der überholten Datei A
  await p;                                                      // b lädt normal fertig
  assert.equal((await v.stand()).sha, 'b');
});

test('R2: der eigene fehler (Pfad im Text) gibt 422', async () => {
  const { v, klienten } = neuZeit({ '/x.mp3': 500 });
  const p = v.spiele({ pfad: '/x.mp3', typ: 'oneshot', sha: 'x' });
  await warteMs(20); klienten[0].emit('fehler', 'ffmpeg rc 1, 0 Frames: /x.mp3');
  await assert.rejects(p, (e) => e.code === 422 && /Frames/.test(e.fehler));
});

test('R3: wartet die Sperre, steht die Event-Loop nicht (Timer laufen weiter)', async () => {
  const { v, kd } = neuZeit({});
  await v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' });
  const p = await flockHalten(path.dirname(kd), 1200);
  let letzter = Date.now(), maxLuecke = 0; const iv = setInterval(() => { const j = Date.now(); maxLuecke = Math.max(maxLuecke, j - letzter); letzter = j; }, 20);
  const ende = v.ende();
  await warteMs(700);
  clearInterval(iv);
  assert.ok(maxLuecke < 200, `Event-Loop stand nie länger als 200 ms still (größte Lücke ${maxLuecke} ms)`);
  await ende; p.kill();
});

test('503-Pfad: scheitert kantenWeg (Sperre nicht zu bekommen), kommt trotzdem 503 und kein roher Fehler', async () => {
  const { v, ctx, kd } = neuZeit({});
  fs.mkdirSync(path.dirname(kd), { recursive: true }); fs.writeFileSync(kd, 'x\n');
  ctx.nurCue = false;
  fs.chmodSync(kd, 0o400); fs.chmodSync(path.dirname(kd), 0o500);   // schreiben unmöglich: mv in den Ordner scheitert
  try { await assert.rejects(v.spiele({ pfad: '/a.mp3', typ: 'track', sha: 'a' }), (e) => e.code === 503 && e.fehler === 'kern_ohne_vorhoerkanal'); }
  finally { fs.chmodSync(path.dirname(kd), 0o700); fs.chmodSync(kd, 0o600); }
});

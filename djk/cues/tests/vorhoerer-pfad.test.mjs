// Zweiter Abspiel-Weg über den nativen Vorhörer (djk/vorhoerer), ganzer Pfad Seite(HTTP/SSE)→Server→UDP→Vorhörer.
// Eigene Null-Senke je Lauf (nie Andreas' Digital-Out), eigene OSC-Instanz 'g' (Andreas' laufende Instanz ist ''
// auf 47740/47730 und bleibt unberührt). Fehlerfall: Server ohne --ausgang / mit kaputter Binärdatei fällt auf
// den Browser zurück (409 auf /api/vorhoerer/*, status.weg === 'browser') statt einen Fehler zu werfen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CueServer } from '../server.ts';
import { mp3, tmpOrdner } from './hilfen.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DJK = path.resolve(HIER, '..', '..');
const BIN = path.join(DJK, 'vorhoerer', 'build', 'cypherdj-vorhoerer');
const SENKE = 'cypherdj-pruef-g-cuetest';
const INSTANZ = 'g';

// Die Null-Senke braucht einen laufenden PipeWire-/Pulse-Server (pactl); ohne ihn (Fremdrechner, CI) wird mit Grund übersprungen.
function audioServerDa() { try { execFileSync('pactl', ['info'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } }
const OHNE_AUDIO = audioServerDa() ? false : 'kein Audio-Server erreichbar (pactl info scheitert: PipeWire/PulseAudio läuft nicht)';

function senkeAn() { return execFileSync(path.join(DJK, 'pruefstand', 'senke', 'senke_an.sh'), [SENKE], { encoding: 'utf8' }).trim(); }
function senkeAb() { try { execFileSync(path.join(DJK, 'pruefstand', 'senke', 'senke_ab.sh'), [SENKE]); } catch { /* schon weg */ } }

function aufbau(t) {
  const d = tmpOrdner(t, 'djk-cues-vorhoerer-test-');
  const wurzel = path.join(d, 'musik');
  mp3(path.join(wurzel, 'sinus.mp3'), { f: 440, dauer: 3, meta: { title: 'Sinus', TBPM: '120' } });
  return { wurzel, daten: path.join(d, 'daten'), cache: path.join(d, 'cache') };
}

async function status(basis) { return fetch(`${basis}api/vorhoerer/status`).then((r) => r.json()); }
async function warteAuf(basis, prf, ms = 8000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { const s = await status(basis); if (prf(s)) return s; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`Zeitüberschreitung, letzter Stand: ${JSON.stringify(await status(basis))}`);
}

test('Fehlerfall: ohne --ausgang kein Vorhörer, Seite fällt auf Browser zurück', async (t) => {
  const { wurzel, daten, cache } = aufbau(t);
  const s = new CueServer({ port: 0, wurzel, nml: null, daten, cache });
  await s.starte(); t.after(() => s.stoppe());
  const basis = `http://127.0.0.1:${s.port}/`;
  const st = await status(basis);
  assert.deepEqual(st, { aktiv: false, weg: 'browser', geladen: null, position: null, spielt: false, fehler: null });
  const r = await fetch(`${basis}api/vorhoerer/play`, { method: 'POST' });
  assert.equal(r.status, 409);
});

test('Fehlerfall: kaputte Vorhörer-Binärdatei → Server bleibt oben, fällt auf Browser zurück (kein Absturz)', async (t) => {
  const { wurzel, daten, cache } = aufbau(t);
  const s = new CueServer({ port: 0, wurzel, nml: null, daten, cache, ausgang: 'x', vorhoererBin: '/nicht/da/gibt/es/nicht' });
  await s.starte(); t.after(() => s.stoppe());
  assert.equal(s.vorhoerer, null);
  assert.equal((await status(`http://127.0.0.1:${s.port}/`)).weg, 'browser');
});

test('Voller Pfad Seite→Server→Vorhörer: laden, play, Position kommt per SSE, Loop-Vorsprung (B3)', { timeout: 30000, skip: OHNE_AUDIO }, async (t) => {
  senkeAn(); t.after(senkeAb);
  const { wurzel, daten, cache } = aufbau(t);
  const s = new CueServer({
    port: 0, wurzel, nml: null, daten, cache,
    ausgang: `${SENKE}:playback_F`, ohneBlende: true, vorhoererInstanz: INSTANZ, vorhoererBin: BIN,
  });
  await s.starte(); t.after(() => s.stoppe());
  assert.ok(s.vorhoerer, 'Vorhörer sollte gestartet sein (Binärdatei vorhanden, eigene Senke)');
  const basis = `http://127.0.0.1:${s.port}/`;
  assert.equal((await status(basis)).weg, 'vorhoerer');

  // SSE-Strom mitlesen, um zu belegen, dass Positionen wirklich Seite<-Server<-Vorhörer ankommen (nicht nur im
  // Statuspoll). node:http statt fetch: die Antwort lässt sich mit res.destroy() zuverlässig schließen (ein
  // ungeschlossener fetch-ReadableStream-Reader hält den Node-Prozess sonst über das Testende hinaus offen).
  const sseEvents = [];
  let sseRes = null;
  await new Promise((ok) => {
    http.get(`${basis}api/vorhoerer/stream`, (r) => {
      sseRes = r;
      let buf = '';
      r.setEncoding('utf8');
      r.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const stueck = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (\w+)/m.exec(stueck); const da = /^data: (.*)$/m.exec(stueck);
          if (ev && da) sseEvents.push({ ev: ev[1], daten: JSON.parse(da[1]) });
        }
      });
      ok();
    });
  });
  t.after(() => sseRes?.destroy());

  const rLaden = await fetch(`${basis}api/vorhoerer/laden?rel=sinus.mp3`, { method: 'POST' });
  assert.equal(rLaden.status, 200);
  const stGeladen = await warteAuf(basis, (x) => x.geladen !== null);
  assert.ok(Math.abs(stGeladen.geladen.dauer_s - 3) < 0.2, `Dauer sollte ~3s sein: ${stGeladen.geladen.dauer_s}`);

  const rPlay = await fetch(`${basis}api/vorhoerer/play`, { method: 'POST' });
  assert.equal(rPlay.status, 200);
  await warteAuf(basis, (x) => x.spielt === true && x.position && x.position.s > 0.05);
  await fetch(`${basis}api/vorhoerer/pause`, { method: 'POST' });
  await warteAuf(basis, (x) => x.spielt === false);

  // Loop-Rand (B3): Position steht (nach pause) irgendwo > 0; ein Loop mit b <= Position muss zuerst springen.
  const posVorLoop = (await status(basis)).position.s;
  const a = Math.max(0, posVorLoop - 0.5), b = Math.max(a + 0.01, posVorLoop - 0.01); // b liegt vor der aktuellen Position
  const rLoop = await fetch(`${basis}api/vorhoerer/loop?a=${a}&b=${b}`, { method: 'POST' });
  assert.equal(rLoop.status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const nachLoop = (await status(basis)).position.s;
  assert.ok(nachLoop < posVorLoop, `Position sollte nach dem Vorsprung wieder bei A liegen (vor Loop ${posVorLoop}, nach ${nachLoop})`);

  const rLoopAus = await fetch(`${basis}api/vorhoerer/loop_aus`, { method: 'POST' });
  assert.equal(rLoopAus.status, 200);

  await new Promise((r) => setTimeout(r, 400));
  assert.ok(sseEvents.some((e) => e.ev === 'geladen'), 'SSE sollte ein geladen-Ereignis geliefert haben');
  assert.ok(sseEvents.some((e) => e.ev === 'position'), 'SSE sollte position-Ereignisse geliefert haben');
});

test('Fehlerfall: ungültige Loop-Grenzen (a >= b) → 400, kein OSC-Versand', { skip: OHNE_AUDIO }, async (t) => {
  senkeAn(); t.after(senkeAb);
  const { wurzel, daten, cache } = aufbau(t);
  const s = new CueServer({ port: 0, wurzel, nml: null, daten, cache, ausgang: `${SENKE}:playback_F`, ohneBlende: true, vorhoererInstanz: INSTANZ, vorhoererBin: BIN });
  await s.starte(); t.after(() => s.stoppe());
  const basis = `http://127.0.0.1:${s.port}/`;
  const r = await fetch(`${basis}api/vorhoerer/loop?a=5&b=5`, { method: 'POST' });
  assert.equal(r.status, 400);
});

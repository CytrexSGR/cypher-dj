// Browserprobe Paket 1.13 Warp, Slice 1: der Detailbereich eines Audio-Clips gegen den ECHTEN Seiten-Server mit Kern-Attrappe (Prüfstapel, Instanz c (CYPHERDJ_PROBE_INSTANZ), kein Ton,
// kopfloser Chrome über cdp.mjs). Gefahren wird die Bedienung, die Node-Tests nicht erreichen:
//   B1  Clip mit Warp wählen: WARP-Knopf gedrückt, Modus RE-PITCH, Herkunft „from bars“ und 125 BPM, kein „downbeat?“, OFFSET in Beats statt Sekunden
//   B2  WARP klicken: warp_setzen an false beim Server, Knopf nicht mehr gedrückt, OFFSET wieder in Sekunden; nochmal klicken: wieder an
//   B3  Clip ohne Warp (Auto-Warp aus): Knopf nicht gedrückt, Text „no tempo set“; WARP klicken → warp_auto, der Server setzt den Warp aus der Library
//   B4  Eingabe OFFSET (Beats) 1 → clip_aendern versatz_beats beim Server
//   B5  Track mit BPM: „downbeat?“ steht am Clip
//   K   keine Ausnahme und kein Fehler in der Konsole
// Aufruf: node pruef/probe_warp.mjs      Exit 0 alle OK, 1 FEHL
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const INSTANZ = process.env.CYPHERDJ_PROBE_INSTANZ ?? 'c';   // Prüfinstanz des Stapels (nie g, h, i); eine laufende Suite auf derselben Instanz sperrt
process.env.CYPHERDJ_TEST_INSTANZ = INSTANZ;
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-probe-'));
const aufbau = JSON.parse(execFileSync('node', [path.join(HIER, 'w1_aufbau.mjs'), '--ziel', fix], { encoding: 'utf8' }));
// zusätzlich ein Track mit BPM ohne Takte (Takt-Eins unbekannt) aus derselben Datei
const katalog = baueKatalog(path.join(fix, 'kat2'), [
  { n: 1, typ: 'loop', bpm: 125, takte: 2, pack: 'W1', dauer_s: aufbau.dauer_s, pfad: path.join(fix, 'klick125.wav') },
  { n: 2, typ: 'loop', bpm: 125, takte: 2, pack: 'W1', dauer_s: aufbau.dauer_s, pfad: path.join(fix, 'sinus125.wav') },
  { n: 3, typ: 'track', werk_id: 1, titel: 'Song', bpm: 125, dauer_s: aufbau.dauer_s, pfad: path.join(fix, 'klick125.wav') },
]);
const mt = baueMediathek(path.join(fix, 'mt'));
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };
const s = await starteStapel(path.join(fix, 'stapel'), INSTANZ, {}, { serverArgs: ['--katalog', katalog, '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')], proj });
const URL = s.url.replace(/\/$/, '');
const b = await starteBrowser();
const w = (x) => b.werte(x);
const api = async (methode, weg, d, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d ?? {}) });
  return { code: r.status, j: await r.json().catch(() => null) };
};
const aktuell = async () => (await api('GET', '/proj/aktuell')).j;
const clipServer = async (id) => (await aktuell()).projekt.spuren.flatMap((x) => x.clips).find((c) => c.id === id);
const rect = (sel) => w(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: r.left, t: r.top }; })()`);
const klickXY = async (x, y) => { await b.maus('mouseMoved', x, y, { buttons: 0 }); await b.maus('mousePressed', x, y); await b.maus('mouseReleased', x, y); };
async function waehle(beat, spur) {
  const f = await rect('[data-p="flaeche"]'), a = await w('window.djkProd.ansicht');
  await klickXY(f.l + (beat - a.beat0) * a.pxProBeat, f.t + spur * 64 + 32);
  await warte(300);
}
const dom = (sel, was) => w(`(() => { const e = document.querySelector('[data-d="${sel}"]'); return e ? ${was} : null; })()`);
const knopf = () => dom('warpknopf', 'e.getAttribute("aria-pressed") === "true"');
const info = () => dom('warpinfo', 'e.textContent');
const sichtbar = (sel) => dom(sel, '!e.hidden');
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };

try {
  const neu = await api('POST', '/proj/neu', { name: 'W1 Probe' });
  await warte(1500);
  await api('POST', '/proj/aendern', { rev: (await aktuell()).projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 128 }] });
  await warte(4000);
  const auf = await api('POST', '/proj/aendern', { rev: (await aktuell()).projekt.rev, label: 'Aufbau', befehle: [
    { befehl: 'spur_neu', art: 'audio', name: 'Warp' }, { befehl: 'spur_neu', art: 'audio', name: 'Roh' }, { befehl: 'spur_neu', art: 'audio', name: 'Track' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 2, laenge_beats: 1, sha256: ksha(1), warp: 'auto' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 2, laenge_beats: 8, sha256: ksha(2), warp: 'aus' },
    { befehl: 'clip_neu', spur_id: 's3', art: 'audio', start_beat: 2, laenge_beats: 1, sha256: ksha(3), warp: 'auto' }] });
  if (auf.code !== 200) throw new Error(`Aufbau ${auf.code} ${JSON.stringify(auf.j)}`);
  await b.oeffne(URL);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== neu.j.slug; i++) await warte(100);
  await w(`window.djkProd.ansicht = { beat0: 0, pxProBeat: 24 }`);
  await warte(300);

  // B1
  await waehle(4, 0);
  const wahl = await w('window.djkProd.auswahl');
  const modus = await dom('warpmodus', 'e.textContent');
  notiere('B1 Clip mit Warp: Knopf gedrückt, RE-PITCH, „from bars“ und 125 BPM, OFFSET in Beats', JSON.stringify(wahl) === '["c1"]' && (await knopf()) === true && modus === 'RE-PITCH'
    && /from bars/.test(await info()) && /125 BPM/.test(await info()) && !/downbeat/.test(await info()) && (await sichtbar('versatzl')) === true && (await sichtbar('offsetl')) === false,
    `Auswahl ${JSON.stringify(wahl)}, Knopf ${await knopf()}, Modus ${modus}, Info „${await info()}“, Versatz sichtbar ${await sichtbar('versatzl')}, Offset s sichtbar ${await sichtbar('offsetl')}`);

  // B2
  await b.klick('[data-d="warpknopf"]');
  const aus = await bisWahr(async () => (await clipServer('c1')).warp.an === false);
  await warte(300);
  const offenSek = await sichtbar('offsetl');
  await b.klick('[data-d="warpknopf"]');
  const wieder = await bisWahr(async () => (await clipServer('c1')).warp.an === true);
  await warte(300);
  notiere('B2 WARP klicken schaltet aus und an (Server und Knopf), OFFSET wechselt zwischen s und Beats', aus && offenSek === true && wieder && (await knopf()) === true && (await sichtbar('versatzl')) === true,
    `aus beim Server ${aus}, OFFSET s sichtbar im Aus-Zustand ${offenSek}, wieder an ${wieder}, Knopf ${await knopf()}`);

  // B3
  await waehle(4, 1);
  const vorher = { knopf: await knopf(), info: await info() };
  await b.klick('[data-d="warpknopf"]');
  const gesetzt = await bisWahr(async () => (await clipServer('c2')).warp?.an === true);
  await warte(300);
  notiere('B3 Clip ohne Warp: Knopf aus, „no tempo set“; WARP klicken holt den Warp aus der Library (warp_auto)', vorher.knopf === false && /no tempo set/.test(vorher.info) && gesetzt && (await knopf()) === true,
    `vorher Knopf ${vorher.knopf}, „${vorher.info}“; Server warp ${JSON.stringify((await clipServer('c2')).warp?.quelle)}, danach Knopf ${await knopf()}`);

  // B4
  await waehle(4, 0);
  await w(`(() => { const f = document.querySelector('[data-f="versatz_beats"]'); f.focus(); f.value = '1'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const versatz = await bisWahr(async () => (await clipServer('c1')).warp.versatz_beats === 1);
  notiere('B4 Eingabe OFFSET (Beats) = 1 → versatz_beats beim Server', versatz, `versatz_beats ${(await clipServer('c1')).warp.versatz_beats}`);

  // B5
  await waehle(4, 2);
  notiere('B5 Track mit BPM: „downbeat?“ am Clip', /downbeat\?/.test(await info()) && /from library BPM/.test(await info()), `Info „${await info()}“`);

  // Das 429 der Wellen-Route (/welle?sha=…, Drosselung bei mehreren neuen Clips auf einmal) gibt es ohne Warp ebenso; es zählt nicht
  const fehlerK = b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !(/429/.test(k.text) && /\/welle\?sha=/.test(k.url ?? '')));
  notiere('K Konsole ohne Ausnahme und Fehler', fehlerK.length === 0, fehlerK.length ? JSON.stringify(fehlerK.slice(0, 3)) : 'sauber');
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
process.exit(fehl === 0 ? 0 : 1);

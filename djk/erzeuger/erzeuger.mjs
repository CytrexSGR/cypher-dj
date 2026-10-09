#!/usr/bin/env node
// cypherdj-erzeuger (Plan 2026-09-27, vorgezogen aus Scheibe 56; ADR 010, 017, 024): Strudel-Muster → Ereignisse mit
// Beat-Stempel an den Kern, zwei Takte voraus, je Takt geweckt. Folgt der Kern-Uhr (/uhr), nicht der eigenen. Das Muster
// kommt aus einer Datei, die djk-muster atomar schreibt; ein neues gilt ab dem nächsten Takt. Läuft mit node --permission
// (nur lesen). Rückgabe 2: Startfehler (Kit fehlt), dann startet systemd nicht in Schleife neu.
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { kodiere, dekodiere } from '../vertrag/attrappe_kern/osc.mjs';
import { kompiliere } from './src/kompiliere.mjs';
import { ladeKits } from './src/kit.mjs';
import { Planer, WECHSEL_ABSTAND } from './src/planer.mjs';
import { schreibeStatus } from './src/muster_stand.mjs';

const I = process.env.CYPHERDJ_INSTANZ ?? '';
const V = I ? 1000 * (I.charCodeAt(0) - 96) : 0;
const { values: opt } = parseArgs({ options: {
  'kern-port': { type: 'string', default: String(47100 + V) },
  'abo-port': { type: 'string', default: String(47160 + V) },
  'kit-ordner': { type: 'string', default: `${process.env.HOME}/.config/cypherdj/kits` },
  kit: { type: 'string', default: 'battery' },
  'kit-zusatz': { type: 'string', default: '' },  // MVP 2 Scheibe 3: Mitschnitte (rec), live nachgeladen
  muster: { type: 'string', default: `/dev/shm/cypherdj${I ? `-${I}` : ''}/erzeuger/strom1.js` },
  strom: { type: 'string', default: '1' },
  kanal: { type: 'string', default: 'erz/1' },
  ziel: { type: 'string', default: '' },   // Studio S5: midi:<port>:<kanal> statt Kit
  name: { type: 'string', default: 'erzeuger' },   // Studio S1: Hallo-Name je Prozess (Kern führt Abonnenten nach Name)
} });
const KERN = Number(opt['kern-port']);
const STROM = Number(opt.strom);
const log = (t) => process.stderr.write(`erzeuger: ${t}\n`);

const ZUSATZ = opt['kit-zusatz'];
const zusatzJson = ZUSATZ ? `${opt['kit-ordner']}/${ZUSATZ}/kit.json` : '';
const zusatzStand = () => { try { return fs.statSync(zusatzJson).mtimeMs; } catch { return 0; } };
let zusatzGesehen = 0;
const MIDI = opt.ziel.startsWith('midi:');
const KIT_ZIEL = MIDI ? opt.ziel : ZUSATZ ? `kit:${opt.kit}+${ZUSATZ}` : `kit:${opt.kit}`;
const kitLaden = () => MIDI ? { midi: true } : ladeKits(`${opt['kit-ordner']}/${opt.kit}`, ZUSATZ ? `${opt['kit-ordner']}/${ZUSATZ}` : '');
let kit;
try {
  zusatzGesehen = zusatzStand();
  kit = kitLaden();
} catch (e) {
  log(`Kit ${opt.kit} nicht lesbar: ${e.message}`);
  process.exit(2);
}

const sock = dgram.createSocket('udp4');
const sende = (buf) => sock.send(buf, KERN, '127.0.0.1');
let uhr = null;  // letzte /uhr: {mono_ns: BigInt, beat, bpm}
const beatJetzt = () => uhr.beat + (Number(process.hrtime.bigint() - uhr.mono_ns) / 1e9) * uhr.bpm / 60;
const msBisBeat = (b) => ((b - beatJetzt()) * 60000) / uhr.bpm;
const planer = new Planer({ strom: STROM, kit, sende, jetztUs: () => Number(process.hrtime.bigint() / 1000n) });
let id = BigInt(Date.now()) * 1000n;
const stromMelden = () => sende(kodiere('/erz/strom', 'hsiss', [++id, 'erzeuger', STROM, KIT_ZIEL, opt.kanal]));

let wecker = null;
function wecke() {  // kurz vor dem Taktanfang: die nächsten zwei Takte ersetzen
  if (!uhr) return;
  // WECHSEL_ABSTAND vor der Eins wecken: genau auf der Grenze käme das Ereignis auf der Eins beim Kern um den
  // Wecker-Jitter zu spät (gemessen 27.09.: 4 von ~5 Takten „1 Ereignisse zu spät“ bei bd*4).
  const n = Math.floor((beatJetzt() + WECHSEL_ABSTAND) / 4 + 1e-6);
  if (ZUSATZ && zusatzStand() !== zusatzGesehen) {  // neuer Mitschnitt-Klang: Namen neu lesen, Kern lädt beide Kits neu
    try {
      zusatzGesehen = zusatzStand();
      planer.kit = kit = kitLaden();
      stromMelden();
      log(`Kit ${KIT_ZIEL} neu geladen (${kit.note?.size ?? 'midi'} Klänge)`);
    } catch (e) { log(`Kit ${ZUSATZ} nicht lesbar, das alte bleibt: ${e.message}`); }
  }
  let unbekannt = new Set();
  try {
    unbekannt = planer.takt(n);
  } catch (e) {  // Abschluss-Review Scheibe 3 Fund 6: ein Wurf (zu viele Ereignisse auf einem Beat) beendete den Erzeuger
    log(`Takt ${n} nicht geschickt: ${e.message} (der Erzeuger läuft weiter)`);
  }
  if (unbekannt.size) log(`im Kit ${opt.kit} unbekannt: ${[...unbekannt].join(', ')}`);
  felderMelden();
  clearTimeout(wecker);
  wecker = setTimeout(wecke, Math.max(5, msBisBeat(4 * (n + 1) - WECHSEL_ABSTAND)));
}

// Task 1.4: zuletzt geschriebener Stand; schreibeStatus ersetzt die ganze Datei, die Meldestelle ergänzt ihn nur
let letzterStand = { taub: [], taub_muster: null };   // auch bei kaputtem ersten Muster vorhanden
let gemeldet = { nr: 0, n: 0 };   // für welches Muster und wie viele Felder status.json schon taub trägt

// Nach jedem Takt: taub + taub_muster schreiben, sobald ein neues Muster einen Takt gespielt hat (auch leer: taub_muster
// === nr heißt „geprüft“) und wenn ein späterer Takt ein weiteres Feld findet. Log nur bei Zuwachs.
function felderMelden() {
  if (!planer.nr) return;
  const gleich = gemeldet.nr === planer.nr;
  const zuwachs = planer.felder.size > (gleich ? gemeldet.n : 0);
  if (gleich && !zuwachs) return;
  gemeldet = { nr: planer.nr, n: planer.felder.size };
  if (zuwachs) log(`Muster ${planer.nr}: Strudel-Felder ohne Weg in den Kern (klingen nicht): ${[...planer.felder].join(', ')}`);
  letzterStand = { ...letzterStand, taub: [...planer.felder], taub_muster: planer.nr };  // Task 1.4: Cypher sieht es über studio
  status(letzterStand);
}

function musterLesen() {
  let text;
  try {
    text = fs.readFileSync(opt.muster, 'utf8');
  } catch {
    return;  // noch kein Muster: Stille
  }
  const r = kompiliere(text);
  if (r.fehler) {
    log(`${opt.muster}: ${r.fehler} (das alte Muster bleibt)`);
    status(letzterStand = { ...letzterStand, nr: planer.nr, ab_beat: null, fehler: r.fehler });  // altes Muster bleibt: sein taub auch
    return;
  }
  const ab = planer.setze(r.muster, uhr ? beatJetzt() : -Infinity);
  log(`Muster ${planer.nr} gilt ab Beat ${ab}`);
  status(letzterStand = { nr: planer.nr, ab_beat: Number.isFinite(ab) ? ab : null, fehler: null, taub: [], taub_muster: null });
}

// Plan 2 T6: status.json neben dem Muster (ab welchem Beat es gilt), für das Feld der Seite. Ohne Schreibrecht läuft der
// Erzeuger weiter, nur ohne Stand.
function status(stand) {
  try { schreibeStatus(path.dirname(opt.muster), stand); } catch (e) { log(`status.json: ${e.message}`); }
}

sock.on('message', (buf) => {
  let m;
  try {
    m = dekodiere(buf);
  } catch {
    return;
  }
  if (m.adresse === '/uhr') {
    const erste = !uhr;
    uhr = { mono_ns: m.werte[1], beat: m.werte[2], bpm: m.werte[3] };
    if (erste) {
      stromMelden();
      musterLesen();
      wecke();
    }
  } else if (m.adresse === '/e/neustart') {  // Kern neu: Strom und Schlange sind weg (Plan, Entscheidung 5)
    stromMelden();
    planer.vergiss();
    wecke();
  } else if (m.adresse === '/erz/quittung' && m.werte[0] === STROM && m.werte[5] > 0) {
    log(`Sendung ${m.werte[1]}: ${m.werte[5]} Ereignisse zu spät`);
  }
});

sock.bind(Number(opt['abo-port']), '127.0.0.1', () => {
  const abo = sock.address().port;
  const hallo = () => sende(kodiere('/k/hallo', 'sii', [opt.name, abo, 1]));
  hallo();
  setInterval(hallo, 1000);
  fs.watchFile(opt.muster, { interval: 100 }, () => musterLesen());
  log(`bereit: Kern udp ${KERN}, Abo udp ${abo}, Kit ${opt.kit} (${kit.note?.size ?? 'midi'} Klänge), Muster ${opt.muster}`);
});
process.on('SIGTERM', () => process.exit(0));

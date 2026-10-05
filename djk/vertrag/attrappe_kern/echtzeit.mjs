// Golden-Folgen gegen die Kern-Attrappe als eigenen Prozess, über UDP in Echtzeit, nach djk/vertrag/folgen/FORMAT.md.
// Je Folge eine frische Attrappe (--frisch, eigener Zustand, gemeinsamer Arbeitsbestand), Anmeldung und Herzschlag
// (Punkt 13), Senden nach der aus /uhr hochgerechneten Kern-Uhr (§5.2), aktion kern_kill9 als SIGKILL mit Neustart
// ohne --frisch (Fortsetzen auf dem Anker). Geurteilt wird wie in golden.mjs mit folgen_vergleich.py (vergleich.py).
// Zweck: die Echtzeit-Seite der Attrappe über alle Folgen prüfen, unabhängig davon, welche Schritt-Arten der Läufer
// attrappe_leitstand.py (Scheibe 08) schon kann.
//
// Zeitstempel einer Nachricht: der Block, in dem die Attrappe sie geschickt hat, nicht der Augenblick, in dem der Läufer
// sie liest (UDP auf Loopback hält die Reihenfolge; sonst mäße ein Fenster von 512 Samples die Last des Läufers statt der
// Attrappe: gemessen 2026-09-23 unter Last 25 mit Ankunftszeit 4 von 4 Folgen rot, Meldeverzug bis 1 826 Samples).
// Regel: /uhr trägt sein Sample; eine Nachricht mit eigenem Feld sample bzw. ist_sample, das nicht vor dem zuletzt
// empfangenen /uhr liegt, trägt dieses Feld; jede andere (Antwort auf einen Befehl, Wiederholung mit altem Sample) gilt
// am Blockanfang nach dem zuletzt empfangenen /uhr, denn die Attrappe rechnet vor jedem Befehl alle fälligen Blöcke
// und schickt deren /uhr zuerst (wie golden.mjs: Stempel der Attrappe beim Senden). Werte: Regler aus
// /e/regler, Deck-Felder aus /zustand/deck (bezogen auf den Blockanfang des /uhr davor), linear zwischen Meldungen.
// Instrument-Prüfung: Sendeverzug (wie spät der Läufer selbst eine Handlung abschickt) und Meldeverzug (Ankunft auf der
// hochgerechneten Kern-Uhr minus eigenes Feld); über 1 200 Samples (25 ms) ist der Lauf unter Last: ein zu spät
// gesendeter Befehl verschiebt seine Wirkung, das Ergebnis ist dann nicht aussagekräftig. Umgekehrt ist eine Meldung, die
// mehr als 48 Samples vor ihrem eigenen Sample eintrifft, ein Fehler der Attrappe (Befund zu_frueh, Folge rot): Last
// macht Meldungen nur später, nie früher.
// Ports (ROADMAP Z2): Attrappe auf 47100 + 1000·k, Läufer auf 47140 + 1000·k; k aus CYPHERDJ_INSTANZ (a = 1 … i = 9).
//
// Aufruf: node echtzeit.mjs [--vertrag DIR] [--material DIR] [--mutation m] [--bericht datei.json] folge.jsonl ...

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { kodiere, kodiereBundle, dekodiere } from './osc.mjs';
import { AUSGABEN, REGLER } from './vertrag.mjs';
import { ausgelassen, leseFolge, letztesSample, oscWerte, pruefeArten, urteile, material, HAND_VORLAUF } from './folge.mjs';

const SR = 48000;
const BLOCK = 256;                     // Quantum der Attrappe (kern.mjs)
export const FRUEH_GRENZE = 48;        // 1 ms: kommt eine Meldung früher vor ihrem eigenen Sample an, schickt die Attrappe zu früh
const NACHLAUF = 9600;                 // 0,2 s nach dem letzten Sample der Folge
export const VERZUG_GRENZE = 1200;     // 25 ms: darüber sind die Fenster der Folgen (oft 2 400 Samples) nicht mehr fair
const MELDEABSTAND = 1100;             // /e/regler und /zustand/deck kommen während Bewegung etwa alle 960 Samples
const PROG = fileURLToPath(new URL('../attrappe_kern.mjs', import.meta.url));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const kinder = new Set();              // laufende Attrappen; bei SIGINT/SIGTERM mit beenden (keine Waisen)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const k of kinder) k.kill('SIGKILL'); process.exit(130); });

export function instanzK() {
  const i = process.env.CYPHERDJ_INSTANZ ?? '';
  if (i === '') return 0;
  if (!/^[a-i]$/.test(i)) throw new Error(`CYPHERDJ_INSTANZ=${i}: erlaubt sind a bis i oder leer`);
  return 'abcdefghi'.indexOf(i) + 1;
}

function feldIndex(adresse) {
  const f = AUSGABEN[adresse]?.felder ?? [];
  return f.indexOf('ist_sample') >= 0 ? f.indexOf('ist_sample') : f.indexOf('sample');
}

// Wert an Sample s aus einer nach Sample sortierten Reihe [[sample, wert], ...]: linear nur zwischen zwei Meldungen,
// die höchstens MELDEABSTAND auseinander liegen (sonst gilt die letzte: ein Setzen ist ein Schritt, keine Rampe).
// fortlaufend (quell_beat): über eine Naht (Loop-Rücksprung) nicht interpolieren, sondern aus dem Paar davor weiterrechnen.
export function wertAusReihe(r, s, { fortlaufend = false } = {}) {
  let i = -1;
  for (let j = 0; j < r.length && r[j][0] <= s; j++) i = j;
  if (i < 0) return undefined;
  const [x0, w0] = r[i];
  if (x0 === s || !Number.isFinite(w0)) return w0;
  const glatt = (a, b) => (fortlaufend ? b[1] >= a[1] : true) && Number.isFinite(b[1]) && b[0] - a[0] <= MELDEABSTAND;
  if (i + 1 < r.length && glatt(r[i], r[i + 1])) {
    const [x1, w1] = r[i + 1];
    return w0 + ((w1 - w0) * (s - x0)) / (x1 - x0);
  }
  if (fortlaufend && i >= 1 && glatt(r[i - 1], r[i]) && s - x0 <= MELDEABSTAND) {
    const [xa, wa] = r[i - 1];
    return w0 + ((w0 - wa) * (s - x0)) / (x0 - xa);
  }
  return w0;
}

export async function fahreEchtzeit(zeilen, { ab, mutationen = [], name = 'echtzeit' } = {}) {
  pruefeArten(zeilen);
  const k = instanzK();
  const kernPort = 47100 + 1000 * k;
  const eigenerPort = 47140 + 1000 * k;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-echtzeit-'));
  const konfig = path.join(dir, 'kern.toml');
  fs.writeFileSync(konfig, 'version = 1\npruefmodus = true\n');
  const argv = ['--udp-port', String(kernPort), '--zustand', path.join(dir, 'zustand.json'), '--arbeitsbestand', ab, '--konfig', konfig];
  if (mutationen.length) argv.push('--mutation', mutationen.join(','));
  let kind = null;
  const starte = async (frisch) => {
    kind = spawn(process.execPath, [PROG, ...argv, ...(frisch ? ['--frisch'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
    kinder.add(kind);
    const dieses = kind;
    kind.once('exit', () => kinder.delete(dieses));
    await new Promise((ok, nein) => {
      let aus = '';
      dieses.stdout.on('data', (d) => { aus += d; if (/port=\d+/.test(aus)) ok(); });
      dieses.once('exit', (c) => nein(new Error(`Attrappe endete mit ${c}: ${aus}`)));
    });
  };
  const sock = dgram.createSocket('udp4');
  await new Promise((r, f) => { sock.once('error', f); sock.bind(eigenerPort, '127.0.0.1', r); });
  let beobachtet = [];
  let uhr = null;                                     // { sample, mono_ns }
  let letzteUhrNs = 0n;
  let willkommen = false;
  let setNeu = null;                                  // { id, gestartet }
  let meldeverzug = 0;
  const zuFrueh = [];                                 // Meldungen, die vor ihrem eigenen Sample eintrafen (Fehler der Attrappe)
  const jetzt = () => (uhr ? uhr.sample + (Number(process.hrtime.bigint() - uhr.mono_ns) * SR) / 1e9 : -Infinity);
  const deckReihen = new Map();
  sock.on('message', (buf) => {
    let m;
    try { m = dekodiere(buf); } catch { return; }
    if (m.bundle) return;
    if (m.adresse === '/uhr') { uhr = { sample: Number(m.werte[0]), mono_ns: m.werte[1] }; letzteUhrNs = process.hrtime.bigint(); }
    if (m.adresse === '/k/willkommen') willkommen = true;
    // Punkt 2: mit der Quittung gestartet von /k/set/neu beginnt die neue Zeitachse bei Sample 0; bis zu ihrem ersten
    // /uhr stempelt der Läufer mit 0 statt mit der alten Uhr
    const neueAchse = setNeu && !setNeu.gestartet && m.adresse === '/q' && m.werte[0] === setNeu.id && m.werte[2] === 2;
    if (neueAchse) uhr = null;
    const i = feldIndex(m.adresse);
    const basis = uhr ? uhr.sample : 0;
    const eigen = i >= 0 ? Number(m.werte[i]) : null;
    const s = m.adresse === '/uhr' ? eigen : eigen !== null && eigen >= basis ? eigen : uhr ? basis + BLOCK : 0;
    if (uhr && eigen !== null && eigen >= basis && m.adresse !== '/uhr') {
      const ankunft = Math.floor(jetzt());
      meldeverzug = Math.max(meldeverzug, ankunft - eigen);
      if (eigen - ankunft > FRUEH_GRENZE) zuFrueh.push(`${m.adresse} Sample ${eigen} kam bei ${ankunft}`);
    }
    beobachtet.push({ s, adresse: m.adresse, typen: m.typen, werte: m.werte });
    if (m.adresse === '/zustand/deck' && uhr) {
      for (const [feld, idx] of [['status', 1], ['quell_beat', 5], ['beats_bis_ende', 6], ['faktor', 7]]) {
        const key = `${m.werte[0]}|${feld}`;
        if (!deckReihen.has(key)) deckReihen.set(key, []);
        deckReihen.get(key).push([uhr.sample, m.werte[idx]]);
      }
    }
    if (neueAchse) {                                   // Älteres gehört zur alten Zeitachse und fällt weg (außer dessen /q)
      setNeu.gestartet = true;
      beobachtet = beobachtet.filter((x) => x.adresse === '/q' && x.werte[0] === setNeu.id).map((x) => ({ ...x, s: 0 }));
      deckReihen.clear();
    }
  });
  const schicke = (buf) => sock.send(buf, kernPort, '127.0.0.1');
  let letzterHallo = 0;
  const hallo = () => { schicke(kodiere('/k/hallo', 'sii', [name, eigenerPort, 1])); letzterHallo = Date.now(); };

  const plan = [];
  let uebersprungen = 0;
  zeilen.forEach((z, i) => {
    if (ausgelassen(z)) { uebersprungen++; return; }
    if (z.t === 'sende') {
      plan.push({ s: z.sample, i, tu: async () => {
        const [a, t, w] = oscWerte(z.osc);
        if (a !== '/k/set/neu') return schicke(kodiere(a, t, w));
        setNeu = { id: w[0], gestartet: false };
        schicke(kodiere(a, t, w));
        const bis = Date.now() + 2000;                 // Punkt 2: höchstens 2 s auf gestartet warten
        while (Date.now() < bis && !setNeu.gestartet) await warte(1);
        if (!setNeu.gestartet) throw new Error('/k/set/neu: keine Quittung gestartet in 2 s');
        const u = letzteUhrNs;
        while (Date.now() < bis + 1000 && letzteUhrNs === u) await warte(1);   // erstes /uhr der neuen Zeitachse
      } });
    } else if (z.t === 'buendel') {
      plan.push({ s: z.sample, i, tu: async () => schicke(kodiereBundle(z.nachrichten.map(oscWerte))) });
    } else if (z.t === 'hand') {
      plan.push({ s: z.sample - HAND_VORLAUF, i, tu: async () => schicke(kodiere('/test/hand', 'sfh', [z.pfad, z.midi_roh, BigInt(z.sample)])) });
    } else if (z.t === 'aktion') {
      if (z.was !== 'kern_kill9') throw new Error(`Zeile ${i + 1}: aktion ${z.was} unbekannt`);
      plan.push({ s: z.sample, i, tu: async () => {
        kind.kill('SIGKILL');
        await new Promise((r) => (kind.exitCode !== null || kind.signalCode !== null ? r() : kind.once('exit', r)));
        await starte(false);
      } });
    }
  });
  plan.sort((a, b) => a.s - b.s || a.i - b.i);
  const ende = letztesSample(zeilen) + NACHLAUF;
  let sendeverzug = 0;
  try {
    await starte(true);
    const bis = Date.now() + 2000;
    while (!willkommen && Date.now() < bis) { if (Date.now() - letzterHallo >= 50) hallo(); await warte(1); }
    if (!willkommen) throw new Error('kein /k/willkommen von der Attrappe');
    let p = 0;
    const wandEnde = Date.now() + ((ende + SR) / SR) * 1000 + 60000;
    while ((p < plan.length || jetzt() <= ende) && Date.now() < wandEnde) {
      while (p < plan.length && plan[p].s <= jetzt()) {
        if (p > 0) sendeverzug = Math.max(sendeverzug, jetzt() - plan[p].s);
        await plan[p++].tu();
      }
      const stumm = Number(process.hrtime.bigint() - letzteUhrNs) / 1e6;       // Punkt 13 und §16.3
      if (stumm >= 100 ? Date.now() - letzterHallo >= 50 : Date.now() - letzterHallo >= 1000) hallo();
      await warte(1);
    }
    await warte(50);
  } finally {
    if (kind && kind.exitCode === null && kind.signalCode === null) { kind.kill('SIGTERM'); await new Promise((r) => kind.once('exit', r)); }
    sock.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const regler = new Map();
  for (const m of beobachtet) {
    if (m.adresse !== '/e/regler') continue;
    if (!regler.has(m.werte[0])) regler.set(m.werte[0], []);
    regler.get(m.werte[0]).push([Number(m.werte[3]), m.werte[1]]);
  }
  const werte = new Map();
  const deck = new Map();
  for (const z of zeilen) {
    if (ausgelassen(z)) continue;
    if (z.t === 'wert') {
      const r = (regler.get(z.pfad) ?? []).sort((a, b) => a[0] - b[0]);
      // nie oder erst später gemeldet: frische Attrappe, also die Vorgabe aus §1.5
      const v = !r.length || r[0][0] > z.sample ? REGLER.get(z.pfad)?.vorgabe : wertAusReihe(r, z.sample);
      if (v !== undefined) werte.set(`${z.pfad}|${z.sample}`, v);
    } else if (z.t === 'deck_wert') {
      const r = (deckReihen.get(`${z.deck}|${z.feld}`) ?? []).sort((a, b) => a[0] - b[0]);
      const v = z.feld === 'status' ? [...r].reverse().find((x) => x[0] <= z.sample)?.[1] : wertAusReihe(r, z.sample, { fortlaufend: z.feld === 'quell_beat' });
      if (v !== undefined) deck.set(`${z.deck}|${z.feld}|${z.sample}`, v);
    }
  }
  return { beobachtet, werte, deck, uebersprungen, zuFrueh, verzug: Math.round(Math.max(sendeverzug, meldeverzug)) };
}

// Hauptprogramm nur beim direkten Aufruf
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let vertrag = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let mutationen = [];
  let bericht = null;
  let ab = null;
  const dateien = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vertrag') vertrag = path.resolve(args[++i]);
    else if (args[i] === '--mutation') mutationen = args[++i].split(',').filter(Boolean);
    else if (args[i] === '--bericht') bericht = args[++i];
    else if (args[i] === '--material') ab = args[++i];
    else dateien.push(args[i]);
  }
  if (!dateien.length) { console.error('Aufruf: node echtzeit.mjs [--vertrag DIR] [--material DIR] [--mutation m] [--bericht datei] folge.jsonl ...'); process.exit(2); }
  if (!ab) { ab = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-ab-')); material(vertrag, ab); }
  const eintraege = [];
  for (const d of dateien) {
    const t0 = Date.now();
    const zeilen = leseFolge(d);
    const r = await fahreEchtzeit(zeilen, { ab, mutationen });
    eintraege.push({ name: path.basename(d, '.jsonl'), datei: d, zeilen, dauer_s: (Date.now() - t0) / 1000, ...r });
  }
  const urteil = urteile(eintraege);
  let rot = 0;
  let unterLast = 0;
  const liste = eintraege.map((e, i) => {
    const befunde = urteil[i].befunde;
    if (e.zuFrueh.length) befunde.push([0, 'zu_frueh', `${e.zuFrueh.length} Meldungen vor ihrem Sample, erste: ${e.zuFrueh[0]}`]);
    const last = e.verzug > VERZUG_GRENZE;
    unterLast += last;
    const zusatz = `${e.dauer_s.toFixed(1)} s, ${e.beobachtet.length} Meldungen, Verzug max ${e.verzug} Samples${last ? ' UNTER LAST' : ''}`;
    if (!befunde.length) console.log(`GRÜN ${e.name}: ${zusatz}`);
    else { rot++; const [z, art, text] = befunde[0]; console.log(`ROT  ${e.name}: Zeile ${z} ${art}: ${text.slice(0, 300)}${befunde.length > 1 ? ` (+${befunde.length - 1})` : ''}; ${zusatz}`); }
    return { folge: e.name, gruen: !befunde.length, dauer_s: e.dauer_s, verzug_samples: e.verzug, uebersprungen: e.uebersprungen, befunde };
  });
  console.log(`gefahren ${eintraege.length}, grün ${eintraege.length - rot}, rot ${rot}, unter Last ${unterLast}${mutationen.length ? `, Mutation ${mutationen.join(',')}` : ''}`);
  if (bericht) fs.writeFileSync(bericht, JSON.stringify(liste, null, 1));
  process.exit(rot ? 1 : 0);
}

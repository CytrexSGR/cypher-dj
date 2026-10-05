#!/usr/bin/env node
// Kern-Attrappe (SCHNITTSTELLEN §19.1): spricht §4 und §5 über UDP wie der Kern, mit simulierter Uhr in Echtzeit
// (ein Block zu 256 Samples, sobald seine Anfangszeit auf CLOCK_MONOTONIC erreicht ist), ohne JACK und ohne Ton.
// Prüfinstanzen (ROADMAP Z2): CYPHERDJ_INSTANZ=<a..i> verschiebt den UDP-Port um 1000·k und setzt cypherdj-<instanz>/
// in alle festen Pfade. Neustart-Zustand in /dev/shm/cypherdj[-<instanz>]/zustand_attrappe.json; liegt er beim Start
// vor, setzt die Attrappe auf dem Anker fort (generation + 1), sonst beginnt sie bei Sample 0.
//
// Aufruf: node djk/vertrag/attrappe_kern.mjs [--konfig DATEI] [--udp-port N] [--start-bpm X] [--arbeitsbestand DIR]
//                                            [--zustand DATEI] [--frisch] [--mutation m1,m2]

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { neuerKern } from './attrappe_kern/module.mjs';
import { VORGABE_CFG } from './attrappe_kern/kern.mjs';
import { kodiere } from './attrappe_kern/osc.mjs';
import { AUSGABEN } from './attrappe_kern/vertrag.mjs';
import { leseToml } from './attrappe_kern/toml.mjs';
import { schreibeDatei, leseDatei, stelleWieder } from './attrappe_kern/zustand.mjs';

function abbruch(text, code) {
  process.stderr.write(`attrappe_kern: ${text}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--frisch') opt.frisch = true;
  else if (['--konfig', '--udp-port', '--start-bpm', '--arbeitsbestand', '--zustand', '--mutation'].includes(a)) opt[a.slice(2)] = args[++i];
  else abbruch(`unbekannte Option ${a}`, 2);
}

const instanz = process.env.CYPHERDJ_INSTANZ ?? '';
if (instanz !== '' && !/^[a-i]$/.test(instanz)) abbruch(`CYPHERDJ_INSTANZ=${instanz}: erlaubt sind a bis i oder leer`, 2);
const k = instanz ? 'abcdefghi'.indexOf(instanz) + 1 : 0;
const z2 = (p) => (instanz ? p.replace(/cypherdj\//g, `cypherdj-${instanz}/`) : p);

const konfig = opt.konfig ?? path.join(os.homedir(), '.config', instanz ? `cypherdj-${instanz}` : 'cypherdj', 'kern.toml');
let cfg = { ...VORGABE_CFG };
if (fs.existsSync(konfig)) {
  try { cfg = { ...cfg, ...leseToml(fs.readFileSync(konfig, 'utf8'), VORGABE_CFG, konfig) }; } catch (e) { abbruch(e.message, 2); }
} else if (opt.konfig) abbruch(`Konfiguration ${konfig} fehlt`, 2);
cfg.arbeitsbestand = opt.arbeitsbestand ?? z2(cfg.arbeitsbestand);
if (opt['start-bpm']) cfg.start_bpm = Number(opt['start-bpm']);
const port = opt['udp-port'] ? Number(opt['udp-port']) : cfg.udp_port + 1000 * k;
const zustandDatei = opt.zustand ?? z2('/dev/shm/cypherdj/zustand_attrappe.json');
const mutationen = (opt.mutation ?? process.env.ATTRAPPE_MUTATION ?? '').split(',').filter(Boolean);

const sock = dgram.createSocket('udp4');
// Nie vor seiner Zeit senden: die Attrappe rechnet einen Block an seinem Anfang; eine Meldung über ein späteres Sample
// (Feld sample bzw. ist_sample, etwa /e/rueckfall vom Blockende oder /q gestartet mitten im Block) wartet, bis die Wanduhr
// mono(Sample) erreicht. Sonst sähe ein Läufer, der nach Empfangszeit stempelt, sie bis zu 5,3 ms zu früh.
const warteschlange = [];
const faellig = (m) => {
  const f = AUSGABEN[m.adresse]?.felder ?? [];
  const i = f.indexOf('ist_sample') >= 0 ? f.indexOf('ist_sample') : f.indexOf('sample');
  return i >= 0 ? Math.max(m.s, Number(m.werte[i])) : m.s;
};
const raus = (m) => {
  const buf = kodiere(m.adresse, m.typen, m.werte);
  for (const p of m.ports) sock.send(buf, p, '127.0.0.1');
};
// Die Bedingung prüft nur die Wanduhr: auch ein Ereignis mitten im Block, das die Attrappe am Blockanfang rechnet
// (Stempel = sein eigenes Sample), geht erst bei mono(Sample) hinaus. Mit der früheren Bedingung "s > m.s" gingen solche
// Meldungen bis zu einem Block zu früh hinaus (gefunden 2026-09-23: Läufer, die nach Ankunft stempeln, sahen /e/halter
// und /q gestartet vor ab_sample, etwa attrappe_leitstand.py von 08 in 5 von 5 inhaltlich gefahrenen Folgen; Plan 13, B5).
const sende = (m) => {
  if (!m.ports.length) return;
  const s = faellig(m);
  if (K.monoBei(s) > process.hrtime.bigint()) warteschlange.push({ m, s });
  else raus(m);
};
const leere = (t) => {
  while (warteschlange.length) {
    const i = warteschlange.findIndex((w) => K.monoBei(w.s) <= t);
    if (i < 0) break;
    raus(warteschlange.splice(i, 1)[0].m);
  }
};

let K = neuerKern({ cfg, sende, mutationen });
const jetztNs = () => process.hrtime.bigint();

// Erst nach dem Binden fortsetzen: stelleWieder schickt /e/neustart, und ein Senden vor bind() bindet den Socket
// an einen Zufallsport (danach wirft bind ERR_SOCKET_ALREADY_BOUND; gefunden am 2026-09-23 mit tests/server.test.mjs).
function fortsetzenOderFrisch() {
  const alt = opt.frisch ? null : leseDatei(zustandDatei);
  if (alt) {
    try { stelleWieder(K, alt, { jetztNs: jetztNs() }); return; } catch (e) {
      process.stderr.write(`attrappe_kern: Zustand ${zustandDatei} unlesbar (${e.message}), beginne frisch\n`);
      K = neuerKern({ cfg, sende, mutationen });
    }
  }
  K.anker = { sample: 0, mono_ns: jetztNs() };
}

sock.on('error', (e) => {
  if (e.code === 'EADDRINUSE') abbruch(`Port ${port} belegt (EADDRINUSE): läuft schon ein Kern oder eine Attrappe dieser Instanz?`, 3);
  abbruch(`UDP-Fehler ${e.message}`, 1);
});
let geaendert = false;
let letzteSicherung = -Infinity;
const sichern = () => { schreibeDatei(K, zustandDatei); letzteSicherung = K.jetzt; geaendert = false; };

// Alle Blöcke rechnen, deren Anfang auf der Wanduhr erreicht ist (ein Block, sobald mono(Blockanfang) vorbei ist).
function aufholen() {
  const t = jetztNs();
  leere(t);
  let n = 0;
  while (K.monoBei(K.jetzt) <= t) {
    if (n === 0) K.stat.aufwach_us.push(Number(t - K.monoBei(K.jetzt)) / 1000);
    K.block();
    n++;
  }
  if (n > 1) K.stat.ausgelassen += n - 1;
  return n;
}

// Vor jedem Befehl erst aufholen: dann ist K.jetzt der nächste Blockanfang NACH der Ankunft, wie im Kern (Befehl im
// Ring, wirksam ab dem nächsten Zyklus). Ohne das stempelte die Attrappe einen Befehl, der zwischen zwei Takten des
// 1-ms-Zeitgebers ankommt, bis zu einen Block zu früh (gefunden 2026-09-23 mit echtzeit.mjs an teil_rampe Zeile 7).
sock.on('message', (buf, rinfo) => { aufholen(); K.empfange(buf, { port: rinfo.port }); geaendert = true; });

sock.bind(port, '127.0.0.1', () => {
  fortsetzenOderFrisch();
  process.stdout.write(`attrappe_kern: instanz=${instanz || '-'} port=${sock.address().port} generation=${K.generation} sample=${K.jetzt} ` +
    `arbeitsbestand=${cfg.arbeitsbestand} zustand=${zustandDatei}${mutationen.length ? ` mutation=${mutationen.join(',')}` : ''}\n`);
  setInterval(() => {
    const n = aufholen();
    if (geaendert || (n && (K.jetzt - letzteSicherung >= 4800 || K.jetzt < letzteSicherung))) sichern();
  }, 1);
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { sichern(); process.exit(0); });

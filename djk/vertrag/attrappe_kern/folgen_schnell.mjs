// Schneller Test-Läufer der Unit-Tests: fährt Schritte im Grundformat SCHNITTSTELLEN §19.0 der Reihe nach im selben
// Prozess gegen die Attrappe, ohne UDP und ohne Echtzeit (die simulierte Uhr läuft so schnell wie gerechnet). Eine
// erwartete Meldung wird verbraucht. Die Golden-Folgen aus 09 (mit FORMAT.md-Zusätzen) fährt golden.mjs.
//
// Schritte: {"t":"sende","sample":S,"osc":[adresse,typen,...werte]}   zugestellt, wenn der Kern Sample S überschritten hat
//           {"t":"hand","sample":S,"pfad":P,"midi_roh":U}              als /test/hand für Sample S
//           {"t":"erwarte","bis_sample":S,"osc":[adresse,typen,...werte]} Meldung mit Stempel ≤ S; null = beliebig
//           {"t":"wert","sample":S,"pfad":P,"wert":W,"toleranz":T}       Reglerwert am Sample S
//           {"t":"neustart","sample":S,"pause_samples":P}               Zustand sichern, neue Attrappe, fortsetzen
// Aufruf: node folgen_schnell.mjs [--mutation m1,m2] [--arbeitsbestand DIR] folge.jsonl ...

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neuerKern } from './module.mjs';
import { kodiere } from './osc.mjs';
import { sichere, stelleWieder } from './zustand.mjs';

const PORT = 1;
const HALLO_ABSTAND = 96000;

function wertGleich(ist, soll) {
  if (soll === null) return true;
  if (typeof soll === 'string') return ist === soll;
  const a = typeof ist === 'bigint' ? Number(ist) : ist;
  if (typeof a !== 'number') return false;
  if (Number.isNaN(soll)) return Number.isNaN(a);
  return Math.abs(a - soll) <= 1e-6 * Math.max(1, Math.abs(soll));
}

function passt(m, spez) {
  const [adresse, typen, ...werte] = spez;
  if (m.adresse !== adresse) return false;
  if (typen !== null && typen !== undefined && m.typen !== String(typen).replace(/^,/, '')) return false;
  return werte.every((w, i) => wertGleich(m.werte[i], w));
}

const zahl = (v, t) => (v === null && (t === 'd' || t === 'f') ? NaN : v);

const MUTATION_AUS_UMGEBUNG = (process.env.ATTRAPPE_MUTATION ?? '').split(',').filter(Boolean);

export function fahre(schritte, { cfg = {}, mutationen = MUTATION_AUS_UMGEBUNG } = {}) {
  const log = [];
  const fehler = [];
  const sende = (m) => { if (m.ports.includes(PORT)) log.push({ ...m, verbraucht: false }); };
  let K = neuerKern({ cfg, sende, mutationen });
  let letzteHallo = -Infinity;
  const hallo = () => { K.empfange(kodiere('/k/hallo', 'sii', ['folgen', PORT, 1]), { port: PORT }); letzteHallo = K.jetzt; };
  const laufeBis = (s) => {
    while (K.jetzt <= s) {
      if (K.jetzt - letzteHallo >= HALLO_ABSTAND) hallo();
      K.block();
    }
  };
  for (const x of schritte) if (x.t === 'wert') K.beobachte.add(x.sample);
  hallo();
  for (const [i, x] of schritte.entries()) {
    const wo = `Schritt ${i + 1} (${x.t})`;
    if (x.t === 'sende') {
      laufeBis(x.sample);
      const [adresse, typen, ...werte] = x.osc;
      const tt = String(typen).replace(/^,/, '');
      K.empfange(kodiere(adresse, tt, werte.map((v, j) => zahl(v, tt[j]))), { port: PORT });
    } else if (x.t === 'hand') {
      K.empfange(kodiere('/test/hand', 'sfh', [x.pfad, x.midi_roh, x.sample]), { port: PORT });
    } else if (x.t === 'erwarte') {
      laufeBis(x.bis_sample);
      const m = log.find((y) => !y.verbraucht && y.s <= x.bis_sample && passt(y, x.osc));
      if (m) m.verbraucht = true;
      else {
        const gleich = log.filter((y) => y.adresse === x.osc[0]).slice(-3).map((y) => `${y.adresse} ${JSON.stringify(y.werte, (k, v) => (typeof v === 'bigint' ? Number(v) : v))} @${y.s}`);
        fehler.push(`${wo}: erwartet ${JSON.stringify(x.osc)} bis ${x.bis_sample}; zuletzt gesehen: ${gleich.join(' | ') || 'nichts'}`);
      }
    } else if (x.t === 'wert') {
      laufeBis(x.sample);
      const w = K.beobachtet.get(x.sample)?.[x.pfad];
      if (w === undefined || Math.abs(w - x.wert) > (x.toleranz ?? 1e-6)) fehler.push(`${wo}: ${x.pfad} bei ${x.sample} = ${w}, erwartet ${x.wert} ± ${x.toleranz ?? 1e-6}`);
    } else if (x.t === 'neustart') {
      laufeBis(x.sample);
      const text = sichere(K);
      const alt = K;
      K = neuerKern({ cfg, sende, mutationen });
      K.beobachte = alt.beobachte;
      K.beobachtet = alt.beobachtet;
      stelleWieder(K, text, { jetztNs: alt.monoBei(alt.jetzt + (x.pause_samples ?? 0)) });
      hallo();
    } else if (x.t === 'kommentar') {
      // nichts
    } else fehler.push(`${wo}: Schritt-Art ${x.t} unbekannt`);
  }
  return { ok: fehler.length === 0, fehler, log, kern: K };
}

export function leseFolge(datei) {
  return fs.readFileSync(datei, 'utf8').split('\n').filter((z) => z.trim() && !z.trim().startsWith('//')).map((z) => JSON.parse(z));
}

// Hauptprogramm nur beim direkten Aufruf (auch über einen Symlink: realpath statt Textvergleich der URL)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let mutationen = [];
  const cfg = {};
  const dateien = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mutation') mutationen = args[++i].split(',').filter(Boolean);
    else if (args[i] === '--arbeitsbestand') cfg.arbeitsbestand = args[++i];
    else dateien.push(args[i]);
  }
  let rot = 0;
  for (const d of dateien) {
    const r = fahre(leseFolge(d), { cfg, mutationen });
    const name = path.basename(d, '.jsonl');
    if (r.ok) console.log(`GRUEN ${name}`);
    else { rot++; console.log(`ROT ${name}: ${r.fehler[0]}`); }
  }
  console.log(`gefahren ${dateien.length}, gruen ${dateien.length - rot}, rot ${rot}${mutationen.length ? `, Mutation ${mutationen.join(',')}` : ''}`);
  process.exit(rot ? 1 : 0);
}

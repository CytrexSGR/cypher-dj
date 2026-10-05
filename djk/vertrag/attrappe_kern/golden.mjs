// Golden-Folgen gegen die Kern-Attrappe in simulierter Zeit (im selben Prozess, ohne UDP, ohne Echtzeit), nach
// djk/vertrag/folgen/FORMAT.md. Der Läufer spielt die Handlungen (sende, buendel, hand, aktion) nach ihrem Sample ein,
// meldet sich wie ein Abonnent an (Herzschlag je Sekunde Kern-Zeit, nach einem Neustart sofort, Punkt 13), sammelt
// alles, was die Attrappe an ihn schickt, und liest Regler- und Deck-Werte an den Samples der wert- und
// deck_wert-Zeilen direkt aus ihren Tabellen (Punkt 7 und 16). Geurteilt wird mit folgen_vergleich.py (vergleich.py).
//
// Zeitstempel einer Beobachtung: max(Sample, an dem die Attrappe sie abschickt; ihr eigenes Feld sample bzw.
// ist_sample). Dieselbe Regel hält attrappe_kern.mjs in Echtzeit ein (sendet nie vor mono(Stempel)).
// Punkt 2: was vor der Quittung gestartet von /k/set/neu eintrifft, gehört zur alten Zeitachse und fällt weg.
//
// Aufruf: node golden.mjs [--vertrag DIR] [--material DIR] [--mutation m1,m2] [--bericht datei.json] folge.jsonl ...
// Rückgabe: 0 alle grün, 1 mindestens eine rot, 2 Aufruf- oder Material-Fehler.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neuerKern } from './module.mjs';
import { kodiere, kodiereBundle } from './osc.mjs';
import { sichere, stelleWieder } from './zustand.mjs';
import { AUSGABEN } from './vertrag.mjs';
import { ausgelassen, leseFolge, letztesSample, oscWerte, pruefeArten, urteile, material, HAND_VORLAUF } from './folge.mjs';

const PORT = 1;                      // Abonnenten-Port des Läufers (im Prozess nur ein Name)
const NAME = 'golden';
const HERZSCHLAG = 48000;            // /k/hallo je Sekunde Kern-Zeit (§4.1: spätestens alle 2 s)
export const PAUSE_NEUSTART = 4800;  // simulierte Neustart-Dauer 100 ms (Folge neustart erlaubt bis 12 000)

export function stempel(m) {
  const f = AUSGABEN[m.adresse]?.felder ?? [];
  const i = f.indexOf('ist_sample') >= 0 ? f.indexOf('ist_sample') : f.indexOf('sample');
  return i >= 0 ? Math.max(m.s, Number(m.werte[i])) : m.s;
}

export function fahreGolden(zeilen, { cfg = {}, mutationen = [], pause = PAUSE_NEUSTART } = {}) {
  pruefeArten(zeilen);
  let beobachtet = [];
  let setNeuId = null;
  const sende = (m) => {
    if (!m.ports.includes(PORT)) return;
    beobachtet.push({ s: stempel(m), adresse: m.adresse, typen: m.typen, werte: m.werte });
    // Punkt 2: mit der Quittung gestartet von /k/set/neu beginnt die Folge; Älteres fällt weg (außer dessen /q)
    if (m.adresse === '/q' && setNeuId !== null && m.werte[0] === setNeuId && m.werte[2] === 2) {
      beobachtet = beobachtet.filter((x) => x.adresse === '/q' && x.werte[0] === setNeuId);
      setNeuId = null;
    }
  };
  const beobachte = new Set(zeilen.filter((z) => (z.t === 'wert' || z.t === 'deck_wert') && !ausgelassen(z)).map((z) => z.sample));
  const schnapp = new Map();
  const neu = () => {
    const k = neuerKern({ cfg: { pruefmodus: true, ...cfg }, sende, mutationen });
    k.beobachte = beobachte;
    k.beobachtet = schnapp;
    return k;
  };
  let K = neu();
  const plan = [];
  let uebersprungen = 0;
  let letzterHallo = -Infinity;
  zeilen.forEach((z, i) => {
    if (ausgelassen(z)) { uebersprungen++; return; }
    if (z.t === 'sende') {
      plan.push({ s: z.sample, i, tu: () => {
        const [a, t, w] = oscWerte(z.osc);
        if (a === '/k/set/neu') setNeuId = w[0];
        K.empfange(kodiere(a, t, w), { port: PORT });
      } });
    } else if (z.t === 'buendel') {
      plan.push({ s: z.sample, i, tu: () => K.empfange(kodiereBundle(z.nachrichten.map(oscWerte)), { port: PORT }) });
    } else if (z.t === 'hand') {
      plan.push({ s: z.sample - HAND_VORLAUF, i, tu: () => K.empfange(kodiere('/test/hand', 'sfh', [z.pfad, z.midi_roh, BigInt(z.sample)]), { port: PORT }) });
    } else if (z.t === 'aktion') {
      if (z.was !== 'kern_kill9') throw new Error(`Zeile ${i + 1}: aktion ${z.was} unbekannt`);
      plan.push({ s: z.sample, i, tu: () => {
        const text = sichere(K);                       // Zustand wie im Shared Memory (§6.3), dann "kill -9"
        const alt = K;
        K = neu();
        stelleWieder(K, text, { jetztNs: alt.monoBei(alt.jetzt + pause) });
        letzterHallo = -Infinity;                      // Punkt 13: 100 ms kein /uhr, der Läufer meldet sich sofort
      } });
    }
  });
  plan.sort((a, b) => a.s - b.s || a.i - b.i);
  const ende = letztesSample(zeilen) + 2400;
  const hallo = () => { K.empfange(kodiere('/k/hallo', 'sii', [NAME, PORT, 1]), { port: PORT }); letzterHallo = K.jetzt; };
  let p = 0;
  let bloecke = 0;
  while (p < plan.length || K.jetzt <= ende) {
    if (K.jetzt - letzterHallo >= HERZSCHLAG || K.jetzt < letzterHallo) hallo();
    while (p < plan.length && plan[p].s < K.jetzt) plan[p++].tu();
    K.block();
    if (++bloecke > 50 * 60 * 48000 / 256) throw new Error('mehr als 50 min Kern-Zeit: Folge hängt');
  }
  const werte = new Map();
  const deck = new Map();
  for (const z of zeilen) {
    if (ausgelassen(z)) continue;
    const w = schnapp.get(z.sample);
    if (z.t === 'wert' && w && w[z.pfad] !== undefined) werte.set(`${z.pfad}|${z.sample}`, w[z.pfad]);
    if (z.t === 'deck_wert' && w && w[`deck/${z.deck}/${z.feld}`] !== undefined) deck.set(`${z.deck}|${z.feld}|${z.sample}`, w[`deck/${z.deck}/${z.feld}`]);
  }
  return { beobachtet, werte, deck, uebersprungen, kern: K };
}

// Mehrere Folgen fahren und in einem Aufruf urteilen; Rückgabe [{name, gruen, befunde, zeilen, uebersprungen}]
export function fahreAlle(dateien, { cfg = {}, mutationen = [] } = {}) {
  const eintraege = dateien.map((d) => {
    const zeilen = leseFolge(d);
    const r = fahreGolden(zeilen, { cfg, mutationen });
    return { name: path.basename(d, '.jsonl'), datei: d, zeilen, ...r };
  });
  const urteil = urteile(eintraege);
  return eintraege.map((e, i) => ({ name: e.name, gruen: urteil[i].befunde.length === 0, befunde: urteil[i].befunde,
    zeilen: e.zeilen.length, uebersprungen: e.uebersprungen }));
}

// Hauptprogramm nur beim direkten Aufruf (auch über einen Symlink: realpath statt Textvergleich der URL)
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
  if (!dateien.length) { console.error('Aufruf: node golden.mjs [--vertrag DIR] [--material DIR] [--mutation m] [--bericht datei] folge.jsonl ...'); process.exit(2); }
  if (!ab) {
    ab = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-golden-'));
    try { material(vertrag, ab); } catch (e) { console.error(`Material: ${e.message}`); process.exit(2); }
  }
  const ergebnis = fahreAlle(dateien, { cfg: { arbeitsbestand: ab }, mutationen });
  let rot = 0;
  for (const r of ergebnis) {
    const zusatz = r.uebersprungen ? `, ${r.uebersprungen} ausgelassen` : '';
    if (r.gruen) console.log(`GRÜN ${r.name}: ${r.zeilen} Zeilen${zusatz}`);
    else { rot++; const [z, art, text] = r.befunde[0]; console.log(`ROT  ${r.name}: Zeile ${z} ${art}: ${text.slice(0, 300)}${r.befunde.length > 1 ? ` (+${r.befunde.length - 1})` : ''}`); }
  }
  console.log(`gefahren ${ergebnis.length}, grün ${ergebnis.length - rot}, rot ${rot}${mutationen.length ? `, Mutation ${mutationen.join(',')}` : ''}`);
  if (bericht) fs.writeFileSync(bericht, JSON.stringify(ergebnis, null, 1));
  process.exit(rot ? 1 : 0);
}

// Gemeinsames der beiden Folgen-Läufer der Kern-Attrappe (golden.mjs in simulierter Zeit, echtzeit.mjs über UDP):
// Folge lesen, Bereiche auslassen, Beobachtung für vergleich.py kodieren, Urteil holen.
// Format und Regeln: djk/vertrag/folgen/FORMAT.md (Scheiben 02 und 09). Geurteilt wird nicht hier, sondern mit
// djk/vertrag/folgen_vergleich.py (über vergleich.py), damit Attrappe, Kern und Bibliotheken dasselbe grün nennen.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HIER = path.dirname(fileURLToPath(import.meta.url));

// FORMAT.md Punkt 14: Bereiche, die die Kern-Attrappe nicht baut (Leitstand-WebSocket, Rechner, Messung am Ton).
export const BEREICHE_AUS = new Set(['leitstand', 'rechner']);
export const ARTEN_AUS = new Set(['ws_sende', 'ws_erwarte', 'rechner_frage', 'rechner_antwort', 'messung']);
export const HANDLUNGEN = new Set(['sende', 'buendel', 'hand', 'aktion']);
export const PRUEFUNGEN = new Set(['erwarte', 'erwarte_nicht', 'erlaube', 'wert', 'deck_wert']);
export const HAND_VORLAUF = 4800;     // FORMAT.md Punkt 5: /test/hand mindestens 2 Zyklen plus Transport vor S (100 ms)

export function ausgelassen(z) {
  return ARTEN_AUS.has(z.t) || BEREICHE_AUS.has(z.bereich);
}

export function leseFolge(datei) {
  return fs.readFileSync(datei, 'utf8').split('\n').filter((z) => z.trim()).map((z) => JSON.parse(z));
}

// Jede Schritt-Art muss bekannt sein (FORMAT.md Punkt 16: unbekannt heißt rot, nicht still überspringen).
export function pruefeArten(zeilen) {
  zeilen.forEach((z, i) => {
    if (!HANDLUNGEN.has(z.t) && !PRUEFUNGEN.has(z.t) && !ARTEN_AUS.has(z.t) && z.t !== 'notiz') {
      throw new Error(`Zeile ${i + 1}: Schritt-Art ${z.t} unbekannt (FORMAT.md Punkt 16)`);
    }
  });
}

export function letztesSample(zeilen) {
  let m = 0;
  for (const z of zeilen) for (const k of ['sample', 'bis_sample']) if (Number.isFinite(z[k])) m = Math.max(m, z[k]);
  return m;
}

// Werte einer sende-Zeile als OSC-Werte: "NaN" an f/d = NaN, h als BigInt; t_send_us im Erzeuger-Kopf ist 0 (Punkt 16)
export function oscWerte(osc) {
  const [adresse, typen, ...werte] = osc;
  const tt = typen.replace(/^,/, '');
  return [adresse, tt, werte.map((v, i) => {
    const t = tt[i];
    if (v === null && t === 'h') return 0n;
    if (v === 'NaN' && (t === 'f' || t === 'd')) return NaN;
    if (v === 'inf' && (t === 'f' || t === 'd')) return Infinity;
    if (v === '-inf' && (t === 'f' || t === 'd')) return -Infinity;
    return t === 'h' ? BigInt(v) : v;
  })];
}

// JSON für Python: ganze Zahlen ohne Punkt, Gleitkomma immer mit Punkt (64.0 bleibt float), NaN und ±Infinity als
// nackte Literale (json.loads versteht sie). JSON.stringify machte aus 64.0 eine 64 und aus NaN ein null.
export function zahlJson(v, t) {
  if (t === 'h' || t === 'i') return String(typeof v === 'bigint' ? v : Math.trunc(v));
  if (t === 's') return JSON.stringify(String(v));
  const x = Number(v);
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

export function nachrichtJson(m) {
  const werte = m.werte.map((w, i) => zahlJson(w, m.typen[i]));
  return `{"sample":${Math.trunc(m.s)},"osc":[${JSON.stringify(m.adresse)},${JSON.stringify(`,${m.typen}`)}${werte.map((w) => `,${w}`).join('')}]}`;
}

// Ein Eintrag je Folge: { name, datei, zeilen, beobachtet: [{s, adresse, typen, werte}], werte: Map, deck: Map }
export function eintragJson(e) {
  const auslassen = [];
  e.zeilen.forEach((z, i) => { if (ausgelassen(z)) auslassen.push(i + 1); });
  const werte = [...e.werte].map(([k, v]) => { const [p, s] = k.split('|'); return `[${JSON.stringify(p)},${s},${zahlJson(v, 'd')}]`; });
  const deck = [...e.deck].map(([k, v]) => { const [d, f, s] = k.split('|'); return `[${d},${JSON.stringify(f)},${s},${zahlJson(v, 'd')}]`; });
  return `{"name":${JSON.stringify(e.name)},"datei":${JSON.stringify(path.resolve(e.datei))},"auslassen":${JSON.stringify(auslassen)},` +
    `"beobachtet":[${e.beobachtet.map(nachrichtJson).join(',')}],"werte":[${werte.join(',')}],"deck":[${deck.join(',')}]}`;
}

// Urteil über alle Einträge in einem Python-Aufruf; Rückgabe [{name, befunde: [[zeile, art, text]]}]
export function urteile(eintraege) {
  const r = spawnSync('python3', [path.join(HIER, 'vergleich.py')], { input: `[${eintraege.map(eintragJson).join(',')}]`, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`vergleich.py endete mit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

// Fixtures aus folgen/material in einen Arbeitsbestand schreiben (FORMAT.md Punkt 21)
export function material(vertrag, ziel) {
  const r = spawnSync('python3', [path.join(vertrag, 'erzeuge_material.py'), '--ziel', ziel], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`erzeuge_material.py endete mit ${r.status}: ${r.stdout}${r.stderr}`);
}

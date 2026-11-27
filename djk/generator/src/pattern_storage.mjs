// Ablage des Strudel-Musters mit Prüfung (Plan 2026-09-27-djk-strudel-feld, Spec E5/E6). Lesen, AUTO-Schalter und Status liegen
// in pattern_state.mjs (ohne Strudel), hier kommt nur das Schreiben dazu, das kompiliere und damit Strudel braucht.
import fs from 'node:fs';
import path from 'node:path';
import { kompiliere } from './compile.mjs';
import { atomar } from './pattern_state.mjs';

export { leseMusterStand, leseVersatz, schreibeStatus, setzeAutonom, autonomAn } from './pattern_state.mjs';

// darf(): nach dem Kompilieren, direkt vor dem Schreiben gefragt (Review F7: AUTO kann während des Prüfens ausgehen).
export function schreibeMuster(ordner, text, von, zeit = Date.now(), darf = () => true, versatz = 0, bezeichnung = null) {
  if (!Number.isInteger(versatz)) return { fehler: 'versatz must be an integer (cycles)' };
  if (bezeichnung !== null && !(typeof bezeichnung === 'string' && bezeichnung.length >= 1 && bezeichnung.length <= 60)) return { fehler: 'bezeichnung must be a string of 1..60 characters' };
  const r = kompiliere(text);
  if (r.fehler) return { fehler: r.fehler };
  if (!darf()) return { abgewiesen: true };
  fs.mkdirSync(ordner, { recursive: true });
  atomar(path.join(ordner, 'strom1.von.json'), JSON.stringify({ von, zeit, ...(versatz ? { versatz } : {}), ...(bezeichnung !== null ? { bezeichnung } : {}) }));
  atomar(path.join(ordner, 'strom1.js'), `${String(text).trim()}\n`);   // zuletzt: der Erzeuger sieht nur Fertiges
  return { ok: true };
}

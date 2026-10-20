// Arbeitsordner der Wiedergaben (Spec D1 2.9): derselbe Wert wie der Kern, also kern.toml `arr_ordner` (§2.1), sonst die Vorgabe
// ~/.cache/cypherdj[-<i>]/arr. Prüfinstanzen schreiben /cypherdj/ in /cypherdj-<i>/ um wie der Kern (konfig.cpp wende_instanz_an).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { arbeitsordnerVorgabe } from '../../projekt/ablage.ts';

export function kernToml(instanz: string): string {
  return path.join(os.homedir(), '.config', instanz ? `cypherdj-${instanz}` : 'cypherdj', 'kern.toml');
}

// Liest nur die eine Zeile `arr_ordner = "…"` (Kommentar dahinter erlaubt). Fehlt die Datei oder die Zeile, oder ist der Wert leer: Vorgabe.
export function arrOrdner(instanz: string, datei: string = kernToml(instanz)): string {
  let text = '';
  try { text = fs.readFileSync(datei, 'utf8'); } catch { return arbeitsordnerVorgabe(instanz); }
  const m = /^[ \t]*arr_ordner[ \t]*=[ \t]*"([^"]*)"[ \t]*(#.*)?$/m.exec(text);
  if (!m || m[1] === '') return arbeitsordnerVorgabe(instanz);
  let wert = m[1];
  if (instanz) wert = wert.replace('/cypherdj/', `/cypherdj-${instanz}/`);
  return path.resolve(wert);
}

// Spec 6.30: Zustandsdatei des Wiedergabe-Zählers der Instanz, ausserhalb des Cache-Ordners (~/.cache/cypherdj[-<i>]/arr), damit ein
// geleerter Cache keine Nummer wiederverwendet: ~/.local/state/cypherdj[-<i>]/wiedergabe-zaehler.
export function zaehlerDateiVorgabe(instanz: string): string {
  return path.join(os.homedir(), '.local', 'state', instanz ? `cypherdj-${instanz}` : 'cypherdj', 'wiedergabe-zaehler');
}

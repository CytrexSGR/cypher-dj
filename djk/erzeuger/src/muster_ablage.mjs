// Ablage des Strudel-Musters mit Prüfung (Plan 2026-09-27-djk-strudel-feld, Spec E5/E6). Lesen, AUTO-Schalter und Status liegen
// in muster_stand.mjs (ohne Strudel), hier kommt nur das Schreiben dazu, das kompiliere und damit Strudel braucht.
import fs from 'node:fs';
import path from 'node:path';
import { kompiliere } from './kompiliere.mjs';
import { atomar } from './muster_stand.mjs';

export { leseMusterStand, schreibeStatus, setzeAutonom, autonomAn } from './muster_stand.mjs';

// darf(): nach dem Kompilieren, direkt vor dem Schreiben gefragt (Review F7: AUTO kann während des Prüfens ausgehen).
export function schreibeMuster(ordner, text, von, zeit = Date.now(), darf = () => true) {
  const r = kompiliere(text);
  if (r.fehler) return { fehler: r.fehler };
  if (!darf()) return { abgewiesen: true };
  fs.mkdirSync(ordner, { recursive: true });
  atomar(path.join(ordner, 'strom1.von.json'), JSON.stringify({ von, zeit }));
  atomar(path.join(ordner, 'strom1.js'), `${String(text).trim()}\n`);   // zuletzt: der Erzeuger sieht nur Fertiges
  return { ok: true };
}

// I08: Text der Kanten-Datei <shm>/eingaenge-kanten (Kern liest sie bei Änderung, Format siehe kanten.h lies_eingangs_kanten) und atomares Schreiben.
import fs from 'node:fs';
import path from 'node:path';
import type { Konfig } from './speicher.ts';

export function baueKantenText(k: Konfig): string {
  const z: string[] = [];
  for (const e of k.eingaenge) {
    if (!e.audio || e.audio.ports.length === 0) continue;
    const l = e.audio.ports[0], r = e.audio.ports[1] ?? e.audio.ports[0];   // Mono geht auf beide Seiten
    z.push(`${l}\tein_${e.k}_L`, `${r}\tein_${e.k}_R`);
  }
  if (k.midi.port) z.push(`${k.midi.port}\tmidi_ein_1`);
  return z.length ? `${z.join('\n')}\n` : '';
}

export function schreibeAtomar(pfad: string, text: string): void {
  fs.mkdirSync(path.dirname(pfad), { recursive: true });
  const tmp = `${pfad}.${process.pid}.teil`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, pfad);
}

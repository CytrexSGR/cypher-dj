// Pfad- und Port-Vorgaben der Oberfläche, soweit sie hier erfasst sind (Plan 2026-10-15-d1-s1, Task 7; Ports ROADMAP Z2: +1000·k je Prüfinstanz a..i).
// NICHT erfasst (unter anderem, nicht abschließend): MEDIATHEK_VORGABE (mediathek.ts:21), katalogVorgabe (katalog.ts:55), pythonVorgabe
// (server.ts:64) und vorhoeerKlientVorgabe (vorhoeren.ts:51) liegen weiter in ihren Modulen.
// Die Instanz kommt bei JEDEM Aufruf aus CYPHERDJ_INSTANZ (Tests setzen sie zur Laufzeit), nie beim Import. Ein explizit
// übergebener Ordner (ServerOptionen) gewinnt immer; diese Funktionen liefern nur die Vorgaben.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HIER = path.dirname(fileURLToPath(import.meta.url));
export const OEFFENTLICH = path.join(HIER, 'oeffentlich');
export const REPO = path.resolve(HIER, '..', '..');
export const PORT_BASIS = { http: 47300, kern: 47100, abo: 47150, leitstandWs: 47200 } as const;
export const REPO_PFADE = {
  bestand: path.join(REPO, 'bestand'),
  sammlungen: path.join(REPO, 'bibliothek', 'sets'),
  musterBibliothek: path.join(REPO, 'bibliothek', 'muster'),
  musterSets: path.join(REPO, 'sets'),
  werkstatt: path.join(REPO, 'djk', 'werkstatt'),
  djkMuster: path.join(REPO, 'djk', 'erzeuger', 'djk-muster'),
  djkKlang: path.join(REPO, 'djk', 'wirte', 'carla', 'djk-klang'),
  surgeBereiche: path.join(REPO, 'djk', 'wirte', 'carla', 'surge_bereiche.json'),
  welleSkript: path.join(HIER, 'welle.py'),
} as const;

const konfig = (...teile: string[]): string => path.join(os.homedir(), '.config', 'cypherdj', ...teile);

export function instanz(): string { return process.env.CYPHERDJ_INSTANZ ?? ''; }
export function versatz(i: string = instanz()): number {
  if (i === '') return 0;
  if (!/^[a-i]$/.test(i)) throw new Error(`CYPHERDJ_INSTANZ=${i}: erlaubt sind a bis i (ROADMAP Z2)`);
  return 1000 * (i.charCodeAt(0) - 96);
}
export function ports(i: string = instanz()): { port: number; kernPort: number; aboPort: number; leitstandWs: number } {
  const k = versatz(i);
  return { port: PORT_BASIS.http + k, kernPort: PORT_BASIS.kern + k, aboPort: PORT_BASIS.abo + k, leitstandWs: PORT_BASIS.leitstandWs + k };
}
export function shmOrdner(i: string = instanz()): string { return `/dev/shm/cypherdj${i ? `-${i}` : ''}`; }
export function rasterOrdnerVorgabe(i: string = instanz()): string { return i ? `/dev/shm/cypherdj-${i}/raster` : konfig('raster'); }
export function hotcueOrdnerVorgabe(i: string = instanz()): string { return i ? `/dev/shm/cypherdj-${i}/hotcues` : konfig('hotcues'); }
export function huellenVorgabe(i: string = instanz()): string { return `${shmOrdner(i)}/huellen`; }
export function musterOrdnerVorgabe(i: string = instanz()): string { return `${shmOrdner(i)}/erzeuger`; }
export function wirtOrdnerVorgabe(i: string = instanz()): string { return shmOrdner(i); }
export function kitsOrdnerVorgabe(): string { return konfig('kits'); }
export function zusatzKit(i: string = instanz()): string { return i ? `rec-${i}` : 'rec'; }
// I08: Geräte-Konfiguration je Instanz (~/.config/cypherdj[-<i>]/geraete.json) und die Kanten-Datei, die der Kern aus dem Shm-Ordner liest.
export function geraeteDatei(i: string = instanz()): string { return path.join(os.homedir(), '.config', i ? `cypherdj-${i}` : 'cypherdj', 'geraete.json'); }
export function eingangsKantenDatei(i: string = instanz()): string { return path.join(shmOrdner(i), 'eingaenge-kanten'); }
export function strudelPakete(): string { return process.env.STRUDEL_PAKETE ?? path.join(os.homedir(), 'strudel', 'packages'); }
// Bisher in loops.ts, welle_cache.ts, arbeitsbestand.ts; dort bleiben sie als Re-Export (gleiche Signatur, gleiche Tests).
export function loopOrdnerVorgabe(i: string): string { return i ? `/dev/shm/cypherdj-${i}/loops` : konfig('loops'); }
// Cache je Instanz (S5-Review B4): Prüfinstanzen nie im Cache des Betriebs.
export function welleCacheVorgabe(i: string): string {
  if (i === '') return path.join(os.homedir(), '.cache', 'cypherdj', 'welle');
  if (!/^[a-i]$/.test(i)) throw new Error(`Instanz ${i}: erlaubt sind a bis i`);
  return `/dev/shm/cypherdj-${i}/welle`;
}
export function arbeitsbestandVorgabe(i: string): string {
  const p = '/dev/shm/cypherdj/material';
  return i ? p.replace(/cypherdj\//g, `cypherdj-${i}/`) : p;
}
// D1 S3 (Spec 2.5): Programm cypherdj-render aus Paket K3, im Bau-Ordner des Kerns wie cypherdj-kern (djk-start). CYPHERDJ_RENDER biegt es um
// (Tests: tests/hilfen/render_attrappe.mjs). Bei jedem Aufruf gelesen, wie die Instanz.
export function renderProgramm(): string { return process.env.CYPHERDJ_RENDER || path.join(REPO, 'djk', 'kern', 'build', 'cypherdj-render'); }

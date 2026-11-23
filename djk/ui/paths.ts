// Pfad- und Port-Vorgaben der Oberfläche, soweit sie hier erfasst sind (Plan 2026-10-15-d1-s1, Task 7; Ports ROADMAP Z2: +1000·k je Prüfinstanz a..i).
// NICHT erfasst (unter anderem, nicht abschließend): MEDIATHEK_VORGABE (media_library.ts:21), katalogVorgabe (catalog.ts:55), pythonVorgabe
// (server.ts:64) und vorhoeerKlientVorgabe (prelisten.ts:51) liegen weiter in ihren Modulen.
// Die Instanz kommt bei JEDEM Aufruf aus CYPHERDJ_INSTANZ (Tests setzen sie zur Laufzeit), nie beim Import. Ein explizit
// übergebener Ordner (ServerOptionen) gewinnt immer; diese Funktionen liefern nur die Vorgaben.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strudelOrdner } from '../contract/orte.ts';

export const HIER = path.dirname(fileURLToPath(import.meta.url));
export const OEFFENTLICH = path.join(HIER, 'public');
export const REPO = path.resolve(HIER, '..', '..');
export const PORT_BASIS = { http: 47300, kern: 47100, abo: 47150, leitstandWs: 47200 } as const;
export const REPO_PFADE = {
  musterSets: path.join(REPO, 'sets'),
  musterStarter: path.join(REPO, 'djk', 'starter', 'muster'),
  werkstatt: path.join(REPO, 'djk', 'workshop'),
  djkMuster: path.join(REPO, 'djk', 'generator', 'djk-muster'),
  djkKlang: path.join(REPO, 'djk', 'hosts', 'carla', 'djk-klang'),
  surgeBereiche: path.join(REPO, 'djk', 'hosts', 'carla', 'surge_bereiche.json'),
  welleSkript: path.join(HIER, 'waveform.py'),
} as const;


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
// Slice 3a: die Analyse-Ablage der Nachtanalyse (Karten je Track, djk/workshop/werkstatt/inventory.py:33 standard_ablage). Nur der Betrieb hat eine Vorgabe: eine
// Prüfinstanz (a..i) liest sie nur mit ausdrücklichem --analyse, damit sie nie die echte Ablage berührt (Fixture-Katalog, Aufträge).
export function analyseVorgabe(i: string = instanz()): string | null {
  if (i !== '') return null;
  return festerPfad('analyse');
}
export function rasterOrdnerVorgabe(i: string = instanz()): string { return i ? `/dev/shm/cypherdj-${i}/raster` : ablageOrdner('raster'); }
export function hotcueOrdnerVorgabe(i: string = instanz()): string { return i ? `/dev/shm/cypherdj-${i}/hotcues` : ablageOrdner('hotcues'); }
export function huellenVorgabe(i: string = instanz()): string { return `${shmOrdner(i)}/huellen`; }
export function musterOrdnerVorgabe(i: string = instanz()): string { return `${shmOrdner(i)}/erzeuger`; }
export function wirtOrdnerVorgabe(i: string = instanz()): string { return shmOrdner(i); }
// Kit folder: CYPHERDJ_KIT_ORDNER (test instances, djk-start --kit-ordner) wins over the configured folder; empty counts as unset.
export function kitsOrdnerVorgabe(o: AblageOptionen = {}): string { return ablageOrdner('kits', o); }
export function zusatzKit(i: string = instanz()): string { return i ? `rec-${i}` : 'rec'; }
// I08: Geräte-Konfiguration je Instanz (~/.config/cypherdj[-<i>]/geraete.json) und die Kanten-Datei, die der Kern aus dem Shm-Ordner liest.
// Baukasten S2: Ordner der Baukasten-Graphen (baukasten-<gruppe>.json), wie djk-instrumente sie dem Wirt nennt
export function baukastenOrdnerVorgabe(i: string = instanz()): string { return path.join(os.homedir(), '.config', i ? `cypherdj-${i}` : 'cypherdj'); }
export function geraeteDatei(i: string = instanz()): string { return path.join(os.homedir(), '.config', i ? `cypherdj-${i}` : 'cypherdj', 'geraete.json'); }
// S19 (MIDI learn): the controller folder of the kern (~/.config/cypherdj[-<i>]/controller, core/src/config.cpp standard_konfig_pfad); lernen.json lives there.
export function controllerOrdner(i: string = instanz()): string { return path.join(os.homedir(), '.config', i ? `cypherdj-${i}` : 'cypherdj', 'controller'); }
export function eingangsKantenDatei(i: string = instanz()): string { return path.join(shmOrdner(i), 'eingaenge-kanten'); }
export function strudelPakete(): string { return process.env.STRUDEL_PAKETE ?? path.join(strudelOrdner(), 'packages'); }
// Bisher in loops.ts, wave_cache.ts, working_inventory.ts; dort bleiben sie als Re-Export (gleiche Signatur, gleiche Tests).
export function loopOrdnerVorgabe(i: string): string { return i ? `/dev/shm/cypherdj-${i}/loops` : ablageOrdner('loops'); }
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
// (Tests: tests/support/render_mock.mjs). Bei jedem Aufruf gelesen, wie die Instanz.
export function renderProgramm(): string { return process.env.CYPHERDJ_RENDER || path.join(REPO, 'djk', 'core', 'build', 'cypherdj-render'); }

// ---- Storage table (djk/config/ablage.json), also read by the Python package djk/ablage; both must give the same paths. ----
export type AblageArt = 'projekte' | 'module' | 'sampler' | 'presets' | 'klaenge' | 'kollektionen' | 'raster' | 'hotcues' | 'kits' | 'loops' | 'geraete' | 'loopsets' | 'bestand' | 'sammlungen' | 'muster' | 'journal';
export type FestName = 'mediathek' | 'analyse' | 'bibliothek_konfig' | 'surge_werk' | 'plugin_index' | 'umgebung' | 'pruefen' | 'quellen' | 'referenzen';
type AblageTabelle = { vorgabe: string; arten: Record<string, { alt: string; neu: string; env: string | null; kern: boolean }>; fest: Record<string, { pfad: string; env: string | null }> };
export type AblageOptionen = { tabelle?: AblageTabelle; log?: (e: { typ: 'ablage_beide'; art: string; alt: string; neu: string }) => void; gewarnt?: Set<string>; repo?: string };
let tabelleGelesen: AblageTabelle | null = null;
const tabelle = (): AblageTabelle => (tabelleGelesen ??= JSON.parse(fs.readFileSync(path.join(REPO, 'djk', 'config', 'ablage.json'), 'utf8')) as AblageTabelle);
const gewarntVorgabe = new Set<string>();
const logVorgabe = (e: object): void => { console.error(JSON.stringify(e)); };
const envWert = (name: string | null): string => (name ? (process.env[name] ?? '') : '');

// CYPHERDJ_HEIM: absolute, trailing '/' stripped; unset or empty gives {HOME}/cypherdj.
export function heimOrdner(): string {
  const roh = process.env.CYPHERDJ_HEIM;
  if (roh === undefined || roh === '') return path.join(os.homedir(), 'cypherdj');
  const e = roh.trim().replace(/\/+$/, '');
  if (e === '' || !e.startsWith('/')) throw new Error('CYPHERDJ_HEIM must be an absolute path');
  return e;
}
const fuelle = (vorlage: string, repo: string = REPO): string => {
  const home = os.homedir();
  return vorlage.replace(/\{HOME\}/g, home).replace(/\{REPO\}/g, () => repo).replace(/\{KONFIG\}/g, `${home}/.config/cypherdj`).replace(/\{HEIM\}/g, () => heimOrdner());
};
export function ablageArten(): AblageArt[] { return Object.keys(tabelle().arten) as AblageArt[]; }
export function ablageOrte(art: AblageArt, o: AblageOptionen = {}): { alt: string; neu: string; env: string | null; kern: boolean } {
  const z = (o.tabelle ?? tabelle()).arten[art];
  if (!z) throw new Error(`unknown storage kind: ${art}`);
  return { alt: fuelle(z.alt, o.repo), neu: fuelle(z.neu, o.repo), env: z.env, kern: z.kern };
}
const echterOrdner = (p: string): boolean => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const linkOhneZiel = (p: string): boolean => { try { return fs.lstatSync(p).isSymbolicLink() && !fs.existsSync(p); } catch { return false; } };
const nichtLeer = (p: string): boolean => { try { return fs.readdirSync(p).length > 0; } catch { return false; } };
// Resolution: (1) env, non-empty; (2) kern kinds and vorgabe 'alt': alt; (3) vorgabe 'neu': a real alt, else neu; an alt link to a missing target throws (moved home, disk absent). Real alt plus non-empty neu
// ('beide') stays at alt and warns once per kind and process.
export function ablageOrdner(art: AblageArt, o: AblageOptionen = {}): string {
  const t = o.tabelle ?? tabelle();
  const orte = ablageOrte(art, o);
  const e = envWert(orte.env);
  if (e !== '') return e;
  if (orte.kern || t.vorgabe !== 'neu') return orte.alt;
  if (linkOhneZiel(orte.alt)) throw new Error(`${art}: ${orte.alt} is a link to a missing target: is the disk mounted? Aborting instead of choosing another place`);
  if (!echterOrdner(orte.alt)) return orte.neu;
  if (nichtLeer(orte.neu)) {
    const gewarnt = o.gewarnt ?? gewarntVorgabe;
    if (!gewarnt.has(art)) { gewarnt.add(art); (o.log ?? logVorgabe)({ typ: 'ablage_beide', art, alt: orte.alt, neu: orte.neu }); }
  }
  return orte.alt;
}
// ANALYZE slice 2: the stored reference curves. A test instance (a..i) keeps them in its own shm folder, never in the real home.
export function referenzOrdnerVorgabe(i: string = instanz()): string { return i ? `${shmOrdner(i)}/referenzen` : festerPfad('referenzen'); }
export function festerPfad(name: FestName): string {
  const z = tabelle().fest[name];
  if (!z) throw new Error(`unknown fixed name: ${name}`);
  const e = envWert(z.env);
  return e !== '' ? e : fuelle(z.pfad);
}

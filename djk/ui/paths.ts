// Pfad- und Port-Vorgaben der Oberfläche, soweit sie hier erfasst sind (Plan 2026-10-15-d1-s1, Task 7; Ports ROADMAP Z2: +1000·k je Prüfinstanz a..i).
// NICHT erfasst (unter anderem, nicht abschließend): katalogVorgabe (catalog.ts:55), pythonVorgabe
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
// Mix and set recordings from the page: a test instance writes into its own shm folder, never into the real home.
export function mitschnittOrdnerVorgabe(i: string = instanz()): string { return i ? `${shmOrdner(i)}/recordings` : ablageOrdner('mitschnitte'); }
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
// Browser plan 1 (review g2): a test instance keeps the import folder, the source list, the catalogue (with its MIDI list) and the feature cache in its
// own /dev/shm folder, like the loops: never the real quellen.toml or katalog.sqlite. An env override (CYPHERDJ_IMPORTE, CYPHERDJ_KATALOG, ...) still wins.
export function importeOrdnerVorgabe(i: string = instanz()): string {
  const e = envWert(ablageOrte('importe').env);
  return i && e === '' ? `${shmOrdner(i)}/importe` : ablageOrdner('importe');
}
/** THE catalogue path, for the reader (Katalog in the page server) and the builder (cypher-mediathek via katalogUmgebung): one decision, two users.
 *  CYPHERDJ_KATALOG (non-empty) wins. Else a test instance: its own ${shm}/bibliothek/katalog.sqlite, whatever mediathek it was given. Else (live studio,
 *  as before) beside the mediathek, as the folder the kernel sees (realpath, '..' behind a link is resolved by the file system; an absent folder stays as written). */
export function katalogPfad(mediathek: string, i: string = instanz()): string {
  const e = process.env.CYPHERDJ_KATALOG ?? '';
  if (e !== '') return e;
  if (i !== '') return `${shmOrdner(i)}/bibliothek/katalog.sqlite`;
  const ordner = path.dirname(mediathek);
  let echt = ordner;
  try { echt = fs.realpathSync.native(ordner); } catch { /* absent: the written path */ }
  return path.join(echt, 'katalog.sqlite');
}
export function katalogUmgebung(i: string = instanz(), basis: NodeJS.ProcessEnv | undefined = undefined): NodeJS.ProcessEnv | undefined {
  if (i === '') return basis;
  const b = `${shmOrdner(i)}/bibliothek`;
  const vorgabe: NodeJS.ProcessEnv = { CYPHERDJ_KATALOG: katalogPfad('', i), CYPHERDJ_BIBLIOTHEK_KONFIG: `${b}/bibliothek.json`, CYPHERDJ_BIBLIOTHEK_CACHE: `${b}/merkmale.sqlite`, CYPHERDJ_HEIM: `${b}/heimat` };
  const frei: NodeJS.ProcessEnv = {};
  // CYPHERDJ_HEIM is not an override here: it holds the real quellen.toml, so an instance always gets its own, whatever the process env says
  for (const [k, v] of Object.entries(vorgabe)) if (k === 'CYPHERDJ_HEIM' || (process.env[k] ?? '') === '') frei[k] = v;
  return { ...frei, ...(basis ?? {}) };
}
// Cache je Instanz (S5-Review B4): Prüfinstanzen nie im Cache des Betriebs.
export function welleCacheVorgabe(i: string): string {
  if (i === '') return path.join(os.homedir(), '.cache', 'cypherdj', 'welle');
  if (!/^[a-i]$/.test(i)) throw new Error(`Instanz ${i}: erlaubt sind a bis i`);
  return `/dev/shm/cypherdj-${i}/welle`;
}
// Preset preview cache (rendered two-bar phrases), same scheme as welleCacheVorgabe: a test instance never writes into the live cache.
export function vorhoerCacheVorgabe(i: string): string {
  if (i === '') return path.join(os.homedir(), '.cache', 'cypherdj', 'vorhoeren');
  if (!/^[a-i]$/.test(i)) throw new Error(`Instanz ${i}: erlaubt sind a bis i`);
  return `/dev/shm/cypherdj-${i}/vorhoeren`;
}
export function arbeitsbestandVorgabe(i: string): string {
  const p = '/dev/shm/cypherdj/material';
  return i ? p.replace(/cypherdj\//g, `cypherdj-${i}/`) : p;
}
// D1 S3 (Spec 2.5): Programm cypherdj-render aus Paket K3, im Bau-Ordner des Kerns wie cypherdj-kern (djk-start). CYPHERDJ_RENDER biegt es um
// (Tests: tests/support/render_mock.mjs). Bei jedem Aufruf gelesen, wie die Instanz.
export function setmitschnittProgramm(): string { return process.env.CYPHERDJ_SETMITSCHNITT || path.join(REPO, 'djk', 'core', 'build', 'cypherdj-setmitschnitt'); }
export function renderProgramm(): string { return process.env.CYPHERDJ_RENDER || path.join(REPO, 'djk', 'core', 'build', 'cypherdj-render'); }

// ---- Storage table (djk/config/ablage.json), also read by the Python package djk/ablage; both must give the same paths. ----
export type AblageArt = 'projekte' | 'module' | 'sampler' | 'presets' | 'klaenge' | 'kollektionen' | 'raster' | 'hotcues' | 'kits' | 'loops' | 'geraete' | 'loopsets' | 'bestand' | 'sammlungen' | 'muster' | 'journal' | 'importe' | 'mitschnitte';
export type FestName = 'mediathek' | 'analyse' | 'bibliothek_konfig' | 'surge_werk' | 'plugin_index' | 'umgebung' | 'pruefen' | 'quellen' | 'referenzen';
type AblageTabelle = { vorgabe: string; arten: Record<string, { alt: string; neu: string; env: string | null; kern: boolean; kern_env?: boolean; grund_alt?: string }>; fest: Record<string, { pfad: string; env: string | null; shm: string | null }> };
export type AblageOptionen = { tabelle?: AblageTabelle; log?: (e: { typ: 'ablage_beide'; art: string; alt: string; neu: string }) => void; gewarnt?: Set<string>; repo?: string; instanz?: string };
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
export function ablageOrte(art: AblageArt, o: AblageOptionen = {}): { alt: string; neu: string; env: string | null; kern: boolean; kern_env: boolean } {
  const z = (o.tabelle ?? tabelle()).arten[art];
  if (!z) throw new Error(`unknown storage kind: ${art}`);
  return { alt: fuelle(z.alt, o.repo), neu: fuelle(z.neu, o.repo), env: z.env, kern: z.kern, kern_env: z.kern_env === true };
}
const echterOrdner = (p: string): boolean => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const linkOhneZiel = (p: string): boolean => { try { return fs.lstatSync(p).isSymbolicLink() && !fs.existsSync(p); } catch { return false; } };
const nichtLeer = (p: string): boolean => { try { return fs.readdirSync(p).length > 0; } catch { return false; } };
// Resolution: (1) env, non-empty; (1b) a test instance (CYPHERDJ_INSTANZ non-empty) gets /dev/shm/cypherdj-<i>/<kind> for every non-core kind and for core kinds with kern_env (geraete), never the owner's place; (2) kern kinds and vorgabe 'alt': alt; (3) vorgabe 'neu': a real alt, else neu; an alt link to a missing target throws (moved home, disk absent). Real alt plus non-empty neu
// ('beide') stays at alt and warns once per kind and process.
export function ablageOrdner(art: AblageArt, o: AblageOptionen = {}): string {
  const t = o.tabelle ?? tabelle();
  const orte = ablageOrte(art, o);
  const e = envWert(orte.env);
  if (e !== '') return e;
  const inst = o.instanz ?? instanz();
  if (inst !== '' && (!orte.kern || orte.kern_env === true)) return `${shmOrdner(inst)}/${art}`;   // core kinds (kits, loops) stay: the kern reads the one real folder. geraete is a core kind with kern_env: the kern takes CYPHERDJ_BK_ORDNER, so an instance gets its own folder and djk-start hands that env to its units
  if (orte.alt === '') return orte.neu;   // a kind without an old place (mitschnitte) lives at neu under every vorgabe
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
// The plugin folder list (plugin_pfade.txt, machine-wide for the live studio: null = <home>/.config/cypherdj/plugin_pfade.txt as before). A test instance gets its
// own file in /dev/shm; CYPHERDJ_PLUGIN_PFADE_DATEI (non-empty) wins, and the Python scan (hosts/carla/plugin_scan.py) reads the same variable.
export function pluginPfadeDatei(i: string = instanz()): string | null {
  const e = process.env.CYPHERDJ_PLUGIN_PFADE_DATEI ?? '';
  if (e !== '') return e;
  return i ? `${shmOrdner(i)}/plugin_pfade.txt` : null;
}
export function festerPfad(name: FestName): string {
  const z = tabelle().fest[name];
  if (!z) throw new Error(`unknown fixed name: ${name}`);
  const e = envWert(z.env);
  if (e !== '') return e;
  const inst = instanz();
  // a test instance keeps the name in its own shm folder; shm null = read-only machine data that stays (surge_werk, umgebung), see the ablage.json table
  if (inst !== '' && z.shm) return `${shmOrdner(inst)}/${z.shm}`;
  return fuelle(z.pfad);
}

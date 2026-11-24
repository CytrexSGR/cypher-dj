// Module-level code of server.ts (plan 2026-11-15-backlog-tech-release, task 9): constants, types and pure helpers, moved unchanged.
import fs from 'node:fs';
import type { TagsBereichOptionen } from './tags/area.ts';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { reglerInfo } from '../conductor/src/controls_info.ts';
import { pultMixIndexListe } from '../contract/pult.ts';
import { SLUG } from './collection.ts';
import type { ProjOptionen } from './areas/proj/area.ts';
import type { GeraeteOptionen } from './areas/devices/area.ts';
import type { LernenOptionen } from './areas/learn/area.ts';
import type { PresetOptionen } from './presets/area.ts';
import type { KollektionBereichOptionen } from './collections/area.ts';
import type { StemsOptionen } from './areas/proj/stems.ts';
import { modulBasis } from './project/module_storage.ts';
import type { ScanBefehl } from './plugins/index.ts';
import type { ImportOptionen } from './loop_import.ts';
import { REPO } from './paths.ts';
import { type Fassung, hatHandEins } from './deck_operation.ts';
import { Vorhoeren } from './prelisten.ts';
import type { MusterPlan, Fahrt } from './track.ts';
import { MAX_SCHLEIFE_TAKTE, type Spur } from './track.ts';
import { vorgabenVon } from './graphs.ts';

// The main checkout behind a git worktree (its `.git` is a file pointing at .git/worktrees/<n>, whose `commondir` leads
// back to the shared .git). The main checkout itself resolves to itself; a folder without git to null.
export function hauptCheckout(repo: string): string | null {
  const g = path.join(repo, '.git');
  try {
    if (fs.statSync(g).isDirectory()) return repo;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(g, 'utf8'));
    if (!m) return null;
    const gitdir = path.resolve(repo, m[1].trim());
    const common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
    return path.dirname(common);
  } catch { return null; }
}
// Python for waveform.py and the werkstatt jobs (needs numpy, torchaudio for stems): CYPHERDJ_PYTHON, else the werkstatt venv,
// else the venv in the repo root (INSTALL §3: `python3 -m venv .venv`), else the same two venvs of the main checkout (a git
// worktree has no untracked venv; without this step every worktree ran the stems tests on the system python3, 2026-11-04),
// else python3 from the PATH.
export function pythonVorgabe(repo: string = REPO, env: NodeJS.ProcessEnv = process.env): string {
  const venvs = (r: string) => [path.join(r, 'djk', 'workshop', '.venv', 'bin', 'python'), path.join(r, '.venv', 'bin', 'python')];
  const haupt = hauptCheckout(repo);
  const kandidaten = [env.CYPHERDJ_PYTHON, ...venvs(repo), ...(haupt !== null && haupt !== repo ? venvs(haupt) : [])];
  return kandidaten.find((p) => p !== undefined && p !== '' && fs.existsSync(p)) ?? 'python3';
}
// Mixer-Regler des Projekts (spur/*, grp/*, pm/fader) ändern sich nur über das Projekt (Spec 6.22), auf keinem Weg am Projekt vorbei
// 1.10 slice 3: also the sends (spur|grp/<n>/send/<r>) and the return strips (ret/*, Hall values included)
// 1.10 slice 4a/4b/4c: also the insert stages (ins/komp|eq|saett|lim|utility|bk/<n>/*) and the rack macros (rack/<k>/m1..m4)
// The headphone cue of a group (grp/<n>/cue, live modules task 6) is no project value: it is a hand-only row like PFL and goes to the core (Cypher gets its nur_hand refusal)
export const ueberProjekt = (pfad: string): boolean => !/^grp\/\d+\/cue$/.test(pfad) && (pfad.startsWith('spur/') || pfad.startsWith('grp/') || pfad.startsWith('ret/') || pfad.startsWith('ins/') || pfad.startsWith('rack/') || pfad === 'pm/fader');
export const ueberProjektText = (pfad: string): string => (pfad.startsWith('rack/')
  ? 'rack macros are changed through the project (/proj/aendern: rack_makro for the value, rack_setzen for the mapping)'
  : pfad.startsWith('ins/')
  ? 'insert stages are changed through the project (/proj/aendern: insert_setzen, insert_param_setzen, insert_an, insert_entfernen, insert_ordnung)'
  : pfad.startsWith('ret/') || pfad.includes('/send/')
  ? 'sends, return strips and Hall values are changed through the project (/proj/aendern: send_setzen, return_aendern)'
  : /^spur\/\d+\/bk\//.test(pfad) ? 'the knobs of a Cypher Modular track are changed through the project (/proj/aendern: geraet_param_setzen); a controller reaches them as a learn target'
  : pfad.startsWith('spur/') ? 'track faders are changed through the project (/proj/aendern, spur_aendern)'
    : 'group and master faders are changed through the project (/proj/aendern: gruppenspur_aendern, master_aendern)');
// Plan live-module task 3: the module store folder; a test instance (a..i) keeps it in /dev/shm, never in the real config folder
export const modulBasisVon = (vorgabe: string | undefined, inst: string): string => vorgabe ?? (inst === '' ? modulBasis() : `/dev/shm/cypherdj-${inst}/module`);
// The pairing file (tablet access): only the live studio keeps it in the real config folder; a test instance (a..i) has its own under /dev/shm, so it never shows
// or changes the owner's paired devices (POST /kopplung/loeschen would write it).
export const kopplungPfadVon = (vorgabe: string | undefined, inst: string): string => vorgabe ?? (inst === '' ? path.join(os.homedir(), '.config', 'cypherdj', 'kopplung.json') : `/dev/shm/cypherdj-${inst}/kopplung.json`);
export const STROM_MAX_BYTES = 4 * 1024 * 1024;   // unsent bytes per event stream before the stream is closed
export const STRUDEL_ZEITLIMIT_MS = 2000;   // Plan-Review M3

// Tablet access (task 10). Off unless ~/.config/cypherdj/tablet.json says {"an": true}; a test instance (a..i) never reads it and keeps its pairing file in /dev/shm/cypherdj-<i>/ (kopplungPfadVon). Tests give their own paths.
export interface TabletOptionen {
  konfigPfad?: string; kopplungPfad?: string; port?: number;
  schnittstellen?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;   // default os.networkInterfaces
  logMs?: number;   // tests: the window of the wrong-pairing-try summary line (default 60 s)
  bindeAn?: string;   // tests only: bind here (127.0.0.1) while the pairing link still names the found address
}

export interface ServerOptionen {
  tablet?: TabletOptionen;
  port: number; kernPort: number; aboPort: number; leitstandWs: number; bestand: string; arbeitsbestand: string;
  wiederOeffnenFristMs?: number;   // how long the start waits for the kern before it gives up reopening the remembered project (default 15000)
  systemstartMs?: number;   // boot time of the machine in epoch ms (tests; default /proc/stat btime), see systemstartMs()
  mutationen?: string[]; log?: (zeile: Record<string, unknown>) => void;
  // Läuft der Kern im Prüfmodus (§19.0)? true/false aus der Konfig (--kern-pruefmodus an|aus), sonst unbekannt:
  // dann lernt der Server es aus der Antwort des Kerns auf /test/hand (Befund 5 der adversarialen Prüfung).
  kernPruefmodus?: boolean | null;
  // Kurve, nach der die Seite Griffe rechnet (public/curves.js): 'kern' (Vorgabe) oder 'attrappe_linear' (Attrappe 13)
  zielKurve?: string;
  loops?: string;  // MVP 2: Loop-Ordner (Vorgabe aus CYPHERDJ_INSTANZ)
  digitalout?: string;  // Glanz 2.1: Standdatei der Digital-Out-Wache
  kits?: string;   // MVP 2 Scheibe 3: Kit-Ordner (Vorgabe ~/.config/cypherdj/kits, wie der Kern)
  kit?: string;    // Basis-Kit des Erzeugers (Vorgabe battery); Zusatz-Kit rec bzw. rec-<i>
  welleCache?: string;  // Plan Oberfläche T2: Vorgabe je Instanz (S5-Review B4): Betrieb ~/.cache/cypherdj/welle, Prüfinstanz /dev/shm/cypherdj-<i>/welle
  welleFfmpeg?: string[];  // Tests: anderer Aufruf statt ffmpeg (z. B. eine langsame Attrappe)
  welleZeitlimit?: (dauerS?: number) => number;  // Tests: Zeitlimit der Dekodierung in ms
  python?: string;      // Vorgabe: pythonVorgabe() (waveform.py braucht numpy)
  plugins?: { datei?: string; scan?: ScanBefehl };   // 1.11 task 10: the plugin index file and the scan command (tests replace both)
  musterOrdner?: string;  // Plan 2: Vorgabe /dev/shm/cypherdj[-i]/erzeuger
  hotcueOrdner?: string;  // Plan E9: Vorgabe ~/.config/cypherdj/hotcues
  rasterOrdner?: string;  // Plan Grid: Vorgabe ~/.config/cypherdj/raster
  huellen?: string;  // Ohr T5: Vorgabe /dev/shm/cypherdj[-i]/huellen
  busRing?: string;  // GET /analyse/live: audio ring, default <shmOrdner>/bus
  wirtOrdner?: string;  // Studio S6: Ordner der Wirt-Sockets (Vorgabe /dev/shm/cypherdj[-i])
  baukastenOrdner?: string;  // Baukasten S2: Ordner der Graphen baukasten-<gruppe>.json (Vorgabe ~/.config/cypherdj[-i])
  sammlungen?: string;   // Sets: folder, default from the storage table (kind sammlungen)
  musterBibliothek?: string;   // S2b: eigene Strudel-Muster, default from the storage table (kind muster)
  musterSets?: string;         // S2b: Muster-Quellen track.mjs und Dirigent-Blöcke, Vorgabe <REPO>/sets
  musterStarter?: string;      // Starter patterns (read-only), default <REPO>/djk/starter/muster; '' = none (tests)
  loopWerkzeug?: ImportOptionen['werkzeug'];   // Tests: Attrappen vor ffmpeg/rubberband des Loop-Imports (S6)
  katalog?: string;      // Browser (Plan 2026-10-10): katalog.sqlite, Vorgabe $CYPHERDJ_KATALOG bzw. neben der Mediathek
  stems?: Partial<StemsOptionen>;   // 1.13 Slice 6: Tests biegen zusatzArgs (Prüftrenner, P3) und killMs um
  geraete?: GeraeteOptionen;   // I08: Pfade und Erkennung (Tests geben eigene)
  lernen?: LernenOptionen;     // S19: controller folder (lernen.json) and the devices file (Tests give their own)
  tags?: TagsBereichOptionen;   // B19..B21: tag store (default tags.sqlite next to the catalogue); tests give their own
  kollektionen?: KollektionBereichOptionen;   // 1.16 rest: collections folder (default ~/.config/cypherdj[-<i>]/kollektionen); tests give their own
  presets?: PresetOptionen;    // 1.16: preset folders (werk = factory presets/factory, nutzer = user ~/.config/cypherdj[-<i>]/presets), vocabulary and factory register; tests give their own
  proj?: ProjOptionen;   // D1 S2: Projektwurzel, Arbeitsordner (Vorgaben je Instanz, areas/proj/session.ts)
  mediathek?: string;    // Mediathek T2: Vorgabe $CYPHERDJ_MEDIATHEK (nur lesen; fehlt sie: 503 mediathek_fehlt)
  korrekturen?: string;  // Slice 3b: Bestand des Decks für die Eins-Korrekturen; Vorgabe nur im Betrieb: bestand; eine Prüfinstanz (a..i) schreibt nur ausdrücklich
  // plan live-module task 3: the module store; Vorgabe $CYPHERDJ_MODULE / ~/.config/cypherdj/module, a test instance (a..i) uses /dev/shm/cypherdj-<i>/module
  modulOrdner?: string;
  samplerOrdner?: string;   // sampler A1: the cut store (Vorgabe $CYPHERDJ_SAMPLER / ~/.config/cypherdj/sampler); tests give their own
  analyse?: string;      // Slice 3a: Analyse-Ablage (Karten), Vorgabe nur im Betrieb: $CYPHERDJ_ANALYSE, sonst ~/werkstatt/cypher-dj-analyse
  einleserModul?: string;  // Mediathek T2: Python-Modul für POST /mediathek/vorbereiten (Vorgabe werkstatt.einzeln); Python selbst: `python`
  vorhoeren?: Vorhoeren;   // S7: Vorhören als Kern-Eingang (Tests: Attrappe statt Vorhörer-Prozess)
  klangBefehl?: string;  // Task 3: Programm für POST /klang (Vorgabe djk/hosts/carla/djk-klang); Tests biegen es auf ein Stub-Skript um
}

// 1.15 A7b: the names of the selector values of spektrum/kanal (index = value; the kern sends the same names as the kanal of /zustand/spektrum)
export const SPEKTRUM_QUELLEN: string[] = ['', ...pultMixIndexListe];   // follows contract/pult.json mix_index (container core)
export const KLANG_GRUPPEN = ['bass', 'melodie'];
export const KLANG_AUS_MAX = 32768, KLANG_ERR_MAX = 8192;

export type Pruefmodus = 'an' | 'aus' | 'unbekannt';

// Drosselung je Schlüssel: höchstens eine Meldung je Intervall, die letzte gewinnt (nachgereicht)
// D1 S2: /zustand/arr 50 Hz beim Spielen, Drossel 50 ms (Spec 3.1)
export const GRAPH_ABGELEHNT = [4, 6, 7, 8];   // quittung states of a refused command (INTERFACES 5.1; 5 = executed late, a positive answer)
export const DROSSEL_MS: Record<string, number> = { '/uhr': 50, '/zustand/deck': 100, '/pegel': 100, '/zustand/komp': 100, '/zustand/arr': 50, '/zustand/ein': 250, '/zustand/rec': 100, '/zustand/mix': 100, '/e/ins_gr': 100, '/e/stufe_pegel': 100,
  '/zustand/spektrum': 40 };   // 1.15 A7b: 25 Hz, keyed per source (kanal)
// /lage container.art: the core's code (/e/container/quelle) as the page reads it
export const CONTAINER_ART = ['leer', 'player', 'modul'] as const;
export const INS_GR_FRIST_MS = 500;   // 1.10 slice 4a: as the page's meters (MIX_FRIST_MS); the kern sends 20 Hz while a stage runs
export const DURCHREICHEN = new Set(['/uhr', '/zustand/deck', '/pegel', '/e/regler', '/e/hand', '/e/geladen', '/e/hotcue', '/e/fx',
  '/e/fx/zuweisung', '/e/fx/routing', '/e/container/quelle', '/q', '/e/protokollfehler', '/e/halter', '/e/neustart', '/k/willkommen', '/e/ki', '/e/mitschnitt', '/e/raster',
  '/zustand/komp',   // Effekt-Sektion 2026-10-11: Absenkung je aktivem Kompressor (10 Hz)
  '/zustand/arr', '/e/freeze', '/zustand/ein', '/zustand/rec', '/e/aufnahme',   // D1 S2 (Spec 3.4); I08 (§5.14)
  '/e/ins_gr',   // 1.10 slice 4a (§5.5f): gain reduction per running insert stage, 20 Hz from the kern, throttled per kanal
  '/e/stufe_pegel',   // device faces T9 (§5.5g): input and output peak per running compressor or limiter stage, 20 Hz from the kern, throttled per kanal
  '/zustand/mix', '/zustand/spektrum',   // 1.15 A6: gain-reduction meters (10 Hz per channel, throttled per kanal); A7b: the spectrum (25 Hz, 40 ms throttle per kanal)
  '/e/auto']);   // 1.12 S3 (D8, §5.13): the override state of a lane field, every change at once

export interface Eintrag {
  material_id: string; titel: string; camelot: string | null; quelle_bpm: number; dauer_s: number; lufs: number;
  tore_ok: boolean; basis_bpm: number; fassung: number; beats: number | null; erste_eins_quell_beat: number;
  eins_unsicher: boolean;   // tore.eins.unsicher der Fassung (2026-10-11): die Seite zeigt „downbeat?“
}

export function leseBestand(dir: string): Eintrag[] {
  const idx = path.join(dir, 'index.sqlite');
  if (!fs.existsSync(idx)) return [];
  const db = new DatabaseSync(idx, { readOnly: true });
  try {
    const zeilen = db.prepare(`SELECT m.material_id, m.titel, m.camelot, m.quelle_bpm, m.dauer_s, m.lufs AS m_lufs,
        f.basis_bpm, f.fassung, f.lufs, f.tore_ok FROM fassung f JOIN material m USING (material_id)
        ORDER BY m.titel, f.basis_bpm, f.fassung`).all() as Record<string, unknown>[];
    return zeilen.map((z) => {
      const mo = path.join(dir, String(z.material_id));
      const fj = path.join(dir, String(z.material_id), 'fassungen', `${Math.round(Number(z.basis_bpm) * 1000)}_r${z.fassung}`, 'fassung.json');
      let beats: number | null = null;
      let eins = 0, unsicher = false, bewertet = false;
      try {
        const j = JSON.parse(fs.readFileSync(fj, 'utf8')) as { beats?: number; erste_eins_quell_beat?: number; tore?: { eins?: { unsicher?: unknown } } };
        beats = j.beats ?? null;
        eins = j.erste_eins_quell_beat ?? 0;
        unsicher = j.tore?.eins?.unsicher === true;
        bewertet = (j.tore?.eins as { bewertet?: unknown } | undefined)?.bewertet === true;
      } catch { /* Fassung ohne json: Anzeige ohne Länge */ }
      // Seitenwert von lauf_eins (eins_bewertung.json neben material.json), solange die Fassung selbst nicht bewertet ist
      if (!bewertet) {
        try {
          const sw = JSON.parse(fs.readFileSync(path.join(mo, 'eins_bewertung.json'), 'utf8')) as { unsicher?: unknown };
          unsicher = sw.unsicher === true && !hatHandEins(mo);
        } catch { /* keine oder unlesbare Seitendatei: nichts zeigen */ }
      }
      return {
        material_id: String(z.material_id), titel: String(z.titel), camelot: (z.camelot as string) ?? null,
        quelle_bpm: Number(z.quelle_bpm), dauer_s: Number(z.dauer_s), lufs: Number(z.lufs), tore_ok: z.tore_ok === 1,
        basis_bpm: Number(z.basis_bpm), fassung: Number(z.fassung), beats, erste_eins_quell_beat: eins,
        eins_unsicher: unsicher,
      };
    });
  } finally { db.close(); }
}

export const TYPEN: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

export interface SpurLauf { quelle: string; anker: number; ende: number; fahrten: Fahrt[]; timer: NodeJS.Timeout[]; offen: MusterPlan[]; gruppen: Set<string>; ids: number[]; teile: { id: number; teil: number; pfad: string }[];
  schleife?: SchleifenStand; planend?: number }   // 1.12 S7: only for a loop track; planend = end beat of the pass the watcher is sending (MAJOR 1)
// 1.12 S7 (M13): state of a loop track. anker_naechster = start beat of the next pass not yet sent (MINOR 5: the one name for it),
// durchlauf = its number k, teilNr = its first part number, n = its length in bars; durchlaeufe = the last two sent passes (MINOR 6).
export interface SchleifenStand { n: number; anker_naechster: number; durchlauf: number; teilNr: number; naechste: Spur | null;
  durchlaeufe: { k: number; anfang: number; ende: number; teile: number; proTakt?: number }[] }
export const VORLAUF_SCHLEIFE_BEATS = 2;   // a pass goes to core and wirt this many beats before its start (S8 plan: 0.94 s at 128 BPM, n = 1)
// Loop state from spuren.json (a file can hold anything): null unless every field is sound
export function schleifeAusDatei(x: unknown): SchleifenStand | null {
  const s = x as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;
  const ganz = (v: unknown, lo: number, hi = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!ganz(s.n, 1, MAX_SCHLEIFE_TAKTE) || !Number.isFinite(s.anker_naechster) || !ganz(s.durchlauf, 0) || !ganz(s.teilNr, 0)) return null;
  const d = Array.isArray(s.durchlaeufe) ? s.durchlaeufe.filter((x: Record<string, unknown>) => ganz(x?.k, 0) && Number.isFinite(x?.anfang)
    && Number.isFinite(x?.ende) && ganz(x?.teile, 0)) : [];
  if (!d.length) return null;
  const n = s.naechste as Spur | null;
  const naechste = n && typeof n === 'object' && Array.isArray(n.fahrten) && ganz(n.schleife_takte, 1, MAX_SCHLEIFE_TAKTE) ? n : null;
  return { n: s.n as number, anker_naechster: s.anker_naechster as number, durchlauf: s.durchlauf as number, teilNr: s.teilNr as number,
    naechste, durchlaeufe: d.slice(-2) as SchleifenStand['durchlaeufe'] };
}

// K2: Regler, die /lage erst zeigt, wenn sie von der Vorgabe (INTERFACES §1.5) abweichen
// Kompressor je Quellkanal (2026-10-11): in der Lage, sobald ein Feld von seiner Vorgabe abweicht
const KOMP_VORGABE: Record<string, number> = { an: 0, schwelle: -18, ratio: 4, attack: 10, release: 120, makeup: 0, mix: 1, sc: 0 };
export const kompAbweichend = (p: string, w: number): boolean => { const m = /^(?:deck\/[1-4]|erz\/[1-8]|pad\/[12])\/komp\/(\w+)$/.exec(p); return !!m && m[1] in KOMP_VORGABE && w !== KOMP_VORGABE[m[1]]; };
// 1.15 A2: the 345 mix-tool controls (gate, util, mb, lim, spektrum/kanal) show in lage only once they differ from their default, like komp.
// The default comes from the contract table (controls_info.ts, compared with the C++ table by its test); the comparison runs in float32, because
// the core reports floats and lim/decke -0.3 is not exact there. The path set itself is PFAD (hand_operation.ts), checked before the kern is called.
// Decks the page server opens: all four of the core (places plan 2026-11-13, decision 1: deck 4 opens like deck 3). The Ohr (hearing check)
// covers all four as well, see hoerenAus, hoerscheinTakt and the ear reader's channel list.
export const OFFENE_DECKS = [1, 2, 3, 4] as const;
export function istOffenesDeck(d: unknown): d is 1 | 2 | 3 | 4 { return d === 1 || d === 2 || d === 3 || d === 4; }
export const WERKZEUG_PFAD = /^(?:(?:deck\/[1-4]|erz\/[1-7]|pad\/[12]|bus\/[1-4])\/(?:gate|util|mb|lim)\/|spektrum\/kanal$)/;
export const werkzeugAbweichend = (p: string, w: number): boolean => {
  if (!WERKZEUG_PFAD.test(p)) return false;
  const vorgabe = reglerInfo(p)?.vorgabe;
  return vorgabe !== undefined && Math.fround(w) !== Math.fround(vorgabe);
};
// S5r: graph knobs <channel>/bk/1..64 (default 0.5) show in lage only once they differ, like komp; S14: fx/3, fx/4 /bk/1..64 too; master/bk/1..64 (master insert graph)
const BK_ZEILE = /^((?:deck\/[1-4]|erz\/(?:[1-35-7]|9|10)|pad\/[12]|fx\/[34]|master))\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/;
/** A graph knob row differs from where its graph starts it (the graph's `vorgabe`, 0.5 where it has none or no graph is known); `vorgabe` caches per graph name for one call. */
export const bkAbweichend = (p: string, w: number, geladen: Record<string, string> = {}, vorgabe: Map<string, number[] | null> = new Map()): boolean => {
  const m = BK_ZEILE.exec(p);
  if (!m) return false;
  const name = geladen[m[1]];
  if (name && !vorgabe.has(name)) vorgabe.set(name, vorgabenVon(name));
  return w !== ((name ? vorgabe.get(name)?.[Number(m[2]) - 1] : undefined) ?? 0.5);
};
// Bug t_bffc3708: every channel whose mixer a player sets, not erz/1..3 only (a level helper took the missing erz/5..7 fader for 0 dB). erz/4 belongs to
// the production, erz/8 is cue only: both stay out. Fader, trim, eq, kill and filter always show (a closed fader is a value); a send (1..4) only off its default.
const LAGE_KANAL = '(?:deck\\/[1-4]|pad\\/[12]|erz\\/(?:[1-35-7]|9|10))';   // M8: the alias rows of the strom tracks (streams 9 and 10 included)
export const LAGE_KANALZUG = new RegExp(`^${LAGE_KANAL}\\/(?:fader|trim|eq\\/|kill\\/|filter)`);
export const LAGE_SEND = new RegExp(`^${LAGE_KANAL}\\/send\\/[1-4]$`);
export const LAGE_ABWEICHEND: Record<string, number> = { 'master/kleber': 0, 'duck/tiefe': 0, 'duck/release': 200, 'fx/2/rueckweg': 0, 'color/art': 0, 'color/param': 0.5 };

// Card t_7f487235: the memory the restore plan after a kern restart is made of (FX type of units 1/2, FX assignments 1-3, graphs with owner; the loop boxes are gone with the container core, an old file
// that still carries them is read and the parts are ignored), kept in neustart_stand.json next to aktive_loops.json. `generation` is the kern generation it was true for, `sample` the kern's sample position of the last greeting seen (the same generation with a smaller
// sample position at the next greeting is another kern life, see Oberflaeche.vomKern).
// The restore plan that waits for the guard time (offenerPlan) without the parts Andreas touched meanwhile, and when it is due (epoch ms)
export interface NeustartPlan {
  faellig: number;
  fx: { einheit: 1 | 2; felder: Record<string, unknown>; zuweisung: string[]; besitzer: string }[]; fx3: { zuweisung: string[]; besitzer: string } | null;
  graphen: { kanal: string; name: string; besitzer: string }[];
}
export interface NeustartStand {
  generation: number; sample?: number; geschrieben?: number; plan?: NeustartPlan; fx: (Record<string, unknown> | null)[]; fxZuweisung: Record<string, boolean>[];
  graphBesitzer: Record<string, string>; graphen_geladen: Record<string, string>;
}
const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const textKarte = (x: unknown): Record<string, string> | null => (istObjekt(x) && Object.values(x).every((v) => typeof v === 'string') ? x as Record<string, string> : null);
/** The stand of the file text, or null for anything that is not exactly the file this server writes (missing, corrupt, other version, wrong shape): an empty stand. */
export function leseNeustartStand(text: string | null): NeustartStand | null {
  if (text === null) return null;
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (!istObjekt(j) || j.v !== 1 || typeof j.generation !== 'number' || !Number.isFinite(j.generation)) return null;
  const { fx, fxZuweisung } = j;
  if (!Array.isArray(fx) || fx.length !== 2 || !fx.every((f) => f === null || istObjekt(f))) return null;
  if (!Array.isArray(fxZuweisung) || fxZuweisung.length !== 3 || !fxZuweisung.every((z) => istObjekt(z) && Object.values(z).every((v) => typeof v === 'boolean'))) return null;
  const graphBesitzer = textKarte(j.graphBesitzer), geladen = textKarte(j.graphen_geladen);
  if (!graphBesitzer || !geladen) return null;
  const sample = istZahl(j.sample) ? j.sample : undefined;
  const plan = lesePlan(j.plan);
  const geschrieben = istZahl(j.geschrieben) ? j.geschrieben : undefined;
  return { generation: j.generation, ...(sample !== undefined ? { sample } : {}), ...(geschrieben !== undefined ? { geschrieben } : {}), ...(plan ? { plan } : {}), fx: fx as NeustartStand['fx'], fxZuweisung: fxZuweisung as NeustartStand['fxZuweisung'],
    graphBesitzer, graphen_geladen: geladen };
}
const istText = (x: unknown): x is string => typeof x === 'string';
const textListe = (x: unknown): x is string[] => Array.isArray(x) && x.every(istText);
const istZahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** The waiting plan of the file, or undefined when it is missing or not exactly the shape this server writes (the stand itself stays valid then). */
function lesePlan(x: unknown): NeustartPlan | undefined {
  if (!istObjekt(x) || !istZahl(x.faellig) || !Array.isArray(x.fx) || !Array.isArray(x.graphen)) return undefined;
  const fxOk = x.fx.every((f) => istObjekt(f) && (f.einheit === 1 || f.einheit === 2) && istObjekt(f.felder) && textListe(f.zuweisung) && istText(f.besitzer));
  const fx3Ok = x.fx3 === null || (istObjekt(x.fx3) && textListe(x.fx3.zuweisung) && istText(x.fx3.besitzer));
  const grOk = x.graphen.every((g) => istObjekt(g) && istText(g.kanal) && istText(g.name) && istText(g.besitzer));
  return fxOk && fx3Ok && grOk ? x as unknown as NeustartPlan : undefined;
}
/** Boot time of the machine in epoch ms: btime of /proc/stat, else now minus the uptime. The kern's state lives in /dev/shm and does not survive a reboot. */
export function systemstartMs(): number {
  try {
    const m = /^btime (\d+)$/m.exec(fs.readFileSync('/proc/stat', 'utf8'));
    if (m) return Number(m[1]) * 1000;
  } catch { /* no /proc */ }
  return Date.now() - os.uptime() * 1000;
}
/** A clock stepped after the boot (NTP) moves the computed boot time by a few seconds: a file written this much before it still counts as after it */
export const NEUSTART_STAND_TOLERANZ_MS = 5000;
/** A waiting plan whose due time lies longer in the past than this is not sent: the moment it waited for is gone. */
export const NEUSTART_PLAN_VERSPAETUNG_MS = 5000;
/** A kern that restarted longer ago than this (48 kHz samples between /e/neustart and /k/willkommen) has had its own set since: nothing is restored. */
export const NEUSTART_FRISCH_FRAMES = 30 * 48000;
/** The kern words after which the memory of the restore plan changed (the first three are the stand itself, /e/graph the graph map) */
export const NEUSTART_STAND_ADRESSEN: ReadonlySet<string> = new Set(['/e/fx', '/e/fx/zuweisung', '/e/graph']);

/** The slug of offenes_projekt.json (the project that was open last), or null for anything that is not exactly the file this server writes (nothing remembered). */
export function leseOffenesProjekt(text: string | null): string | null {
  if (text === null) return null;
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (!istObjekt(j) || j.v !== 1 || typeof j.slug !== 'string' || !SLUG.test(j.slug)) return null;
  return j.slug;
}

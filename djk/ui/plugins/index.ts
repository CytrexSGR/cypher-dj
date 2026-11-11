// Plan 1.11 task 10: the plugin index in the page server. The index file is written by djk/hosts/carla/plugin_scan.py (task 9); the server only reads it
// (cached by mtime and size) and starts the scan as a child process, one at a time. A blocked entry is unblocked by dropping it from the index: the next
// scan then tries the bundle again. Nothing here blocks the event loop for longer than one JSON parse of the index.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

export interface IndexEintrag {
  id: string; format: 'vst3' | 'lv2'; pfad: string; uid: string; name: string; hersteller?: string; art: 'effekt' | 'instrument' | 'sonst';
  audio_ein?: number; audio_aus?: number; parameter?: number; status: 'ok' | 'blockiert'; grund?: string; text?: string; buendel?: string;
  mtime?: number; groesse?: number; gescannt?: string;
}
export interface PluginFilter { text?: string; art?: string; format?: string }
export interface ScanStand { laeuft: boolean; seit: number | null; ende: number | null; ergebnis: Record<string, number> | null; fehler: string | null }
export interface ScanBefehl { befehl: string; args: string[] }

const HIER = path.dirname(fileURLToPath(import.meta.url));
export const INDEX_VORGABE = (): string => process.env.CYPHERDJ_PLUGIN_INDEX ?? path.join(os.homedir(), '.local', 'state', 'cypherdj', 'plugins', 'index.json');
export const SCAN_SKRIPT = path.resolve(HIER, '..', '..', 'hosts', 'carla', 'plugin_scan.py');
export const SCAN_FRIST_MS = 10 * 60_000;

/** the entries that match the filter: `text` is part of the name, the maker or the path (case-insensitive), `art` and `format` are exact */
export function filtereEintraege(liste: readonly IndexEintrag[], f: PluginFilter): IndexEintrag[] {
  const t = (f.text ?? '').trim().toLowerCase();
  return liste.filter((e) => (!f.art || e.art === f.art) && (!f.format || e.format === f.format)
    && (t === '' || `${e.name} ${e.hersteller ?? ''} ${e.pfad}`.toLowerCase().includes(t)));
}

export class PluginIndex {
  private readonly datei: string;
  private readonly scanBefehl: ScanBefehl | null;
  private readonly log: (z: Record<string, unknown>) => void;
  private readonly bei: (s: ScanStand) => void;
  private cache: { mtime: number; groesse: number; eintraege: IndexEintrag[] } | null = null;
  private kind: ChildProcess | null = null;
  private stand: ScanStand = { laeuft: false, seit: null, ende: null, ergebnis: null, fehler: null };

  constructor(o: { datei?: string; scan?: ScanBefehl; python?: string; log?: (z: Record<string, unknown>) => void; bei?: (s: ScanStand) => void } = {}) {
    this.datei = o.datei ?? INDEX_VORGABE();
    this.scanBefehl = o.scan ?? (o.python ? { befehl: o.python, args: [SCAN_SKRIPT, '--index', this.datei] } : null);
    this.log = o.log ?? (() => {});
    this.bei = o.bei ?? (() => {});
  }

  /** all entries; a missing or unreadable index file is an empty list (no scan has run yet) */
  eintraege(): IndexEintrag[] {
    let st: fs.Stats;
    try { st = fs.statSync(this.datei); } catch { this.cache = null; return []; }
    if (this.cache && this.cache.mtime === st.mtimeMs && this.cache.groesse === st.size) return this.cache.eintraege;
    let eintraege: IndexEintrag[] = [];
    try {
      const d = JSON.parse(fs.readFileSync(this.datei, 'utf8')) as { version?: number; eintraege?: IndexEintrag[] };
      if (d.version === 1 && Array.isArray(d.eintraege)) eintraege = d.eintraege;
    } catch { /* torn or foreign file: counts as empty until the next scan */ }
    this.cache = { mtime: st.mtimeMs, groesse: st.size, eintraege };
    return eintraege;
  }
  liste(f: PluginFilter = {}): IndexEintrag[] { return filtereEintraege(this.eintraege(), f); }
  finde(id: string): IndexEintrag | null { return this.eintraege().find((e) => e.id === id) ?? null; }
  scanStand(): ScanStand { return { ...this.stand }; }

  /** starts one scan; false when one is already running (the caller answers scan_laeuft) */
  scanne(): boolean {
    if (this.kind || this.stand.laeuft) return false;
    if (!this.scanBefehl) throw new Error('scan_nicht_konfiguriert');
    const k = spawn(this.scanBefehl.befehl, this.scanBefehl.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.kind = k;
    this.setze({ laeuft: true, seit: Date.now(), ende: null, ergebnis: null, fehler: null });
    let aus = '', fehler = '', fertig = false;
    const ende = (s: Partial<ScanStand>): void => {
      if (fertig) return;
      fertig = true; clearTimeout(frist); this.kind = null;
      this.setze({ ...this.stand, laeuft: false, ende: Date.now(), ...s });
    };
    const frist = setTimeout(() => { k.kill('SIGKILL'); ende({ fehler: 'scan_zeitlimit' }); }, SCAN_FRIST_MS);
    frist.unref();
    k.stdout!.on('data', (d) => { aus += d; });
    k.stderr!.on('data', (d) => { fehler += d; });
    k.on('error', (e) => ende({ fehler: e.message }));
    k.on('close', (code) => {
      if (code !== 0) { this.log({ typ: 'plugin_scan_fehler', code, fehler: fehler.slice(-400) }); ende({ fehler: `exit ${code}` }); return; }
      let ergebnis: Record<string, number> | null = null;
      try { ergebnis = JSON.parse(aus.trim().split('\n').pop() ?? '') as Record<string, number>; } catch { /* the index is written anyway */ }
      ende({ ergebnis });
    });
    return true;
  }
  private setze(s: ScanStand): void {
    this.stand = s;
    try { this.bei({ ...s }); } catch { /* a listener never stops the scan */ }
  }

  /** drops a blocked entry (and the other entries of its bundle) so the next scan tries the bundle again; null = unknown id; 'scan_laeuft' = refused */
  entsperre(id: string): { entsperrt: boolean } | 'scan_laeuft' | null {
    if (this.stand.laeuft) return 'scan_laeuft';
    const e = this.finde(id);
    if (!e) return null;
    if (e.status !== 'blockiert') return { entsperrt: false };
    const d = JSON.parse(fs.readFileSync(this.datei, 'utf8')) as { eintraege: IndexEintrag[] };
    d.eintraege = d.eintraege.filter((x) => (e.buendel === undefined || x.buendel !== e.buendel) && x.id !== e.id);
    const tmp = `${this.datei}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1));
    fs.renameSync(tmp, this.datei);
    this.cache = null;
    return { entsperrt: true };
  }
}

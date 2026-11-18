// Keeping three exports per project (storage layout A5). Older exports move to a bin, they are never deleted:
// <projects root>/.papierkorb/exporte/<slug>/. Files and folders count together; names that do not look like an export stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import type { Einsammler } from './einsammeln.ts';
import type { Projekt } from './model.ts';

export const EXPORT_NAME = /^.+-\d{8}-\d{6}(-\d+)?(\.wav)?$/;
// the stamp is anchored at the END of the name (before the extension): a slug may itself end in a stamp
const ENDSTEMPEL = /-(\d{8}-\d{6})(?:-(\d+))?(?:\.wav)?$/;

/** Sort key of an export name: the stamp at its end, the tie counter (1 when absent) as the last part. */
function schluessel(name: string): [string, number] {
  const m = ENDSTEMPEL.exec(name);
  return m ? [m[1], m[2] ? Number(m[2]) : 1] : ['', 0];
}
const neuerAls = (a: string, b: string): number => {
  const [x, y] = [schluessel(a), schluessel(b)];
  return x[0] < y[0] ? 1 : x[0] > y[0] ? -1 : y[1] - x[1];
};

function freierName(bin: string, name: string): string {
  let ziel = path.join(bin, name);
  for (let n = 2; fs.existsSync(ziel) || isLink(ziel); n++) ziel = path.join(bin, `${name}.${n}`);
  return ziel;
}
const isLink = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };
// Three kinds share the name scheme: WAV files, per-track folders (they hold mix.wav) and MIDI folders (no mix.wav). MIDI exports are not counted
// and never move.
function zaehltAlsExport(ordner: string, e: fs.Dirent): boolean {
  if (!EXPORT_NAME.test(e.name)) return false;
  if (e.isDirectory()) return fs.existsSync(path.join(ordner, e.name, 'mix.wav'));
  return e.isFile() && e.name.endsWith('.wav');   // the folder form has no extension; a plain file without it is something else
}

/** Moves every export but the newest `behalte` (default 3) to `papierkorb`. A name in `genannt` stays and does not count; `neu` (the export just
 *  written) always stays. With `trocken` nothing moves and `verschoben` lists what would. A failing move leaves the entry, logs once and stops. */
export function raeumeExporteAuf(a: { exportOrdner: string; papierkorb: string; behalte?: number; genannt?: ReadonlySet<string>; neu?: string;
  trocken?: boolean; umbenenne?: (von: string, nach: string) => void; log?: (z: Record<string, unknown>) => void }):
  { verschoben: string[]; behalten: number } {
  let eintraege: fs.Dirent[];
  try { eintraege = fs.readdirSync(a.exportOrdner, { withFileTypes: true }); } catch { return { verschoben: [], behalten: 0 }; }
  const zaehlt = eintraege.filter((e) => !a.genannt?.has(e.name) && zaehltAlsExport(a.exportOrdner, e)).map((e) => e.name).sort(neuerAls);
  const weg = zaehlt.slice(a.behalte ?? 3).filter((n) => n !== a.neu), verschoben: string[] = [];
  const rename = a.umbenenne ?? fs.renameSync;
  const binDa = fs.existsSync(a.papierkorb);
  for (const n of weg) {
    if (a.trocken) { verschoben.push(n); continue; }
    try {
      fs.mkdirSync(a.papierkorb, { recursive: true });
      rename(path.join(a.exportOrdner, n), freierName(a.papierkorb, n));
      verschoben.push(n);
    } catch (e) {
      a.log?.({ typ: 'export_aufraeumen_fehler', name: n, fehler: (e as Error).message });   // stays where it is, never removed
      break;
    }
  }
  if (!binDa && !a.trocken) { try { fs.rmdirSync(a.papierkorb); } catch { /* has content or is gone */ } }
  return { verschoben, behalten: eintraege.length - verschoben.length };
}

/** Every token that matches EXPORT_NAME in a `*.md` below the folders (recursively, links not followed). A path token counts by its last element. */
export function genannteExporte(ordner: string[]): Set<string> {
  const aus = new Set<string>();
  const geh = (d: string): void => {
    let eintraege: fs.Dirent[];
    try { eintraege = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) geh(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        let text = '';
        try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
        for (const roh of text.split(/[\s`'"()[\]<>,;*|]+/)) {
          const t = roh.replace(/[.:!?]+$/, '').split(/[\\/]/).pop() ?? '';
          if (EXPORT_NAME.test(t)) aus.add(t);
        }
      }
    }
  };
  for (const o of ordner) geh(o);
  return aus;
}

/** The bin of a project: <projects root>/.papierkorb/exporte/<slug>. */
export const papierkorbVon = (wurzel: string, slug: string): string => path.join(wurzel, '.papierkorb', 'exporte', slug);

/** Genannt folders from CYPHERDJ_EXPORT_GENANNT (':' separated, read at each call; unset = none). */
export function genanntOrdnerAusUmgebung(): string[] { return (process.env.CYPHERDJ_EXPORT_GENANNT ?? '').split(':').filter((x) => x !== ''); }

/** The page's hook for a finished export: moves the older exports to the bin, then reports the open project to the collector (all sources).
 *  A named folder that does not exist means the protection cannot be checked: nothing is tidied (logged once per folder and start). */
export function baueNachExport(a: { einsammler: Einsammler; offen: () => { projekt: Projekt; ordner: string } | null;
  quellPfad: (sha: string, hinweis: string) => string | null; log?: (z: Record<string, unknown>) => void;
  umbenenne?: (von: string, nach: string) => void }): (e: { slug: string; ordner: string; datei?: string }) => void {
  const gemeldet = new Set<string>();
  return (e) => {
    try {
      const ordner = genanntOrdnerAusUmgebung();
      const fehlt = ordner.filter((o) => { try { return !fs.statSync(o).isDirectory(); } catch { return true; } });
      for (const o of fehlt) if (!gemeldet.has(o)) { gemeldet.add(o); a.log?.({ typ: 'export_genannt_ordner_fehlt', ordner: o }); }
      if (fehlt.length === 0) {
        raeumeExporteAuf({ exportOrdner: path.join(e.ordner, 'export'), papierkorb: papierkorbVon(path.dirname(e.ordner), e.slug),
          genannt: genannteExporte(ordner), neu: e.datei, umbenenne: a.umbenenne, log: a.log });
      }
    } catch (x) { a.log?.({ typ: 'nach_export_fehler', schritt: 'aufraeumen', fehler: (x as Error).message }); }
    const o = a.offen();
    if (o !== null && o.ordner === e.ordner) a.einsammler.melde({ projekt: o.projekt, projektOrdner: o.ordner, quellPfad: a.quellPfad, alles: true });
  };
}

// Orphan slot banks (tracker task 21/26): every slot write makes a NEW bank graph `amiga-<6 hex>` (plus its panel) and slot files `smp-p<8 hex>.f32`; none of
// them was ever removed. This sweep moves what no project or module refers to any more into <graph folder>/.waisen/<date>/. It only runs at server start (nothing unsaved is open then) and is
// built to keep rather than delete: any unreadable folder, any file younger than `minAlterMs` and everything that a text file of the roots names stays.
import fs from 'node:fs';
import path from 'node:path';
import { graphenOrdner } from '../graphs.ts';
import { instanz } from '../paths.ts';
import { BANK_NAME, samplesOrdner } from './slots.ts';

const SLOT_DATEI = /^smp-p[0-9a-f]{8}\.f32$/;
const BANK_IN_TEXT = /amiga-[0-9a-f]{6}(?![0-9a-f])/g;
const SLOT_IN_TEXT = /smp-p[0-9a-f]{8}\.f32/g;
const TEXT_ENDUNGEN = new Set(['.json', '.jsonl', '.toml', '.txt', '.ndjson', '']);
const DATEI_MAX = 64 * 1024 * 1024;   // a text file above this is not a project file; it counts as unreadable, which stops the sweep

export interface WaisenOptionen {
  bk: string;                       // graph folder (holds amiga-<hex>.json, panels/, samples/)
  wurzeln: string[];                // folders whose text files may name a bank: the project root, the module shelf
  minAlterMs?: number;              // files younger than this stay (default one day)
  jetzt?: () => number;
}
export interface WaisenErgebnis { graphen: string[]; samples: string[]; uebersprungen: string | null }

/** Every bank and slot file name that a text file under `wurzel` mentions. Throws when something cannot be read: the caller then deletes nothing.
 *  Linked folders are followed (2026-11-19: 24 of the 43 projects in ~/cypherdj/werke/projekte are links to ~/cypherdj/pruefen; without following them
 *  their banks counted as orphans); `gesehen` holds the real paths so a link loop ends. */
function sammle(wurzel: string, banken: Set<string>, slots: Set<string>, gesehen = new Set<string>()): void {
  let echt: string;
  try { echt = fs.realpathSync(wurzel); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  if (gesehen.has(echt)) return;
  gesehen.add(echt);
  let eintraege: fs.Dirent[];
  try { eintraege = fs.readdirSync(wurzel, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  for (const e of eintraege) {
    const pfad = path.join(wurzel, e.name);
    const ordner = e.isDirectory() || (e.isSymbolicLink() && (() => { try { return fs.statSync(pfad).isDirectory(); } catch { return false; } })());
    if (ordner) { sammle(pfad, banken, slots, gesehen); continue; }
    if (!e.isFile() && !(e.isSymbolicLink() && (() => { try { return fs.statSync(pfad).isFile(); } catch { return false; } })())) continue;
    if (!TEXT_ENDUNGEN.has(path.extname(e.name))) continue;
    if (fs.statSync(pfad).size > DATEI_MAX) throw new Error(`${pfad} is too large to scan`);
    const text = fs.readFileSync(pfad, 'latin1');
    for (const m of text.match(BANK_IN_TEXT) ?? []) banken.add(m);
    for (const m of text.match(SLOT_IN_TEXT) ?? []) slots.add(m);
  }
}

export function raeumeWaisenBaenke(o: WaisenOptionen): WaisenErgebnis {
  const aus: WaisenErgebnis = { graphen: [], samples: [], uebersprungen: null };
  const minAlter = o.minAlterMs ?? 24 * 3600_000, jetzt = (o.jetzt ?? Date.now)();
  const banken = new Set<string>(), slots = new Set<string>();
  try {
    for (const w of o.wurzeln) sammle(w, banken, slots);
    // the graph files of the folder that are not banks (a hand-made graph may name a slot file) and the sample files named by kept banks
    const ordner = fs.readdirSync(o.bk);
    const alt = (pfad: string): boolean => jetzt - fs.statSync(pfad).mtimeMs >= minAlter;
    const waisen = ordner.filter((n) => n.endsWith('.json') && BANK_NAME.test(n.slice(0, -5)) && !banken.has(n.slice(0, -5)) && alt(path.join(o.bk, n)));
    for (const n of ordner) {
      if (!n.endsWith('.json')) continue;
      const bank = BANK_NAME.test(n.slice(0, -5));
      if (bank && waisen.includes(n)) continue;
      for (const m of fs.readFileSync(path.join(o.bk, n), 'latin1').match(SLOT_IN_TEXT) ?? []) slots.add(m);   // kept graphs keep their slot files
    }
    const proben = samplesOrdner(o.bk);
    let dateien: string[] = [];
    try { dateien = fs.readdirSync(proben); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const weg = dateien.filter((d) => SLOT_DATEI.test(d) && !slots.has(d) && alt(path.join(proben, d)));
    // moved, not deleted (2026-11-19): a wrong guess stays recoverable from <graph folder>/.waisen/<date>/ (same layout as the graph folder)
    const korb = path.join(o.bk, '.waisen', new Date(jetzt).toISOString().slice(0, 10));
    const weglegen = (von: string, rel: string): void => {
      if (!fs.existsSync(von)) return;
      const nach = path.join(korb, rel);
      fs.mkdirSync(path.dirname(nach), { recursive: true });
      fs.renameSync(von, nach);
    };
    for (const n of waisen) {
      weglegen(path.join(o.bk, n), n);
      weglegen(path.join(o.bk, 'panels', n), path.join('panels', n));
      aus.graphen.push(n.slice(0, -5));
    }
    for (const d of weg) { weglegen(path.join(proben, d), path.join(path.relative(o.bk, proben), d)); aus.samples.push(d); }
  } catch (e) {
    aus.uebersprungen = (e as Error).message;   // nothing is deleted after a read problem that came before the first delete; later ones only cut the sweep short
  }
  return aus;
}

/** The sweep for the graph folder of this instance. A test instance (a..i) without its own graph folder (CYPHERDJ_BK_ORDNER) leaves the real folder alone. */
export function raeumeWaisenImStandardOrdner(wurzeln: string[]): WaisenErgebnis {
  if (instanz() !== '' && (process.env.CYPHERDJ_BK_ORDNER ?? '') === '') return { graphen: [], samples: [], uebersprungen: null };
  return raeumeWaisenBaenke({ bk: graphenOrdner(), wurzeln });
}

// Where a project's audio source lives now (storage layout A5): one resolver for the session, the collector and the export.
// The sha is the identity (spec 2.9); the path is only a hint. A copy collected into <project>/audio/ is found again by its sha8.
import fs from 'node:fs';
import path from 'node:path';
import { lesbarerName } from '../names.ts';

const SHA8 = /^[0-9a-f]{8}/;
// an empty file is no copy: after a power loss a renamed file may have no content (a collect writes through fsync, but an old one may be empty)
const istDatei = (p: string): boolean => { try { const x = fs.statSync(p); return x.isFile() && x.size > 0; } catch { return false; } };

/** `<readable name of the last element without extension, or 'quelle'>-<sha8><extension lower case, '.wav' when none>`. */
export function einsammelName(quelle: string, sha: string): string {
  // a name that ends in a dot has the extension "." which is none (the copy would never match the search)
  const basis = path.basename(quelle), roh = path.extname(basis), ext = roh === '.' ? '' : roh;
  const name = lesbarerName(ext ? basis.slice(0, -ext.length) : basis) || 'quelle';
  return `${name}-${sha.slice(0, 8)}${ext ? ext.toLowerCase() : '.wav'}`;
}

/** The entry of `<project>/audio/` whose name ends in `-<sha8>.<ext>`, or null. */
export function findeKopie(projektOrdner: string | null, sha: string): string | null {
  if (projektOrdner === null || !SHA8.test(sha)) return null;
  const ordner = path.join(projektOrdner, 'audio'), ende = new RegExp(`-${sha.slice(0, 8)}\\.[^./]+$`);
  let namen: string[];
  try { namen = fs.readdirSync(ordner); } catch { return null; }
  for (const n of namen.filter((x) => ende.test(x)).sort()) if (istDatei(path.join(ordner, n))) return path.join(ordner, n);
  return null;
}

/** Order: the existing catalog path; the existing absolute hint; a relative hint without `..` inside the project; the collected copy; null. */
export function loeseQuelle(a: { sha256: string; hinweis: string; projektOrdner: string | null; katalogPfad?: string | null }): string | null {
  if (a.katalogPfad && fs.existsSync(a.katalogPfad)) return a.katalogPfad;
  const h = a.hinweis;
  if (h) {
    if (path.isAbsolute(h)) { if (fs.existsSync(h)) return h; }
    else if (a.projektOrdner !== null && !h.split(/[\\/]/).includes('..')) {
      const p = path.join(a.projektOrdner, h);
      if (fs.existsSync(p)) return p;
    }
  }
  return findeKopie(a.projektOrdner, a.sha256);
}

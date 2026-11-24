// The user's plugin folders: ~/.config/cypherdj/plugin_pfade.txt, one absolute folder per line, machine-wide (browser plan 6, task 10).
// Only the Python scan (plugin_scan.py suchwurzeln) reads it as extra scan roots for third-party plugins; it never feeds the own-bundle list.
// Writes are atomic (temp plus rename) and keep comment and blank lines and the order of every untouched line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImportFehler, loeseAuf, type Wurzel } from '../importe.ts';

/** Mirror of STANDARD_PFADE in djk/hosts/carla/plugin_scan.py (a test compares both, so they cannot drift). */
export const STANDARD_PFADE: readonly string[] = ['~/.vst3', '/usr/lib/vst3', '/usr/local/lib/vst3', '~/.lv2', '/usr/lib/lv2', '/usr/local/lib/lv2'];
export const standardPfade = (home: string = os.homedir()): string[] => STANDARD_PFADE.map((p) => (p.startsWith('~/') ? path.join(home, p.slice(2)) : p));

export class PfadeFehler extends Error {
  readonly code: number; readonly grund: string; readonly text: string;
  constructor(code: number, grund: string, text: string) { super(grund); this.code = code; this.grund = grund; this.text = text; }
}

const dateiVon = (home: string): string => path.join(home, '.config/cypherdj/plugin_pfade.txt');
export const dateiVorgabe = (home: string, datei: string | null | undefined): string => datei ?? dateiVon(home);
// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;

/** A plugin folder as the file may hold it: a string, absolute, no control character (newline included). Normalised without a trailing slash. */
export function pruefePfad(pfad: unknown): string {
  if (typeof pfad !== 'string' || pfad === '' || STEUERZEICHEN.test(pfad) || !path.isAbsolute(pfad) || pfad.trim() !== pfad)
    throw new PfadeFehler(400, 'pfad_ungueltig', 'The folder must be one absolute path without control characters.');
  return path.resolve(pfad);
}

export function pfadeDatei(home: string = os.homedir(), eigeneDatei?: string | null): { lies(): string[]; dazu(pfad: string): { schon_da: boolean }; weg(pfad: string): { entfernt: boolean }; datei: string } {
  const datei = dateiVorgabe(home, eigeneDatei);
  const text = (): string => { try { return fs.readFileSync(datei, 'utf8'); } catch { return ''; } };
  const zeilen = (): string[] => { const t = text(); return t === '' ? [] : t.replace(/\n$/, '').split('\n'); };
  const istEintrag = (z: string): boolean => { const s = z.trim(); return s !== '' && !s.startsWith('#') && path.isAbsolute(s); };
  const schreibe = (z: string[]): void => {
    fs.mkdirSync(path.dirname(datei), { recursive: true });
    const tmp = `${datei}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, z.length ? `${z.join('\n')}\n` : ''); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, datei);
    try { const d = fs.openSync(path.dirname(datei), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch { /* directory fsync is best effort */ }
  };
  return {
    datei,
    lies: () => zeilen().filter(istEintrag).map((z) => z.trim()),
    dazu(pfad) {
      const p = pruefePfad(pfad);
      const z = zeilen();
      if (z.some((l) => istEintrag(l) && l.trim() === p)) return { schon_da: true };
      schreibe([...z, p]);
      return { schon_da: false };
    },
    weg(pfad) {
      const z = zeilen();
      const rest = z.filter((l) => !(istEintrag(l) && l.trim() === pfad));
      if (rest.length === z.length) return { entfernt: false };
      schreibe(rest);
      return { entfernt: true };
    },
  };
}

const istOrdner = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const drin = (wurzel: string, p: string): boolean => p === wurzel || p.startsWith(wurzel.endsWith('/') ? wurzel : `${wurzel}/`);

/**
 * A folder Andreas may add: the same rules as the folder picker (importe.ts loeseAuf): outside the allowed roots is always 403 and is decided BEFORE
 * existence is looked at, so a refusal never tells whether a path outside the roots exists. Inside the roots it must be an existing directory
 * (not a file), never under /proc. Returns the realpath.
 */
export function pruefeOrdner(pfad: unknown, wurzeln: Wurzel[]): string {
  const p = pruefePfad(pfad);
  let real: string;
  try { real = loeseAuf(p, wurzeln); } catch (e) {
    if (!(e instanceof ImportFehler)) throw e;
    if (e.grund === 'pfad_fehlt') throw new PfadeFehler(400, 'pfad_fehlt_ordner', 'That folder does not exist, or it is a file.');
    if (e.code === 400) throw new PfadeFehler(400, 'pfad_ungueltig', 'The folder must be one absolute path without control characters.');
    throw new PfadeFehler(403, 'pfad_ausserhalb', 'Plugin folders must lie in your home folder or on a mounted drive.');
  }
  if (drin('/proc', real) || drin('/proc', p)) throw new PfadeFehler(403, 'pfad_ausserhalb', 'Plugin folders must lie in your home folder or on a mounted drive.');
  if (!istOrdner(real)) throw new PfadeFehler(400, 'pfad_fehlt_ordner', 'That folder does not exist, or it is a file.');
  return real;
}

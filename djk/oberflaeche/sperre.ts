// Sperre je Liste gegen FREMDE Prozesse (Re-Review N1 bis N4, Plan 2026-10-10-mediathek-browser S2b).
// - Innerhalb eines Prozesses braucht es keine Warteschlange: jede Änderung an einer Liste ist ein einziger synchroner Abschnitt
//   (lesen, ändern, schreiben ohne await dazwischen), also nie verschränkt. Die Sperre schützt nur vor einem zweiten Prozess
//   (Betrieb und Prüfinstanz, zwei Server) auf demselben Ordner.
// - Nie warten: belegt von einem lebenden Fremdprozess → SperreBelegt, sofort. Der Aufrufer (server.ts) wiederholt asynchron nach
//   kurzer Pause; ein blockierendes Warten im Server hielt früher die ganze Seite an.
// - Die Sperrdatei enthält {pid, start}; start ist die Startzeit des Prozesses aus /proc/<pid>/stat. Verwaist heißt: dieser Prozess
//   lebt nicht mehr (oder die PID gehört jetzt einem anderen). Die Uhr und die mtime spielen keine Rolle.
// - Anlegen: erst eine vollständige Temp-Datei, dann link() (atomar, scheitert mit EEXIST): nie eine leere Sperre sichtbar.
// - Verwaiste Sperre übernehmen: rename auf einen eigenen Namen (gelingt nur einem), dann prüfen. Hat der Weggenommene einen
//   lebenden Besitzer (ein anderer war schneller), wird die Sperre zurückgelegt und wir melden „belegt“.
import fs from 'node:fs';
import crypto from 'node:crypto';

export class SperreBelegt extends Error { constructor() { super('liste_busy'); } }

// Startzeit (Ticks seit Boot, Feld 22 von /proc/<pid>/stat); der Name kann Leerzeichen und Klammern enthalten, darum ab der letzten „)“
export function startzeit(pid: number): string | null {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch { return null; }
}

function lebt(pid: unknown, start: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return false;   // die eigene Sperre bleibt nie liegen: eine mit unserer PID ist ein Rest
  const jetzt = startzeit(pid);
  if (jetzt !== null) return typeof start === 'string' && jetzt === start;
  if (typeof start === 'string') return false;                    // /proc kennt die PID nicht mehr
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }   // ohne /proc: Signal 0
}

type Urteil = 'lebt' | 'verwaist' | 'weg';
function beurteile(pfad: string): Urteil {
  let st: fs.Stats;
  try { st = fs.lstatSync(pfad); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'weg'; throw e; }
  if (!st.isFile()) return 'verwaist';                            // Symlink, Verzeichnis, Gerät: keine Sperre, die ein Server schreibt
  let inhalt: { pid?: unknown; start?: unknown };
  try { inhalt = JSON.parse(fs.readFileSync(pfad, 'utf8')); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'weg' : 'verwaist'; }
  return inhalt !== null && typeof inhalt === 'object' && lebt(inhalt.pid, inhalt.start) ? 'lebt' : 'verwaist';
}

const eindeutig = (): string => `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;

function legeAn(pfad: string, inhalt: string): boolean {
  const tmp = `${pfad}.${eindeutig()}.neu`;
  fs.writeFileSync(tmp, inhalt, { flag: 'wx' });
  try { fs.linkSync(tmp, pfad); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  finally { fs.rmSync(tmp, { force: true }); }
}

// true: weggeräumt (oder schon weg). false: wir haben eine LEBENDE Sperre erwischt und sie zurückgelegt.
function raeumeAb(pfad: string): boolean {
  const tot = `${pfad}.tot.${eindeutig()}`;
  try { fs.renameSync(pfad, tot); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true; throw e; }
  const urteil = beurteile(tot);
  if (urteil === 'lebt') {
    try { fs.linkSync(tot, pfad); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }   // sonst hat schon ein Dritter eine neue angelegt
    fs.rmSync(tot, { force: true });
    return false;
  }
  fs.rmSync(tot, { recursive: true, force: true });
  return true;
}

// Gibt die Freigabe zurück. haken.nachUrteil nur für Tests (Verschränkung erzwingen).
export function nimmSperre(pfad: string, haken?: { nachUrteil?: () => void }): () => void {
  const meins = JSON.stringify({ pid: process.pid, start: startzeit(process.pid) });
  for (let versuch = 0; versuch < 3; versuch++) {              // fester Deckel: nie eine Endlosschleife
    if (legeAn(pfad, meins)) return () => { try { if (fs.readFileSync(pfad, 'utf8') === meins) fs.rmSync(pfad, { force: true }); } catch { /* schon weg */ } };
    const u = beurteile(pfad);
    if (u === 'lebt') throw new SperreBelegt();
    if (u === 'verwaist') { haken?.nachUrteil?.(); if (!raeumeAb(pfad)) throw new SperreBelegt(); }
  }
  throw new SperreBelegt();
}

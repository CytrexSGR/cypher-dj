// V2 Fix-Runde 2 H4: Länge der Wirt-Socket-Pfade in Tests. Ein Unix-Socket-Pfad hat höchstens 107 Bytes (sun_path 108 mit NUL). Ein längerer
// wird beim listen() gekürzt; wirt-bass.sock und wirt-melodie.sock desselben Ordners fallen dann zusammen, und der zweite listen() scheitert mit
// EADDRINUSE, ohne Hinweis auf die Ursache (Re-Review der V2-Fix-Runde 1: langer TMPDIR, sechs Wirt-Tests rot). Wer einen Wirt-Ordner für Tests
// anlegt oder bekommt, prüft ihn hier und bricht mit einer Meldung ab, die TMPDIR und die Länge nennt. Server-Code bleibt unverändert.
import os from 'node:os';
import path from 'node:path';

export const SUN_PATH_MAX = 107;
// Gruppen wie server.ts KLANG_GRUPPEN, Dateiname wie server.ts wirtSock: wirt-<gruppe>.sock
export const WIRT_SOCKETS = ['wirt-bass.sock', 'wirt-melodie.sock'];

// → der längste Socket-Pfad im Ordner und seine Länge in Bytes
export function laengsterWirtSock(ordner) {
  const pfade = WIRT_SOCKETS.map((n) => path.join(ordner, n));
  const pfad = pfade.reduce((a, b) => (Buffer.byteLength(b) > Buffer.byteLength(a) ? b : a));
  return { pfad, bytes: Buffer.byteLength(pfad) };
}

// Wirft, wenn der längste Wirt-Socket-Pfad in ordner mehr als 107 Bytes hat; sonst gibt es ordner zurück
export function pruefeWirtOrdner(ordner) {
  const { pfad, bytes } = laengsterWirtSock(ordner);
  if (bytes > SUN_PATH_MAX) {
    throw new Error(`Wirt-Socket-Pfad zu lang: ${bytes} Bytes, erlaubt sind ${SUN_PATH_MAX} (sun_path): ${pfad}. `
      + `TMPDIR=${process.env.TMPDIR ?? '(nicht gesetzt)'} (os.tmpdir() ${os.tmpdir()}, ${Buffer.byteLength(os.tmpdir())} Bytes). `
      + 'Mit diesem TMPDIR fielen wirt-bass.sock und wirt-melodie.sock zusammen (EADDRINUSE). Kürzeren TMPDIR setzen, z. B. TMPDIR=/tmp/djk-t.');
  }
  return ordner;
}

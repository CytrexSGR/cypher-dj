// Hilfen für Tests mit echten Prozessen und Ports. Kindprozesse schreiben nie auf das Terminal des
// Testlaufs (stdio als Pipe), damit kein verwaister Prozess eine Ausgabe offen hält.
import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEITSTAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Kleinster gültiger Takt-Bericht nach §14.8 (Schema aus 09); takt und phrase setzt der Test.
export const BERICHT = {
  takt: 1, phrase: 1, frist_takte: null, decks: [], deck_gegen_deck: null, ueberdeckung: null,
  summe: { lufs_takt: -18.7, spitze_dbfs: -7.2 }, plan_abweichung: null,
};

// Fix-Runde S3 R10 (A5 wackelte: 140 bis 152 von 157, alle Fehler bind EADDRINUSE 127.0.0.1:57001). Vorher banden diese Hilfen Port 0, lasen die
// Nummer und schlossen den Socket wieder. Die Nummer lag damit im flüchtigen Bereich des Kernels (ip_local_port_range, hier 32768..60999), und der
// nächste bind(0) irgendeines Prozesses (Sende-Socket der Kern-Attrappe, die zweite Abfrage im selben Test) bekam sie oft wieder (gemessen:
// 57001 → 57001; Prüfkette bekam 57001 für Vermittler UND Abo). Jetzt: zufällig UNTERHALB des flüchtigen Bereichs (dort vergibt der Kernel nie
// selbst), per ausdrücklichem bind geprüft, und in einem Testprozess nie zweimal dieselbe Nummer.
const vergeben = new Set<number>();
function fluechtigAb(): number {
  try { return Number(fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/)[0]) || 32768; } catch { return 32768; }
}
export const TEST_PORT_BEREICH = (): [number, number] => [20000, Math.min(fluechtigAb(), 32768) - 1];
async function freierPort(pruefe: (p: number) => Promise<boolean>): Promise<number> {
  const [von, bis] = TEST_PORT_BEREICH();
  for (let n = 0; n < 200; n++) {
    const p = von + Math.floor(Math.random() * (bis - von + 1));
    if (vergeben.has(p) || !(await pruefe(p))) continue;
    vergeben.add(p);
    return p;
  }
  throw new Error(`kein freier Test-Port in ${von}..${bis} nach 200 Versuchen`);
}
const tcpFrei = (p: number): Promise<boolean> => new Promise((ok) => {
  const s = net.createServer();
  s.once('error', () => ok(false));
  s.listen(p, '127.0.0.1', () => s.close(() => ok(true)));
});
const udpFrei = (p: number): Promise<boolean> => new Promise((ok) => {
  const s = dgram.createSocket('udp4');
  s.once('error', () => { s.close(); ok(false); });
  s.bind(p, '127.0.0.1', () => s.close(() => ok(true)));
});
export const freierTcpPort = (): Promise<number> => freierPort(tcpFrei);
export const freierUdpPort = (): Promise<number> => freierPort(udpFrei);

export interface Kind { p: ChildProcess; aus: () => string; err: () => string }

// Kindprozesse der Tests laufen ohne CYPHERDJ_INSTANZ: die Tests geben ihre Ports ausdrücklich vor, und eine in der
// Shell gesetzte Prüfinstanz (export CYPHERDJ_INSTANZ=c) verschöbe sie sonst um 1000·k.
export function ohneInstanz(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { CYPHERDJ_INSTANZ: _weg, ...rest } = env;
  return rest;
}

// Startet ein Skript (Pfad relativ zu djk/leitstand/) mit node und wartet, bis seine Ausgabe `bereit` enthält.
// Die Kern-Attrappe startet nur mit eigener --konfig (Paket K3, Befund 16.10.): ohne sie liest sie die echte
// ~/.config/cypherdj/kern.toml des Nutzers, und ein Test hinge am Betrieb (A5 war so seit dem 09.10. rot: 15 von 157,
// „unbekannter Schlüssel keylock_maschine“).
export function starte(skript: string, args: string[], bereit: string, env: NodeJS.ProcessEnv = ohneInstanz()): Promise<Kind> {
  if (path.basename(skript) === 'attrappe_kern.mjs' && !args.includes('--konfig'))
    return Promise.reject(new Error('attrappe_kern.mjs ohne --konfig: der Test läse die echte kern.toml des Nutzers'));
  return new Promise((ok, fehler) => {
    const p = spawn(process.execPath, [path.resolve(LEITSTAND, skript), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let aus = '';
    let err = '';
    let da = false;
    p.stdout!.on('data', (d) => {
      aus += d;
      if (!da && aus.includes(bereit)) { da = true; ok({ p, aus: () => aus, err: () => err }); }
    });
    p.stderr!.on('data', (d) => { err += d; });
    p.once('exit', (code) => { if (!da) fehler(new Error(`${skript} endete mit ${code}: ${err}`)); });
  });
}

// Beendet ein Kind sicher, auch wenn es gerade per SIGSTOP steht.
export async function beende(k: Kind | undefined, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
  if (!k || k.p.exitCode !== null || k.p.signalCode !== null) return;
  const weg = new Promise((ok) => k.p.once('exit', ok));
  k.p.kill('SIGCONT');
  k.p.kill(signal);
  await weg;
}

export const warte = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

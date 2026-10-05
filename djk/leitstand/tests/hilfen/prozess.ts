// Hilfen für Tests mit echten Prozessen und Ports. Kindprozesse schreiben nie auf das Terminal des
// Testlaufs (stdio als Pipe), damit kein verwaister Prozess eine Ausgabe offen hält.
import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEITSTAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Kleinster gültiger Takt-Bericht nach §14.8 (Schema aus 09); takt und phrase setzt der Test.
export const BERICHT = {
  takt: 1, phrase: 1, frist_takte: null, decks: [], deck_gegen_deck: null, ueberdeckung: null,
  summe: { lufs_takt: -18.7, spitze_dbfs: -7.2 }, plan_abweichung: null,
};

export function freierTcpPort(): Promise<number> {
  return new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });
}

export function freierUdpPort(): Promise<number> {
  return new Promise((ok) => {
    const s = dgram.createSocket('udp4');
    s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

export interface Kind { p: ChildProcess; aus: () => string; err: () => string }

// Kindprozesse der Tests laufen ohne CYPHERDJ_INSTANZ: die Tests geben ihre Ports ausdrücklich vor, und eine in der
// Shell gesetzte Prüfinstanz (export CYPHERDJ_INSTANZ=c) verschöbe sie sonst um 1000·k.
export function ohneInstanz(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { CYPHERDJ_INSTANZ: _weg, ...rest } = env;
  return rest;
}

// Startet ein Skript (Pfad relativ zu djk/leitstand/) mit node und wartet, bis seine Ausgabe `bereit` enthält.
export function starte(skript: string, args: string[], bereit: string, env: NodeJS.ProcessEnv = ohneInstanz()): Promise<Kind> {
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

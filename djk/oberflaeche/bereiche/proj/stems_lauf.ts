// Package 1.13 slice 6 (D2): ONE stem run as a child process (nice 19, ionice -c3; GPU only since 2026-11-06,
// plan stems-roformer-gpu D2). Liest @@fortschritt (stderr, mediathek.ts:497) und die eine
// Ergebniszeile (stdout). abbrechen(): SIGTERM, nach killMs SIGKILL. Den Temp-Ordner räumt der Bereich (er weiß, wann).
import { spawn, type ChildProcess } from 'node:child_process';
import { cpuTicksBaum, liesFortschrittsZeichen } from '../../mediathek.ts';

// D18, AK26 2026-11-04: 4 threads raised the set p99.9 by ~600 us, 2 by 156 us (limit 200); Andreas: "Ok"
// (~/messungen/2026-11-04-ak26-faeden/)
export const STEMS_THREADS = 2;
// AK26 follow-up (2026-10-31, Andreas "yes, separate cores"): demucs runs apart from the real-time kern (djk-start KERN_CPUS). Measured on 2026-10-31
// with demucs on 2-7,10-15 and the kern on 0,1,8,9: p99.9 increase +894 -> +572 us, longest tick under 2500 us (~/messungen/2026-10-31-w6-last-pin/).
// Multi-core spec 2026-11-06: djk-start computes the cores from the topology (kerne.py, CYPHERDJ_KERN_KERNE = 4) and hands them to this page as
// CYPHERDJ_STEMS_CPUS. Without that variable there is NO mask: a fixed list would name CPUs a smaller machine does not have (taskset fails there),
// and the right split only exists in kerne.py. The new split is NOT MEASURED (smaller mask than the measurement).
export const STEMS_CPUS = process.env.CYPHERDJ_STEMS_CPUS || '';
// The command line of a run: `taskset -c <mask> nice ...` with a mask, plain `nice ...` without one.
export function stemsBefehl(cpus: string, rest: string[]): { cmd: string; args: string[] } {
  return cpus.trim() ? { cmd: 'taskset', args: ['-c', cpus.trim(), ...rest] } : { cmd: rest[0], args: rest.slice(1) };
}
export interface StemsLaufOptionen { python: string; cwd: string; modul?: string; gewichte?: string; zusatzArgs?: string[]; killMs?: number }
export interface StemsAuftrag { quelle: string; f0: number; f1: number; aus: string }
export interface StemsErgebnis { rc: number | null; signal: string | null; zeile: Record<string, unknown> | null; fehl: string }

export class StemsLauf {
  private readonly kind: ChildProcess;
  private killUhr: NodeJS.Timeout | null = null;
  readonly fertig: Promise<StemsErgebnis>;
  constructor(o: StemsLaufOptionen, a: StemsAuftrag, melde: (stufe: string, prozent: number | null) => void) {
    const befehl = ['nice', '-n', '19', 'ionice', '-c3', o.python, '-m', o.modul ?? 'werkstatt.stems',
      '--quelle', a.quelle, '--f0', String(a.f0), '--f1', String(a.f1), '--aus', a.aus, '--threads', String(STEMS_THREADS),
      ...(o.gewichte ? ['--gewichte', o.gewichte] : []), ...(o.zusatzArgs ?? [])];
    const { cmd, args } = stemsBefehl(STEMS_CPUS, befehl);
    // the run sees the one GPU; its CPU side stays on the stems mask from djk-start because the job feeds the GPU from it (detached: own process group)
    this.kind = spawn(cmd, args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, CUDA_VISIBLE_DEVICES: '0', OMP_NUM_THREADS: String(STEMS_THREADS) } });
    let aus = '', fehl = '', rest = '';
    this.kind.stdout!.on('data', (d: Buffer) => { aus += d; if (aus.length > 65536) aus = aus.slice(-32768); });
    this.kind.stderr!.on('data', (d: Buffer) => {
      fehl += d; if (fehl.length > 65536) fehl = fehl.slice(-32768);
      const zeilen = (rest + d.toString('utf8')).split('\n'); rest = zeilen.pop() ?? '';
      for (const z of zeilen) for (const f of liesFortschrittsZeichen(z)) melde(f.name, f.prozent);
    });
    this.fertig = new Promise((ok) => {
      this.kind.on('error', (e) => ok({ rc: null, signal: null, zeile: null, fehl: String(e) }));
      this.kind.on('close', (rc, signal) => {
        if (this.killUhr) clearTimeout(this.killUhr);
        let zeile: Record<string, unknown> | null = null;
        try { const j = JSON.parse(aus.trim().split('\n').pop() ?? ''); if (j && typeof j === 'object') zeile = j; } catch { /* keine Ergebniszeile */ }
        ok({ rc, signal, zeile, fehl: fehl.slice(-2000) });
      });
    });
  }
  get pid(): number | undefined { return this.kind.pid; }
  // Lebenszeichen (D2): CPU-Sekunden des Prozessbaums (Ticks / 100, CLK_TCK des Arbeitsrechners)
  cpuSekunden(): number | null { const t = this.kind.pid ? cpuTicksBaum(this.kind.pid) : null; return t === null ? null : Math.round(t) / 100; }
  // Serverstopp: sofort SIGKILL an die ganze Prozessgruppe (kein Timer, der beim Exit des Servers nicht mehr feuert)
  toete(): void {
    if (this.kind.exitCode !== null || this.kind.signalCode !== null || !this.kind.pid) return;
    try { process.kill(-this.kind.pid, 'SIGKILL'); } catch { this.kind.kill('SIGKILL'); }
  }
  abbrechen(killMs: number): void {
    if (this.kind.exitCode !== null || this.kind.signalCode !== null) return;
    this.kind.kill('SIGTERM');
    this.killUhr = setTimeout(() => this.kind.kill('SIGKILL'), killMs);
  }
}

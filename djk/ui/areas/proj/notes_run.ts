// Note editor (slice 1, task B2): ONE child process of the note detection as a generic runner (after StemsLauf in stems_run.ts). It runs a command line
// (`cypherdj-noten analyse ...`, `cypherdj-noten pruefe ...`, the network module), reads the progress lines on stderr (`@@fortschritt`,
// liesFortschrittsZeichen)
// and the one result line on stdout, and can be asked to stop: SIGTERM, SIGKILL after killMs. The folders of a run belong to the caller (it knows when).
// The command line is built by stemsBefehl(STEMS_CPUS, [nice -n 19, ionice -c3, ...]): the CPU mask from djk-start keeps the real-time cores free, and
// without a mask there is no taskset. The child is its own process group (detached), so a kill takes its children with it.
import { spawn as echtSpawn, type ChildProcess } from 'node:child_process';
import { cpuTicksBaum, liesFortschrittsZeichen } from '../../media_library.ts';
import { STEMS_CPUS, stemsBefehl } from './stems_run.ts';

export type NotenFortschrittZeile = ReturnType<typeof liesFortschrittsZeichen>[number];
export interface NotenErgebnis { rc: number | null; signal: string | null; zeile: Record<string, unknown> | null; fehl: string }
export interface NotenLaufOptionen {
  cwd: string;
  omp: number;                                  // OMP_NUM_THREADS of the child: 1 for cypherdj-noten, 2 for the network module
  env?: Record<string, string | undefined>;     // extra variables on top of the server's (a test steers its stand-ins with them)
  cpus?: string;                                // CPU mask; default CYPHERDJ_STEMS_CPUS as read at server start
  spawn?: typeof echtSpawn;                     // test: look at the command line instead of running it
}

/** The command line of a run: the program and its arguments behind `taskset -c <mask> nice -n 19 ionice -c3` (no taskset without a mask) */
export function notenBefehl(programmUndArgs: string[], cpus: string = STEMS_CPUS): { cmd: string; args: string[] } {
  return stemsBefehl(cpus, ['nice', '-n', '19', 'ionice', '-c3', ...programmUndArgs]);
}

export class NotenLauf {
  private readonly kind: ChildProcess;
  private killUhr: NodeJS.Timeout | null = null;
  readonly fertig: Promise<NotenErgebnis>;
  constructor(programmUndArgs: string[], o: NotenLaufOptionen, melde: (f: NotenFortschrittZeile) => void) {
    const { cmd, args } = notenBefehl(programmUndArgs, o.cpus ?? STEMS_CPUS);
    this.kind = (o.spawn ?? echtSpawn)(cmd, args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, ...(o.env ?? {}), OMP_NUM_THREADS: String(o.omp) } });
    let aus = '', fehl = '', rest = '';
    this.kind.stdout!.on('data', (d: Buffer) => { aus += d; if (aus.length > 65536) aus = aus.slice(-32768); });
    this.kind.stderr!.on('data', (d: Buffer) => {
      fehl += d; if (fehl.length > 65536) fehl = fehl.slice(-32768);
      const zeilen = (rest + d.toString('utf8')).split('\n'); rest = zeilen.pop() ?? '';
      for (const z of zeilen) for (const f of liesFortschrittsZeichen(z)) melde(f);
    });
    this.fertig = new Promise((ok) => {
      this.kind.on('error', (e) => ok({ rc: null, signal: null, zeile: null, fehl: String(e) }));
      this.kind.on('close', (rc, signal) => {
        if (this.killUhr) clearTimeout(this.killUhr);
        let zeile: Record<string, unknown> | null = null;
        try { const j = JSON.parse(aus.trim().split('\n').pop() ?? ''); if (j && typeof j === 'object' && !Array.isArray(j)) zeile = j;
          } catch { /* no result line */ }
        ok({ rc, signal, zeile, fehl: fehl.slice(-2000) });
      });
    });
  }
  get pid(): number | undefined { return this.kind.pid; }
  /** Sign of life: CPU seconds of the process tree (ticks / 100) */
  cpuSekunden(): number | null { const t = this.kind.pid ? cpuTicksBaum(this.kind.pid) : null; return t === null ? null : Math.round(t) / 100; }
  /** Server stop: SIGKILL to the whole process group at once (no timer that would not fire when the server exits) */
  toete(): void {
    if (this.kind.exitCode !== null || this.kind.signalCode !== null || !this.kind.pid) return;
    try { process.kill(-this.kind.pid, 'SIGKILL'); } catch { this.kind.kill('SIGKILL'); }
  }
  /** SIGTERM, and SIGKILL to the group after killMs when the child is still there */
  abbrechen(killMs: number): void {
    if (this.kind.exitCode !== null || this.kind.signalCode !== null || this.killUhr) return;
    this.kind.kill('SIGTERM');
    this.killUhr = setTimeout(() => { try { if (this.kind.pid) process.kill(-this.kind.pid, 'SIGKILL'); } catch { this.kind.kill('SIGKILL'); } }, killMs);
  }
}

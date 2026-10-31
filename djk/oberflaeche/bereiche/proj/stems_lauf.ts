// Paket 1.13 Slice 6 (D2): EIN Stems-Lauf als Kindprozess (nice 19, ionice -c3, nur CPU: P4). Liest @@fortschritt (stderr, mediathek.ts:497) und die eine
// Ergebniszeile (stdout). abbrechen(): SIGTERM, nach killMs SIGKILL. Den Temp-Ordner räumt der Bereich (er weiß, wann).
import { spawn, type ChildProcess } from 'node:child_process';
import { cpuTicksBaum, liesFortschrittsZeichen } from '../../mediathek.ts';

export const STEMS_THREADS = 4;                                                 // D18
// AK26-Nachzug (2026-10-31, Andreas „ja getrennte kerne“): demucs nur auf den Kernen 2 bis 7 (CPU 2-7, 10-15); die Kerne 0 und 1 hält der
// Echtzeit-Kern (djk-start KERN_CPUS). Gemessen: p99,9-Zuwachs +894 → +572 µs, längster Takt unter 2500 µs (~/messungen/2026-10-31-w6-last-pin/).
export const STEMS_CPUS = process.env.CYPHERDJ_STEMS_CPUS || '2-7,10-15';
export interface StemsLaufOptionen { python: string; cwd: string; modul?: string; gewichte?: string; zusatzArgs?: string[]; killMs?: number }
export interface StemsAuftrag { quelle: string; f0: number; f1: number; aus: string; geraet?: 'cpu' | 'gpu' }
export interface StemsErgebnis { rc: number | null; signal: string | null; zeile: Record<string, unknown> | null; fehl: string }

export class StemsLauf {
  private readonly kind: ChildProcess;
  private killUhr: NodeJS.Timeout | null = null;
  readonly fertig: Promise<StemsErgebnis>;
  constructor(o: StemsLaufOptionen, a: StemsAuftrag, melde: (stufe: string, prozent: number | null) => void) {
    const args = ['-c', STEMS_CPUS, 'nice', '-n', '19', 'ionice', '-c3', o.python, '-m', o.modul ?? 'werkstatt.stems', '--quelle', a.quelle, '--f0', String(a.f0), '--f1', String(a.f1),
      '--aus', a.aus, '--threads', String(STEMS_THREADS), '--geraet', a.geraet ?? 'cpu', ...(o.gewichte ? ['--gewichte', o.gewichte] : []), ...(o.zusatzArgs ?? [])];
    this.kind = spawn('taskset', args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, CUDA_VISIBLE_DEVICES: a.geraet === 'gpu' ? '0' : '', OMP_NUM_THREADS: String(STEMS_THREADS) } });   // P4: CPU-Lauf sieht keine GPU (detached: eigene Gruppe)
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

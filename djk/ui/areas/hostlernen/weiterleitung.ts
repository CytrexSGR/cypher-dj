// Host learn: the forwarding. A slot row `erz/2|3/bk/<n>` that has a host mapping and moves by CC (/e/hand: first and last event of a gesture, at most 20 Hz in
// between) moves the host parameter instead of a graph knob. Not while a Baukasten graph is loaded on the channel (then the row belongs to the graph).
// Surge takes display values: `fahre {name, bis, von, dauer 0.05}`; `von` is ALWAYS sent (without it the wirt reads the whole plug-in state and blocks its loop).
// RB-338 and other VST3 hosts take the normalised value: `param {name, wert}`. Per parameter at most one command is in flight; what arrives meanwhile
// replaces the waiting value (the latest wins), so a burst costs the first and the last value only.
import type { HostBruecke } from '../../http/router.ts';
import { anzeigeWert, type Parameter } from '../../devices_parameter.ts';
import { slotKanal, type HostZiel } from './store.ts';

export const FAHRT_DAUER_S = 0.05;   // one hand event interval (20 Hz): the ramp bridges the steps of the throttled stream

const klemme = (x: number): number => Math.min(1, Math.max(0, x));

/** Travel 0..1 of a display value (inverse of anzeigeWert for the `punkte` curve and the linear range). */
export function normVonAnzeige(p: Parameter, wert: number): number {
  const q = p.punkte;
  if (q && q.length >= 2) {
    const n = q.length - 1;
    for (let i = 0; i < n; i++) {
      const a = q[i] as number, b = q[i + 1] as number;
      if (wert >= Math.min(a, b) && wert <= Math.max(a, b)) return klemme((i + (b === a ? 0 : (wert - a) / (b - a))) / n);
    }
    return wert < Math.min(q[0] as number, q[n] as number) ? ((q[0] as number) <= (q[n] as number) ? 0 : 1) : ((q[0] as number) <= (q[n] as number) ? 1 : 0);
  }
  return p.max === p.min ? 0 : klemme((wert - p.min) / (p.max - p.min));
}

interface Stand { laeuft: boolean; neu: number | null; von: number | null }
export interface WeiterleitungOptionen {
  host: () => HostBruecke | undefined;
  ziele: () => Record<string, HostZiel>;
  geladen: () => Record<string, string>;          // channel -> graph name (stand.graphen_geladen)
  surgeParameter: (name: string) => Parameter | undefined;
  log: (zeile: Record<string, unknown>) => void;
}

export class Weiterleitung {
  private readonly stand = new Map<string, Stand>();
  private readonly o: WeiterleitungOptionen;
  constructor(o: WeiterleitungOptionen) { this.o = o; }

  /** The last display value known for a slot (set when it is learned, so the first ramp starts from the real value). */
  merke(pfad: string, anzeige: number | null): void { this.zustand(pfad).von = anzeige; }
  vergiss(pfad: string): void { this.stand.delete(pfad); }

  private zustand(pfad: string): Stand {
    let s = this.stand.get(pfad);
    if (!s) { s = { laeuft: false, neu: null, von: null }; this.stand.set(pfad, s); }
    return s;
  }

  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse !== '/e/hand' || typeof f.pfad !== 'string') return;
    const kanal = slotKanal(f.pfad);
    if (kanal === null) return;
    const ziel = this.o.ziele()[f.pfad];
    if (!ziel) return;
    const wert = Number(f.wert);
    if (!Number.isFinite(wert)) return;
    if ((this.o.geladen()[kanal] ?? '') !== '') return;   // a graph is loaded: the row belongs to its knob
    const s = this.zustand(f.pfad);
    if (s.laeuft) { s.neu = klemme(wert); return; }   // coalesce: the running command is followed by the latest value
    s.laeuft = true;
    void this.lauf(f.pfad, ziel, s, klemme(wert));
  }

  private async lauf(pfad: string, ziel: HostZiel, s: Stand, erst: number): Promise<void> {
    let n: number | null = erst;
    try {
      while (n !== null) {
        s.neu = null;
        await this.sende(pfad, ziel, s, n);
        n = s.neu;
      }
    } finally { s.laeuft = false; }
  }

  private async sende(pfad: string, ziel: HostZiel, s: Stand, norm: number): Promise<void> {
    const host = this.o.host();
    if (!host) return;
    let befehl: Record<string, unknown>;
    let anzeige: number | null = null;
    if (ziel.art === 'surge') {
      const p = this.o.surgeParameter(ziel.name);
      if (!p) { this.o.log({ typ: 'hostlernen_fehler', pfad, fehler: `${ziel.name} is not a Surge parameter` }); return; }
      anzeige = anzeigeWert(p, norm);
      befehl = { befehl: 'fahre', name: ziel.name, bis: anzeige, von: s.von ?? anzeige, dauer: FAHRT_DAUER_S, spur: `klang-${ziel.gruppe}`, form: 'linear' };
    } else befehl = { befehl: 'param', name: ziel.name, wert: norm };
    try {
      const r = await host.ruf(ziel.gruppe, befehl);
      if (!r.ok) { this.o.log({ typ: 'hostlernen_fehler', pfad, fehler: String(r.fehler ?? 'wirt refused') }); return; }
      if (anzeige !== null) s.von = anzeige;
    } catch (e) { this.o.log({ typ: 'hostlernen_fehler', pfad, fehler: (e as Error)?.message ?? String(e) }); }
  }
}

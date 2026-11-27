// Strand 2 slice 2 task 2.3: forwards the moves of the knob rows `plug/<h>/k<m>` (/e/hand) to the plugin parameter that knob m of host stage h drives
// (`Insert.regler[m-1]`). Pattern of areas/hostlernen/weiterleitung.ts: per (insert, index) at most one call in flight, the latest value wins.
// A plugin lane on the same index wins while the transport plays (as chain lanes do). Pickup: the rows are set to the plugin's current values.
import { alleInserts, pluginLanen, type Projekt } from '../project/model.ts';

export const KNOPF_PFAD = /^plug\/([1-8])\/k([1-9]|1[0-6])$/;

interface Antwort { ok: boolean; fehler?: string }
export interface ReglerAbhaengig {
  projekt(): Projekt | null;
  /** the user path of the host manager (`HostVerwaltung.param`: marks the plugin state for saving) */
  param(insertId: string, werte: Record<string, number>): Promise<Antwort>;
  /** `HostVerwaltung.parameter`: the plugin's parameters, each with its current value 0..1 */
  parameter(insertId: string): Promise<{ ok: true; parameter: Record<string, unknown>[] } | { ok: false; fehler: string }>;
  /** the host bridge's `setzeRegler`: a core row to a value (the pickup) */
  setzeRegler(pfad: string, wert: number): Promise<unknown>;
  /** the lane player is running (the transport plays) */
  spielt(): boolean;
  log(zeile: Record<string, unknown>): void;
}
interface Stand { laeuft: boolean; neu: number | null }

const klemme = (x: number): number => Math.min(1, Math.max(0, x));

export class ReglerWeiterleitung {
  private readonly dep: ReglerAbhaengig;
  private readonly stand = new Map<string, Stand>();   // `${insert}.${index}`
  constructor(dep: ReglerAbhaengig) { this.dep = dep; }

  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse !== '/e/hand' || typeof f.pfad !== 'string') return;
    const m = KNOPF_PFAD.exec(f.pfad);
    if (!m) return;
    const wert = Number(f.wert);
    if (!Number.isFinite(wert)) return;
    const p = this.dep.projekt();
    const x = p ? alleInserts(p).find((i) => i.insert.art === 'host' && i.insert.slot === Number(m[1])) : undefined;
    const index = x?.insert.regler?.[Number(m[2]) - 1];
    if (!x || typeof index !== 'number') return;
    if (this.dep.spielt() && pluginLanen(x.strang, x.insert.id).some((l) => l.ziel === `plugin.${x.insert.id}.${index}`)) return;   // the lane wins
    const schluessel = `${x.insert.id}.${index}`;
    let s = this.stand.get(schluessel);
    if (!s) { s = { laeuft: false, neu: null }; this.stand.set(schluessel, s); }
    if (s.laeuft) { s.neu = klemme(wert); return; }   // coalesce: the running call is followed by the latest value
    s.laeuft = true;
    void this.lauf(x.insert.id, index, s, klemme(wert));
  }

  private async lauf(insertId: string, index: number, s: Stand, erst: number): Promise<void> {
    let n: number | null = erst;
    try {
      while (n !== null) {
        s.neu = null;
        try {
          const r = await this.dep.param(insertId, { [String(index)]: n });
          if (!r.ok) this.dep.log({ typ: 'plugin_regler_fehler', insert: insertId, index, fehler: r.fehler ?? 'refused' });
        } catch (e) { this.dep.log({ typ: 'plugin_regler_fehler', insert: insertId, index, fehler: (e as Error)?.message ?? String(e) }); }
        n = s.neu;
      }
    } finally { s.laeuft = false; }
  }

  /** Sets every assigned knob row of the stage to the plugin's current value, so an absolute controller continues from there. */
  async pickup(insertId: string): Promise<void> {
    const p = this.dep.projekt();
    const x = p ? alleInserts(p).find((i) => i.insert.id === insertId && i.insert.art === 'host') : undefined;
    const regler = x?.insert.regler;
    if (!x || !regler?.some((i) => typeof i === 'number')) return;
    const r = await this.dep.parameter(insertId);
    if (!r.ok) return;
    const werte = new Map(r.parameter.map((q) => [Number(q.index), q.wert] as const));
    await Promise.all(regler.map(async (index, m) => {
      const w = typeof index === 'number' ? werte.get(index) : undefined;
      if (typeof w !== 'number' || !Number.isFinite(w)) return;
      try { await this.dep.setzeRegler(`plug/${x.insert.slot}/k${m + 1}`, klemme(w)); } catch (e) {
        this.dep.log({ typ: 'plugin_regler_pickup_fehler', insert: insertId, knopf: m + 1, fehler: (e as Error)?.message ?? String(e) });
      }
    }));
  }
}

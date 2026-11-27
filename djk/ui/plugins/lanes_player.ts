// Plays the plugin parameter lanes (`plugin.<host stage id>.<index>`, plan strand 2 slice 1): on every `/zustand/arr` while the transport runs the lane
// values are evaluated one tick ahead and handed to the host manager. The core never sees these lanes. Not sample-accurate (plan section 0.4).
import { alleStraenge, pluginZielVon, type Projekt } from '../project/model.ts';
import { laneWert } from '../project/lane.ts';

/** one tick ahead (20 ms at 48 kHz, 960 samples): a value lands within about +/- 10 ms of its beat, see plan strand 2 section 0.4 */
export const VORLAUF_S = 0.02;
const AENDERUNG = 1e-4, SPRUNG_BEATS = 1;

export interface LanenAbhaengig {
  projekt(): Projekt | null;
  /** beats per second at the current position */
  beatsProSekunde(beat: number): number;
  senden(insertId: string, werte: Record<string, number>): void;
}

export class PluginLanenSpieler {
  private readonly dep: LanenAbhaengig;
  private zuletzt = new Map<string, number>();   // `${insert}.${index}` -> last value sent
  private letzterBeat: number | null = null;

  constructor(dep: LanenAbhaengig) { this.dep = dep; }

  /** the transport plays (the last `/zustand/arr` said so): plugin lanes are in charge of their parameters */
  spielt(): boolean { return this.letzterBeat !== null; }

  zustand(f: Record<string, unknown>): void {
    if (Number(f.status) !== 2) { this.zuletzt.clear(); this.letzterBeat = null; return; }
    const jetzt = Number(f.projekt_beat);
    if (!Number.isFinite(jetzt)) return;
    if (this.letzterBeat === null || jetzt < this.letzterBeat || jetzt - this.letzterBeat > SPRUNG_BEATS) this.zuletzt.clear();   // start, wrap or jump
    this.letzterBeat = jetzt;
    const p = this.dep.projekt();
    if (!p) return;
    const beat = jetzt + VORLAUF_S * this.dep.beatsProSekunde(jetzt);
    const aus = new Map<string, Record<string, number>>();
    for (const { strang } of alleStraenge(p)) {
      for (const l of strang.automation ?? []) {
        const z = pluginZielVon(l.ziel);
        if (!z || !strang.inserts?.some((i) => i.id === z.insert && i.art === 'host') || l.punkte.length === 0) continue;
        const w = laneWert(l.punkte, beat, l.ziel);
        const schluessel = `${z.insert}.${z.index}`, alt = this.zuletzt.get(schluessel);
        if (alt !== undefined && Math.abs(alt - w) <= AENDERUNG) continue;
        this.zuletzt.set(schluessel, w);
        const m = aus.get(z.insert) ?? {};
        m[String(z.index)] = w;
        aus.set(z.insert, m);
      }
    }
    for (const [id, werte] of aus) this.dep.senden(id, werte);
  }
}

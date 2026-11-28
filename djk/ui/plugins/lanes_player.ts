// Plays the plugin parameter lanes (`plugin.<host stage id>.<index>`, plan strand 2 slice 1): on every `/zustand/arr` while the transport runs the lane
// values are evaluated one tick ahead and handed to the host manager. The core never sees these lanes. Not sample-accurate (plan section 0.4).
import { alleStraenge, pluginZielVon, type Projekt } from '../project/model.ts';
import { laneWert } from '../project/lane.ts';
import { modVersatz, modWert } from '../project/mod_formula.ts';

/** one tick ahead (20 ms at 48 kHz, 960 samples): a value lands within about +/- 10 ms of its beat, see plan strand 2 section 0.4 */
export const VORLAUF_S = 0.02;
const AENDERUNG = 1e-4, SPRUNG_BEATS = 1;

export interface LanenAbhaengig {
  projekt(): Projekt | null;
  /** beats per second at the current position */
  beatsProSekunde(beat: number): number;
  senden(insertId: string, werte: Record<string, number>): void;
  /** strand 6 task 4.3: the plugin's current value of one parameter (0..1) when a modulated parameter has no lane and no value is known yet; optional */
  parameterWert?(insertId: string, index: number): Promise<number | undefined>;
  /** clock in ms (tests); default Date.now */
  jetzt?(): number;
}

/** strand 6 task 4.3: no `/zustand/mod` for this long: the modulator is treated as gone, the base goes out once */
export const MOD_FRIST_MS = 500;
/** the modulation timer while the transport stands (50 Hz) */
export const MOD_TAKT_MS = 20;
const klemme01 = { min: 0, max: 1 };

interface ModZielPlugin { insert: string; index: number; versatz: number | null }   // versatz null: a modulator of it fell silent

export class PluginLanenSpieler {
  private readonly dep: LanenAbhaengig;
  private zuletzt = new Map<string, number>();   // `${insert}.${index}` -> last value sent
  private letzterBeat: number | null = null;
  private readonly modAus = new Map<number, { wert: number; ms: number }>();   // nr -> the latest /zustand/mod output and when it came
  private readonly basis = new Map<string, number>();                          // `${insert}.${index}` -> the unmodulated value (lane, knob, plugin)
  private readonly basisFrage = new Set<string>();
  private modTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dep: LanenAbhaengig) { this.dep = dep; }

  /** the transport plays (the last `/zustand/arr` said so): plugin lanes are in charge of their parameters */
  spielt(): boolean { return this.letzterBeat !== null; }

  zustand(f: Record<string, unknown>): void {
    if (Number(f.status) !== 2) { this.zuletzt.clear(); this.letzterBeat = null; this.modPruefen(); return; }
    const jetzt = Number(f.projekt_beat);
    if (!Number.isFinite(jetzt)) return;
    if (this.letzterBeat === null || jetzt < this.letzterBeat || jetzt - this.letzterBeat > SPRUNG_BEATS) this.zuletzt.clear();   // start, wrap or jump
    this.letzterBeat = jetzt;
    const p = this.dep.projekt();
    if (!p) return;
    const beat = jetzt + VORLAUF_S * this.dep.beatsProSekunde(jetzt);
    const aus = new Map<string, Record<string, number>>();
    const modZiele = this.modZiele(p);
    const mitLane = new Set<string>();
    this.modPruefen();
    for (const { strang } of alleStraenge(p)) {
      for (const l of strang.automation ?? []) {
        const z = pluginZielVon(l.ziel);
        if (!z || !strang.inserts?.some((i) => i.id === z.insert && i.art === 'host') || l.punkte.length === 0) continue;
        const roh = laneWert(l.punkte, beat, l.ziel);
        const schluessel = `${z.insert}.${z.index}`, alt = this.zuletzt.get(schluessel);
        this.basis.set(schluessel, roh);
        mitLane.add(schluessel);
        const v = modZiele.get(schluessel)?.versatz;
        const w = v === undefined || v === null ? roh : modWert(roh, v, klemme01);
        if (alt !== undefined && Math.abs(alt - w) <= AENDERUNG) continue;
        this.zuletzt.set(schluessel, w);
        const m = aus.get(z.insert) ?? {};
        m[String(z.index)] = w;
        aus.set(z.insert, m);
      }
    }
    this.modSchritt(modZiele, mitLane, aus);
    for (const [id, werte] of aus) this.dep.senden(id, werte);
  }

  /** `/zustand/mod` (strand 6): the core's output of modulator `nr` (-1..1 before depth; the follower 0..1) */
  mod(f: Record<string, unknown>): void {
    const nr = Number(f.nr), wert = Number(f.wert);
    if (!Number.isFinite(nr) || !Number.isFinite(wert)) return;
    this.modAus.set(nr, { wert, ms: this.jetzt() });
    this.modPruefen();
  }

  /** a basis that the server learned from elsewhere (the knob rows forward a value to the plugin): the modulation swings around it */
  basisSetzen(insertId: string, werte: Record<string, number>): void {
    for (const [i, w] of Object.entries(werte)) if (Number.isFinite(w)) this.basis.set(`${insertId}.${i}`, w);
  }

  modTimerLaeuft(): boolean { return this.modTimer !== null; }

  /** stops the timer (shutdown) */
  halt(): void { if (this.modTimer) { clearInterval(this.modTimer); this.modTimer = null; } }

  /** one modulation step while the transport stands (the timer; while it plays `zustand` carries the modulation) */
  modTick(): void {
    if (this.letzterBeat !== null) return;
    const p = this.dep.projekt();
    if (!p) return;
    const aus = new Map<string, Record<string, number>>();
    this.modSchritt(this.modZiele(p), new Set(), aus);
    for (const [id, werte] of aus) this.dep.senden(id, werte);
  }

  private jetzt(): number { return this.dep.jetzt ? this.dep.jetzt() : Date.now(); }

  /** the 50 Hz timer exists only while a switched-on modulator has a plugin target and the transport stands */
  private modPruefen(): void {
    const p = this.dep.projekt();
    const noetig = this.letzterBeat === null && !!p && this.modZiele(p).size > 0;
    if (noetig && !this.modTimer) { this.modTimer = setInterval(() => this.modTick(), MOD_TAKT_MS); this.modTimer.unref?.(); }
    else if (!noetig && this.modTimer) { clearInterval(this.modTimer); this.modTimer = null; }
  }

  /** every plugin parameter that a switched-on modulator drives, with the summed offset (null: a contributing modulator has no fresh output) */
  private modZiele(p: Projekt): Map<string, ModZielPlugin> {
    const aus = new Map<string, ModZielPlugin>();
    const jetzt = this.jetzt();
    for (const m of p.modulatoren ?? []) {
      if (m.an === false) continue;
      const o = this.modAus.get(m.nr);
      for (const z of m.ziele) {
        const pz = pluginZielVon(z.ziel);
        if (!pz) continue;
        const strang = alleStraenge(p).find((x) => x.strang.id === z.strang_id)?.strang;
        if (!strang?.inserts?.some((i) => i.id === pz.insert && i.art === 'host')) continue;
        const schluessel = `${pz.insert}.${pz.index}`;
        const alt = aus.get(schluessel);
        const frisch = o !== undefined && jetzt - o.ms <= MOD_FRIST_MS;
        const v = !frisch ? null : m.art === 'folger' ? z.tiefe * o.wert : modVersatz(o.wert, z.tiefe, z.polaritaet === 'uni');
        const summe = alt === undefined ? v : alt.versatz === null || v === null ? null : alt.versatz + v;
        aus.set(schluessel, { insert: pz.insert, index: pz.index, versatz: o === undefined ? null : summe });
      }
    }
    return aus;
  }

  /** sends base + offset for the modulated parameters that no lane carries this tick (unchanged values are not resent); a silent modulator: the base once */
  private modSchritt(ziele: Map<string, ModZielPlugin>, mitLane: Set<string>, aus: Map<string, Record<string, number>>): void {
    for (const [schluessel, z] of ziele) {
      if (mitLane.has(schluessel)) continue;
      const b = this.basis.get(schluessel);
      if (b === undefined) { this.basisHolen(schluessel, z); continue; }
      const w = z.versatz === null ? b : modWert(b, z.versatz, klemme01);
      const alt = this.zuletzt.get(schluessel);
      if (alt !== undefined && Math.abs(alt - w) <= AENDERUNG) continue;
      this.zuletzt.set(schluessel, w);
      const m = aus.get(z.insert) ?? {};
      m[String(z.index)] = w;
      aus.set(z.insert, m);
    }
  }

  /** no base known (no lane, no knob move yet): ask the plugin once; modulation starts when the value is here */
  private basisHolen(schluessel: string, z: ModZielPlugin): void {
    if (!this.dep.parameterWert || this.basisFrage.has(schluessel)) return;
    this.basisFrage.add(schluessel);
    void this.dep.parameterWert(z.insert, z.index).then((w) => {
      if (typeof w === 'number' && Number.isFinite(w) && !this.basis.has(schluessel)) this.basis.set(schluessel, Math.min(1, Math.max(0, w)));
    }).catch(() => undefined).finally(() => this.basisFrage.delete(schluessel));
  }
}

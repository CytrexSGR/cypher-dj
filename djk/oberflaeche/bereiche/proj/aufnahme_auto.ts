// 1.12 automation slice 3 (task 8): the take collector. It holds the arm state of the session (D11), gathers the points of a take from the two
// inputs (the hand: /e/auto_punkt with the core's project beat; the mouse and the keyboard of the page: the server's own time base, D12), ends a
// gesture as D13 says, shapes what is written by the mode (D14), simplifies it (D15) and writes it in the order of D13a (D16).
// The collector knows nothing of the core or the project store: the session gives it a `AutoWirt`.
import { laneWert, type Punkt } from '../../projekt/lane.ts';
import type { Lane, Projekt, Spur } from '../../projekt/modell.ts';
import { laneStart } from '../../projekt/befehle.ts';
import { vereinfache } from '../../projekt/vereinfachen.ts';
import { GESTE_RUHE_MS } from './zeiten.ts';
import { grundText } from '../../http/gruende.ts';
import { KERN_AUTO_ZIELE, quittungOk, type Quittung } from './kern_weg.ts';

export const AUFNAHME_ZIELE = KERN_AUTO_ZIELE;                    // the fields a take can hold are the fields the core can override
export type AufnahmeZiel = (typeof AUFNAHME_ZIELE)[number];
export type Modus = 0 | 1 | 2;                                    // touch, latch, write (D11)
export const MODUS_NAMEN = ['touch', 'latch', 'write'] as const;
const FELD_PFAD = /^spur\/([1-9][0-9]?)\/(fader|pan|mute|solo)$/;
const NAHT_EPS = 1e-6;                                            // a fall of the project beat larger than this is a loop seam (D12, D14)
export const MAUS_SICHERUNG_MS = 60_000;                          // D13: a mouse gesture without any end event is closed after this long
export const STOPP_GNADE_MS = 60;                                 // D13a/D12: a held point arrives AFTER the stopped /zustand/arr (one block later)

export interface AutoWirt {
  projekt(): Projekt | null;
  slug(): string | null;
  kennung(): object | null;                                      // the identity of the open project (a new object at every open, also of the same slug)
  bpm(): number;
  // one aendere with this label (a single undo step), waits for the core acknowledgement of the new playback; throws the refusal. It writes only if
  // the project `kennung` is still the open one, checked inside the serialized write (else projekt_gewechselt)
  schreibe(label: string, befehle: Record<string, unknown>[], kennung: object): Promise<void>;
  autoAn(nr: number, ziel: string): Promise<Quittung>;           // /k/arr/auto an 1 (the lane plays again)
  // /k/teil with the base value of the project (D10), through the queue of the regulator writes; the value is read from the project when its turn comes
  basis(felder: { spurId: string; ziel: AufnahmeZiel }[]): Promise<void>;
  entwaffne(nr: number): Promise<void>;                          // the core disarms a track number whose track is gone
  verteile(f: Record<string, unknown>): void;
  log(z: Record<string, unknown>): void;
}
// The clock of the collector: tests give a fake one, so no test waits on real time
export interface Uhr { jetzt(): number; setze(f: () => void, ms: number): unknown; loesche(h: unknown): void }
export const ECHTE_UHR: Uhr = {
  jetzt: () => Date.now(),
  setze: (f, ms) => { const h = setTimeout(f, ms); h.unref(); return h; },
  loesche: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
export interface AutoOptionen { ruheMs?: number; sicherungMs?: number; gnadeMs?: number; uhr?: Uhr }

interface Durchgang { punkte: Punkt[]; ende?: number; seed?: boolean; fall?: number }   // seed: the first point only holds the base or held value
interface Feld {
  key: string; slug: string; kennung: object; spurId: string; nr: number; ziel: AufnahmeZiel; modus: Modus; quelle: 'hand' | 'maus' | 'tasten';
  durchgaenge: Durchgang[]; offen: boolean; timer: unknown;
  basis: number;   // the value of the field before the gesture: what the lane plays outside the take, and what the project value goes back to
}
interface ArmEintrag { nr: number; modus: Modus }
interface ArrStand { status: number; beat: number; ms: number }

export const modusVon = (x: unknown): Modus | null => {
  if (x === 0 || x === 1 || x === 2) return x;
  const i = MODUS_NAMEN.indexOf(x as never);
  return i >= 0 ? (i as Modus) : null;
};
const laneVon = (s: Spur, ziel: string): Lane | undefined => s.automation?.find((l) => l.ziel === ziel);
// the existing lane at a beat, or (no lane yet) its base value: a track without a lane behaves like a flat lane
const alt = (lane: Lane | undefined, ziel: AufnahmeZiel, beat: number, basis: number): number => (lane ? laneWert(lane.punkte, beat, ziel) : basis);
const BASIS_MERK_MS = 5000;                                       // a base value noted from a page write waits this long for the gesture it belongs to
const FELD_VON_ZIEL = { fader: 'fader_db', pan: 'pan', mute: 'mute', solo: 'solo' } as const;

export class AutoAufnahme {
  private readonly arm = new Map<string, ArmEintrag>();           // by track id
  private modus: Modus = 0;
  private readonly felder = new Map<string, Feld>();
  private z: ArrStand | null = null;
  private startBeat = 0;                                          // beat where the current pass of the transport began
  private gnadeTimer: unknown = null;
  private stoppBeat: number | null = null;
  private zNr = 0;                                              // counts the /zustand/arr states, to tell a pass cut by a point from one cut by a state
  private readonly basen = new Map<string, { wert: number; ms: number }>();   // value before a page write of an armed, playing track, by field key
  private kette: Promise<void> = Promise.resolve();
  private readonly ruheMs: number; private readonly sicherungMs: number; private readonly gnadeMs: number; private readonly uhr: Uhr;

  private readonly w: AutoWirt;

  constructor(w: AutoWirt, o: AutoOptionen = {}) {
    this.w = w;
    this.ruheMs = o.ruheMs ?? GESTE_RUHE_MS; this.sicherungMs = o.sicherungMs ?? MAUS_SICHERUNG_MS; this.gnadeMs = o.gnadeMs ?? STOPP_GNADE_MS;
    this.uhr = o.uhr ?? ECHTE_UHR;
  }

  // --- arm state (D11) ------------------------------------------------------------------------------------------------
  ansicht(): { modus: string; spuren: string[] } { this.raeume(); return this.ansichtRoh(); }
  private ansichtRoh(): { modus: string; spuren: string[] } { return { modus: MODUS_NAMEN[this.modus], spuren: [...this.arm.keys()] }; }
  modusNr(): Modus { return this.modus; }
  istArm(): boolean { this.raeume(); return this.arm.size > 0; }
  armiert(spurId: string): boolean { this.raeume(); return this.arm.has(spurId); }
  // A deleted track (or a number now held by another track, numbers are reused) must not stay armed: its entry would silence the new track and
  // arm it again. Pruned lazily at every read, like the mirror of the overrides; the core gets a disarm for the number.
  raeume(): void {
    const p = this.w.projekt();
    if (!p || !this.arm.size) return;
    const weg: { id: string; nr: number }[] = [];
    for (const [id, e] of this.arm) if (p.spuren.find((x) => x.id === id)?.nr !== e.nr) weg.push({ id, nr: e.nr });
    if (!weg.length) return;
    for (const x of weg) this.freigeben(x.id);
    for (const x of weg) this.w.entwaffne(x.nr).catch((e) => this.w.log({ typ: 'proj_arm_frei_fehler', nr: x.nr, fehler: (e as Error).message }));
    this.w.verteile({ a: 'proj', f: { auto_arm: this.ansichtRoh() } });
  }
  armiereNur(spurId: string, nr: number, an: boolean): void {            // the core acknowledged it
    if (an) { this.arm.set(spurId, { nr, modus: this.modus }); if (this.spielt() && this.modus === 2) this.schreibStart(this.jetztBeat() ?? this.startBeat); }
    else this.freigeben(spurId);
  }
  setzeModus(m: Modus): void { this.modus = m; for (const e of this.arm.values()) e.modus = m; }
  armiertListe(): { id: string; nr: number }[] { this.raeume(); return [...this.arm].map(([id, e]) => ({ id, nr: e.nr })); }
  // disarm of one track: its takes end now and are written (the work of the player is kept)
  private freigeben(spurId: string): void {
    this.arm.delete(spurId);
    this.schliesse(spurId, [...this.felder.values()].filter((f) => f.spurId === spurId), 'disarm');
  }
  alleFrei(): void { for (const id of [...this.arm.keys()]) this.freigeben(id); }
  // D6: a new core generation or a project change; nothing of the old takes may reach the new state
  verwirf(): void {
    for (const f of this.felder.values()) if (f.timer) this.uhr.loesche(f.timer);
    this.felder.clear(); this.arm.clear(); this.z = null; this.stoppBeat = null; this.basen.clear();
    if (this.gnadeTimer) { this.uhr.loesche(this.gnadeTimer); this.gnadeTimer = null; }
  }
  beende(): void { this.verwirf(); }

  private spielt(): boolean { return this.z?.status === 2; }
  private nachStopp(): boolean { return this.gnadeTimer !== null; }
  // D10: the return path is suppressed for an armed track while the transport plays (and in the grace after a stop)
  unterdrueckt(pfad: string): boolean {
    this.raeume();
    const m = FELD_PFAD.exec(pfad);
    if (!m || !(this.spielt() || this.nachStopp())) return false;
    return [...this.arm.values()].some((e) => e.nr === Number(m[1]));
  }

  // --- time base (D12) ------------------------------------------------------------------------------------------------
  // The mouse path: the last /zustand/arr project beat plus the wall clock since then at the project tempo, clamped to the loop end
  private beatBei(z: ArrStand): number {
    const p = this.w.projekt(), b = z.beat + (this.uhr.jetzt() - z.ms) / 60000 * this.w.bpm();
    return p?.loop.an && b > p.loop.bis_beat ? p.loop.bis_beat : b;
  }
  jetztBeat(): number | null { return this.z && this.z.status === 2 ? this.beatBei(this.z) : null; }
  // /zustand/arr (called after the lage took it): start, loop seam and stop
  zustand(f: Record<string, unknown>): void {
    // a project beat a hair below 0 (clock fit, sample rounding at a start) is 0: a lane point below beat 0 would refuse the whole take (argument_ungueltig)
    const neu: ArrStand = { status: Number(f.status), beat: Math.max(0, Number(f.projekt_beat)), ms: this.uhr.jetzt() }, vor = this.z;
    this.z = neu;
    const zuvor = this.zNr++;
    if (neu.status === 2 && vor?.status !== 2) {
      if (this.gnadeTimer) { this.uhr.loesche(this.gnadeTimer); this.gnadeTimer = null; this.fertig('stopp'); }
      this.startBeat = neu.beat; this.stoppBeat = null;
      this.schreibStart(neu.beat);
    } else if (neu.status === 2 && vor && neu.beat < vor.beat - NAHT_EPS) this.naht(vor.beat, neu.beat, zuvor);
    else if (neu.status !== 2 && vor?.status === 2) this.stopp(vor);
  }
  // D14 loop: the pass ends at the loop end, the next begins at the loop start. A field that holds its value (latch, write) goes on with it.
  private naht(vonBeat: number, neuBeat: number, zuvor: number): void {
    const p = this.w.projekt();
    const ende = p?.loop.an ? p.loop.bis_beat : vonBeat, start = p?.loop.an ? p.loop.von_beat : neuBeat;
    this.startBeat = start;
    for (const f of this.felder.values()) {
      const d = f.durchgaenge.at(-1);
      if (!d) continue;
      if (!d.punkte.length) continue;
      if (d.fall === zuvor) {
        // the first point behind the seam came BEFORE this state and already cut the pass: it must not be ended again. The pass before it holds its
        // value to the loop end (latch, write) as it would have with the state first.
        const v = f.durchgaenge.at(-2), l = v?.punkte.at(-1);
        if (v && l && f.modus !== 0 && (v.ende === undefined || v.ende <= l.beat)) v.ende = ende;
        continue;
      }
      d.ende = ende;
      // every mode: a new pass begins at the seam, so the points after it never join the old pass (D14); a field that holds its value goes on with it
      f.durchgaenge.push(f.modus !== 0 ? { punkte: [{ beat: start, wert: d.punkte.at(-1)!.wert }], seed: true } : { punkte: [] });
    }
  }
  private stopp(vor: ArrStand): void {
    this.stoppBeat = this.beatBei(vor);
    for (const f of this.felder.values()) { f.offen = false; if (f.timer) { this.uhr.loesche(f.timer); f.timer = null; } }   // D13: a stop ends every gesture
    if (this.gnadeTimer) this.uhr.loesche(this.gnadeTimer);
    this.gnadeTimer = this.uhr.setze(() => { this.gnadeTimer = null; this.fertig('stopp'); }, this.gnadeMs);
  }
  private fertig(grund: string): void {
    const liste = [...this.felder.values()];
    if (liste.length) this.schliesse('*', liste, grund);
  }

  // --- the points -------------------------------------------------------------------------------------------------------
  // The hand: /e/auto_punkt pfad, projekt_beat, wert (D12). Only armed tracks; a point may arrive after the stop (inside the grace).
  handPunkt(f: Record<string, unknown>): void {
    const m = FELD_PFAD.exec(String(f.pfad));
    const beat = Number(f.projekt_beat), wert = Number(f.wert);
    if (!m || !Number.isFinite(beat) || !Number.isFinite(wert) || !(this.spielt() || this.nachStopp())) return;
    this.raeume();
    const spur = this.w.projekt()?.spuren.find((s) => s.nr === Number(m[1]));
    if (!spur || !this.arm.has(spur.id)) return;
    this.punkt(spur, m[2] as AufnahmeZiel, beat, wert, 'hand');
  }
  // The page: a mouse or keyboard value of one field. Returns the project beat used, or null when nothing is recorded (not armed, not playing).
  mausPunkt(spurId: string, ziel: AufnahmeZiel, wert: number | null, ende: boolean, quelle: 'maus' | 'tasten'): { aufgenommen: boolean; beat: number | null } {
    const spur = this.w.projekt()?.spuren.find((s) => s.id === spurId);
    const f = this.felder.get(`${spurId}/${ziel}`);
    if (wert !== null && spur && this.arm.has(spurId) && this.spielt()) {
      const beat = this.jetztBeat() as number;
      this.punkt(spur, ziel, beat, wert, quelle);
      if (ende) this.geschenEnde(this.felder.get(`${spurId}/${ziel}`) as Feld);
      return { aufgenommen: true, beat };
    }
    if (ende && f) { this.geschenEnde(f); return { aufgenommen: true, beat: null }; }
    return { aufgenommen: false, beat: null };
  }
  // The release event of the core (/e/regler halter not mensch): the hand let go
  reglerFrei(pfad: string): void {
    const m = FELD_PFAD.exec(pfad);
    if (!m) return;
    for (const f of this.felder.values()) if (f.nr === Number(m[1]) && f.ziel === m[2] && f.quelle === 'hand' && f.offen) this.geschenEnde(f);
  }

  // The base value of a field at the start of its take. A page write of the gesture (spur_aendern) may land before the first /geste: merkeBasen noted
  // the value from before that write, so the order of the two requests does not matter.
  private basisFuer(spur: Spur, ziel: AufnahmeZiel): number {
    const key = `${spur.id}/${ziel}`, m = this.basen.get(key);
    this.basen.delete(key);
    return m && this.uhr.jetzt() - m.ms <= BASIS_MERK_MS ? m.wert : laneStart(spur, ziel);
  }
  // Called by the session before a page change of the project is applied: for an armed track that plays, a field that changes and has no open take
  // gets its old value noted (the page's write of a gesture IS the gesture; the old value is what the lane must play outside it).
  merkeBasen(vorher: Projekt, nachher: Projekt): void {
    if (!this.arm.size || !(this.spielt() || this.nachStopp())) return;
    for (const id of this.arm.keys()) {
      const a = vorher.spuren.find((x) => x.id === id), b = nachher.spuren.find((x) => x.id === id);
      if (!a || !b) continue;
      for (const ziel of AUFNAHME_ZIELE) {
        const key = `${id}/${ziel}`;
        if (this.felder.has(key) || this.basen.has(key) && this.uhr.jetzt() - this.basen.get(key)!.ms <= BASIS_MERK_MS) continue;
        if (laneStart(a, ziel) !== laneStart(b, ziel)) this.basen.set(key, { wert: laneStart(a, ziel), ms: this.uhr.jetzt() });
      }
    }
  }
  private neuesFeld(spur: Spur, ziel: AufnahmeZiel, modus: Modus, quelle: Feld['quelle'], durchgaenge: Durchgang[], offen: boolean, basis: number): Feld {
    return { key: `${spur.id}/${ziel}`, slug: this.w.slug() as string, kennung: this.w.kennung() as object, spurId: spur.id, nr: spur.nr, ziel, modus, quelle,
      durchgaenge, offen, timer: null, basis };
  }
  private punkt(spur: Spur, ziel: AufnahmeZiel, beat: number, wert: number, quelle: Feld['quelle']): void {
    beat = Math.max(0, beat);                      // as in zustand(): the beat of a grip sample may lie a hair before the origin
    const key = `${spur.id}/${ziel}`;
    let f = this.felder.get(key);
    if (!f) {
      const e = this.arm.get(spur.id) as ArmEintrag;
      f = this.neuesFeld(spur, ziel, e.modus, quelle, [], true, this.basisFuer(spur, ziel));
      // write: a field that had no lane yet starts at the beginning of the pass with the base value (D14)
      if (f.modus === 2) f.durchgaenge.push({ punkte: [{ beat: Math.min(this.startBeat, beat), wert: f.basis }], seed: true });
      this.felder.set(key, f);
    }
    f.offen = true; f.quelle = quelle;
    let d = f.durchgaenge.at(-1);
    const letzter = d?.punkte.at(-1);
    if (!d || (letzter && beat < letzter.beat - NAHT_EPS && d.ende === undefined)) {   // a fall of the project beat inside a field: the loop seam
      if (d && letzter) d.ende = d.ende ?? letzter.beat;
      d = { punkte: [], fall: this.zNr }; f.durchgaenge.push(d);
    }
    // an untouched span holds the base (or held) value up to the first grip, then steps to the hand value: two points at one beat are a step
    if (d.seed && d.punkte.length === 1 && beat > d.punkte[0].beat) d.punkte.push({ beat, wert: d.punkte[0].wert });
    d.seed = false;
    d.punkte.push({ beat, wert });
    if (f.timer) this.uhr.loesche(f.timer);
    const ms = quelle === 'maus' ? this.sicherungMs : this.ruheMs;
    f.timer = this.uhr.setze(() => { f!.timer = null; this.geschenEnde(f!); }, ms);
  }
  // D13/D14: touch writes at the end of the gesture; latch and write keep the field until the stop
  private geschenEnde(f: Feld): void {
    if (f.timer) { this.uhr.loesche(f.timer); f.timer = null; }
    f.offen = false;
    if (f.modus === 0 && this.felder.get(f.key) === f) this.schliesse(f.spurId, [f], 'ende');
  }

  // --- write (D13a, D16) ------------------------------------------------------------------------------------------------
  // write mode: at the start every field of an armed track that has a lane takes part with the base value, even without movement
  private schreibStart(beat: number): void {
    const p = this.w.projekt();
    if (!p) return;
    for (const [id, e] of this.arm) {
      if (e.modus !== 2) continue;
      const s = p.spuren.find((x) => x.id === id);
      if (!s) continue;
      for (const ziel of AUFNAHME_ZIELE) {
        const key = `${id}/${ziel}`;
        if (!laneVon(s, ziel) || this.felder.has(key)) continue;
        this.felder.set(key, this.neuesFeld(s, ziel, 2, 'hand', [{ punkte: [{ beat, wert: laneStart(s, ziel) }], seed: true }], false, laneStart(s, ziel)));
      }
    }
  }
  private schliesse(_wer: string, liste: Feld[], grund: string): void {
    for (const f of liste) {
      if (f.timer) this.uhr.loesche(f.timer);
      f.timer = null; this.felder.delete(f.key);
    }
    if (!liste.length) return;
    const stopp = grund === 'stopp' ? this.stoppBeat : grund === 'disarm' ? this.jetztBeat() : null;
    this.kette = this.kette.then(() => this.schreibe(liste, stopp, grund)).catch((e) => {
      this.w.log({ typ: 'proj_aufnahme_fehler', fehler: (e as Error).message });
      for (const f of liste) {
        const fehler = 'aufnahme_fehler';
        this.w.verteile({ a: 'proj', f: { auto_aufnahme: { spur_id: f.spurId, ziel: f.ziel, slug: f.slug, fehler, text: grundText(fehler) } } });
      }
    });
  }
  // for the tests: resolves when every queued write is done
  fertigGeschrieben(): Promise<void> { return this.kette; }

  // The points of one field as the mode writes them (D14): passes merged (the last pass wins where they overlap), a held value extended to the end
  private roh(f: Feld, stoppBeat: number | null): Punkt[] {
    let r: Punkt[] = [];
    f.durchgaenge.forEach((d, i) => {
      const pk = d.punkte.map((q) => ({ ...q }));
      const l = pk.at(-1);
      if (!l) return;
      const ende = i === f.durchgaenge.length - 1 ? (stoppBeat ?? d.ende) : d.ende;
      if (f.modus !== 0 && ende !== undefined && ende > l.beat) pk.push({ beat: ende, wert: l.wert });   // latch and write hold the value to the end
      const lo = pk[0].beat, hi = pk.at(-1)!.beat;
      r = r.filter((q) => q.beat < lo || q.beat > hi);
      for (const q of pk) r.push(q);
      r = r.map((q, k) => ({ q, k })).sort((x, y) => x.q.beat - y.q.beat || x.k - y.k).map((x) => x.q);
    });
    return r;
  }

  private async schreibe(liste: Feld[], stoppBeat: number | null, grund: string): Promise<void> {
    const p = this.w.projekt();
    const beschaffen: { f: Feld; spur: Spur }[] = [];
    const meldungen: Record<string, unknown>[] = [];
    const posten: { f: Feld; spur: Spur; befehl: Record<string, unknown>; punkte: number }[] = [];
    const melde = (f: Feld, fehler: string, extra: Record<string, unknown> = {}): void => {
      meldungen.push({ spur_id: f.spurId, ziel: f.ziel, slug: f.slug, fehler, text: grundText(fehler), ...extra });
    };
    for (const f of liste) {
      const gleich = this.w.kennung() === f.kennung;                                 // the project of the take is still the open one
      const spur = p && gleich ? p.spuren.find((s) => s.id === f.spurId) : undefined;
      if (!spur) { melde(f, !p ? 'kein_projekt' : gleich ? 'spur_unbekannt' : 'projekt_gewechselt'); continue; }
      beschaffen.push({ f, spur });
      try {
        const lane = laneVon(spur, f.ziel);
        if (lane?.gesperrt) { melde(f, 'lane_gesperrt'); continue; }                  // AK17: refused, shown, not dropped
        const roh = this.roh(f, stoppBeat);
        if (!roh.length) continue;
        const punkte = vereinfache(roh, f.ziel);
        const lo = punkte[0].beat, hi = punkte.at(-1)!.beat;
        const vor = alt(lane, f.ziel, lo, f.basis), nach = alt(lane, f.ziel, hi, f.basis);
        // outside the span the old lane stays: a point with its value on each side keeps the line from leaning into the take (touch: only the span)
        const setze: Punkt[] = [...punkte];
        const platz = (beat: number): boolean => setze.filter((q) => q.beat === beat).length < 2;       // the lane rule: at most two points at one beat
        if (Math.abs(vor - punkte[0].wert) > 1e-9 && platz(lo)) setze.unshift({ beat: lo, wert: vor });
        if (Math.abs(nach - punkte.at(-1)!.wert) > 1e-9 && platz(hi)) setze.push({ beat: hi, wert: nach });
        const befehle: Record<string, unknown>[] = [lane ? { befehl: 'auto_punkte', lane_id: lane.id, setze, loesche_von: lo, loesche_bis: hi }
          : { befehl: 'auto_neu', spur_id: spur.id, ziel: f.ziel, punkte: setze }];
        // the page wrote the gesture into the project value as well; the value belongs to the take (D10), so it goes back, in the same entry
        if (Math.abs(laneStart(spur, f.ziel) - f.basis) > 1e-9) {
          const schalter = f.ziel === 'mute' || f.ziel === 'solo';
          befehle.push({ befehl: 'spur_aendern', spur_id: spur.id, [FELD_VON_ZIEL[f.ziel]]: schalter ? f.basis === 1 : f.basis });
        }
        posten.push({ f, spur, punkte: punkte.length, befehle });
      } catch (e) { this.w.log({ typ: 'proj_aufnahme_fehler', fehler: (e as Error).message }); melde(f, 'aufnahme_fehler'); }
    }
    // One aendere for the whole batch (one undo step). If it is refused, each field is tried alone, so one bad field cannot sink the good ones.
    const geschrieben: typeof posten = [];
    const etikett = (x: typeof posten): string => {
      const einzeln = new Set(x.map((q) => q.spur.id)).size === 1;
      return (einzeln ? `Record ${x.map((q) => q.f.ziel).join(', ')} ${x[0].spur.name}` : `Record ${x.length} fields`).slice(0, 200);
    };
    const versuche = async (x: typeof posten): Promise<unknown> => {
      try { await this.w.schreibe(etikett(x), x.flatMap((q) => q.befehle), x[0].f.kennung); geschrieben.push(...x); return null; } catch (e) { return e; }
    };
    const abgelehnt = (x: (typeof posten)[number], err: unknown): void => {
      const g = err as { grund?: string; fehler?: string }, fehler = g.grund ?? g.fehler ?? 'fehler';
      this.w.log({ typ: 'proj_aufnahme_abgelehnt', fehler, ziele: [`${x.f.spurId}/${x.f.ziel}`] });
      melde(x.f, fehler);
    };
    if (posten.length) {
      const e = await versuche(posten);
      if (e !== null && posten.length > 1 && (e as { grund?: string }).grund !== 'projekt_gewechselt') {
        for (const x of posten) { const err = await versuche([x]); if (err !== null) abgelehnt(x, err); }
      } else if (e !== null) for (const x of posten) abgelehnt(x, e);
    }
    // D13a: (1) the take is written and the new playback acknowledged (above). A field whose hand has gripped it again (a new take is open) is left
    // alone below: its own end gives it back, else the lane would play against the hand and the base value would jump the fader mid-gesture.
    const frei = beschaffen.filter((b) => this.w.kennung() === b.f.kennung && !this.felder.has(b.f.key));
    // (3) the lane plays again for the regulators of the take, all at once (one call per field, a core answers each)
    const aus = await Promise.allSettled(frei.map((b) => this.w.autoAn(b.f.nr, b.f.ziel)));
    const an: typeof frei = [];                              // the fields whose switch-on the core acknowledged
    aus.forEach((r, i) => {
      if (r.status === 'fulfilled' && quittungOk(r.value)) { an.push(frei[i]); return; }
      this.w.log({ typ: 'proj_aufnahme_fehler', fehler: r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : 'auto_an_nicht_quittiert' });
      melde(frei[i].f, 'aufnahme_fehler');
    });
    // (4) only then the base value of the project goes to the core; reversed, the old lane would play without the take, or the base value would play
    // as a hand value
    try {
      const soll = an.filter((b) => this.w.kennung() === b.f.kennung && !this.felder.has(b.f.key)).map((b) => ({ spurId: b.spur.id, ziel: b.f.ziel }));
      if (soll.length) await this.w.basis(soll);
    } catch (e) { this.w.log({ typ: 'proj_aufnahme_fehler', fehler: (e as Error).message }); for (const b of an) melde(b.f, 'aufnahme_fehler'); }
    for (const g of geschrieben) {
      const { spurId, ziel, slug, modus } = g.f;
      this.w.verteile({ a: 'proj', f: { auto_aufnahme: { spur_id: spurId, ziel, slug, modus: MODUS_NAMEN[modus], punkte: g.punkte } } });
    }
    for (const m of meldungen) this.w.verteile({ a: 'proj', f: { auto_aufnahme: m } });
    this.w.log({ typ: 'proj_aufnahme', grund, geschrieben: geschrieben.length, abgelehnt: meldungen.length });
  }
}

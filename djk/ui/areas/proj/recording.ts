// 1.8 Slice 1: Bereich proj-aufnahme. POST /proj/aufnahme {aktion: start|stopp, von_beat?}, GET /proj/aufnahme (Lauf und letztes Ergebnis).
// Besitzt den Ablauf: Spuren im
// Kern scharf stellen (/k/rec/spur), /k/rec/start, dann der gewöhnliche Transport; beim Stopp Transport aus, auf /e/aufnahme warten, Rohdatei
// -> WAV -> Clip (EIN Undo-Schritt).
// 1.8 S3 (D13): the server keeps the core in sync with the project. Arm, input, mode and monitor of a track go to the core with /k/rec/spur after every
// change of the open project (listener ProjZugang.beiStand), after undo/redo, on project open and after a core restart, not only at the start of a run.
// imKern holds what the core confirmed.
// Schutz wie proj (fremdePost). Während des Laufs hält er die Aufnahme-Sperre (sperreLaden('aufnahme'): kein Öffnen/Neu, keine
// wiedergabewirksame Änderung, kein Freeze,
// aber der eigene Transport-Start geht durch, B1) und sperrt Tempo-Änderungen (aufnahmeLauf). Abweichung zur Spec: der Lauf steht unter GET
// /proj/aufnahme, nicht in /proj/aktuell.
// Ein Lauf endet auf dem ersten von drei Wegen (M1, M2): (1) POST stopp; (2) der Take endet im Kern, weil der Transport anders endete
// (Transport-Knopf, Hand-Taste, Ende des
// Arrangements): alle /e/aufnahme des Laufs sind da; (3) der Kern verwirft die Aufnahme (Quittung 7 der Rec-ID: zu_spaet, abbruch, ki_stopp).
// In jedem Fall fällt die Sperre, und
// das Ergebnis liegt in `letzte` (GET /proj/aufnahme); ein späteres POST stopp liefert es einmal, statt keine_aufnahme zu melden.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { aendereStand } from '../../project/state.ts';
import {
  eingangsCode, leseMidiDatei, midiTakeNoten, nehmeMidiAuf, nehmeTakeAuf, schreibeWavAusF32, TakeFehler, type MidiTakeAngabe,
} from '../../project/recording.ts';
import { aufnahmeVon, MAX_BEAT, type EingangExtern, type EingangIntern, type Projekt, type SpurAufnahme } from '../../project/model.ts';
import { quittungsFristMs } from './recording_deadline.ts';
import { geraeteDatei } from '../../paths.ts';
import { GeraeteFehler, GeraeteSpeicher, type Konfig } from '../devices/store.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from './area.ts';
import { ProjFehler, type Antwort } from './session.ts';

type Quelle = 'andreas' | 'cypher';
// art 1 = the MIDI take (spur 0, frames = event count), art 0 = an audio take (1.8 T7a)
interface Meldung { spur: number; kennung: number; status: number; frames: number; start_sample: number; luecken: number; art: number }
// art 'instrument' marks a track armed with midi_ein_1 (1.8 T8); audio tracks carry no key, so the answers of slices 1 to 7 stay as they were
interface LaufSpur { id: string; nr: number; name: string; versatz_samples: number; art?: 'instrument' }
interface Lauf {
  kennung: number; recId: number; startBeat: number; bpm: number; quelle: Quelle; seit: number; spuren: LaufSpur[];
  nachlauf: number;                         // 1.8 S2b (D9): the one tail of the run = the largest offset of the armed tracks (0 with internal tracks only)
  laufend: boolean;                         // 1.8 S4b (D8): began inside a running transport; stopping ends the recording only
  punch: { ein: boolean; aus: boolean; von_beat: number; bis_beat: number } | null;   // 1.8 S4b (D6): punch range at the start; null = whole pass
  overdub: boolean;                         // 1.8 T8 (R7): the overdub switch at the start; it decides how the MIDI take meets the clips of the range
  verworfen: string | null;                 // Grund der Quittung 7 (Kern verwirft), solange der Lauf schon als laufend galt
  abschluss: Promise<Antwort> | null;       // gesetzt, sobald der Lauf endet (eine Instanz für alle drei Wege)
}
interface Letzte { kennung: number; antwort: Antwort; geliefert: boolean }
// What the core holds for a track (eingang code, channel mode, monitor), in the terms of /k/rec/spur.
interface KernSpur { eingang: number; modus: number; monitor: number }
const gleich = (a: KernSpur | undefined, b: KernSpur | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.eingang === b.eingang && a.modus === b.modus && a.monitor === b.monitor;

// Frist des Kerns für den Transportstart nach /k/rec/start. Sie endet im Kern, sobald das Arrangement wartet (Quant); bis dahin deckt sie die
// 400 ms Quittungsweg dieses Befehls,
// eine Tempo-Rampe und den Weg des Transportbefehls. Die Vorgabe des Kerns (2 s) war kürzer als der Weg bei laufendem Deck (400 ms + bis 1,9 s Quant): M1.
export const KERN_FRIST_SAMPLES = 480000;   // 10 s
const GEMELDET_MAX = 64;
const MODUS_CODE = { stereo: 0, links: 1, rechts: 2, summe: 3 } as const;   // /k/rec/spur modus (D14)
const MONITOR_CODE = { aus: 0, auto: 1, ein: 2 } as const;                   // /k/rec/spur monitor; absent in the project means auto (D11)
const monitorCode = (a: SpurAufnahme): number => (a.monitor === undefined ? MONITOR_CODE.auto : MONITOR_CODE[a.monitor]);
const MIN_FREI_BYTES = 2 ** 30;                                               // D19: default minimum of free space to start a recording (1 GiB)
interface Platz { minFreiBytes?: number; statfs?: (ordner: string) => { bavail: number; bsize: number } }
const NACHLAUF_MAX = 480000;                                                  // osc.json /k/rec/start nachlauf_samples
const MIDI_EINGANG = 30;                                                      // /k/rec/spur eingang of midi_ein_1 (an instrument track, T7a)
const midiSchluessel = (kennung: number): string => `m:${kennung}`;           // key of the one MIDI report of a run in `gemeldet` / `wartend`
const eingangVon = (s: { aufnahme?: { eingang: unknown } }): { art: string } => s.aufnahme!.eingang as { art: string };

export class Aufnahme {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private lauf: Lauf | null = null;
  private letzte: Letzte | null = null;
  private frei: (() => void) | null = null;
  private arrStatus = 0;
  private kernBereinigt = false;
  private beobachtet: number | null = null;     // Rec-ID eines Starts, der noch läuft (this.lauf ist dann noch nicht gesetzt)
  private abbruch: string | null = null;        // Grund der Quittung 7 dieser Rec-ID
  private einsatzBeat: number | null = null;    // 1.8 S4b (D8): ist_beat of receipt 2 of the REC id of the start in progress
  private readonly imKern = new Map<number, KernSpur>();   // what the core confirmed (changed only after a receipt that is not a refusal, D13)
  private readonly dirty = new Set<number>();               // tracks that differ from imKern but could not be sent yet (a run is active, a refusal, no core)
  private startet = 0;                                     // starts in progress (their own /k/rec/spur messages are sent by start itself)
  private generation: number | null = null;                // last core generation seen (hello or restart)
  private kette: Promise<void> = Promise.resolve();         // serializes the syncs
  private readonly gemeldet = new Map<string, Meldung>();
  private readonly wartend = new Map<string, (m: Meldung | null) => void>();
  private readonly fristMs: number;
  private readonly geraete: GeraeteSpeicher;
  private readonly zustandMs: number;
  private readonly ladeMs: number;
  private readonly minFreiBytes: number;           // 1.8 T9 (D19, AK28): less free space than this on a folder refuses the start (kein_platz)
  private readonly statfs: (ordner: string) => { bavail: number; bsize: number };
  // 1.8 S2b (D9): ausgang_vorhalt of the last /zustand/rec. 1.8 T2: it contains the delay compensation (pdc_latenz) of the playback loaded in the
  // core, so a report counts only if it arrived after the core announced the current playback number: a change of /zustand/arr.nr drops it (null)
  // until the next report.
  private vorhalt: number | null = null;
  private quantum = 0;                          // its quantum (0 before the first cycle)
  private arrNr: number | null = null;          // /zustand/arr.nr, the playback number the core plays (-1 none); null: not heard since the last hello
  private zustandWartend: (() => void)[] = [];
  constructor(ctx: BereichKontext, zugang: ProjZugang, fristMs = 30000, geraeteKonfig?: string, zustandMs = 1500, ladeMs = 5000, platz: Platz = {}) {
    this.ctx = ctx; this.zugang = zugang; this.fristMs = fristMs; this.zustandMs = zustandMs; this.ladeMs = ladeMs;
    this.minFreiBytes = platz.minFreiBytes ?? MIN_FREI_BYTES;
    this.statfs = platz.statfs ?? ((ordner) => fs.statfsSync(ordner));
    this.geraete = new GeraeteSpeicher(geraeteKonfig ?? geraeteDatei());
    this.zugang.beiStand?.((p) => this.stand(p));
  }

  // ---- 1.8 S3 (D13): the core follows the project ------------------------------------------------------------------------------------------------------
  // What /k/rec/spur has to carry for each armed track of the project: audio tracks with their tap and mode, instrument tracks with midi_ein_1 (1.8 T8).
  private soll(p: Projekt): Map<number, KernSpur> {
    const m = new Map<number, KernSpur>();
    for (const s of p.spuren) {
      const e = s.aufnahme?.eingang;
      if (!s.aufnahme?.scharf || !e) continue;
      if (s.art === 'audio' && (e.art === 'intern' || e.art === 'extern')) {
        m.set(s.nr, { eingang: eingangCode(e), modus: e.art === 'extern' ? MODUS_CODE[e.modus] : 0, monitor: monitorCode(s.aufnahme) });
      } else if (s.art === 'instrument' && e.art === 'midi') m.set(s.nr, { eingang: MIDI_EINGANG, modus: 0, monitor: monitorCode(s.aufnahme) });
    }
    return m;
  }
  // The tracks whose state in the core differs from the project (armed in one, not in the other, or another input, mode or monitor).
  private unterschiede(soll: Map<number, KernSpur>): number[] {
    const nrs = [...new Set([...soll.keys(), ...this.imKern.keys()])].sort((a, b) => a - b).filter((nr) => !gleich(soll.get(nr), this.imKern.get(nr)));
    for (const nr of [...this.dirty]) if (!nrs.includes(nr)) this.dirty.delete(nr);   // the project went back to what the core has: nothing left to send
    return nrs;
  }
  // D19: the free space of the project folder and of the work folder (the raw files go there) must reach the minimum. A folder that does not exist yet
  // counts by its nearest existing parent; a volume that cannot be read does not block the recording (the take would end with status 3 at worst).
  private pruefePlatz(projektOrdner: string): void {
    for (const ordner of new Set([projektOrdner, this.zugang.arbeitsordner()])) {
      let da = ordner;
      while (!fs.existsSync(da) && path.dirname(da) !== da) da = path.dirname(da);
      let frei: number;
      try { const f = this.statfs(da); frei = f.bavail * f.bsize; } catch { continue; }
      if (frei < this.minFreiBytes) {
        const mib = (n: number): number => Math.floor(n / 2 ** 20);
        throw new ProjFehler(409, 'kein_platz', { text: `only ${mib(frei)} MiB free on ${da}; a recording needs at least ${mib(this.minFreiBytes)} MiB` });
      }
    }
  }
  private laeuft(): boolean { return this.lauf !== null || this.beobachtet !== null || this.startet > 0; }
  // D12: the core accepts a monitor change of a recording track in place; input and mode of a recording track it refuses (aufnahme_laeuft).
  private nurMonitorImLauf(nr: number, soll: Map<number, KernSpur>): boolean {
    const a = soll.get(nr), b = this.imKern.get(nr);
    return this.lauf !== null && this.startet === 0 && this.beobachtet === null && this.lauf.spuren.some((s) => s.nr === nr) &&
      a !== undefined && b !== undefined && a.eingang === b.eingang && a.modus === b.modus && a.monitor !== b.monitor;
  }
  // Sends /k/rec/spur for the given tracks (all messages first, then all receipts). imKern follows only a receipt that is not a refusal; a refusal or a missing
  // receipt (kein_kern) leaves it as it was and marks the track dirty. Returns the receipts in the order of the tracks.
  private async sendeSpuren(nrs: number[], soll: Map<number, KernSpur>): Promise<{ nr: number; q: { status: number; grund: string } | null }[]> {
    const ids = nrs.map((nr) => {
      const s = soll.get(nr);
      const felder = { spur: nr, scharf: s ? 1 : 0, eingang: s?.eingang ?? 0, modus: s?.modus ?? 0, monitor: s?.monitor ?? 1 };
      return { nr, s, id: this.ctx.sende('/k/rec/spur', felder) };
    });
    const aus: { nr: number; q: { status: number; grund: string } | null }[] = [];
    for (const x of ids) {
      const q = await this.ctx.warteQuittung(x.id);
      aus.push({ nr: x.nr, q });
      if (q && q.status < 6) {
        if (x.s) this.imKern.set(x.nr, x.s); else this.imKern.delete(x.nr);
        this.dirty.delete(x.nr);
      } else if (!gleich(x.s, this.imKern.get(x.nr))) this.dirty.add(x.nr);
    }
    return aus;
  }
  // The listener of the open project (ProjZugang.beiStand): called after every assignment of the project and at the end of nachNeustart. Sends the differences
  // unless a run is active; then the track is dirty, except the monitor-only change of a recording track.
  private stand(p: Projekt): void {
    const soll = this.soll(p), nrs = this.unterschiede(soll);
    if (nrs.length === 0) return;
    for (const nr of nrs) if (this.laeuft() && !this.nurMonitorImLauf(nr, soll)) this.dirty.add(nr);
    this.planeAbgleich();
  }
  // The differences between the current project and the core, one run at a time. Called by the listener, after a run (schliesseAb, start), on hello and
  // restart.
  private planeAbgleich(): void {
    this.kette = this.kette.then(() => this.abgleich()).catch((e) => this.ctx.log({ typ: 'aufnahme_abgleich_fehler', fehler: (e as Error).message }));
  }
  private async abgleich(): Promise<void> {
    const o = this.zugang.offen();
    if (!o) return;
    const soll = this.soll(o.projekt);
    const senden = this.unterschiede(soll).filter((nr) => !this.laeuft() || this.nurMonitorImLauf(nr, soll));
    if (senden.length > 0) await this.sendeSpuren(senden, soll);
  }
  /** Tracks that differ from the core and are waiting to be sent (tests, diagnosis). */
  schmutzig(): number[] { return [...this.dirty].sort((a, b) => a - b); }
  /** A track the core confirmed: its state there (tests, diagnosis). */
  imKernStand(nr: number): { eingang: number; modus: number; monitor: number } | null { return this.imKern.get(nr) ?? null; }
  /** Waits until the syncs queued so far are done (tests). */
  async abgeglichen(): Promise<void> { await this.kette; }

  // The core reports /zustand/rec at 2 Hz and /zustand/arr at every change. An external run needs ausgang_vorhalt (with the PDC of the playback in
  // force) and the quantum. 1.8 T2: pdc_latenz follows the playback snapshot loaded in the core, not time. So first wait until the core plays the
  // project's playback number (the load goes through the core's loader thread; a few seconds at most), then until a /zustand/rec arrived after that.
  // Without a playback (wiedergabe_rev <= 0) no PDC exists and any report does. Called inside the lock after the audition ended and the tempo is at
  // the master, because both can load another playback.
  private async warteVorhalt(): Promise<number> {
    const rev = (): number => this.zugang.offen()?.projekt.wiedergabe_rev ?? 0;
    const warte = (ms: number, bis: () => boolean): Promise<boolean> => new Promise<boolean>((ok) => {
      if (bis()) { ok(true); return; }
      const fertig = (v: boolean): void => { clearTimeout(uhr); this.zustandWartend = this.zustandWartend.filter((f) => f !== sig); ok(v); };
      const sig = (): void => { if (bis()) fertig(true); };
      const uhr = setTimeout(() => fertig(bis()), ms);
      this.zustandWartend.push(sig);
    });
    // no /zustand/arr heard at all: that is no core (short wait), not a slow load
    if (this.arrNr === null && !(await warte(this.zustandMs, () => this.arrNr !== null))) throw new ProjFehler(409, 'kein_kern');
    if (rev() > 0 && !(await warte(this.ladeMs, () => this.arrNr === rev()))) {
      throw new ProjFehler(409, 'kein_kernstand', { rev_geladen: this.arrNr, wiedergabe_rev: rev(),
        text: 'the core has not loaded the current playback yet; try again in a moment' });
    }
    if (!(await warte(this.zustandMs, () => this.vorhalt !== null))) throw new ProjFehler(409, 'kein_kern');
    return this.vorhalt!;
  }

  // D9: per external track the device must exist, Cypher needs the release (D4); the offset is the profile plus what the core delays its master. This part
  // returns the profile samples (`versatz`, 0 for internal tracks) and the numbers of the tracks that get the core part too (external and MIDI tracks,
  // `kompensiert`); the core part (ausgang_vorhalt) is added by `mitVorhalt`. 1.8 T8: instrument tracks on midi_ein_1 need the MIDI release for Cypher
  // (midi.frei_fuer_cypher, else eingang_nicht_frei) and carry midi.versatz_samples as their profile part (absent = 0, no hint).
  private async plane(scharf: { id: string; nr: number; name: string; aufnahme?: { eingang: unknown } }[],
    quelle: Quelle): Promise<{ versatz: Map<number, number>; kompensiert: number[]; hinweise: string[] }> {
    const versatz = new Map<number, number>(), hinweise: string[] = [];
    const extern = scharf.filter((s) => eingangVon(s).art === 'extern'), midi = scharf.filter((s) => eingangVon(s).art === 'midi');
    for (const s of scharf) versatz.set(s.nr, 0);
    if (extern.length === 0 && midi.length === 0) return { versatz, kompensiert: [], hinweise };
    let k: Konfig;
    try { k = this.geraete.lies(); } catch (e) {
      if (e instanceof GeraeteFehler) throw new ProjFehler(e.code, e.grund);
      throw e;
    }
    for (const s of extern) {
      const e = k.eingaenge[(s.aufnahme!.eingang as EingangExtern).paar - 1];
      if (!e || e.audio === null) throw new ProjFehler(409, 'kein_eingang');
      if (quelle === 'cypher' && !e.frei_fuer_cypher) throw new ProjFehler(409, 'eingang_nicht_frei');
    }
    if (midi.length > 0 && quelle === 'cypher' && !k.midi.frei_fuer_cypher) throw new ProjFehler(409, 'eingang_nicht_frei');
    const mv = Math.round(k.midi.versatz_samples ?? 0);
    if (midi.length > 0 && (!Number.isFinite(mv) || mv < 0 || mv > NACHLAUF_MAX)) throw new ProjFehler(409, 'latenz_ungueltig', { versatz_samples: mv });
    for (const s of midi) versatz.set(s.nr, mv);
    for (const s of extern) {
      const l = k.eingaenge[(s.aufnahme!.eingang as EingangExtern).paar - 1].latenz;
      if (l === null) { if (!hinweise.includes('latenz_fehlt')) hinweise.push('latenz_fehlt'); }
      else if (this.quantum > 0 && l.quantum !== this.quantum && !hinweise.includes('latenz_veraltet')) hinweise.push('latenz_veraltet');
      const v = Math.round(l?.samples ?? 0);
      if (!Number.isFinite(v) || v < 0 || v > NACHLAUF_MAX) throw new ProjFehler(409, 'latenz_ungueltig', { versatz_samples: v });
      versatz.set(s.nr, v);
    }
    return { versatz, kompensiert: [...extern, ...midi].map((s) => s.nr), hinweise };
  }

  // 1.8 T2: adds what the core delays its master (limiter, channel, PDC of the playback in force) to the profile samples of the external tracks.
  // 1.8 T8: also to the MIDI tracks: the player plays to what he hears, and that is late by the same amount.
  private async mitVorhalt(versatz: Map<number, number>, kompensiert: number[]): Promise<void> {
    if (kompensiert.length === 0) return;
    const vorhalt = await this.warteVorhalt();
    for (const nr of kompensiert) {
      const v = (versatz.get(nr) ?? 0) + vorhalt;
      if (!Number.isFinite(v) || v < 0 || v > NACHLAUF_MAX) throw new ProjFehler(409, 'latenz_ungueltig', { versatz_samples: v });
      versatz.set(nr, v);
    }
  }

  lage(): Antwort {
    const l = this.lauf, z = this.letzte;
    return { code: 200, j: {
      lauf: l ? { kennung: l.kennung, start_beat: l.startBeat, seit_ms: Date.now() - l.seit, spuren: l.spuren, laufend: l.laufend } : null,
      letzte: z ? { kennung: z.kennung, code: z.antwort.code, ...(z.antwort.j as Record<string, unknown>) } : null,
    } };
  }

  // The transport that this start began, ended again; it ends by itself or no longer belongs to the caller otherwise
  private async transportStopp(quelle: Quelle): Promise<void> {
    try { await this.zugang.transport({ aktion: 'stopp' }, quelle); } catch { /* der Transport endet ohnehin oder gehört nicht mehr uns */ }
  }

  private async kern(adresse: '/k/rec/stopp', felder: Record<string, unknown>): Promise<void> {
    const id = this.ctx.sende(adresse, felder);
    const q = await this.ctx.warteQuittung(id);
    if (!q) throw new ProjFehler(409, 'kein_kern');
    if (q.status >= 6) throw new ProjFehler(409, q.grund || 'aufnahme_abgelehnt');
  }

  async start(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    this.startet++;   // synchron, vor dem ersten await: bis zum Ende des Starts sendet kein Abgleich, die Änderungen warten (dirty)
    try { return await this.starteLauf(d, quelle); } finally {
      this.startet--;
      if (this.lauf === null) this.planeAbgleich();   // the start failed: what waited in the meantime goes out now; a run flushes after its end (schliesseAb)
    }
  }

  private async starteLauf(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    if (this.lauf) throw new ProjFehler(409, 'aufnahme_laeuft');
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    // 1.8 S4b (D8): Andreas may record into his running transport (the take begins at the next bar); Cypher never does (transport_laeuft)
    const laufend = this.arrStatus === 2 && quelle === 'andreas';
    if (this.arrStatus !== 0 && !laufend) throw new ProjFehler(409, quelle === 'cypher' ? 'transport_laeuft' : 'ueberlappung');
    const beat = d.von_beat === undefined ? 0 : d.von_beat;
    if (typeof beat !== 'number' || !Number.isFinite(beat) || beat < 0 || beat > MAX_BEAT) throw new ProjFehler(400, 'beat_ungueltig');
    // 1.8 T8: instrument tracks on midi_ein_1 are armed tracks too; a run with only those is a run (the core accepts it since T7a)
    const scharf = o.projekt.spuren.filter((s) => (s.art === 'audio' || s.art === 'instrument') && s.aufnahme?.scharf && s.aufnahme.eingang);
    if (scharf.length === 0) throw new ProjFehler(409, 'nichts_scharf');
    if (scharf.some((s) => (s.art === 'audio' ? eingangVon(s).art !== 'intern' && eingangVon(s).art !== 'extern' : eingangVon(s).art !== 'midi'))) {
      throw new ProjFehler(409, 'eingang_fehlt');
    }
    this.pruefePlatz(o.ordner);                                                    // 409 kein_platz, before anything goes to the core
    // before the lock and before anything goes to the core: a refusal leaves no trace
    const { versatz, kompensiert, hinweise } = await this.plane(scharf, quelle);
    let nachlauf = 0;                                                         // set after mitVorhalt (the core part of the offset)
    const au = aufnahmeVon(o.projekt);
    const vorzaehler = laufend ? 0 : au.vorzaehler_takte;                   // D7: in a running transport the count-in is ignored
    const loopBeats = o.projekt.loop.an ? o.projekt.loop.bis_beat - o.projekt.loop.von_beat : null;
    const punch = au.punch.ein || au.punch.aus ? { ...au.punch } : null;
    // B1: die Aufnahme-Sperre, nicht die Freeze-Sperre (sie ließe den Transport-Start nicht durch). Synchron, vor dem ersten await: ein
    // zweiter gleichzeitiger Start
    // bekommt beschaeftigt; ebenso, solange ein Freeze, ein Export oder ein Öffnen läuft.
    const freigabe = this.zugang.sperreLaden('aufnahme');
    let behalten = false;
    this.abbruch = null;
    try {
      await this.zugang.beendeVorhoeren();   // 1.14 (R3): a recording start ends any audition first; the core must play the main lane
      await this.zugang.tempoAnMaster();
      await this.mitVorhalt(versatz, kompensiert);   // 1.8 T2: only now the playback in the core is the one of the project (audition ended, tempo set)
      nachlauf = Math.max(0, ...versatz.values());
      // Scharf-Stand im Kern angleichen (D13): einmal je Kern-Generation alle Spuren (der Kern kann von früher armiert sein), danach nur die Unterschiede,
      // auch die Spuren, die ein Abgleich während eines früheren Laufs zurückgestellt hat. Ein Abgleich, der noch läuft, wird abgewartet.
      await this.kette;
      const soll = this.soll(o.projekt);   // the same project state as `scharf` above
      const alle = this.kernBereinigt ? this.unterschiede(soll) : Array.from({ length: 32 }, (_, i) => i + 1);
      // alle Nachrichten zugleich senden, dann alle Quittungen abwarten (32 mal einzeln wären rund eine Sekunde)
      for (const x of await this.sendeSpuren(alle, soll)) {
        if (!x.q) throw new ProjFehler(409, 'kein_kern');
        // also aufnahme_laeuft, while the thread still closes the file of the last take (m1)
        if (x.q.status >= 6) throw new ProjFehler(409, x.q.grund || 'aufnahme_abgelehnt');
      }
      this.kernBereinigt = true;
      const kennung = this.zugang.naechsteNummer();
      const wartetEinsatz = laufend || vorzaehler > 0;
      const t0 = Date.now();
      const recId = this.ctx.sende('/k/rec/start', { kennung, nachlauf_samples: nachlauf, frist_samples: KERN_FRIST_SAMPLES, vorzaehler_takte: vorzaehler });
      this.beobachtet = recId;
      this.einsatzBeat = null;
      const q0 = await this.ctx.warteQuittung(recId);
      if (!q0) throw new ProjFehler(409, 'kein_kern');
      if (q0.status >= 6) throw new ProjFehler(409, q0.grund || 'aufnahme_abgelehnt');
      // R1: wirft der Transport (transport_laeuft, tempo_*, Zustand), hat der Kern /k/rec/start schon: ohne /k/rec/stopp bliebe er bis zur Frist scharf
      // und nähme den nächsten Transport-Start als Take auf, den kein Lauf kennt.
      let t: Antwort | null = null;
      if (!laufend) {   // D8: in a running transport there is no transport call; the core starts the take at the next bar
        try { t = await this.zugang.transport({ aktion: 'start', beat, ...(vorzaehler > 0 ? { vorzaehl_beats: 4 * vorzaehler } : {}) }, quelle); } catch (e) {
          try { await this.kern('/k/rec/stopp', {}); } catch { /* der Kern bricht den wartenden Start ohnehin ab */ }
          throw e;
        }
        const tq = (t.j as { quittung?: { status: number } | null } | null)?.quittung;
        if (t.code !== 200 || tq === null || (tq && [4, 6, 7, 8].includes(tq.status))) {
          try { await this.kern('/k/rec/stopp', {}); } catch { /* der Kern bricht den wartenden Start ohnehin ab */ }
          return t.code === 200 ? { code: 409, j: { fehler: 'transport_abgelehnt', text: 'the transport did not start; nothing was recorded' } } : t;
        }
      }
      // M1: hat der Kern die Aufnahme verworfen (Quittung 7 der Rec-ID: zu_spaet, abbruch, ki_stopp)? Dann läuft nichts mit. Der erste Entwurf
      // prüfte nur die Quittung des
      // Transports und meldete 200 laeuft; beim Stopp wartete er 30 s auf ein /e/aufnahme, das nie kam. Die Quittung 2 (Einsatz) kommt im
      // selben Block wie die des Transports.
      // 1.8 S4b.1a (D7, D8): with a count-in or a running start the receipt 2 (the entry) comes late; the horizon follows from the request
      // (quittungsFristMs), the transport answer tells the quant. Count-in 0 in a stopped transport waits as before.
      // The horizon counts from the command, so the time the transport call already waited is not added a second time.
      const quant = (((t?.j as { quant?: number } | null)?.quant ?? 0) as 0 | 1 | 2);
      const rest = Math.max(1, quittungsFristMs({ bpm: o.projekt.tempo_bpm, quant, vorzaehlerTakte: vorzaehler, laufend, loopBeats }) - (Date.now() - t0));
      const rq = wartetEinsatz ? await this.ctx.warteQuittung(recId, undefined, false, rest) : await this.ctx.warteQuittung(recId);
      const verworfen = this.abbruch ?? (rq && rq.status === 7 ? (rq.grund || 'abbruch') : null);
      if (verworfen !== null) {
        if (!laufend) await this.transportStopp(quelle);
        throw new ProjFehler(409, 'aufnahme_abgebrochen', { grund: verworfen });
      }
      if (wartetEinsatz && !(rq && (rq.status === 2 || rq.status === 3))) {   // no entry within the horizon: take back the core and this call's transport
        try { await this.kern('/k/rec/stopp', {}); } catch { /* der Kern bricht den wartenden Start ohnehin ab */ }
        if (!laufend) await this.transportStopp(quelle);
        throw new ProjFehler(409, 'einsatz_ausgeblieben');
      }
      // D8: inside a running transport the take began where receipt 2 says (a project beat); after a stopped start it began at the transport start beat
      const startBeat = laufend ? (this.einsatzBeat ?? beat) : beat;
      this.lauf = { kennung, recId, startBeat, bpm: o.projekt.tempo_bpm, quelle, seit: Date.now(), verworfen: null, abschluss: null, nachlauf, laufend, punch,
        overdub: au.overdub,
        spuren: scharf.map((s) => ({ id: s.id, nr: s.nr, name: s.name, versatz_samples: versatz.get(s.nr) ?? 0,
          ...(s.art === 'instrument' ? { art: 'instrument' as const } : {}) })) };
      this.letzte = null;
      this.zugang.aufnahmeLauf(this.lauf);
      this.frei = freigabe;
      behalten = true;
      return { code: 200, j: { aufnahme: 'laeuft', kennung, spuren: this.lauf.spuren, nachlauf_samples: nachlauf, start_beat: startBeat,
        ...(laufend ? { laufend: true } : {}), ...(hinweise.length > 0 ? { hinweise } : {}) } };
    } finally {
      this.beobachtet = null;
      this.abbruch = null;
      this.einsatzBeat = null;
      if (!behalten) freigabe();
    }
  }

  private warteMeldung(nr: number, kennung: number): Promise<Meldung | null> { return this.warteSchluessel(`${nr}:${kennung}`); }
  private warteSchluessel(k: string): Promise<Meldung | null> {
    const da = this.gemeldet.get(k);
    if (da) return Promise.resolve(da);
    return new Promise((ok) => {
      const uhr = setTimeout(() => { this.wartend.delete(k); ok(null); }, this.fristMs);
      this.wartend.set(k, (m) => { clearTimeout(uhr); ok(m); });
    });
  }

  async stopp(quelle: Quelle): Promise<Antwort> {
    const l = this.lauf;
    if (!l) {
      const z = this.letzte;   // M2: der Lauf endete auf anderem Weg; das Ergebnis liegt bereit und wird einmal geliefert
      if (z && !z.geliefert) { z.geliefert = true; return z.antwort; }
      throw new ProjFehler(409, 'keine_aufnahme');
    }
    // N3: erst der Transport. Lehnt er ab (Cypher will einen Lauf stoppen, den Andreas gestartet hat: transport_laeuft), bleibt der Lauf
    // unberührt und die Sperre gehalten.
    // Der erste Entwurf gab den Lauf in einem finally frei, auch wenn der Stopp abgelehnt wurde; der Kern nahm weiter auf, der Server hielt nichts mehr.
    // 1.8 S4b (D8): a run that began inside Andreas' running transport ends the recording only, the transport keeps playing; Cypher does not end his recording
    if (!l.abschluss) {
      if (!l.laufend) await this.zugang.transport({ aktion: 'stopp' }, quelle);
      else if (l.quelle === 'andreas' && quelle === 'cypher') {
        throw new ProjFehler(409, 'transport_laeuft', { text: 'a recording Andreas started is running; Cypher stops only a recording she started' });
      } else await this.kern('/k/rec/stopp', {});
    }
    try { return await this.beende(l); } finally { if (this.letzte?.kennung === l.kennung) this.letzte.geliefert = true; }
  }

  // Ein Ende pro Lauf, egal von welchem Weg (POST stopp, Meldungen des Kerns, Quittung 7)
  private beende(l: Lauf): Promise<Antwort> {
    l.abschluss ??= this.schliesseAb(l);
    return l.abschluss;
  }
  private async schliesseAb(l: Lauf): Promise<Antwort> {
    try {
      // the MIDI take is ONE report for all instrument tracks of the run (spur 0, art 1): wait for it once
      const audio = l.spuren.filter((s) => s.art === undefined);
      const antwort = l.verworfen !== null
        ? alsAntwort(new ProjFehler(409, 'aufnahme_abgebrochen', { grund: l.verworfen }), this.ctx)
        : await this.uebernehmen(l, await Promise.all(audio.map((s) => this.warteMeldung(s.nr, l.kennung))),
          audio.length < l.spuren.length ? await this.warteSchluessel(midiSchluessel(l.kennung)) : null);
      this.letzte = { kennung: l.kennung, antwort, geliefert: false };
      return antwort;
    } catch (e) {
      this.letzte = { kennung: l.kennung, antwort: alsAntwort(e, this.ctx), geliefert: false };
      throw e;
    } finally {
      this.lauf = null;
      this.zugang.aufnahmeLauf(null);
      for (const s of l.spuren) this.gemeldet.delete(`${s.nr}:${l.kennung}`);
      this.gemeldet.delete(midiSchluessel(l.kennung));
      const f = this.frei; this.frei = null;
      if (f) f();
      this.planeAbgleich();   // D13: the tracks that changed during the run (arm, input, mode) go to the core now
    }
  }

  // `meldungen` are the reports of the audio tracks of the run in their order, `midi` the one report of the MIDI take (null when no instrument track took part)
  private async uebernehmen(l: Lauf, meldungen: (Meldung | null)[], midi: Meldung | null = null): Promise<Antwort> {
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const meta = { quelle: l.quelle, label: `Record ${l.spuren.map((s) => s.name).join(', ')}` };
    const ergebnis: Record<string, unknown>[] = [];
    let neu: Projekt = structuredClone(o.projekt);
    l.spuren.filter((s) => s.art === undefined).forEach((s, i) => {
      const m = meldungen[i];
      const roh = path.join(this.zugang.arbeitsordner(), `aufnahme-${s.nr}-${l.kennung}.f32`);
      if (!m || !fs.existsSync(roh)) {   // Status 2 (abgebrochen) sendet der Kern nie (abbrechen() meldet nicht); der Zweig bleibt für später
        ergebnis.push({ spur_id: s.id, fehler: 'datei_fehlt', text: 'the take file is missing; nothing was placed on the track' });
        return;
      }
      const wav = path.join(o.ordner, 'aufnahmen', `take-${l.kennung}-${s.nr}.wav`);
      try {
        const w = schreibeWavAusF32(roh, wav);
        if (w.frames === 0) {   // jedes Gründe-Literal braucht ein text daneben (proj_reasons_text.test.mjs, N9)
          ergebnis.push({ spur_id: s.id, fehler: 'leer', text: 'the take contains no audio; the file is kept', datei: wav });
          return;
        }
        const zusatz = m.status === 1 ? ' (gaps)' : m.status === 2 ? ' (aborted)' : m.status === 3 ? ' (disk full)' : '';
        const laengeBeats = (w.frames / 48000) * (l.bpm / 60);
        // D6: the punch range of the project at the start, resolved against the take: both edges = the range; only ein = from its start to the end of the take
        // (the raw end, tail included: no cut there); only aus = from the start of the take to its end
        const punch = l.punch === null ? undefined
          : { von_beat: l.punch.ein ? l.punch.von_beat : l.startBeat, bis_beat: l.punch.aus ? l.punch.bis_beat : l.startBeat + laengeBeats };
        neu = nehmeTakeAuf(neu, { spurId: s.id, startBeat: l.startBeat, laengeBeats, sha256: w.sha256, pfadHinweis: wav,
          name: `Take ${l.kennung}${zusatz}`, versatzSamples: s.versatz_samples, nachlaufSamples: l.nachlauf,
          abgebrochen: m.status === 2 || m.status === 3, ...(punch ? { punch } : {}) });   // D9, D6
        ergebnis.push({ spur_id: s.id, frames: w.frames, luecken: m.luecken, status: m.status, datei: wav,
          versatz_samples: s.versatz_samples, nachlauf_samples: l.nachlauf, ...(punch ? { punch } : {}) });
      } catch (e) {
        // R1: ein Fehler dieser Spur verwirft die anderen Spuren des Laufs nicht; die Rohdatei bleibt, der Clip wird nicht gesetzt
        if (e instanceof TakeFehler) ergebnis.push({ spur_id: s.id, fehler: e.grund, text: grundText(e.grund), datei: wav });
        else {
          ergebnis.push({ spur_id: s.id, fehler: 'uebernahme_fehler', text: 'the take could not be placed on the track; the raw file is kept',
            detail: String((e as Error).message ?? e), datei: wav });
        }
      }
    });
    const instrumente = l.spuren.filter((s) => s.art === 'instrument');
    if (instrumente.length > 0) neu = this.uebernimmMidi(l, midi, instrumente, neu, ergebnis);
    if (ergebnis.every((e) => e.fehler)) return { code: 200, j: { takes: ergebnis, rev: o.projekt.rev } };
    // kein Clip gesetzt: die Dateien bleiben, der Stand ändert sich nicht
    const w = aendereStand(o.verlauf, o.projekt, neu, meta, this.zugang.haken());
    if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
    return { code: 200, j: { takes: ergebnis, rev: this.zugang.offen()?.projekt.rev ?? w.projekt.rev } };
  }

  // 1.8 T8: the MIDI take (midi-<kennung>.bin of the work folder) becomes notes on every instrument track of the run; the pass ends where the audio pass would
  // (the end of the take minus the tail, or minus the own offset when it ended early). One failing track does not discard the others, as for audio;
  // the file stays.
  private uebernimmMidi(l: Lauf, m: Meldung | null, spuren: LaufSpur[], neu0: Projekt, ergebnis: Record<string, unknown>[]): Projekt {
    let neu = neu0;
    const datei = path.join(this.zugang.arbeitsordner(), `midi-${l.kennung}.bin`);
    const fehler = (fehler: string, text: string): void => { for (const s of spuren) ergebnis.push({ spur_id: s.id, fehler, text, datei }); };
    let ereignisse;
    try { ereignisse = m && fs.existsSync(datei) ? leseMidiDatei(fs.readFileSync(datei)) : null; } catch { ereignisse = null; }
    if (!m || ereignisse === null) { fehler('datei_fehlt', 'the MIDI take file is missing; nothing was placed on the track'); return neu; }
    if (ereignisse.length === 0) { fehler('keine_noten', grundText('keine_noten')); return neu; }
    const proSample = l.bpm / (60 * 48000);
    const abgebrochen = m.status === 2 || m.status === 3, versatz = spuren[0].versatz_samples;
    let ende = ereignisse[ereignisse.length - 1].sample;   // without a sidecar the last event is the best end there is
    try {
      const b = JSON.parse(fs.readFileSync(datei.replace(/\.bin$/, '.json'), 'utf8')) as { ende_sample?: unknown };
      if (typeof b.ende_sample === 'number' && b.ende_sample >= m.start_sample) ende = b.ende_sample - (abgebrochen ? versatz : l.nachlauf);
    } catch { /* no sidecar */ }
    const endeBeat = l.startBeat + (ende - m.start_sample) * proSample;
    const punch = l.punch === null ? undefined
      : { von_beat: l.punch.ein ? l.punch.von_beat : l.startBeat, bis_beat: l.punch.aus ? l.punch.bis_beat : endeBeat };
    const zusatz = m.status === 1 ? ' (gaps)' : m.status === 3 ? ' (disk full)' : '';
    for (const s of spuren) {
      const a: MidiTakeAngabe = { spurIds: [s.id], startBeat: l.startBeat, bpm: l.bpm, startSample: m.start_sample, ereignisse,
        versatzSamples: s.versatz_samples, overdub: l.overdub, endeBeat, name: `Take ${l.kennung}${zusatz}`, ...(punch ? { punch } : {}) };
      try {
        neu = nehmeMidiAuf(neu, a);
        ergebnis.push({ spur_id: s.id, art: 'midi', ereignisse: m.frames, noten: midiTakeNoten(a), luecken: m.luecken, status: m.status, datei,
          versatz_samples: s.versatz_samples, overdub: l.overdub, ...(punch ? { punch } : {}) });
      } catch (e) {
        if (e instanceof TakeFehler) ergebnis.push({ spur_id: s.id, fehler: e.grund, text: grundText(e.grund), datei });
        else {
          ergebnis.push({ spur_id: s.id, fehler: 'uebernahme_fehler', text: 'the take could not be placed on the track; the file is kept',
            detail: String((e as Error).message ?? e), datei });
        }
      }
    }
    return neu;
  }

  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse === '/zustand/arr') {
      this.arrStatus = Number(f.status);
      const nr = Number(f.nr);
      if (Number.isFinite(nr) && nr !== this.arrNr) {   // 1.8 T2: another playback in the core: its PDC is not in the cached report
        this.arrNr = nr; this.vorhalt = null;
        for (const ok of [...this.zustandWartend]) ok();
      }
      return;
    }
    // D13: a new core generation knows nothing of what the old one confirmed; a hello flushes what waits
    if (adresse === '/k/willkommen' || adresse === '/e/neustart') {
      const g = Number(f.generation);
      if (this.generation !== g) { this.generation = g; this.imKern.clear(); this.kernBereinigt = false; this.arrNr = null; this.vorhalt = null; }
      this.planeAbgleich();
      return;
    }
    if (adresse === '/zustand/rec') {   // 1.8 S2b (D9): what the core delays its master, and the cycle size the latency profile was measured at
      if (typeof f.ausgang_vorhalt === 'number') { this.vorhalt = f.ausgang_vorhalt; this.quantum = typeof f.quantum === 'number' ? f.quantum : 0; }
      for (const ok of [...this.zustandWartend]) ok();   // the waiters check their own condition and remove themselves
      return;
    }
    if (adresse === '/q') {   // Weg 3: der Kern verwirft die Aufnahme (Quittung 7 der Rec-ID)
      if (Number(f.status) === 2 && Number(f.id) === this.beobachtet && typeof f.ist_beat === 'number') this.einsatzBeat = f.ist_beat;   // D8
      if (Number(f.status) !== 7) return;
      const id = Number(f.id), grund = String(f.grund ?? '') || 'abbruch';
      const l = this.lauf;
      if (l && id === l.recId) { l.verworfen = grund; void this.beende(l).catch(() => { /* das Ergebnis steht in letzte */ }); }
      else if (id === this.beobachtet) this.abbruch = grund;
      return;
    }
    if (adresse === '/e/aufnahme') {
      const m: Meldung = { spur: Number(f.spur), kennung: Number(f.kennung), status: Number(f.status), frames: Number(f.frames),
        start_sample: Number(f.start_sample), luecken: Number(f.luecken), art: Number(f.art ?? 0) };
      const k = m.art === 1 ? midiSchluessel(m.kennung) : `${m.spur}:${m.kennung}`;
      this.gemeldet.set(k, m);
      if (this.gemeldet.size > GEMELDET_MAX) this.gemeldet.delete(this.gemeldet.keys().next().value as string);
      this.wartend.get(k)?.(m);
      this.wartend.delete(k);
      // Weg 2: sind alle Takes des Laufs gemeldet, ist der Lauf zu Ende, auch wenn niemand POST stopp gerufen hat (Transport anders gestoppt,
      // Arrangement zu Ende)
      const l = this.lauf;
      const da = (s: LaufSpur): boolean => this.gemeldet.has(s.art === 'instrument' ? midiSchluessel(l!.kennung) : `${s.nr}:${l!.kennung}`);
      if (l && !l.abschluss && m.kennung === l.kennung && l.spuren.every(da)) {
        void this.beende(l).catch(() => { /* das Ergebnis steht in letzte */ });
      }
    }
  }
  schliesse(): void {
    for (const f of this.wartend.values()) f(null);
    this.wartend.clear();
    const f = this.frei; this.frei = null;
    if (f) f();
    this.lauf = null;
  }
}

const eingangCode = (e: EingangIntern | EingangExtern): number => (e.art === 'extern' ? e.paar : eingangsCode(e.name));

export function aufnahmeBereich(ctx: BereichKontext, zugang: ProjZugang,
  opt: { fristMs?: number; geraeteKonfig?: string; zustandMs?: number; ladeMs?: number } & Platz = {}): Bereich & { aufnahme: Aufnahme } {
  const a = new Aufnahme(ctx, zugang, opt.fristMs, opt.geraeteKonfig, opt.zustandMs, opt.ladeMs, { minFreiBytes: opt.minFreiBytes, statfs: opt.statfs });
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/proj/aufnahme', schutz: 'offen', handler: (_q, r) => antworte(r, () => a.lage()) },
    { methode: 'POST', pfad: '/proj/aufnahme', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => {
        const d = await leseKoerper(q);
        if (d.aktion === 'start') return a.start(d, quelle);
        if (d.aktion === 'stopp') return a.stopp(quelle);
        throw new ProjFehler(400, 'aktion_unbekannt');
      });
    } },
  ];
  return { name: 'proj-aufnahme', aufnahme: a, routen, ereignis: (adresse, felder) => a.ereignis(adresse, felder) };
}

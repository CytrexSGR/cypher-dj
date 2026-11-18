import fs from 'node:fs';
import type { Antwort, Koerper, Offen } from './session.ts';
import { ProjFehler } from './session.ts';
import type { BereichKontext } from '../../http/router.ts';
import { quittungAbgelehnt, type KernWeg, type Quelle, type Quittung } from './core_path.ts';
import { sucheSpur, type Projekt } from '../../project/model.ts';
import { wiedergabeDatei } from '../../project/playback.ts';

// The part of ProjSitzung that the take audition (pre-listen) reaches (the rest stays with the session). The `get` members read live fields.
export interface VorhoerenHost {
  readonly arbeitsordner: string;
  readonly aufnahmeLauf: unknown;
  brauchOffen(): Offen;
  readonly ctx: BereichKontext;
  readonly kern: KernWeg;
  ladeWiedergabe(quelle: Quelle, vorhoeren?: ReadonlyMap<string, string>): Promise<Record<string, unknown>>;
  readonly offen: Offen | null;
  riegel(quelle: Quelle): void;
  schreibeVorhoerWiedergabe(p: Projekt, vorhoeren: ReadonlyMap<string, string>, streng?: boolean): number | null;
  seriell<T>(f: () => Promise<T>): Promise<T>;
  readonly sperren: number;
  readonly sperrenAufnahme: number;
}

export class SitzungVorhoeren {
  private readonly h: VorhoerenHost;
  constructor(h: VorhoerenHost) { this.h = h; }
  // --- 1.14 comping: audition (spec R8) -------------------------------------------------------------------------------------------------
  private meldeVorhoeren(o: Offen): void { this.h.ctx.verteile({ a: 'take_vorhoeren', f: { vorhoeren: Object.fromEntries(o.vorhoeren) } }); }
  // Empties the map (event only when it was not empty). No reload: the callers load the main playback themselves or the project goes away.
  leereVorhoeren(o: Offen): boolean {
    if (o.vorhoeren.size === 0) return false;
    o.vorhoeren.clear();
    this.meldeVorhoeren(o);
    return true;
  }
  // The audition map without the entries whose track or take no longer exists in p (the state after a command, undo or redo).
  gueltigeVorhoeren(o: Offen, p: Projekt): Map<string, string> {
    return new Map([...o.vorhoeren].filter(([spurId, takeId]) => p.spuren.find((s) => s.id === spurId)?.takes?.some((t) => t.id === takeId)));
  }
  // Replaces the map; one event when it changed.
  setzeVorhoeren(o: Offen, neu: ReadonlyMap<string, string>): void {
    if (neu.size === o.vorhoeren.size && [...neu].every(([k, v]) => o.vorhoeren.get(k) === v)) return;
    o.vorhoeren = new Map(neu);
    this.meldeVorhoeren(o);
  }
  vorhoerenLage(): Antwort { return { code: 200, j: { vorhoeren: Object.fromEntries(this.h.offen?.vorhoeren ?? []) } }; }
  // POST /proj/take_vorhoeren {spur_id, take_id | null}: one take per track, several tracks at once. A change reloads the playback once.
  vorhoerenSetzen(d: Koerper, quelle: Quelle): Promise<Antwort> {
    return this.h.seriell(async () => {
      const o = this.h.brauchOffen();
      this.h.riegel(quelle);
      if (typeof d.spur_id !== 'string' || !(d.take_id === null || typeof d.take_id === 'string')) {
        throw new ProjFehler(400, 'argument_ungueltig', { text: 'spur_id: a track id is required; take_id: a take id, or null to switch the audition off' });
      }
      if (this.h.aufnahmeLauf || this.h.sperrenAufnahme > 0) throw new ProjFehler(409, 'aufnahme_laeuft');
      const spur = sucheSpur(o.projekt, d.spur_id);
      if (!spur) throw new ProjFehler(404, 'spur_unbekannt');
      const vorher = new Map(o.vorhoeren), neu = new Map(o.vorhoeren);
      if (d.take_id === null) neu.delete(spur.id);
      else {
        if (!spur.takes?.some((t) => t.id === d.take_id)) throw new ProjFehler(404, 'take_unbekannt');
        neu.set(spur.id, d.take_id);
      }
      const antwort = (kern?: Record<string, unknown>): Antwort =>
        ({ code: 200, j: { vorhoeren: Object.fromEntries(o.vorhoeren), ...(kern ? { kern } : {}) } });
      if (neu.size === vorher.size && [...neu].every(([k, v]) => vorher.get(k) === v)) return antwort();
      // Under a lock (freeze, export) the load waits: the map stays set and the answer says so, like the other write paths
      if (this.h.sperren > 0) {
        this.setzeVorhoeren(o, neu); o.merk.laden = true;
        return antwort({ wiedergabe: { nr: null, aufgeschoben: true } });
      }
      let wiedergabe: Record<string, unknown>;
      try { wiedergabe = await this.ladeVorhoerenStand(o, neu, quelle); } catch (e) {
        if (e instanceof ProjFehler) throw e;
        this.h.ctx.log({ typ: 'proj_vorhoeren_laden_fehler', fehler: (e as Error).message });
        throw e;
      }
      this.setzeVorhoeren(o, neu);
      return antwort({ wiedergabe });
    });
  }
  // Loads the playback of the audition map `neu`: the audition file when it is not empty, else the main playback (its file, or a fresh one when that
  // is missing or stale). The map is not touched here. A refusal of the translator or of the core throws ProjFehler, so the caller keeps the old map:
  // the reason is the core's own (q.grund), 409 like every other refusal of the core (recording, regulators, tempo). No core (null) is not a refusal.
  private async ladeVorhoerenStand(o: Offen, neu: ReadonlyMap<string, string>, quelle: Quelle): Promise<Record<string, unknown>> {
    const rev = o.projekt.wiedergabe_rev;
    let nr: number;
    if (neu.size > 0) nr = this.h.schreibeVorhoerWiedergabe(o.projekt, neu, true) as number;
    else if (!o.merk.laden && rev > 0 && fs.existsSync(wiedergabeDatei(this.h.arbeitsordner, rev))) nr = rev;
    else {
      const w = await this.h.ladeWiedergabe(quelle, neu);
      if (typeof w.nr !== 'number') throw new ProjFehler(409, (w.fehler as string) ?? 'nicht_geladen', { detail: w.detail, kern: { wiedergabe: w } });
      if (quittungAbgelehnt(w.quittung as Quittung)) throw new ProjFehler(409, (w.quittung as Quittung).grund || 'nicht_geladen', { kern: { wiedergabe: w } });
      return w;
    }
    const quittung = await this.h.kern.laden(nr, quelle);
    if (quittungAbgelehnt(quittung)) throw new ProjFehler(409, quittung.grund || 'nicht_geladen', { kern: { wiedergabe: { nr, quittung } } });
    if (neu.size === 0) o.merk.laden = false;
    return { nr, quittung };
  }
  // For a caller that holds the load lock itself (recording start, freeze start): ends the audition and loads the main playback now, because the
  // transport or the freeze needs the core to play wiedergabe_rev. A second lock holder (a running freeze) defers the load to its release instead.
  beendeVorhoeren(): Promise<void> {
    return this.h.seriell(async () => {
      const o = this.h.offen;
      if (!o || !this.leereVorhoeren(o)) return;
      if (this.h.sperren > 1) { o.merk.laden = true; return; }
      await this.h.ladeWiedergabe('andreas');
    });
  }
}

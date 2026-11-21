// Controller write-back for project tracks: a value a controller put on the core row spur/<slot>/bk/<k> reaches the project as ONE geraet_param_setzen
// per knob once it has rested (400 ms), label "Controller", as Andreas' own change (undoable).
//
// Origin: the kern event /e/regler carries `halter` (INTERFACES 5.7: frei | mensch | plan:<id> | <source>). `mensch` is set ONLY by the stellwerk's hand
// path (a controller grip through a mapping table, hand.cpp hand_anwenden); everything the page server writes goes out as /k/teil with the holder
// `andreas` or `cypher` (core_path.ts teile), and a /k/teil on a row the hand holds is refused (regler_beim_menschen) and sends no value event.
// The arrangement is a sink of the row, never a source: a playback rebuild, a lane and a clip envelope emit no /e/regler for the row (arr_output.cpp
// bk_ueber_*), and spur_bk rows are not stored in the state file, so a kern restart restores none. The session's own mixer return path (session.ts
// rueckweg) relies on the same field. So: only events with halter `mensch` are taken, and only when the value differs from the one seen before
// (a touch without a move repeats the value) and from the project's value (an echo of what the project holds).
//
// A knob that a lane or a clip envelope of its track drives is never written back (the lane wins in the core; the stored value would not sound).
// The hand holds the row for 32 beats after the last grip and the core refuses a /k/teil on it, so before the write the hold is released with
// /k/hand/frei (source andreas, only that row); the controller's next grip takes it again.
import type { BereichKontext } from '../../http/router.ts';
import { BK_KNOPF_VORGABE, bkSlot, BK_LIVE_SLOTS, type Projekt } from '../../project/model.ts';

export const RUHE_MS = 400;
const ZEILE = /^spur\/([1-9][0-9]?)\/bk\/([1-9][0-9]?)$/;   // the slot range itself is BK_LIVE_SLOTS (spurDerZeile)
const EPS = 1e-6;

export interface ZurueckZugang {
  offen(): { projekt: Projekt } | null;
  aendern(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<unknown>;
}

/** The track (id) of a core row spur/<slot>/bk/<k> in the project, or null (no such bk track, slot beyond the live rows). */
function spurDerZeile(p: Projekt, slot: number): { id: string; spur: Projekt['spuren'][number] } | null {
  const bk = p.spuren.filter((s) => s.geraet?.art === 'intern' && s.geraet.name === 'bk').sort((a, b) => a.nr - b.nr);
  const s = bk[slot - 1];
  return s && slot <= BK_LIVE_SLOTS && bkSlot(p, s.id) === slot ? { id: s.id, spur: s } : null;
}

/** True when a lane or a clip envelope of the track drives the knob. */
export function laneTreibt(spur: Projekt['spuren'][number], param: string): boolean {
  const ziel = `geraet.${param}`;
  if ((spur.automation ?? []).some((l) => (l.ziel as unknown) === ziel)) return true;
  return (spur.clips ?? []).some((c) => ((c as { huellkurven?: { ziel: string }[] }).huellkurven ?? []).some((h) => h.ziel === ziel));
}

export class ReglerZurueck {
  private readonly ctx: BereichKontext;
  private readonly zugang: ZurueckZugang;
  private readonly ruheMs: number;
  private readonly letzt = new Map<string, number>();                       // path -> last value seen in any /e/regler event
  private readonly wartend = new Map<string, { wert: number; timer: NodeJS.Timeout }>();
  private kette: Promise<unknown> = Promise.resolve();

  constructor(ctx: BereichKontext, zugang: ZurueckZugang, ruheMs = RUHE_MS) { this.ctx = ctx; this.zugang = zugang; this.ruheMs = ruheMs; }

  ereignis(f: Record<string, unknown>): void {
    const pfad = f.pfad, wert = f.wert;
    if (typeof pfad !== 'string' || typeof wert !== 'number' || !Number.isFinite(wert)) return;
    const m = ZEILE.exec(pfad);
    if (!m || Number(m[2]) > 64) return;
    const vorher = this.letzt.get(pfad);
    this.letzt.set(pfad, wert);
    if (f.halter !== 'mensch') return;                                        // the page, a plan, a release: never a controller grip
    if (vorher !== undefined && Math.abs(vorher - wert) < EPS) return;        // a touch without a move, a repeated report
    const alt = this.wartend.get(pfad);
    if (alt) clearTimeout(alt.timer);
    const timer = setTimeout(() => {
      this.wartend.delete(pfad);
      this.kette = this.kette.then(() => this.schreibe(pfad, wert)).catch((e) => this.ctx.log({ typ: 'controller_zurueck_fehler', pfad, fehler: (e as Error).message }));
    }, this.ruheMs);
    timer.unref();
    this.wartend.set(pfad, { wert, timer });
  }

  /** Forget a waiting value (the project was closed or replaced). */
  verwirf(): void { for (const w of this.wartend.values()) clearTimeout(w.timer); this.wartend.clear(); }

  private async schreibe(pfad: string, wert: number): Promise<void> {
    const m = ZEILE.exec(pfad);
    const o = this.zugang.offen();
    if (!m || !o) return;
    const z = spurDerZeile(o.projekt, Number(m[1]));
    if (!z) return;
    const param = `k${Number(m[2])}`;
    if (laneTreibt(z.spur, param)) return;
    const w = Math.min(1, Math.max(0, wert));
    const ist = (z.spur.geraet as { parameter?: Record<string, number> } | undefined)?.parameter?.[param] ?? BK_KNOPF_VORGABE;
    if (Math.abs(ist - w) < EPS) return;
    const id = this.ctx.sende('/k/hand/frei', { quelle: 'andreas', pfade: pfad });
    await this.ctx.warteQuittung(id);
    const jetzt = this.zugang.offen();
    if (!jetzt) return;                                                        // the project was closed meanwhile
    const p = jetzt.projekt;                                                   // it may have changed while the hold was released: look again
    const z2 = spurDerZeile(p, Number(m[1]));
    if (!z2 || z2.id !== z.id || laneTreibt(z2.spur, param)) return;
    await this.zugang.aendern({ rev: p.rev, label: 'Controller', befehle: [{ befehl: 'geraet_param_setzen', spur_id: z.id, param, wert: w }] }, 'andreas');
  }
}

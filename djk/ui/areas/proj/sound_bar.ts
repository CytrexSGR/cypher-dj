// FIND SOUND, COMPARE: the bar line of the open project and the scheduled core parts the compare of the round rides on. The core's own scheduler
// switches the audition on the bar line (/k/teil with ab_beat, plan 'klang'); this file only reads the clock the core reports and sends those parts.
// Nothing here changes the core: it uses messages the core already knows (/k/teil with a future ab_beat, /k/abbruch with a plan name).
import type { BereichKontext } from '../../http/router.ts';
import { bkSlot, sucheSpur, type Projekt } from '../../project/model.ts';
import type { Quelle } from '../../project/history.ts';
import { vorlaufBeats } from '../../tempo_ramp.ts';

/** What the bar target needs: the core beat now, the offset core beat - project beat, the tempo and the loop. */
export interface ZielEingang {
  kBeat: number;
  offset: number;
  bpm: number;
  loopVon: number;
  loopBis: number;
  loopAn: boolean;
  /** The arrangement plays. */
  laeuft: boolean;
}

const EPS = 1e-9;
/** The final receipts that mean the part was executed (2 running, 3 done, 5 executed late). */
const AUSGEFUEHRT = new Set([2, 3, 5]);

/** Beats of one bar of the project (taktart [numerator, denominator]; the project beat is a quarter). */
export const takteBeats = (taktart: readonly [number, number]): number => (taktart[0] * 4) / taktart[1];

/** The CORE beat of the next project bar line at least one lead (vorlaufBeats) ahead of kBeat; null = the transport does not play. A bar target behind
 *  the loop end becomes the loop end itself when the loop is not a whole number of bars (the bar grid shifts at the seam). */
export function zielBeat(p: ZielEingang, takt: number): number | null {
  if (!p.laeuft || !(takt > 0)) return null;
  const frueh = p.kBeat + vorlaufBeats(p.bpm) - p.offset;
  let ziel = Math.ceil(frueh / takt - EPS) * takt;
  if (p.loopAn && ziel > p.loopBis + EPS && frueh <= p.loopBis + EPS) {
    const rest = (p.loopBis - p.loopVon) / takt;
    if (Math.abs(rest - Math.round(rest)) > EPS) ziel = p.loopBis;
  }
  return ziel + p.offset;
}

/** The clock of the core as the events report it. The core sends /uhr and then /zustand/arr in one cycle: a /zustand/arr pairs with the newest /uhr
 *  that arrived since the previous /zustand/arr, and the pair gives the offset core beat - project beat. A new core forgets it. */
export class TaktUhr {
  private uhr: { beat: number; bpm: number } | null = null;
  private arr: { status: number; loopAn: boolean } | null = null;
  private paar: number | null = null;
  private offset: number | null = null;

  nimm(adresse: string, f: Record<string, unknown>): void {
    if (adresse === '/uhr') { this.uhr = { beat: Number(f.beat), bpm: Number(f.bpm) }; this.paar = this.uhr.beat; return; }
    if (adresse === '/zustand/arr') {
      this.arr = { status: Number(f.status), loopAn: Number(f.loop_an) === 1 };
      const pb = Number(f.projekt_beat);
      if (this.paar !== null && Number.isFinite(this.paar) && Number.isFinite(pb)) this.offset = this.paar - pb;
      this.paar = null;
      return;
    }
    if (adresse === '/e/neustart') { this.arr = null; this.offset = null; this.paar = null; }
  }

  /** The bar target input, or null while the clock or the offset is unknown. */
  lage(loop: { von_beat: number; bis_beat: number }): ZielEingang | null {
    if (!this.uhr || !this.arr || this.offset === null) return null;
    return { kBeat: this.uhr.beat, offset: this.offset, bpm: this.uhr.bpm, loopVon: loop.von_beat, loopBis: loop.bis_beat, loopAn: this.arr.loopAn,
      laeuft: this.arr.status === 2 };
  }
  beat(): { beat: number; bpm: number } | null { return this.uhr; }
}

/** What the round needs for COMPARE (areas/proj/sound_runde.ts); tests give doubles. */
export interface TaktZugang {
  /** The core beat of the next bar line of the open project that can still be met, or null (transport stopped, clock unknown, no project). */
  zielBeat(): number | null;
  /** Beats of one bar of the open project. */
  takt(): number;
  /** Schedules the knob rows (and the fader row) of one side at `abBeat` and resolves with the final receipt: ausgefuehrt = every row was executed. */
  teile(plan: string, quelle: Quelle, abBeat: number, spurId: string, werte: Readonly<Record<string, number>>,
    faderDb?: number): Promise<{ ausgefuehrt: boolean }>;
  /** Ends every open part of the plan (waiting ones are deleted). */
  abbruch(plan: string, quelle: Quelle): Promise<void>;
}

/** The access of the round to the core clock and the scheduler: only the open project, the clock and the context of the page server. */
export function baueTaktZugang(ctx: Pick<BereichKontext, 'sende' | 'warteQuittung'>, uhr: TaktUhr,
  offen: () => { projekt: Projekt } | null): TaktZugang {
  return {
    zielBeat: () => {
      const o = offen();
      const l = o ? uhr.lage(o.projekt.loop) : null;
      return o && l ? zielBeat(l, takteBeats(o.projekt.taktart)) : null;
    },
    takt: () => { const o = offen(); return o ? takteBeats(o.projekt.taktart) : 4; },
    async teile(plan, quelle, abBeat, spurId, werte, faderDb) {
      const o = offen();
      const spur = o ? sucheSpur(o.projekt, spurId) : undefined, slot = o ? bkSlot(o.projekt, spurId) : null;
      if (!o || !spur || slot === null) return { ausgefuehrt: false };
      const zeilen = Object.entries(werte).map(([k, wert]) => ({ pfad: `spur/${slot}/bk/${Number(k.slice(1))}`, wert }));
      if (faderDb !== undefined) zeilen.push({ pfad: `spur/${spur.nr}/fader`, wert: faderDb });
      if (!zeilen.length) return { ausgefuehrt: true };
      const ids = zeilen.map((z) => ctx.sende('/k/teil', { quelle, plan, teil: 0, pfad: z.pfad, ab_beat: abBeat, dauer_beats: 0, nach: z.wert, form: 0,
        politik: 1, gruppe: '', hoerschein: '' }));
      // the wait ends at the bar line (+ 1/4 beat); the cap only covers a core that never answers, computed at 60 BPM so a slower tempo cannot cut it short
      const u = uhr.beat(), ms = u ? Math.max(0, (abBeat - u.beat) * 1000) : 0;
      const q = await Promise.all(ids.map((id) => ctx.warteQuittung(id, abBeat, true, ms + 1000)));
      return { ausgefuehrt: q.every((x) => x !== null && AUSGEFUEHRT.has(x.status)) };
    },
    async abbruch(plan, quelle) {
      await ctx.warteQuittung(ctx.sende('/k/abbruch', { quelle, plan, teile: '*' }));
    },
  };
}

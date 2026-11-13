// Plan live-module task 11 (decision 19): POST /modul/tonart {slot} adapts the module of a slot to the key of the deck on the master. The distance
// (project/live.ts tonartAbstand, Camelot, shortest way -6..+6) is applied to the whole module tree in ONE undo step: MIDI notes move, audio clips
// get warp.transpose_st; the total is stored on the module (`transponiert`), so a second call changes nothing. GET /modul/stand shows the distance
// per slot (`tonart_abstand` = what adapting would still move, `transponiert`, `deck_tonart`).
// The master key: the playing deck (status 2+, channel open) whose channel is the loudest on the master (the page server's peak buffer); see server.ts.
import { liveSlots, normiereSlot, passeModulAn, tonartAbstand, tonartRest } from '../../project/live.ts';
import { aendereStand } from '../../project/state.ts';
import type { BereichKontext } from '../../http/router.ts';
import type { ProjZugang } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';

type Slot = 'A' | 'B';
export interface MasterTonart { deck: number; tonart: string | null }
export type MasterTonartQuelle = () => MasterTonart | { code: number; fehler: string };

export class ModulTonart {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly master: MasterTonartQuelle | undefined;
  constructor(ctx: BereichKontext, zugang: ProjZugang, master?: MasterTonartQuelle) { this.ctx = ctx; this.zugang = zugang; this.master = master; }

  // The fields GET /modul/stand adds to a slot; nothing without a master source (the page then shows no distance)
  stand(gruppeId: string): Record<string, unknown> {
    const o = this.zugang.offen();
    const modul = o?.projekt.gruppen.find((g) => g.id === gruppeId)?.modul;
    if (!modul || !this.master) return {};
    const m = this.master();
    const aus: Record<string, unknown> = { ...(modul.transponiert ? { transponiert: modul.transponiert } : {}), tonart: modul.tonart };
    if ('fehler' in m) return { ...aus, tonart_abstand: null, tonart_grund: m.fehler };
    const rest = tonartRest(modul, m.tonart);
    return { ...aus, deck_tonart: m.tonart, deck: m.deck, tonart_abstand: rest, ...(rest === null ? { tonart_grund: 'tonart_unbekannt' } : {}) };
  }

  async passeAn(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) if (k !== 'slot') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    const s0 = normiereSlot(d.slot);                                           // 1/2 and A/B (decision 13)
    if (s0 === undefined) throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 1, 2, 'A' or 'B'" });
    d = { ...d, slot: s0 };
    const slot: Slot = s0;
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o = this.zugang.offen();
    if (!o || !o.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    const gruppeId = liveSlots(o.projekt)[slot];
    if (gruppeId === undefined) throw new ProjFehler(409, 'slot_leer', { slot });
    const m = this.master?.() ?? { code: 409, fehler: 'kein_deck' };
    if ('fehler' in m) throw new ProjFehler(m.code, m.fehler);
    const modul = o.projekt.gruppen.find((g) => g.id === gruppeId)!.modul!;
    const abstand = tonartAbstand(modul, m.tonart);
    if (abstand === null) throw new ProjFehler(409, 'tonart_unbekannt', { slot, modul_tonart: modul.tonart, deck_tonart: m.tonart ?? '', deck: m.deck });
    const vorher = modul.transponiert ?? 0;
    const neu = passeModulAn(o.projekt, gruppeId, abstand, quelle);
    let rev = o.projekt.rev;
    if (vorher !== abstand) {
      const meta = { quelle, label: `Adapt module ${slot} to ${m.tonart}` };
      const w = aendereStand(o.verlauf, o.projekt, neu, meta, this.zugang.haken());
      await this.zugang.uebernimm(w, meta);
      rev = this.zugang.offen()?.projekt.rev ?? w.projekt.rev;
    }
    return { code: 200, j: { slot, gruppe_id: gruppeId, deck: m.deck, deck_tonart: m.tonart, abstand, bewegt: abstand - vorher, transponiert: abstand, rev } };
  }
}

// The one key source of the live modules (module origin at export, deck on the master): the library's own analysis of the track (what /lage shows)
// first, the catalogue's tag only as a fallback
export const tonartQuelle = (analyse: string | null | undefined, katalog: string | null | undefined): string | null => analyse || katalog || null;

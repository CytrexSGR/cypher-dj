// Plan live-module task 3 (decisions 16, spec 6.6/6.7): POST /modul/leeren {slot, takte} clears a live slot. The module fader of the slot ramps to -200 over
// `takte` bars on the core clock (ramp.ts), then the whole group tree of the slot (top group, child groups, all tracks in it and their clips) goes in ONE
// undo step. The module is saved to the store first (spec: saved when it is cleared), so Clear is never the loss of a module.
// takte 0 answers after the removal. takte > 0 answers at once with zustand 'rampe' (a 16 bar ramp outlasts any HTTP call); the end comes as the
// event {a:'modul', f:{leeren}} and in GET /modul/stand under `leeren`. Editing the other slot goes on meanwhile (nothing here holds the project).
import { liveSlots, normiereSlot } from '../../project/live.ts';
import { aendereStand } from '../../project/state.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { modulBaum } from '../../project/module_storage.ts';
import type { Projekt } from '../../project/model.ts';
import type { BereichKontext } from '../../http/router.ts';
import { quittungAbgelehnt } from '../proj/core_path.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { ProjZugang } from '../proj/area.ts';
import { fahreRampe, type RampeEnde, type RampeKern } from './ramp.ts';

type Slot = 'A' | 'B';
export const MUTE_WARTE_MS = 20;                                                   // the core's mute fade is 10 ms, plus a reserve
export const LEEREN_TAKTE: readonly number[] = [0, 1, 2, 4, 8, 16];
export interface LeerenOptionen {
  kern?: RampeKern;                                                                  // without a clock source the ramp is taken at once
  speichere?(projekt: Projekt, gruppeId: string): { id: string; pfad: string };      // the module store (project/module_storage.ts)
  rampe?: { pollMs?: number; stillMs?: number; warte?: (ms: number) => Promise<void>; jetzt?: () => number };   // test seam
}
export interface LeerenStand {
  zustand: 'rampe' | 'fertig' | 'abgebrochen' | 'fehler'; takte: number; grund?: string; text?: string; ende?: RampeEnde;
  modul_id?: string; gespeichert?: boolean; rev?: number;
}

export class ModulLeeren {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: LeerenOptionen;
  private readonly zustand: Partial<Record<Slot, LeerenStand>> = {};
  private readonly laufend = new Map<Slot, Promise<void>>();
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: LeerenOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  stand(): Partial<Record<Slot, LeerenStand>> { return { ...this.zustand }; }
  fertig(slot: Slot): Promise<void> { return this.laufend.get(slot) ?? Promise.resolve(); }   // for tests and callers that want to wait
  private setze(slot: Slot, s: LeerenStand): void {
    this.zustand[slot] = s;
    this.ctx.verteile({ a: 'modul', f: { leeren: { [slot]: s } } });
  }

  async leere(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) if (k !== 'slot' && k !== 'takte') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    const s0 = normiereSlot(d.slot);                                           // 1/2 and A/B (decision 13)
    if (s0 === undefined) throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 1, 2, 'A' or 'B'" });
    d = { ...d, slot: s0 };
    if (typeof d.takte !== 'number' || !LEEREN_TAKTE.includes(d.takte)) {
      throw new ProjFehler(400, 'argument_ungueltig', { detail: `takte: one of ${LEEREN_TAKTE.join(', ')}` });
    }
    const slot: Slot = s0, takte = d.takte;
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o = this.zugang.offen();
    if (!o || !o.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    if (this.laufend.has(slot)) throw new ProjFehler(409, 'rampe_laeuft', { slot });
    const gruppeId = liveSlots(o.projekt)[slot];
    if (gruppeId === undefined) throw new ProjFehler(409, 'slot_leer', { slot });
    const g = o.projekt.gruppen.find((x) => x.id === gruppeId)!;
    const ende = takte > 0 && this.o.kern?.uhr() ? this.o.kern.uhr()!.beat + takte * 4 : undefined;
    this.setze(slot, { zustand: 'rampe', takte });
    const lauf = this.lauf(slot, gruppeId, o.slug, g.nr, g.fader_db, takte, quelle).finally(() => this.laufend.delete(slot));
    this.laufend.set(slot, lauf);
    if (takte === 0) {
      await lauf;
      const s = this.zustand[slot]!;
      if (s.zustand === 'fehler') throw new ProjFehler(500, s.grund ?? 'intern', { text: s.text });
      return { code: 200, j: { slot, gruppe_id: gruppeId, takte, ...s } };
    }
    return { code: 200, j: { slot, gruppe_id: gruppeId, takte, zustand: 'rampe', ...(ende !== undefined ? { ende_beat: ende } : {}) } };
  }

  // a write of the group fader row on the core clock; Andreas' hand on the fader makes the core refuse it (regler_beim_menschen): logged, the removal goes on
  private schreibeZeile(nr: number, db: number): void { this.schreibePfad(`grp/${nr}/fader`, db); }
  private schreibePfad(pfad: string, wert: number): void {
    const u = this.o.kern?.uhr();
    const ab = u?.beat ?? 0;
    const id = this.ctx.sende('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad, ab_beat: ab, dauer_beats: 0, nach: wert, form: 0,
      politik: 1, gruppe: '', hoerschein: '' });
    void this.ctx.warteQuittung(id, ab, true).then((q) => {
      if (quittungAbgelehnt(q)) this.ctx.log({ typ: 'modul_leeren_regler_abgelehnt', pfad, grund: q?.grund });
    }, () => undefined);
  }

  private async lauf(slot: Slot, gruppeId: string, slug: string, nr: number, von: number, takte: number, quelle: 'andreas' | 'cypher'): Promise<void> {
    const gleich = (): Projekt | null => {
      const o = this.zugang.offen();
      return o && o.slug === slug && liveSlots(o.projekt)[slot] === gruppeId ? o.projekt : null;
    };
    let stumm: Projekt['spuren'] = [];                                              // tracks muted by this run (rows only, the model is unchanged)
    const zurueck = (): void => {                                                  // the rows go back to what the model says
      const p = gleich();
      if (!p) return;
      this.schreibeZeile(nr, p.gruppen.find((x) => x.id === gruppeId)!.fader_db);
      for (const s of stumm) { const m = p.spuren.find((x) => x.id === s.id); if (m) this.schreibePfad(`spur/${m.nr}/mute`, m.mute ? 1 : 0); }
    };
    try {
      const kern = this.o.kern;
      const ende = kern ? await fahreRampe({ kern, von, nach: -200, beats: takte * 4, schreibe: (db) => this.schreibeZeile(nr, db),
        abbruch: () => gleich() === null || (quelle === 'cypher' && this.ctx.kiGestoppt()), ...this.o.rampe })
        : (this.schreibeZeile(nr, -200), 'sofort' as const);
      if (ende === 'abgebrochen') {
        zurueck();
        const ki = quelle === 'cypher' && this.ctx.kiGestoppt();
        return this.setze(slot, { zustand: 'abgebrochen', takte, ende, grund: ki ? 'ki_gestoppt' : 'projekt_gewechselt' });
      }
      const p0 = gleich();
      if (!this.zugang.offen() || !p0) return this.setze(slot, { zustand: 'abgebrochen', takte, ende, grund: 'projekt_gewechselt' });
      // The 96 sample release of a removed track runs through its stem group, which takes master as its target once the top group is gone, so it would
      // bypass the closed module fader. Mute every track of the tree first (quieter rows, before the load) and let the 10 ms mute fade finish.
      stumm = modulBaum(p0, gruppeId).spuren;
      for (const s of stumm) this.schreibePfad(`spur/${s.nr}/mute`, 1);
      await (this.o.rampe?.warte ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(MUTE_WARTE_MS);
      const o = this.zugang.offen();                                                 // fresh again after the wait; no await up to aendereStand
      const p = gleich();
      if (!o || !p) return this.setze(slot, { zustand: 'abgebrochen', takte, ende, grund: 'projekt_gewechselt' });
      let ablage: { id: string; pfad: string } | null = null;
      if (this.o.speichere) {
        try { ablage = this.o.speichere(p, gruppeId); } catch (e) {
          this.ctx.log({ typ: 'modul_speichern_fehler', slot, fehler: (e as Error).message });   // undo brings the module back; clearing is not refused for it
        }
      }
      const baum = modulBaum(p, gruppeId);
      const befehle: unknown[] = [...baum.spuren.map((s) => ({ befehl: 'spur_loeschen', spur_id: s.id })),
        ...[...baum.gruppen].reverse().map((x) => ({ befehl: 'gruppenspur_loeschen', gruppe_id: x.id }))];
      const neu = fuehreListeAus(p, befehle, { quelle }).projekt;
      const meta = { quelle, label: `Clear module ${slot}` };
      const w = aendereStand(o.verlauf, p, neu, meta, this.zugang.haken());
      await this.zugang.uebernimm(w, meta);
      this.setze(slot, { zustand: 'fertig', takte, ende, gespeichert: ablage !== null, ...(ablage ? { modul_id: ablage.id } : {}),
        rev: this.zugang.offen()?.projekt.rev ?? w.projekt.rev });
    } catch (e) {
      zurueck();
      const fehler = e instanceof ProjFehler ? e.fehler : 'intern';
      this.ctx.log({ typ: 'modul_leeren_fehler', slot, fehler: (e as Error).message });
      this.setze(slot, { zustand: 'fehler', takte, grund: fehler, text: (e as Error).message });
    }
  }
}

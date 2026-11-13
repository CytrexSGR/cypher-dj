// Plan live-module task 8 (decisions 7, 16): POST /modul/blend {slot, stem, wert, takte?} sets the blend of one stem of a module. wert 0..1 is stored on the
// stem group (`blend`); the command blend_setzen turns it into the two track faders by the equal-power law (original / new instrument path). Only a stem
// with a new path (Drums, Bass once their MIDI is in) can be blended, else 409 kein_neuer_pfad. takte 0 or absent: one undo step and the answer holds the
// new state. takte > 0: both track fader rows move on the core clock (ramp.ts, about every 1/16), the model gets the end value once at the end (one undo
// step); the answer comes at once with zustand 'rampe', the end as the event {a:'modul', f:{blend}} and in GET /modul/stand under `blend`.
import { liveSlots, normiereSlot } from '../../project/live.ts';
import { aendereStand } from '../../project/state.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { blendFader, blendPfad, type Projekt } from '../../project/model.ts';
import { STEMS, type Stem } from '../../project/stems.ts';
import type { BereichKontext } from '../../http/router.ts';
import { quittungAbgelehnt } from '../proj/core_path.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { ProjZugang } from '../proj/area.ts';
import { fahreRampe, type RampeEnde } from './ramp.ts';
import { LEEREN_TAKTE, type LeerenOptionen } from './leeren.ts';

type Slot = 'A' | 'B';
const STEM_NAME: Record<Stem, string> = { drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals', guitar: 'Guitar', piano: 'Piano' };
export interface BlendStand {
  zustand: 'rampe' | 'fertig' | 'abgebrochen' | 'fehler'; stem: Stem; wert: number; takte: number; ende?: RampeEnde;
  grund?: string; text?: string; rev?: number;
}

export class ModulBlend {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: LeerenOptionen;
  private readonly zustand: Partial<Record<Slot, Partial<Record<Stem, BlendStand>>>> = {};
  private readonly laufend = new Map<string, Promise<void>>();
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: LeerenOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  stand(): Record<string, unknown> { return JSON.parse(JSON.stringify(this.zustand)) as Record<string, unknown>; }
  fertig(slot: Slot, stem: Stem): Promise<void> { return this.laufend.get(`${slot}/${stem}`) ?? Promise.resolve(); }   // for tests
  private setze(slot: Slot, stem: Stem, s: BlendStand): void {
    (this.zustand[slot] ??= {})[stem] = s;
    this.ctx.verteile({ a: 'modul', f: { blend: { [slot]: { [stem]: s } } } });
  }

  async blende(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) {
      if (k !== 'slot' && k !== 'stem' && k !== 'wert' && k !== 'takte') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    }
    const s0 = normiereSlot(d.slot);                                           // 1/2 and A/B (decision 13)
    if (s0 === undefined) throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 1, 2, 'A' or 'B'" });
    d = { ...d, slot: s0 };
    if (typeof d.stem !== 'string' || !(STEMS as readonly string[]).includes(d.stem)) {
      throw new ProjFehler(400, 'argument_ungueltig', { detail: `stem: one of ${STEMS.join(', ')}` });
    }
    if (typeof d.wert !== 'number' || !Number.isFinite(d.wert) || d.wert < 0 || d.wert > 1) {
      throw new ProjFehler(400, 'argument_ungueltig', { detail: 'wert: number 0..1' });
    }
    const takte = d.takte ?? 0;
    if (typeof takte !== 'number' || !LEEREN_TAKTE.includes(takte)) {
      throw new ProjFehler(400, 'argument_ungueltig', { detail: `takte: one of ${LEEREN_TAKTE.join(', ')}` });
    }
    const slot: Slot = s0, stem = d.stem as Stem, wert = d.wert;
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o = this.zugang.offen();
    if (!o || !o.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    const top = liveSlots(o.projekt)[slot];
    if (top === undefined) throw new ProjFehler(409, 'slot_leer', { slot });
    const kind = o.projekt.gruppen.find((g) => g.ausgang?.id === top && g.name === STEM_NAME[stem]);
    const pf = kind ? blendPfad(o.projekt, kind.id) : null;
    if (!kind || !pf) throw new ProjFehler(409, 'kein_neuer_pfad', { slot, stem });
    if (this.laufend.has(`${slot}/${stem}`)) throw new ProjFehler(409, 'rampe_laeuft', { slot, stem });
    const von = kind.blend ?? 0;
    const u = this.o.kern?.uhr();                                                  // before the ramp starts to move the clock
    const lauf = this.lauf(slot, stem, o.slug, top, kind.id, von, wert, takte, quelle).finally(() => this.laufend.delete(`${slot}/${stem}`));
    this.laufend.set(`${slot}/${stem}`, lauf);
    const kopf = { slot, stem, gruppe_id: kind.id, wert, takte };
    if (takte === 0) {
      await lauf;
      const s = this.zustand[slot]![stem]!;
      if (s.zustand === 'fehler') throw new ProjFehler(500, s.grund ?? 'intern', { text: s.text });
      return { code: 200, j: { ...kopf, zustand: s.zustand, rev: s.rev, blend: wert, fader_db: blendFader(wert, kind.neu_trim_db ?? 0) } };
    }
    return { code: 200, j: { ...kopf, zustand: 'rampe', ...(u ? { ende_beat: u.beat + takte * 4 } : {}) } };
  }

  private schreibeZeile(nr: number, db: number): void {
    const u = this.o.kern?.uhr();
    const ab = u?.beat ?? 0;
    const pfad = `spur/${nr}/fader`;
    const id = this.ctx.sende('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad, ab_beat: ab, dauer_beats: 0, nach: db, form: 0, politik: 1,
      gruppe: '', hoerschein: '' });
    void this.ctx.warteQuittung(id, ab, true).then((q) => {
      if (quittungAbgelehnt(q)) this.ctx.log({ typ: 'modul_blend_regler_abgelehnt', pfad, grund: q?.grund });
    }, () => undefined);
  }

  private async lauf(slot: Slot, stem: Stem, slug: string, top: string, kindId: string, von: number, nach: number, takte: number,
    quelle: 'andreas' | 'cypher'): Promise<void> {
    const gleich = (): Projekt | null => {
      const o = this.zugang.offen();
      return o && o.slug === slug && liveSlots(o.projekt)[slot] === top ? o.projekt : null;
    };
    const zeilen = (b: number): void => {
      const p = gleich(), pf = p ? blendPfad(p, kindId) : null;
      if (!pf) return;
      const f = blendFader(b, p!.gruppen.find((g) => g.id === kindId)?.neu_trim_db ?? 0);
      this.schreibeZeile(pf.original.nr, f.original);
      this.schreibeZeile(pf.neu.nr, f.neu);
    };
    const zurueck = (): void => {                                                  // the rows go back to what the model says
      const p = gleich(), pf = p ? blendPfad(p, kindId) : null;
      if (pf) { this.schreibeZeile(pf.original.nr, pf.original.fader_db); this.schreibeZeile(pf.neu.nr, pf.neu.fader_db); }
    };
    if (takte > 0) this.setze(slot, stem, { zustand: 'rampe', stem, wert: nach, takte });
    try {
      let ende: RampeEnde | undefined;
      if (takte > 0 && this.o.kern) {
        ende = await fahreRampe({ kern: this.o.kern, von, nach, beats: takte * 4, schreibe: zeilen,
          abbruch: () => gleich() === null || (quelle === 'cypher' && this.ctx.kiGestoppt()), ...this.o.rampe });
        if (ende === 'abgebrochen') {
          zurueck();
          const ki = quelle === 'cypher' && this.ctx.kiGestoppt();
          return this.setze(slot, stem, { zustand: 'abgebrochen', stem, wert: nach, takte, ende, grund: ki ? 'ki_gestoppt' : 'projekt_gewechselt' });
        }
      }
      const o = this.zugang.offen(), p = gleich();
      if (!o || !p) return this.setze(slot, stem, { zustand: 'abgebrochen', stem, wert: nach, takte, ...(ende ? { ende } : {}), grund: 'projekt_gewechselt' });
      const neu = fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: kindId, wert: nach }], { quelle }).projekt;
      const meta = { quelle, label: `Blend ${STEM_NAME[stem]} module ${slot}` };
      const w = aendereStand(o.verlauf, p, neu, meta, this.zugang.haken());
      if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
      this.setze(slot, stem, { zustand: 'fertig', stem, wert: nach, takte, ...(ende ? { ende } : {}), rev: this.zugang.offen()?.projekt.rev ?? w.projekt.rev });
    } catch (e) {
      zurueck();
      const fehler = e instanceof ProjFehler ? e.fehler : (e as { grund?: string }).grund ?? 'intern';
      this.ctx.log({ typ: 'modul_blend_fehler', slot, stem, fehler: (e as Error).message });
      this.setze(slot, stem, { zustand: 'fehler', stem, wert: nach, takte, grund: fehler, text: (e as Error).message });
    }
  }
}

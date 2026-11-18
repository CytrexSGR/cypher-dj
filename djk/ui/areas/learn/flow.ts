// S19 (MIDI learn): the flow of one assignment. The page asks to learn a graph knob (scharf), the kern is armed (/k/lernen), the first CC
// on midi_ein_1 comes back as /e/gelernt, the store writes lernen.json and the kern reloads it (/k/mapping geraet "lernen"). The state
// "armed" lives here, not in the kern: the kern only knows the id. A capture whose id is not the current arming is stale and dropped.
// The kern reports on which raw input the CC came (/e/gelernt quelle 1..8 = midi_ein_1..8): that is the controller place, and the assignment
// goes into the table of that place.
// Every outcome goes out as SSE {a:'lernen', f:{stand, pfad, ...}} so every open page follows.
import type { BereichKontext } from '../../http/router.ts';
import { LernFehler, lernName, type LernSpeicher } from './store.ts';

export interface Zeit { setzen(f: () => void, ms: number): unknown; loeschen(h: unknown): void }
export interface AblaufOptionen { fristMs?: number; zeit?: Zeit }
type Ausgang = { stand: 'fertig' | 'ohne_antwort' } | { stand: 'abgelehnt'; grund: string };
interface Wartet { pfad: string; id: number; gen: number | null; timer: unknown }

const num = (x: unknown): number => Number(x ?? 0);
export const HAND_IN_TEXT = 'this controller is mapped on hand_in; choose it as MIDI input under Devices';

export class LernAblauf {
  private wartet: Wartet | null = null;
  private gen: number | null = null;                 // last /e/neustart generation seen
  // Has this kern shown that it knows the places 2..8 (a capture from one of them, or one of their inputs linked)? A kern from before the
  // eight inputs would take the name "lernen-2" for a base mapping and replace the desk with it: without the proof the file is written and
  // left for the kern's next start.
  private mehrPlaetze = false;
  private kette: Promise<unknown> = Promise.resolve();   // writes one after the other
  private readonly fristMs: number;
  private readonly zeit: Zeit;
  private readonly ctx: BereichKontext;
  private readonly speicher: LernSpeicher;
  constructor(ctx: BereichKontext, speicher: LernSpeicher, opt: AblaufOptionen = {}) {
    this.ctx = ctx;
    this.speicher = speicher;
    this.fristMs = opt.fristMs ?? 20000;
    this.zeit = opt.zeit ?? { setzen: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, loeschen: (h) => clearTimeout(h as NodeJS.Timeout) };
  }

  lage(): { pfad: string; frist_ms: number } | null { return this.wartet ? { pfad: this.wartet.pfad, frist_ms: this.fristMs } : null; }

  // Arm the kern for this knob. A second call replaces the first (the kern takes the new id).
  scharf(pfad: string): void {
    this.entwaffne(false);
    const id = this.ctx.sende('/k/lernen', { an: 1 });
    const timer = this.zeit.setzen(() => this.ablauf(id), this.fristMs);
    this.wartet = { pfad, id, gen: this.gen, timer };
  }

  // The page cancels (pfad null) or the same knob is clicked again.
  abbrechen(): void {
    const w = this.wartet;
    if (!w) return;
    this.entwaffne(true);
    this.ctx.verteile({ a: 'lernen', f: { stand: 'abgebrochen', pfad: w.pfad } });
  }

  private entwaffne(sendeAus: boolean): void {
    if (!this.wartet) return;
    this.zeit.loeschen(this.wartet.timer);
    this.wartet = null;
    if (sendeAus) this.ctx.sende('/k/lernen', { an: 0 });
  }

  private ablauf(id: number): void {
    const w = this.wartet;
    if (!w || w.id !== id) return;
    this.wartet = null;
    this.ctx.sende('/k/lernen', { an: 0 });
    this.ctx.verteile({ a: 'lernen', f: { stand: 'abgelaufen', pfad: w.pfad } });
  }

  // Kern events: /e/gelernt finishes an arming, /e/neustart of a new generation ends it (the new kern is not armed).
  ereignis(adresse: string, f: Record<string, unknown>): void {
    if (adresse === '/zustand/ein') { if ((num(f.verbunden) & 0xFE00) !== 0) this.mehrPlaetze = true; return; }
    if (adresse === '/e/neustart') {
      const g = num(f.generation);
      if (this.gen !== null && this.gen !== g) this.mehrPlaetze = false;
      if (this.wartet && this.wartet.gen !== null && this.wartet.gen !== g) {
        const w = this.wartet;
        this.zeit.loeschen(w.timer);
        this.wartet = null;
        this.ctx.verteile({ a: 'lernen', f: { stand: 'abgelaufen', pfad: w.pfad } });
      } else if (this.wartet && this.wartet.gen === null) this.wartet.gen = g;
      this.gen = g;
      return;
    }
    if (adresse !== '/e/gelernt') return;
    const w = this.wartet;
    if (!w || num(f.id) !== w.id) return;   // stale: not the current arming
    this.zeit.loeschen(w.timer);
    this.wartet = null;
    const pfad = w.pfad, kanal = num(f.kanal), nr = num(f.nr), platz = num(f.quelle);
    if (platz >= 2) this.mehrPlaetze = true;
    if (platz === 0) { this.ctx.verteile({ a: 'lernen', f: { stand: 'hand_in', pfad, kanal, nr, text: HAND_IN_TEXT } }); return; }
    if (num(f.belegt) === 1) { this.ctx.verteile({ a: 'lernen', f: { stand: 'belegt', pfad, kanal, nr } }); return; }
    this.kette = this.kette.then(() => this.speichere(pfad, kanal, nr, platz)).catch((e) => this.ctx.log({ typ: 'lernen_fehler', fehler: (e as Error)?.message ?? String(e) }));
  }

  // Delete one assignment and reload the table.
  loesche(pfad: string): Promise<void> {
    const lauf = this.kette.then(async () => {
      await this.lade(this.speicher.loesche(pfad), pfad, 'geloescht');
    });
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  // Assign a CC to a target without a capture (the page picked the control from a layout): the same write, kern reload and events as a capture.
  // Resolves with how it ended ('fertig', 'ohne_antwort': files kept, the kern loads them at its next start) and rejects with a LernFehler when it was refused.
  setze(pfad: string, kanal: number, nr: number, platz: number): Promise<'fertig' | 'ohne_antwort'> {
    const lauf = this.kette.then(async () => {
      const r = await this.speichere(pfad, kanal, nr, platz);
      if (r.stand === 'abgelehnt') throw r.grund === 'lernen_datei_kaputt' ? new LernFehler(r.grund, 409) : new LernFehler('lernen_abgelehnt', 409, `the assignment was refused (${r.grund}); nothing was changed`);
      return r.stand;
    });
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  private async speichere(pfad: string, kanal: number, nr: number, platz: number): Promise<Ausgang> {
    let plaetze: number[];
    try { plaetze = this.speicher.zuordne({ pfad, kanal, nr, platz }); } catch (e) {
      const grund = e instanceof LernFehler ? e.grund : 'intern';
      this.ctx.verteile({ a: 'lernen', f: { stand: 'abgelehnt', pfad, grund } });
      return { stand: 'abgelehnt', grund };
    }
    return this.lade(plaetze, pfad, 'fertig', kanal, nr, platz);
  }

  // Ask the kern to reload the tables of the changed places and tell the pages how it went.
  private async lade(plaetze: number[], pfad: string, erfolg: 'fertig' | 'geloescht', kanal?: number, nr?: number, platz?: number): Promise<Ausgang> {
    for (const p of plaetze) {
      if (p >= 2 && !this.mehrPlaetze) continue;   // see mehrPlaetze: the file is kept, the kern loads it at its next start
      const id = this.ctx.sende('/k/mapping', { geraet: lernName(p) });
      const q = await this.ctx.warteQuittung(id, undefined, true);
      if (q === null) { this.ctx.verteile({ a: 'lernen', f: { stand: 'ohne_antwort', pfad } }); return { stand: 'ohne_antwort' }; }   // files kept: the kern loads them at its next start
      if (q.status === 3 || q.status === 5) continue;
      this.speicher.stelleWiederHer(plaetze);   // the kern refused a new file: the tables stay what they were, and so do the files
      for (const r of plaetze) if (r !== p && (r === 1 || this.mehrPlaetze)) this.ctx.sende('/k/mapping', { geraet: lernName(r) });   // and the kern takes the old ones back
      this.ctx.verteile({ a: 'lernen', f: { stand: 'abgelehnt', pfad, grund: q.grund || 'abgelehnt' } });
      return { stand: 'abgelehnt', grund: q.grund || 'abgelehnt' };
    }
    this.ctx.verteile({ a: 'lernen', f: { stand: erfolg, pfad, kanal, nr, ...(platz !== undefined ? { platz } : {}) } });
    return { stand: 'fertig' };
  }
}

// Planer eines Stroms (Plan 2026-09-27): welcher Muster-Plan ab welchem Beat gilt und welche Fenster zu schicken sind.
// Rein: ohne Netz und Uhr (sende und jetztUs kommen von außen). Je Takt n ersetzt er [4(n+1), 4(n+3)) (ADR 010, zwei
// Takte voraus, wie Probe 06 Strom 1). Ein neues Muster gilt ab dem Takt, der mindestens WECHSEL_ABSTAND Beats entfernt
// ist, und ersetzt sofort, was ab dort schon geschickt wurde.
import { kodiereBundle } from '../../vertrag/attrappe_kern/osc.mjs';
import { ereignisse, teile } from './fenster.mjs';
import { ADRESSEN } from '../../vertrag/osc_adressen.ts';

// Typen aus dem Vertrag, nicht als Literal (Plan-Review Scheibe 3: ein Versatz Node/Kern macht alles stumm)
const T_FENSTER = ADRESSEN['/erz/fenster'].typen.slice(1);
const T_EV = ADRESSEN['/erz/ev'].typen.slice(1);
const T_SCHWANZ = ADRESSEN['/erz/ev'].schwanz;

export const VORLAUF_TAKTE = 2;
export const WECHSEL_ABSTAND = 0.25;  // Beats (117 ms bei 128 BPM): so weit vorher muss der Wechsel beim Kern sein

export class Planer {
  constructor({ strom, kit, sende, jetztUs = () => 0 }) {
    this.strom = strom;
    this.kit = kit;
    this.sende = sende;
    this.jetztUs = jetztUs;
    this.plan = [];               // [{ab, muster, nr}], ab aufsteigend
    this.horizont = -Infinity;    // bis hierhin ist geschickt
    this.sendung = 0;
    this.nr = 0;
    this.evId = 0;
    this.felder = new Set();      // Strudel-Felder des GELTENDEN Musters ohne Weg in den Kern; wächst über seine Takte, setze() leert es
  }

  naechsterTakt(jetzt) { return Math.ceil((jetzt + WECHSEL_ABSTAND) / 4) * 4; }

  setze(muster, jetzt) {
    const ab = this.plan.length && Number.isFinite(jetzt) ? this.naechsterTakt(jetzt) : -Infinity;
    this.plan = this.plan.filter((p) => p.ab < ab);
    this.plan.push({ ab, muster, nr: ++this.nr });
    this.felder = new Set();   // neues Muster: Felder des verdrängten gelten nicht mehr
    if (Number.isFinite(this.horizont) && Number.isFinite(jetzt)) {
      const von = Number.isFinite(ab) ? ab : this.naechsterTakt(jetzt);
      if (von < this.horizont) this.schicke(von, this.horizont);
    }
    return ab;
  }

  takt(n) {
    const a = 4 * (n + 1);
    const b = 4 * (n + 1 + VORLAUF_TAKTE);
    this.horizont = Math.max(this.horizont, b);
    return this.schicke(a, b);
  }

  vergiss() { this.horizont = -Infinity; }   // Kern neu gestartet: nichts gilt als geschickt

  schicke(a, b) {
    const { evs, unbekannt, felder } = ereignisse(this.plan, this.kit, a, b);
    for (const f of felder) this.felder.add(f);
    for (const t of teile(evs, a, b)) {
      const n = [['/erz/fenster', T_FENSTER, [this.strom, ++this.sendung, 66, 0, t.ab, t.bis, BigInt(Math.round(this.jetztUs()))]]];
      for (const e of t.evs) {
        n.push(['/erz/ev', T_EV + T_SCHWANZ.repeat(e.param.length),
          [this.strom, e.muster, ++this.evId, e.note, e.beat, e.dauer, e.velocity, ...e.param.flat()]]);
      }
      this.sende(kodiereBundle(n));
    }
    return unbekannt;
  }
}

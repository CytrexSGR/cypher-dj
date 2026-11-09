// Planer eines Stroms (Plan 2026-09-27): welcher Muster-Plan ab welchem Beat gilt und welche Fenster zu schicken sind.
// Rein: ohne Netz und Uhr (sende und jetztUs kommen von außen). Je Takt n ersetzt er [4(n+1), 4(n+3)) (ADR 010, zwei
// Takte voraus, wie Probe 06 Strom 1). Ein neues Muster gilt ab dem Takt, der mindestens WECHSEL_ABSTAND Beats entfernt
// ist, und ersetzt sofort, was ab dort schon geschickt wurde.
import { kodiereBundle } from '../../contract/mock_core/osc.mjs';
import { ereignisse, teile } from './window.mjs';
import { ADRESSEN } from '../../contract/osc_addresses.ts';

// Typen aus dem Vertrag, nicht als Literal (Plan-Review Scheibe 3: ein Versatz Node/Kern macht alles stumm)
const T_FENSTER = ADRESSEN['/erz/fenster'].typen.slice(1);
const T_EV = ADRESSEN['/erz/ev'].typen.slice(1);
const T_SCHWANZ = ADRESSEN['/erz/ev'].schwanz;

export const VORLAUF_TAKTE = 2;
export const STILLE_ZYKLEN = 16;   // a pattern without any onset in this many cycles from ab on counts as silence (stille)
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

  // Bug t_bffc3708: is the new pattern silence (`silence`, s("~"), ...)? Then notes that already sound must end at ab; a window that only
  // replaces events cannot do that. Any other pattern keeps the ringing notes (they end by their own duration, like in Strudel).
  istStille(muster, ab) {
    try {
      const von = Number.isFinite(ab) ? ab / 4 : 0;
      // cycle by cycle, out at the first onset: a dense stack costs one cycle here (the 16-cycle query took up to 490 ms, more than WECHSEL_ABSTAND)
      for (let z = 0; z < STILLE_ZYKLEN; z++) if (muster.queryArc(von + z, von + z + 1).some((h) => h.hasOnset())) return false;
      return true;
    } catch {
      return false;
    }
  }

  setze(muster, jetzt) {
    const ab = this.plan.length && Number.isFinite(jetzt) ? this.naechsterTakt(jetzt) : -Infinity;
    this.plan = this.plan.filter((p) => p.ab < ab);
    this.plan.push({ ab, muster, nr: ++this.nr });
    this.felder = new Set();   // neues Muster: Felder des verdrängten gelten nicht mehr
    if (Number.isFinite(this.horizont) && Number.isFinite(jetzt)) {
      const von = Number.isFinite(ab) ? ab : this.naechsterTakt(jetzt);
      if (von < this.horizont) this.schicke(von, this.horizont, this.istStille(muster, ab));
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

  // kappe (4th field of /erz/fenster): the kern ends the notes of this stream that still sound at ab (only the first window, the cut is once)
  schicke(a, b, kappe = false) {
    const { evs, unbekannt, felder } = ereignisse(this.plan, this.kit, a, b);
    for (const f of felder) this.felder.add(f);
    for (const t of teile(evs, a, b)) {
      const n = [['/erz/fenster', T_FENSTER, [this.strom, ++this.sendung, 66, kappe && t.ab === a ? 1 : 0, t.ab, t.bis, BigInt(Math.round(this.jetztUs()))]]];
      for (const e of t.evs) {
        n.push(['/erz/ev', T_EV + T_SCHWANZ.repeat(e.param.length),
          [this.strom, e.muster, ++this.evId, e.note, e.beat, e.dauer, e.velocity, ...e.param.flat()]]);
      }
      this.sende(kodiereBundle(n));
    }
    return unbekannt;
  }
}

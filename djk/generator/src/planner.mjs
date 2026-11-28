// Planer eines Stroms (Plan 2026-09-27): welcher Muster-Plan ab welchem Beat gilt und welche Fenster zu schicken sind.
// proTakt (default 4) = Beats je Takt und je Strudel-Zyklus. Rein: ohne Netz und Uhr (sende und jetztUs kommen von außen). Je Takt n ersetzt er [4(n+1), 4(n+3)) (ADR 010, zwei
// Takte voraus, wie Probe 06 Strom 1). Ein neues Muster gilt ab dem Takt, der mindestens WECHSEL_ABSTAND Beats entfernt
// ist, und ersetzt sofort, was ab dort schon geschickt wurde.
import { kodiereBundle } from '../../contract/mock_core/osc.mjs';
import { ereignisse, teile } from './window.mjs';
import { setzeLane } from './strudel.mjs';
import { akkordBei, TON_NAMEN } from '../../ui/public/harmonie.js';
import { ADRESSEN } from '../../contract/osc_addresses.ts';

// Typen aus dem Vertrag, nicht als Literal (Plan-Review Scheibe 3: ein Versatz Node/Kern macht alles stumm)
const T_FENSTER = ADRESSEN['/erz/fenster'].typen.slice(1);
const T_EV = ADRESSEN['/erz/ev'].typen.slice(1);
const T_SCHWANZ = ADRESSEN['/erz/ev'].schwanz;

export const VORLAUF_TAKTE = 2;
export const STILLE_ZYKLEN = 16;   // a pattern without any onset in this many cycles from ab on counts as silence (stille)
export const WECHSEL_ABSTAND = 0.25;  // Beats (117 ms bei 128 BPM): so weit vorher muss der Wechsel beim Kern sein

export class Planer {
  constructor({ strom, kit, sende, jetztUs = () => 0, taktart = 4, lane = [] }) {
    this.strom = strom;
    this.proTakt = taktart;       // beats per bar (= beats per Strudel cycle); 4 unless the project meter says otherwise
    this.kit = kit;
    this.sende = sende;
    this.jetztUs = jetztUs;
    this.plan = [];               // [{ab, muster, nr}], ab aufsteigend
    this.horizont = -Infinity;    // bis hierhin ist geschickt
    this.sendung = 0;
    this.nr = 0;
    this.evId = 0;
    this.lane = lane;             // entries of harmonie.json (strand 7); .harm() / .akkordton() read them while this planer queries
    this.harmonie = null;         // clash count of the latest window of a MIDI stream: {von_zyklus, bis_zyklus, noten, fremd, fremd_toene}; null without a lane
    this.felder = new Set();      // Strudel-Felder des GELTENDEN Musters ohne Weg in den Kern; wächst über seine Takte, setze() leert es
  }

  naechsterTakt(jetzt) { return Math.ceil((jetzt + WECHSEL_ABSTAND) / this.proTakt) * this.proTakt; }

  // Bug t_bffc3708: is the new pattern silence (`silence`, s("~"), ...)? Then notes that already sound must end at ab; a window that only
  // replaces events cannot do that. Any other pattern keeps the ringing notes (they end by their own duration, like in Strudel).
  istStille(muster, ab) {
    try {
      setzeLane(this.lane);
      const von = Number.isFinite(ab) ? ab / this.proTakt : 0;
      // cycle by cycle, out at the first onset: a dense stack costs one cycle here (the 16-cycle query took up to 490 ms, more than WECHSEL_ABSTAND)
      for (let z = 0; z < STILLE_ZYKLEN; z++) if (muster.queryArc(von + z, von + z + 1).some((h) => h.hasOnset())) return false;
      return true;
    } catch {
      return false;
    }
  }

  // Strand 7 task 2.2: the lane file changed. From the first changed cycle on (not before the next bar line) the window already sent is replaced.
  setzeLane(neu, jetzt = -Infinity) {
    const schluessel = (e) => JSON.stringify(e);
    const alt = new Set(this.lane.map(schluessel));
    const neuS = new Set(neu.map(schluessel));
    const geaendert = [...this.lane.filter((e) => !neuS.has(schluessel(e))), ...neu.filter((e) => !alt.has(schluessel(e)))];
    this.lane = neu;
    if (!geaendert.length) return;
    let von = Math.min(...geaendert.map((e) => e.ab_zyklus)) * this.proTakt;
    if (Number.isFinite(jetzt)) von = Math.max(von, this.naechsterTakt(jetzt));
    if (this.plan.length && Number.isFinite(this.horizont) && von < this.horizont) this.schicke(von, this.horizont);
  }

  // The beat setze() would pick for a pattern sent at `jetzt` (-Infinity: it applies at once).
  abFuer(jetzt) { return this.plan.length && Number.isFinite(jetzt) ? this.naechsterTakt(jetzt) : -Infinity; }

  // versatz: phase offset in cycles (task 5.1); the pattern plays as muster.late(versatz), its text is untouched.
  setze(muster, jetzt, versatz = 0) {
    if (versatz) muster = muster.late(versatz);
    const ab = this.abFuer(jetzt);
    this.plan = this.plan.filter((p) => p.ab < ab);
    this.plan.push({ ab, muster, nr: ++this.nr, proTakt: this.proTakt });
    this.felder = new Set();   // neues Muster: Felder des verdrängten gelten nicht mehr
    if (Number.isFinite(this.horizont) && Number.isFinite(jetzt)) {
      const von = Number.isFinite(ab) ? ab : this.naechsterTakt(jetzt);
      if (von < this.horizont) this.schicke(von, this.horizont, this.istStille(muster, ab));
    }
    return ab;
  }

  takt(n) {
    const a = this.proTakt * (n + 1);
    const b = this.proTakt * (n + 1 + VORLAUF_TAKTE);
    this.horizont = Math.max(this.horizont, b);
    return this.schicke(a, b);
  }

  // Plan studio-taktart M1: the bar length changes from the next bar of the NEW length on (never refused). Plan entries keep the cycle
  // they were planned with; the current pattern continues from `von` with the new cycle and the window already sent is replaced.
  setzeTaktart(proTakt, jetzt) {
    if (proTakt === this.proTakt) return;
    this.proTakt = proTakt;
    const von = Number.isFinite(jetzt) ? this.naechsterTakt(jetzt) : -Infinity;
    const letzt = this.plan.at(-1);
    this.plan = this.plan.filter((p) => p.ab < von);
    if (!letzt) return;
    this.plan.push({ ab: von, muster: letzt.muster, nr: letzt.nr, proTakt });
    if (Number.isFinite(this.horizont) && Number.isFinite(von)) {
      // the new bar line can lie beyond what was already sent (growing bar): start at the old horizon then, so no gap stays silent
      const ab = Math.min(von, this.horizont);
      this.horizont = Math.max(this.horizont, von + VORLAUF_TAKTE * proTakt);
      this.schicke(ab, this.horizont);
    }
  }

  vergiss() { this.horizont = -Infinity; }   // Kern neu gestartet: nichts gilt als geschickt

  // Notes of a window whose pitch class is not in the lane scale at their cycle (cycles without a lane do not count).
  zaehleFremd(evs, a, b) {
    let noten = 0;
    let fremd = 0;
    const namen = [];
    for (const e of evs) {
      const l = akkordBei(this.lane, Math.floor(e.beat / this.proTakt + 1e-9));
      if (!l?.tonart) continue;
      noten++;
      const pc = e.note % 12;
      if (l.tonart.stufen.some((s) => (l.tonart.grundton + s) % 12 === pc)) continue;
      fremd++;
      const n = TON_NAMEN[pc];
      if (!namen.includes(n) && namen.length < 6) namen.push(n);
    }
    return { von_zyklus: a / this.proTakt, bis_zyklus: b / this.proTakt, noten, fremd, fremd_toene: namen };
  }

  // kappe (4th field of /erz/fenster): the kern ends the notes of this stream that still sound at ab (only the first window, the cut is once)
  schicke(a, b, kappe = false) {
    setzeLane(this.lane);
    const { evs, unbekannt, felder } = ereignisse(this.plan, this.kit, a, b, this.proTakt);
    if (this.kit?.midi) this.harmonie = this.lane.length ? this.zaehleFremd(evs, a, b) : null;
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

// 1.12 automation slice 4 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, decisions D3 to D6): the editor tools of a lane, pure.
// dehne (stretch), neige (skew), formPunkte (an inserted shape) and setzeForm (shape into a lane), bereichVereinfacht (simplify a range).
// The page mirrors dehne, neige, formPunkte and setzeForm in oeffentlich/produktion/lanen_werkzeuge.js (same code, laneWert from lanen.js);
// tests/produktion_lanen_werkzeuge.test.mjs runs one fixture set through both. Change one, change the other.
// A point's `form` is the form of the segment INTO the point (lane.ts). Inputs are never changed; every function returns a new list.
import { laneWert, type Punkt } from './lane.ts';
import { vereinfache, toleranzVon } from './vereinfachen.ts';

export const FORMEN_EINFUEGEN = ['rampe_auf', 'rampe_ab', 'sinus', 'dreieck', 'rechteck'] as const;
export type FormEinfuegen = (typeof FORMEN_EINFUEGEN)[number];
// D5: the default value range of an inserted shape (the lane's display range)
export function formBereich(ziel: string): { unten: number; oben: number } {
  if (ziel === 'fader') return { unten: -60, oben: 0 };
  if (ziel === 'pan') return { unten: -1, oben: 1 };
  return { unten: 0, oben: 1 };
}

const kopie = (p: readonly Punkt[]): Punkt[] => p.map((q) => ({ ...q }));
// A point at `beat` carrying the lane value there, with the form of the segment it splits (the form of the next point after it), so the lane
// keeps its values on both sides (exact for linear and sprung segments; an s segment split in two is close, not exact).
function anker(p: readonly Punkt[], beat: number, ziel: string): Punkt {
  const naechster = p.find((q) => q.beat > beat);
  const a: Punkt = { beat, wert: laneWert(p, beat, ziel) };
  if (naechster?.form !== undefined) a.form = naechster.form;
  return a;
}
// Inserts an anchor at `beat` if no point sits there and points lie on both sides (else the lane is constant there and needs none)
function mitAnker(p: Punkt[], beat: number, ziel: string): Punkt[] {
  if (p.some((q) => q.beat === beat) || !p.some((q) => q.beat < beat) || !p.some((q) => q.beat > beat)) return p;
  const a = anker(p, beat, ziel);
  const i = p.findIndex((q) => q.beat > beat);
  return [...p.slice(0, i), a, ...p.slice(i)];
}

// D3: points in (von, bis] map linearly to (von, neuBis]; points of the target span that are not part of the source go; after
// m = max(bis, neuBis) the lane keeps its values (a jump pair at m holds the old value where the stretched end differs).
export function dehne(punkte: readonly Punkt[], von: number, bis: number, neuBis: number, ziel: string): Punkt[] {
  if (neuBis === bis) return kopie(punkte);
  const alt = mitAnker(mitAnker(kopie(punkte), von, ziel), bis, ziel);
  const m = Math.max(bis, neuBis), k = (neuBis - von) / (bis - von);
  const wertM = laneWert(alt, m, ziel);
  const links = alt.filter((q) => q.beat <= von);
  const bewegt = alt.filter((q) => q.beat > von && q.beat <= bis).map((q) => ({ ...q, beat: von + (q.beat - von) * k }));
  const rechts = alt.filter((q) => q.beat > m);
  const neu = [...links, ...bewegt];
  const ende = laneWert(neu, m, ziel);
  const amEnde = neu.filter((q) => q.beat === m);
  if (amEnde.length > 0) {
    if (ende !== wertM) {
      if (amEnde.length === 2) neu.pop();         // of a moved jump pair only its first point stays in front of the hold point
      neu.push({ beat: m, wert: wertM, form: 'sprung' });
    }
  } else if (rechts.length > 0 || ende !== wertM) {
    neu.push({ beat: m, wert: ende });
    if (ende !== wertM) neu.push({ beat: m, wert: wertM, form: 'sprung' });
  }
  return [...neu, ...rechts];
}

// D4: inside (von, bis) a point at u = (beat - von) / (bis - von) moves to u^(4^faktor); values, forms and order stay, the edges are fixed
export function neige(punkte: readonly Punkt[], von: number, bis: number, faktor: number, ziel: string): Punkt[] {
  if (faktor === 0) return kopie(punkte);
  const e = 4 ** faktor;
  return mitAnker(mitAnker(kopie(punkte), von, ziel), bis, ziel)
    .map((q) => (q.beat > von && q.beat < bis ? { ...q, beat: von + ((q.beat - von) / (bis - von)) ** e * (bis - von) } : q));
}

// D5: the points of a shape over [von, bis] with `perioden` periods between `unten` and `oben` (first point without form).
// Ramps and triangle are linear, sine is s segments between its extremes (it starts at its lowest value), square uses sprung.
export function formPunkte(form: FormEinfuegen, von: number, bis: number, perioden: number, unten: number, oben: number): Punkt[] {
  const P = (bis - von) / perioden, aus: Punkt[] = [];
  for (let k = 0; k < perioden; k++) {
    const a = von + k * P, b = k === perioden - 1 ? bis : von + (k + 1) * P, mitte = von + (k + 0.5) * P;
    if (form === 'rampe_auf' || form === 'rampe_ab') {
      const [s, e] = form === 'rampe_auf' ? [unten, oben] : [oben, unten];
      aus.push(k === 0 ? { beat: a, wert: s } : { beat: a, wert: s, form: 'sprung' }, { beat: b, wert: e, form: 'linear' });
    } else if (form === 'dreieck' || form === 'sinus') {
      const f = form === 'sinus' ? 's' as const : 'linear' as const;
      if (k === 0) aus.push({ beat: a, wert: unten });
      aus.push({ beat: mitte, wert: oben, form: f }, { beat: b, wert: unten, form: f });
    } else {
      aus.push(k === 0 ? { beat: a, wert: oben } : { beat: a, wert: oben, form: 'sprung' }, { beat: mitte, wert: unten, form: 'sprung' });
      if (k === perioden - 1) aus.push({ beat: b, wert: unten, form: 'sprung' });
    }
  }
  // the first point of a ramp's next period sits on the beat of the previous end: a jump pair (two points at one beat), as wanted
  return aus;
}

// D5: replaces the points in [von, bis] with the shape; at both edges a jump pair keeps the old value outside the range.
// A point already at `von` is the left edge as it is (its form is the segment into von, which stays); only without one an anchor is made.
export function setzeForm(punkte: readonly Punkt[], von: number, bis: number, form: Punkt[], ziel: string): Punkt[] {
  const alt = kopie(punkte);
  const links = { ...(alt.find((q) => q.beat === von) ?? anker(alt, von, ziel)) }, rechtsWert = laneWert(alt, bis, ziel);
  const innen = form.map((q) => ({ ...q }));
  const erster = innen[0], letzter = innen[innen.length - 1];
  const vorne: Punkt[] = [links];
  if (erster.wert === links.wert) innen.shift(); else erster.form = 'sprung';
  const hinten: Punkt[] = letzter.wert === rechtsWert && innen.length > 0 ? [] : [{ beat: bis, wert: rechtsWert, form: 'sprung' }];
  return [...alt.filter((q) => q.beat < von), ...vorne, ...innen, ...hinten, ...alt.filter((q) => q.beat > bis)];
}

// D6: simplify the points in [von, bis] with `vereinfache`, but only across maximal runs of linear segments: every non-linear point, its two
// neighbours, both points of a same-beat pair and the first and last point of the range stay unchanged (vereinfache measures against a linear chord)
export function bereichVereinfacht(punkte: readonly Punkt[], von: number, bis: number, ziel: string, toleranz: number = toleranzVon(ziel)): Punkt[] {
  const alt = kopie(punkte);
  const i0 = alt.findIndex((q) => q.beat >= von);
  const drin = alt.filter((q) => q.beat >= von && q.beat <= bis);
  if (i0 < 0 || drin.length < 3) return alt;
  const fest = new Uint8Array(drin.length);
  fest[0] = 1; fest[drin.length - 1] = 1;
  for (let i = 1; i < drin.length; i++) {
    if ((drin[i].form ?? 'linear') !== 'linear') { fest[i - 1] = 1; fest[i] = 1; if (i + 1 < drin.length) fest[i + 1] = 1; }
    if (drin[i].beat === drin[i - 1].beat) { fest[i - 1] = 1; fest[i] = 1; }
  }
  const aus: Punkt[] = [drin[0]];
  let a = 0;
  for (let b = 1; b < drin.length; b++) {
    if (!fest[b]) continue;
    const lauf = drin.slice(a, b + 1);
    aus.push(...(lauf.length >= 3 ? vereinfache(lauf, ziel, toleranz) : lauf).slice(1));
    a = b;
  }
  return [...alt.slice(0, i0), ...aus, ...alt.slice(i0 + drin.length)];
}

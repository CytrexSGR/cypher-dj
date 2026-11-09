// PRODUCTION (1.12 automation slice 4, plan PLAN-1.12-slices4-5-7.md D3 to D5): the lane editor tools on the page, pure (browser and node).
// The page does not import server code: dehne, neige, formPunkte, setzeForm and formBereich are a copy of project/lane_tools.ts (laneWert from
// lanes.js instead of project/lane.ts) and tests/production_lanes_tools.test.mjs compares both on one fixture set. Change one, change the other.
// Used for the draft of a stretch, skew or shape gesture (draft.js), so what is shown is what the server will store. Simplify is server only.
import { laneWert, bereich } from './lanes.js';

export const FORMEN_EINFUEGEN = ['rampe_auf', 'rampe_ab', 'sinus', 'dreieck', 'rechteck'];
export function formBereich(ziel) {
  if (ziel === 'fader') return { unten: -60, oben: 0 };
  if (ziel === 'pan') return { unten: -1, oben: 1 };
  return { unten: 0, oben: 1 };
}

const kopie = (p) => p.map((q) => ({ ...q }));
function anker(p, beat, ziel) {
  const naechster = p.find((q) => q.beat > beat);
  const a = { beat, wert: laneWert(p, beat, ziel) };
  if (naechster?.form !== undefined) a.form = naechster.form;
  return a;
}
function mitAnker(p, beat, ziel) {
  if (p.some((q) => q.beat === beat) || !p.some((q) => q.beat < beat) || !p.some((q) => q.beat > beat)) return p;
  const a = anker(p, beat, ziel);
  const i = p.findIndex((q) => q.beat > beat);
  return [...p.slice(0, i), a, ...p.slice(i)];
}

export function dehne(punkte, von, bis, neuBis, ziel) {
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
      if (amEnde.length === 2) neu.pop();
      neu.push({ beat: m, wert: wertM, form: 'sprung' });
    }
  } else if (rechts.length > 0 || ende !== wertM) {
    neu.push({ beat: m, wert: ende });
    if (ende !== wertM) neu.push({ beat: m, wert: wertM, form: 'sprung' });
  }
  return [...neu, ...rechts];
}

export function neige(punkte, von, bis, faktor, ziel) {
  if (faktor === 0) return kopie(punkte);
  const e = 4 ** faktor;
  return mitAnker(mitAnker(kopie(punkte), von, ziel), bis, ziel)
    .map((q) => (q.beat > von && q.beat < bis ? { ...q, beat: von + ((q.beat - von) / (bis - von)) ** e * (bis - von) } : q));
}

export function formPunkte(form, von, bis, perioden, unten, oben) {
  const P = (bis - von) / perioden, aus = [];
  for (let k = 0; k < perioden; k++) {
    const a = von + k * P, b = k === perioden - 1 ? bis : von + (k + 1) * P, mitte = von + (k + 0.5) * P;
    if (form === 'rampe_auf' || form === 'rampe_ab') {
      const [s, e] = form === 'rampe_auf' ? [unten, oben] : [oben, unten];
      aus.push(k === 0 ? { beat: a, wert: s } : { beat: a, wert: s, form: 'sprung' }, { beat: b, wert: e, form: 'linear' });
    } else if (form === 'dreieck' || form === 'sinus') {
      const f = form === 'sinus' ? 's' : 'linear';
      if (k === 0) aus.push({ beat: a, wert: unten });
      aus.push({ beat: mitte, wert: oben, form: f }, { beat: b, wert: unten, form: f });
    } else {
      aus.push(k === 0 ? { beat: a, wert: oben } : { beat: a, wert: oben, form: 'sprung' }, { beat: mitte, wert: unten, form: 'sprung' });
      if (k === perioden - 1) aus.push({ beat: b, wert: unten, form: 'sprung' });
    }
  }
  return aus;
}

export function setzeForm(punkte, von, bis, form, ziel) {
  const alt = kopie(punkte);
  const links = { ...(alt.find((q) => q.beat === von) ?? anker(alt, von, ziel)) }, rechtsWert = laneWert(alt, bis, ziel);
  const innen = form.map((q) => ({ ...q }));
  const erster = innen[0], letzter = innen[innen.length - 1];
  const vorne = [links];
  if (erster.wert === links.wert) innen.shift(); else erster.form = 'sprung';
  const hinten = letzter.wert === rechtsWert && innen.length > 0 ? [] : [{ beat: bis, wert: rechtsWert, form: 'sprung' }];
  return [...alt.filter((q) => q.beat < von), ...vorne, ...innen, ...hinten, ...alt.filter((q) => q.beat > bis)];
}

// The points of `lane` after one auto_dehnen, auto_neigen or auto_form command (defaults as on the server); other commands leave them.
// Like the server (normalisiereLane), a switch lane's points without form are jumps.
export function werkzeugNach(lane, b) {
  const z = lane.ziel;
  let p = lane.punkte;
  if (b.befehl === 'auto_dehnen') p = dehne(p, b.von_beat, b.bis_beat, b.neu_bis_beat, z);
  else if (b.befehl === 'auto_neigen') p = neige(p, b.von_beat, b.bis_beat, b.faktor, z);
  else if (b.befehl === 'auto_form') {
    const v = formBereich(z);
    p = setzeForm(p, b.von_beat, b.bis_beat, formPunkte(b.form, b.von_beat, b.bis_beat, b.perioden ?? 1, b.unten ?? v.unten, b.oben ?? v.oben), z);
  } else return p;
  return bereich(z).nurSprung ? p.map((q) => (q.form === undefined ? { ...q, form: 'sprung' } : q)) : p;
}

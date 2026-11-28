// NOTEN time rules (note editor slice 2, N13): the one place that decides what a time edit of notes does to the list. The command audio_noten_aendern
// (server) and the page preview (drag) both call zeitAnwenden, so a preview cannot disagree with the command. Pure and host-neutral: nothing here
// imports anything outside public/noten/ and nothing touches the input list (a changed note is a new object).
// Rules: a note's effective interval is [a ?? qa, e ?? qe] in source seconds. `zeitUm` moves both edges of every id by the same delta; `a` / `e`
// (absolute) only with one id. Values are rounded to 1e-6 and a value equal to qa / qe is not stored. Neighbours (D3): a neighbour whose effective edge
// touched the moved edge (gap < 40 ms before the edit) follows it; otherwise the gap gives. Then the list is checked: a >= 0, e > a, no overlap of
// effective intervals, stretch factor 0.25..4 against the detected length.

const GLEICH = 1e-6;          // seconds: a target this close to the detected value is not stored
const BERUEHRUNG = 0.04;      // seconds: a gap smaller than this before the edit counts as touching
const DEHNUNG_MIN = 0.25;
const DEHNUNG_MAX = 4;
const DEHNUNG_TOLERANZ = 1e-9;

const rundeS = (x) => Math.round(x * 1e6) / 1e6;
const aEff = (n) => n.a ?? n.qa;
const eEff = (n) => n.e ?? n.qe;
const zahl = (x) => typeof x === 'number' && Number.isFinite(x);

/** Note with edge `feld` ('a' or 'e') set to the effective value `wert` (seconds); the field is removed when it equals the detected value */
function mitKante(n, feld, wert) {
  const w = rundeS(wert);
  const q = feld === 'a' ? n.qa : n.qe;
  const { [feld]: _alt, ...rest } = n;
  return Math.abs(w - q) <= GLEICH ? rest : { ...rest, [feld]: w };
}

/**
 * @param {object[]} liste  the notes of the clip (audio_noten.liste), in order of qa
 * @param {{ ids: string[], a?: number, e?: number, zeitUm?: number }} aenderung  ids of the notes to edit (any order); `zeitUm` seconds, or `a` and / or `e`
 *        absolute seconds for exactly one id
 * @param {{ mitNachbarn?: boolean }} [opt]
 * @returns {{ liste: object[] } | { grund: string, text: string }}
 */
export function zeitAnwenden(liste, aenderung, { mitNachbarn = true } = {}) {
  const nein = (grund, text) => ({ grund, text });
  const { ids, a, e, zeitUm } = aenderung;
  if (!Array.isArray(ids) || ids.length < 1) return nein('argument_ungueltig', 'ids: at least one note id expected');
  const imSatz = new Set(ids);
  const pos = [];
  liste.forEach((n, i) => { if (imSatz.has(n.id)) pos.push(i); });
  if (pos.length !== imSatz.size) return nein('noten_unbekannt', ids.find((id) => !liste.some((n) => n.id === id)));
  const absolut = a !== undefined || e !== undefined;
  if (absolut === (zeitUm !== undefined)) return nein('argument_ungueltig', 'exactly one of zeit_um and (a, e) expected');
  if (absolut && pos.length !== 1) return nein('argument_ungueltig', 'a and e only with exactly one id');
  for (const [k, v] of [['a', a], ['e', e], ['zeit_um', zeitUm]]) {
    if (v !== undefined && !zahl(v)) return nein('argument_ungueltig', `${k}: finite number expected`);
  }

  // new effective edges of every moved note
  const neu = new Map();   // index -> { a, e }
  for (const i of pos) {
    const n = liste[i];
    neu.set(i, absolut
      ? { a: a === undefined ? aEff(n) : rundeS(a), e: e === undefined ? eEff(n) : rundeS(e) }   // the edge not given stays unrounded: it did not move
      : { a: rundeS(aEff(n) + zeitUm), e: rundeS(eEff(n) + zeitUm) });
  }

  const aus = liste.slice();
  const geaendert = new Set();
  for (const [i, k] of neu) {
    const n = liste[i];
    let m = n;
    if (Math.abs(k.a - aEff(n)) > 1e-9) m = mitKante(m, 'a', k.a);
    if (Math.abs(k.e - eEff(n)) > 1e-9) m = mitKante(m, 'e', k.e);
    if (m !== n) { aus[i] = m; geaendert.add(i); }
  }

  // neighbours (D3): decided on the list before the edit, only for an edge that really moved
  if (mitNachbarn) {
    const erst = pos[0]; const letzt = pos[pos.length - 1];
    const k0 = neu.get(erst); const kl = neu.get(letzt);
    const p = erst > 0 ? erst - 1 : -1;
    if (p >= 0 && !imSatz.has(liste[p].id) && Math.abs(k0.a - aEff(liste[erst])) > 1e-9 && aEff(liste[erst]) - eEff(liste[p]) < BERUEHRUNG) {
      aus[p] = mitKante(liste[p], 'e', k0.a); geaendert.add(p);
    }
    const q = letzt + 1 < liste.length ? letzt + 1 : -1;
    if (q >= 0 && !imSatz.has(liste[q].id) && Math.abs(kl.e - eEff(liste[letzt])) > 1e-9 && aEff(liste[q]) - eEff(liste[letzt]) < BERUEHRUNG) {
      aus[q] = mitKante(liste[q], 'a', kl.e); geaendert.add(q);
    }
  }

  // checks: start, order of the edges, overlap, stretch
  for (const i of [...geaendert].sort((x, y) => x - y)) {
    const n = aus[i];
    if (aEff(n) < 0) return nein('argument_ungueltig', `${n.id}: the start would be before 0 (${aEff(n)})`);
    if (eEff(n) <= aEff(n)) return nein('argument_ungueltig', `${n.id}: the end must be greater than the start`);
  }
  for (let i = 1; i < aus.length; i++) {
    if (!geaendert.has(i) && !geaendert.has(i - 1)) continue;
    if (eEff(aus[i - 1]) > aEff(aus[i])) {
      return nein('noten_ueberlappen', `notes overlap after the edit (end ${eEff(aus[i - 1])} of ${aus[i - 1].id} is after the start ${aEff(aus[i])} of ${aus[i].id})`);
    }
  }
  for (const i of [...geaendert].sort((x, y) => x - y)) {
    const n = aus[i];
    const f = (eEff(n) - aEff(n)) / (n.qe - n.qa);
    if (f < DEHNUNG_MIN - DEHNUNG_TOLERANZ || f > DEHNUNG_MAX + DEHNUNG_TOLERANZ) {
      return nein('noten_dehnung_grenze', `${n.id}: a note can be stretched to at most 4 times and compressed to a quarter of its detected length (factor ${Math.round(f * 1e3) / 1e3})`);
    }
  }
  return { liste: aus };
}

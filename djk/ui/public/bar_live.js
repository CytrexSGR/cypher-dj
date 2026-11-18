// The live page counts bars of the open project's time signature n/4 (plan studio-taktart, phase 1). Pure helpers plus the one number the page holds.
// With no project open or an invalid meter the page counts 4. The rule is the same as `takteProLive` of project/taktart_live.ts (a drift test pins it).
export const TAKT_STANDARD = 4;
const ZAEHLER_MIN = 2, ZAEHLER_MAX = 12;

// Beats per bar of a project meter value: n of a valid [n, 4] (whole n from 2 to 12), else 4.
export function takteProLive(taktart) {
  const ok = Array.isArray(taktart) && taktart.length === 2 && Number.isInteger(taktart[0]) && taktart[1] === 4
    && taktart[0] >= ZAEHLER_MIN && taktart[0] <= ZAEHLER_MAX;
  return ok ? taktart[0] : TAKT_STANDARD;
}

// BAR, BEAT-in-bar and PHRASE (8 bars) of a master beat.
export function zaehlerVon(beat, proTakt = TAKT_STANDARD) {
  return { takt: Math.floor(beat / proTakt) + 1, phrase: Math.floor(beat / (8 * proTakt)) + 1, schlag: Math.floor(((beat % proTakt) + proTakt) % proTakt) + 1 };
}

// The conductor (/takt event of the core) counts 4: the page takes its bar and phrase only while the studio counts 4 as well.
export const leitstandZaehlt = (proTakt) => proTakt === TAKT_STANDARD;

let proTakt = TAKT_STANDARD;
export const proTaktJetzt = () => proTakt;
export function setzeProTakt(n) { proTakt = takteProLive(n === TAKT_STANDARD ? null : [n, 4]); return proTakt; }

// Header beat dots: one <i> per beat of the bar (4 by default, so the markup of index.html stays). `el` holds the dots, `neu` makes one.
export function zeigeSchlagPunkte(el, beat, n = TAKT_STANDARD, neu = () => document.createElement('i')) {
  let punkte = [...el.querySelectorAll('i')];
  if (punkte.length !== n) { punkte = Array.from({ length: n }, neu); el.replaceChildren(...punkte); }
  const s = Math.floor(((beat % n) + n) % n);
  punkte.forEach((i, k) => i.classList.toggle('an', k === s));
}

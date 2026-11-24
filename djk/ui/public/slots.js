// DJ view places (container core, lane U, U2): the pure model of the four places. The places live in the live project (GET /lage answers
// `plaetze`, POST /plaetze changes one), the page keeps no layout of its own. No DOM, no storage, no fetch: it runs in node tests.
// A place holds one of six types (F5): leer, track (deck N plays on place N), strudel (at most once), seq, loops, stems. The count of loops and stems
// places is the server's business. The strip of place N is the container strip A..D (pfadVonPlatz); the model knows no other channel.
import { containerName, pfadVonPlatz } from './kanaele.js';

/** The place types in the order of F5. */
export const PLATZ_TYPEN = Object.freeze(['leer', 'track', 'strudel', 'seq', 'loops', 'stems']);
/** The words a person reads for a place type (titles of the type keys): the stored value `leer` is never shown. */
export const PLATZ_WORT = Object.freeze({ leer: 'empty', track: 'track', strudel: 'Strudel', seq: 'SEQ', loops: 'loops', stems: 'stems' });

/** The types that may sit in one place only (C1: loops may appear twice, one per loop deck). */
export const EINMALIG = Object.freeze(['strudel']);
/** Open when trim plus fader is above this level (dB). */
export const KANAL_OFFEN_DB = -26;

const PLATZ_N = 4;
const platzGueltig = (n) => Number.isInteger(n) && n >= 1 && n <= PLATZ_N;

/** The four places of an answer of /lage, or null when no live project is open (no `plaetze`, or not exactly four entries). */
export function plaetzeAusLage(lage) {
  const p = lage?.plaetze;
  return Array.isArray(p) && p.length === PLATZ_N ? p : null;
}

/** The type of place n (1..4); 'leer' without a live project. */
export const typVon = (plaetze, n) => plaetze?.[n - 1]?.typ ?? 'leer';

/** The group of place n, or null for leer, track and without a live project. */
export const gruppeVon = (plaetze, n) => plaetze?.[n - 1]?.gruppe ?? null;

/** Whether the page offers `typ` on `platz`: a known type, and a single-place type only when no other place holds it. Nothing without a live project. */
export function erlaubt(plaetze, platz, typ) {
  if (!plaetze || !PLATZ_TYPEN.includes(typ)) return false;
  if (!EINMALIG.includes(typ)) return true;
  return !plaetze.some((p, i) => i !== platz - 1 && p?.typ === typ);
}

// Open when trim plus fader is above -26 dB; an unknown fader counts -200, an unknown trim 0.
// slots_paritaet.test.mjs runs this and kanalOffen of hand_operation.ts over the same table of values.
export function kanalOffen(regler, k) {
  return (regler?.[`${k}/trim`] ?? 0) + (regler?.[`${k}/trim_auto`] ?? 0) + (regler?.[`${k}/fader`] ?? -200) > KANAL_OFFEN_DB;
}
export const pflAn = (regler, k) => (regler?.[`${k}/pfl`] ?? 0) >= 0.5;

/** The silence rule: a place is silent when its container strip is closed and has PFL off. An empty place, and any place without a live project,
 *  has nothing to silence. `offen` names what blocks the switch, `text` says it in one line. */
export function still(plaetze, platz, regler) {
  const offen = [];
  if (plaetze && typVon(plaetze, platz) !== 'leer') {
    const k = pfadVonPlatz(platz);
    if (kanalOffen(regler, k)) offen.push({ kanal: k, grund: 'open' });
    else if (pflAn(regler, k)) offen.push({ kanal: k, grund: 'pfl' });
  }
  const text = offen.length === 0 ? '' : `${containerName(offen[0].kanal)} ${offen[0].grund === 'pfl' ? 'has PFL on' : 'is open'}`;
  return { still: offen.length === 0, offen, text };
}

/** The body of POST /plaetze for a switch of `platz` to `typ`; throws RangeError for a place outside 1..4 or an unknown type. */
export function wechselKoerper(platz, typ) {
  if (!platzGueltig(platz)) throw new RangeError(`platz ${platz}`);
  if (!PLATZ_TYPEN.includes(typ)) throw new RangeError(`typ ${typ}`);
  return { platz, typ };
}

/** The banner of a closed live set: `null` while it is open; otherwise the sentence and the key. `anderesProjekt` is true while a non-live project is open. */
export function liveZuText({ offen, anderesProjekt }) {
  if (offen) return null;
  return { text: anderesProjekt ? 'The live set is closed because another project is open.' : 'The live set is not open.', knopf: 'OPEN LIVE SET' };
}

/** Head text of the strip of place n: the container letter and the type ('C strudel', 'A track', 'B empty'). */
export function zugKopf(plaetze, n) {
  const typ = typVon(plaetze, n);
  return `${containerName(pfadVonPlatz(n))} ${typ === 'leer' ? 'empty' : typ}`;
}

// Shared page state and helpers (zustand, deckAnsicht, $, $$, melde, postJson, el, the check-mode banner). One instance for every view module.
import { HAND_PRUEFMODUS_TEXT } from './messages.js';

export const $ = (s, w = document) => w.querySelector(s);
export const $$ = (s, w = document) => [...w.querySelectorAll(s)];
export const BUCHSTABE = { 1: 'A', 2: 'B', 3: '3', 4: '4' };
// The decks the page shows today (places plan, slice 1): the sections and strips of all DECKS exist, decks 3 and 4 stay hidden until slice 4 places them.
// LADE_DECKS get a LOAD button in the library (places plan task 16: the deck 3 bar is gone, every deck is a Track place).
export const LADE_DECKS = [1, 2, 3, 4];
const KLASSE_LADEN = { 1: 'a', 2: 'b', 3: 'd3', 4: 'd3' };
export const klasseLaden = (n) => KLASSE_LADEN[n];
// Studio S1: Zustand je Instanz in `instanzen` (unten)
export const jsonPost = (pfad, daten) => fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });

export const zustand = {
  regler: {},             // pfad → Wert laut Kern (/e/regler)
  decks: {},              // deck → letzte /zustand/deck
  bestand: [],            // aus /bestand
  geladen: {},            // deck → material_id
  eigeneLaden: new Map(), // id → deck (für /q)
  loopliste: [],          // aus /loops
  plaetze: null,          // the four places of the live project (GET /lage), null without one
  container: null,        // GET /lage container: [{art}] x4 (leer|player|modul), null until the first answer
};
window.djk = zustand;      // für die Prüfung (lesen)
export const deckAnsicht = {};    // deck → { lauf, ueber, kopf, id, raster } (Plan Oberfläche T5)
window.djkAnsicht = deckAnsicht;  // für die Prüfung (lesen)

let meldungZeit = 0;
export function melde(text, fehler = false, dauerhaft = false) {
  const m = $('#meldung');
  m.textContent = text;
  m.className = fehler ? 'fehler' : 'ok';
  clearTimeout(meldungZeit);
  if (!dauerhaft) meldungZeit = setTimeout(() => { m.textContent = ''; }, 6000);
}

// Kern ohne Prüfmodus: die Hand der Seite (/test/hand) kommt nicht an, bis 35 hand_osc bringt. Sichtbar, nicht still.
export let pruefmodusAus = false;
export function zeigePruefmodus(stand) {
  const aus = stand === 'aus';
  $('#v-kern').classList.toggle('ohne-hand', aus);
  $('#v-kern').title = aus ? `Audio core (via page server): ${HAND_PRUEFMODUS_TEXT}` : 'Audio core (via page server)';
  if (aus) melde(HAND_PRUEFMODUS_TEXT, true, true);
  else if (pruefmodusAus) melde('');
  pruefmodusAus = aus;
}
export const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
export async function postJson(pfad, daten) {
  const r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten ?? {}) });
  return { ok: r.ok, code: r.status, j: await r.json() };
}

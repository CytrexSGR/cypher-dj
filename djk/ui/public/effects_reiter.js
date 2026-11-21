import { CONTAINER, fxReiter } from './kanaele.js';
// The channel chosen in the EFFECTS tab, kept per viewer (localStorage, try/catch): the card in front of the live dock (live_dock/host.js) sets it through
// setzeFxGewaehlt (effects_view.js), the PRESETS tab works on it. FX_REITER is the order of the former tab row (MASTER, the containers A..D, SENDS, BUS);
// a stored choice is checked against it. This module touches no page module (they need a browser to load); the channel ids equal FX_KANAELE
// (live_kanaele.js; a test pins that the ids are equal).
export const FX_REITER = fxReiter();
export const FX_REITER_SCHLUESSEL = 'djk-fx-reiter';
export function reiterWahl(gespeichert, vorgabe = CONTAINER[0].pfad) {
  return FX_REITER.some((r) => r.id === gespeichert) ? gespeichert : vorgabe;
}
let aktiv = null;
function lade() {
  try { return localStorage.getItem(FX_REITER_SCHLUESSEL); } catch { return null; }
}
export const fxReiterAktiv = () => (aktiv ??= reiterWahl(lade()));

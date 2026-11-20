// The channel chosen in the EFFECTS tab, kept per viewer (localStorage, try/catch): the card in front of the live dock (live_dock/host.js) sets it through
// setzeFxGewaehlt (effects_view.js), the PRESETS tab works on it. FX_REITER is the order of the former tab row (MASTER, the ten channels, SENDS, BUS);
// a stored choice is checked against it. This module touches no page module (they need a browser to load); the channel ids equal FX_KANAELE
// (live_kanaele.js; a test pins that the ids are equal).
export const FX_REITER = [{ id: 'master', text: 'MASTER' }].concat([['deck/1', 'A'], ['deck/2', 'B'], ['erz/1', 'DRUMS'], ['erz/2', 'BASS'], ['erz/3', 'MELODY'], ['erz/5', 'I5'], ['erz/6', 'I6'], ['erz/7', 'I7'],
  ['pad/1', 'L1'], ['pad/2', 'L2']].map(([id, text]) => ({ id, text })), [{ id: 'sends', text: 'SENDS' }, { id: 'bus', text: 'BUS' }]);
export const FX_REITER_SCHLUESSEL = 'djk-fx-reiter';
export function reiterWahl(gespeichert, vorgabe = 'erz/1') {
  return FX_REITER.some((r) => r.id === gespeichert) ? gespeichert : vorgabe;
}
let aktiv = null;
function lade() {
  try { return localStorage.getItem(FX_REITER_SCHLUESSEL); } catch { return null; }
}
export const fxReiterAktiv = () => (aktiv ??= reiterWahl(lade()));

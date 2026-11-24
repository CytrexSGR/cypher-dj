// Frame of the browser component (browser plan 2, task 3): open/closed per view, remembered per viewer in localStorage.
// Every read and write is wrapped: without storage (private window, blocked data) the default holds and nothing throws.
export const BROWSER_SCHLUESSEL = (ansicht) => `djk-browser-offen-${ansicht}`;
const STANDARD_OFFEN = (ansicht) => ansicht === 'produktion';

export function liesOffen(speicher, ansicht) {
  let w = null;
  try { w = speicher?.getItem(BROWSER_SCHLUESSEL(ansicht)) ?? null; } catch { /* without storage: the default */ }
  if (w === 'ja') return true;
  if (w === 'nein') return false;
  return STANDARD_OFFEN(ansicht);
}
export function merkeOffen(speicher, ansicht, offen) {
  try { speicher?.setItem(BROWSER_SCHLUESSEL(ansicht), offen ? 'ja' : 'nein'); } catch { /* without storage: only now */ }
}

// task 5: PRODUCTION folds its dock (body.browser-zu); the other views open a drawer (body.browser-offen). Both are remembered per view.
export function schalte(ansicht, offen, speicher = globalThis.localStorage) {
  if (ansicht === 'produktion') globalThis.document?.body.classList.toggle('browser-zu', !offen);
  else globalThis.document?.body.classList.toggle('browser-offen', offen);
  merkeOffen(speicher, ansicht, offen);
}
// a plain b or B (no modifier) that does not land in a text field
export function tasteB(e) {
  if (e.key !== 'b' && e.key !== 'B') return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !e.target?.closest?.('input, textarea, select, [contenteditable]');
}
// the drawer is 360 px wide (max) and stays left of whatever must stay uncovered, but never narrower than 280 px
export function drawerBreite({ sperrLinks = [], max = 360, min = 280 }) {
  const frei = sperrLinks.length ? Math.min(...sperrLinks) - 8 : Infinity;
  return Math.max(min, Math.min(max, frei));
}

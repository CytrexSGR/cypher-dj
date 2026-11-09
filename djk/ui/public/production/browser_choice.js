// PRODUCTION (package 1.16 rest, layout decision of the spec): the left browser column gets a mode switch LIBRARY · DEVICES · PRESETS ·
// COLLECTIONS. The mode is a class on body (b-library, b-geraete, b-presets, b-kollektionen), set only while PRODUCTION is visible;
// production.css shows the matching element. Remembered per viewer in localStorage under djk-prod-browser (try/catch: without storage the
// mode lives only now). The DJ view and its tab state (djk-bereich) are never touched. COLLECTIONS is on since U8 (public/collections.js).
export const BROWSER_MODI = ['library', 'geraete', 'presets', 'kollektionen'];
export const BROWSER_SCHLUESSEL = 'djk-prod-browser';
export const MODUS_AKTIV = { library: true, geraete: true, presets: true, kollektionen: true };
const MODUS_TEXT = { library: 'LIBRARY', geraete: 'DEVICES', presets: 'PRESETS', kollektionen: 'COLLECTIONS' };
const MODUS_TITEL = { library: 'Library: samples, loops, tracks', geraete: 'Devices: instruments and effects to drag into the arrangement',
  presets: 'Presets: drag onto a track or an insert stage, save the current sound', kollektionen: 'Collections: your lists of samples, presets and devices; right click a row to add it' };

export function liesModus(speicher) {
  let m = null;
  try { m = speicher?.getItem(BROWSER_SCHLUESSEL) ?? null; } catch { /* without storage: LIBRARY */ }
  return BROWSER_MODI.includes(m) && MODUS_AKTIV[m] ? m : 'library';
}
export function merkeModus(speicher, m) {
  try { speicher?.setItem(BROWSER_SCHLUESSEL, m); } catch { /* without storage: only now */ }
}
// exactly one mode class while visible, none while hidden
export function setzeKlassen(body, modus, sichtbar) {
  for (const m of BROWSER_MODI) body.classList.toggle(`b-${m}`, !!sichtbar && m === modus);
}
// a click: the new mode (and remembered), or the old one when the mode is disabled
export function waehle(speicher, neu, alt) {
  if (!BROWSER_MODI.includes(neu) || !MODUS_AKTIV[neu]) return alt;
  merkeModus(speicher, neu);
  return neu;
}
export function wahlHtml(modus) {
  return BROWSER_MODI.map((m) => `<button data-browser-modus="${m}" class="${m === modus ? 'an' : ''}" aria-pressed="${m === modus}" title="${MODUS_TITEL[m]}"`
    + `${MODUS_AKTIV[m] ? '' : ' disabled'}>${MODUS_TEXT[m]}</button>`).join('');
}

export function bindeBrowserwahl(ctx, speicher = globalThis.localStorage) {
  const wurzel = document.getElementById('p-browserwahl');
  if (!wurzel) return;
  let modus = liesModus(speicher);
  let presetsAn = false;   // the panel was asked for since PRESETS became the visible mode (a repeated click on it does not reload the list)
  let kollAn = false;      // U8: the same for COLLECTIONS
  const zeige = () => {
    wurzel.innerHTML = wahlHtml(modus); setzeKlassen(document.body, modus, ctx.st.sichtbar);
    const an = modus === 'presets' && !!ctx.st.sichtbar;
    if (an && !presetsAn) ctx.presetsZeigen?.();   // 1.16 rest U7: build and load the PRESETS panel (app.js)
    presetsAn = an;
    const ka = modus === 'kollektionen' && !!ctx.st.sichtbar;
    if (ka && !kollAn) ctx.kollektionenZeigen?.();   // 1.16 rest U8: load the collections (collections.js)
    kollAn = ka;
  };
  wurzel.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-browser-modus]');
    if (!b || b.disabled) return;
    modus = waehle(speicher, b.dataset.browserModus, modus);
    zeige();
  });
  ctx.beimSichtwechsel.push(() => zeige());
  zeige();
}

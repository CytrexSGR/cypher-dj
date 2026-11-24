// Collapsible panels under the arrangement (Andreas 2026-11-13: "alle fenster darunter müssen in gleicher weise einklappbar sein").
// The three dock rows (TRACKS, GROUPS, EFFECTS) and CLIP fold like ROUTING MATRIX and INPUTS (those are <details>): a click on the title keeps only the
// title, and the arrangement takes the freed height (the dock row and the CLIP row of the page grid shrink, see production.css).
// The folded state is a per-viewer convenience in localStorage; without a stored choice the compact default of standardZu applies.
const SCHLUESSEL = 'djk.produktion.zu';
// [storage key, part (the element that gets .p-zu), title inside the part]. A dock row is the parent of its card container (the dock builds the rows once).
const dockZeile = (karten) => (ctx) => ctx.$('dock-wurzel')?.querySelector(`[data-w="${karten}"]`)?.parentElement ?? null;
const TEILE = [['dock-spuren', dockZeile('dock-synths'), '.w-dock-etikett'], ['dock-gruppen', dockZeile('dock-grp'), '.w-dock-etikett'], ['dock-fx', dockZeile('dock-fx'), '.w-dock-etikett'],
  ['detail', (ctx) => ctx.$('detail'), '[data-d="titel"]']];

// The stored choice, or null when none was made (nothing stored, unreadable, or storage blocked): then the default of the window height applies.
function lies() {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (roh === null || roh === undefined) return null;
    const v = JSON.parse(roh);
    return new Set(Array.isArray(v) ? v : []);
  } catch { return null; }
}
/** UI polish T7 (Nr. 2): the panels that start folded. A stored choice always wins (an empty one means: all open); without one a window of 820 px height or less
 *  starts with the three dock rows and CLIP folded, so the arrangement keeps its 300 px. */
export function standardZu(hoch, gespeichert) {
  if (gespeichert) return new Set(gespeichert);
  return hoch <= 820 ? new Set(['dock-spuren', 'dock-gruppen', 'dock-fx', 'detail']) : new Set();
}
function schreib(zu) {
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify([...zu])); } catch { /* no storage: the state lives until reload */ }
}

export function bindeEinklappen(ctx) {
  const gewaehlt = lies();
  let vorgabe = gewaehlt === null;   // true while the folded state is the default of the window height, not a choice of the viewer
  const zu = standardZu(window.innerHeight, gewaehlt);
  for (const [name, finde, wahl] of TEILE) {
    const teil = finde(ctx);
    const titel = teil && teil.querySelector(wahl);
    if (!titel) continue;
    titel.classList.add('p-klapptitel');
    titel.setAttribute('role', 'button');
    titel.tabIndex = 0;
    titel.title = 'Fold or unfold this panel';
    const setze = (an) => { teil.classList.toggle('p-zu', an); titel.setAttribute('aria-expanded', String(!an)); };
    setze(zu.has(name));
    const kippe = () => { vorgabe = false; const an = !teil.classList.contains('p-zu'); setze(an); if (an) zu.add(name); else zu.delete(name); schreib(zu); };
    // CLIP folded by the default: selecting a clip unfolds it (nothing is written, the next load starts folded again); a viewer's own choice is left alone
    const leer = name === 'detail' ? teil.querySelector('[data-d="leer"]') : null;
    if (leer && typeof MutationObserver === 'function') new MutationObserver(() => { if (vorgabe && leer.hidden && teil.classList.contains('p-zu')) setze(false); }).observe(leer, { attributes: true, attributeFilter: ['hidden'] });
    titel.addEventListener('click', kippe);
    titel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kippe(); } });
  }
}

// UI polish fix (transport): the recording options (count-in, punch, overdub, automation recording) sit behind one REC OPTIONS key so the toolbar needs two rows at 1366 px.
// The key shows the state (aria-pressed and the lit key) and the choice is remembered per viewer; folded by default.
const REC_SCHLUESSEL = 'djk.produktion.recopt';
export function bindeRecOptionen(ctx) {
  const knopf = ctx.$('recopt'), leiste = knopf?.closest('.p-transport');
  if (!knopf || !leiste) return;
  let an = false;
  try { an = localStorage.getItem(REC_SCHLUESSEL) === '1'; } catch { /* no storage: folded */ }
  const setze = (neu) => {
    an = neu;
    leiste.classList.toggle('p-recopt-auf', an);
    knopf.classList.toggle('an', an);
    knopf.setAttribute('aria-pressed', String(an)); knopf.setAttribute('aria-expanded', String(an));
    knopf.textContent = an ? 'REC OPTIONS ▴' : 'REC OPTIONS ▾';
  };
  setze(an);
  knopf.addEventListener('click', () => { setze(!an); try { localStorage.setItem(REC_SCHLUESSEL, an ? '1' : '0'); } catch { /* the state lives until reload */ } });
}

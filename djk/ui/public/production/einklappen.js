// Collapsible panels under the arrangement (Andreas 2026-11-13: "alle fenster darunter müssen in gleicher weise einklappbar sein").
// The three dock rows (TRACKS, GROUPS, EFFECTS) and CLIP fold like ROUTING MATRIX and INPUTS (those are <details>): a click on the title keeps only the
// title, and the arrangement takes the freed height (the dock row and the CLIP row of the page grid shrink, see production.css).
// The folded state is a per-viewer convenience in localStorage; without storage every panel starts open.
const SCHLUESSEL = 'djk.produktion.zu';
// [storage key, part (the element that gets .p-zu), title inside the part]. A dock row is the parent of its card container (the dock builds the rows once).
const dockZeile = (karten) => (ctx) => ctx.$('dock-wurzel')?.querySelector(`[data-w="${karten}"]`)?.parentElement ?? null;
const TEILE = [['dock-spuren', dockZeile('dock-synths'), '.w-dock-etikett'], ['dock-gruppen', dockZeile('dock-grp'), '.w-dock-etikett'], ['dock-fx', dockZeile('dock-fx'), '.w-dock-etikett'],
  ['detail', (ctx) => ctx.$('detail'), '[data-d="titel"]']];

function lies() {
  try { const v = JSON.parse(localStorage.getItem(SCHLUESSEL) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function schreib(zu) {
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify([...zu])); } catch { /* no storage: the state lives until reload */ }
}

export function bindeEinklappen(ctx) {
  const zu = lies();
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
    const kippe = () => { const an = !teil.classList.contains('p-zu'); setze(an); if (an) zu.add(name); else zu.delete(name); schreib(zu); };
    titel.addEventListener('click', kippe);
    titel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kippe(); } });
  }
}

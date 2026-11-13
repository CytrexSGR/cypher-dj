// Collapsible panels under the arrangement (Andreas 2026-11-13: "alle fenster darunter müssen in gleicher weise einklappbar sein").
// GROUPS, RETURNS and CLIP fold like ROUTING MATRIX, INSERTS and INPUTS (those are <details>): a click on the title keeps only the
// title row, and the arrangement takes the freed height (the CLIP row of the page grid shrinks to its title, see production.css).
// The folded state is a per-viewer convenience in localStorage; without storage every panel starts open.
const SCHLUESSEL = 'djk.produktion.zu';
const TEILE = [['mixer', '.p-mixer-kopf > .p-mixer-titel'], ['returns', '.p-mixer-kopf > .p-mixer-titel'], ['detail', '[data-d="titel"]']];

function lies() {
  try { const v = JSON.parse(localStorage.getItem(SCHLUESSEL) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function schreib(zu) {
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify([...zu])); } catch { /* no storage: the state lives until reload */ }
}

export function bindeEinklappen(ctx) {
  const zu = lies();
  for (const [name, wahl] of TEILE) {
    const teil = ctx.$(name);
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

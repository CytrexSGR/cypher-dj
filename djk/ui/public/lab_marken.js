// R9: a small "LAB" mark on every page element that opens or is a labs feature (table: lab_marken_table.js, rows of docs/masterplan/SCOPE-1.0.md).
// Tooltip exactly "experimental, may change". markiere is idempotent (data-lab marks an element as done); the observer catches buttons that views build later.
import { LAB_ZEILEN } from './lab_marken_table.js';

export const LAB_TEXT = 'experimental, may change';

/** Adds one mark to every element matching a selector of the table that has none yet; returns the number of marks added. */
export function markiere(wurzel, tabelle = LAB_ZEILEN) {
  let neu = 0;
  const dok = wurzel.ownerDocument ?? globalThis.document;
  for (const zeile of tabelle) {
    for (const sel of zeile.seite ?? []) {
      let treffer = [];
      try { treffer = wurzel.querySelectorAll(sel); } catch { continue; }   // an invalid selector must not stop the others
      for (const el of treffer) {
        if (el.dataset && el.dataset.lab !== undefined) continue;
        if (zeile.text && !zeile.text.test(el.textContent ?? '')) continue;
        const m = dok.createElement('span');
        m.className = 'lab-marke'; m.title = LAB_TEXT; m.textContent = 'LAB';
        el.append(m);
        el.dataset.lab = '';
        neu++;
      }
    }
  }
  return neu;
}

if (typeof document !== 'undefined' && document.body) {
  markiere(document.body);
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => markiere(document.body)).observe(document.body, { childList: true, subtree: true });
  }
}

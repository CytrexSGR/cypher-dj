// Bottom area of the loop deck pop-up (loopdeck/gross.js): the tabs CLIP | DEVICES. CLIP mounts the properties and the clip editor of the selected cell;
// DEVICES is mounted by the pop-up through `koerper('DEVICES')` (the shared dock). The tab is remembered per viewer (localStorage); a stored name
// this build does not know (the old STRUDEL and SCENES tabs of the SESSION view) reads as CLIP.
import { baueEditor } from './editor.js';

export const TABS = ['CLIP', 'DEVICES'];
export const TAB_SCHLUESSEL = 'djk-session-tab';
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

function leseTab() {
  try { const t = globalThis.localStorage?.getItem(TAB_SCHLUESSEL); if (TABS.includes(t)) return t; } catch { /* storage blocked: the default */ }
  return 'CLIP';
}
function schreibeTab(t) { try { globalThis.localStorage?.setItem(TAB_SCHLUESSEL, t); } catch { /* storage blocked: not remembered */ } }

/** wurzel: the bottom area node. opt.editor: the context of baueEditor. opt.beiTab(name): called when a tab shows. */
export function baueUnten(wurzel, opt = {}) {
  const leiste = el('div', 'dtabs'); leiste.setAttribute('role', 'tablist');
  const koerper = {}, knoepfe = {};
  const flaeche = el('div', 'dpanes');
  for (const t of TABS) {
    const b = el('button', 'dtab', t); b.type = 'button'; b.setAttribute('type', 'button'); b.dataset.tab = t; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => zeigeTab(t));
    leiste.append(b); knoepfe[t] = b;
    const k = el('div', `pane pane-${t.toLowerCase()}`); k.dataset.pane = t; k.hidden = true; koerper[t] = k; flaeche.append(k);
  }
  wurzel.append(leiste, flaeche);
  const editor = baueEditor(koerper.CLIP, opt.editor ?? {});
  let aktuell = null;

  function zeigeTab(name) {
    if (!TABS.includes(name)) return;
    aktuell = name; schreibeTab(name);
    for (const t of TABS) {
      koerper[t].hidden = t !== name;
      knoepfe[t].classList.toggle('an', t === name); knoepfe[t].setAttribute('aria-selected', String(t === name));
    }
    opt.beiTab?.(name);
  }

  zeigeTab(leseTab());
  return { zeigeTab, tab: () => aktuell, koerper: (n) => koerper[n], editor };
}

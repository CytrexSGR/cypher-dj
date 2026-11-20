// The gestures and the context menu of a card (PRODUCTION, switch `mischer`): right click = the strip menu of the heads (production/context_menu.js KOPF_MENUE),
// double click on the name = inline rename, click on the colour field = the next colour.
import { kopfMenuePunkte } from '../production/context_menu.js';
import { kartenMenueWeicht } from './blocks.js';

const RENAME = { spur: ['spur_aendern', 'spur_id', 'Rename track'], grp: ['gruppenspur_aendern', 'gruppe_id', 'Rename group'], ret: ['return_aendern', 'return_id', 'Rename return'] };
const LISTE = { spur: 'spuren', grp: 'gruppen', ret: 'returns' };
const startet = new WeakMap();   // card element -> its rename starter (the menu entry Rename reaches a card through ctx.dockUmbenennen)

// the strip as the heads pass it to the menu: the project track itself, {id, name} for a group, a return and the master
function strangVon(host, karte) {
  const p = host.projekt?.();
  if (!p) return null;
  if (karte.art === 'pm') return { id: 'master', name: 'Master' };
  const x = (p[LISTE[karte.art]] ?? []).find((s) => s.id === karte.id);
  if (!x) return null;
  return karte.art === 'spur' ? x : { id: x.id, name: x.name };
}

/** Binds rename, colour and the card menu to one card. `karte` is the card of the model; `el` the card, `nameEl` and `farbEl` the name and the colour field (or null). */
export function bindeKartenGesten(host, karte, { el, nameEl, farbEl }) {
  if (!host.schalter?.mischer || !el) return;
  const ctx = host.adapterCtx;
  const aufStrang = () => strangVon(host, karte);
  el.addEventListener('contextmenu', (e) => {
    if (e.target?.tagName === 'INPUT' && e.target.type === 'text') return;   // the name field keeps the browser menu
    if (kartenMenueWeicht(e.target)) return;   // a stage chip opens its own menu
    const strang = aufStrang();
    const punkte = strang && ctx ? kopfMenuePunkte(ctx, strang, e.target) : [];
    if (!punkte.length) return;
    e.preventDefault(); host.oeffneMenue(punkte, e.clientX, e.clientY);
  });
  if (farbEl) farbEl.addEventListener('click', () => {
    const strang = aufStrang();
    if (strang && ctx) kopfMenuePunkte(ctx, strang, farbEl).find((m) => m.text === 'Colour')?.aktion();
  });
  const art = RENAME[karte.art];
  if (!nameEl || !art) return;
  // the input sits beside the hidden name (the rule of the old return heads): no node swap; the dock skips its rebuild while input.p-namefeld exists
  const umbenennen = () => {
    const strang = aufStrang();
    if (!strang || el.querySelector?.('input.p-namefeld')) return;
    const ein = el.ownerDocument.createElement('input');
    ein.className = 'p-namefeld'; ein.value = strang.name; ein.maxLength = 40; ein.setAttribute('aria-label', `${art[2]} name`);
    nameEl.hidden = true; nameEl.after(ein); ein.focus(); ein.select();
    let fertig = false;
    const ende = (uebernehmen) => {
      if (fertig) return; fertig = true;
      const neu = ein.value.trim();
      ein.remove(); nameEl.hidden = false;
      const jetzt = aufStrang();
      if (uebernehmen && jetzt && neu && neu !== jetzt.name) host.aendere(art[2], [{ befehl: art[0], [art[1]]: karte.id, name: neu }]);
    };
    ein.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ende(true); if (e.key === 'Escape') ende(false); });
    ein.addEventListener('blur', () => ende(false));
    ein.addEventListener('click', (e) => e.stopPropagation());
  };
  nameEl.addEventListener('dblclick', umbenennen);
  startet.set(el, umbenennen);
  if (ctx) ctx.dockUmbenennen = (id) => { const k = host.dockEl?.querySelector?.(`[data-strang="${id}"]`); startet.get(k)?.(); };
}

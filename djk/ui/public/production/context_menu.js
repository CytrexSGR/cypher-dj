import { MAX_RACK_GERAETE, rackBelegt } from './rack_device.js';
import { oeffnePatchWahl } from './surge_patch_choice.js';
import { oeffnePluginGeraet, schaltePluginFenster } from './plugin_device.js';

// PRODUCTION (Paket 1.13 Warp, Slice 3b): ein kleines Kontextmenü (Rechtsklick). Es gab bisher keins in der Produktion. oeffneMenue(punkte, x, y): x und y sind
// Fensterpixel (clientX, clientY); punkte = [{ text, aus?, aktion }]. Es schließt bei Klick daneben, Esc, Rad und Fokusverlust des Fensters, und nach jedem Punkt.
// Das Menü liegt über allem (position: fixed) und wird in den sichtbaren Bereich geschoben.
let schliesser = null;
export function schliesseMenue() { if (schliesser) { const f = schliesser; schliesser = null; f(); } }
export const menueOffen = () => schliesser !== null;

export function oeffneMenue(punkte, x, y, doc = document, fenster = window) {
  schliesseMenue();
  const ul = doc.createElement('ul');
  ul.className = 'p-menue'; ul.setAttribute('role', 'menu');
  for (const p of punkte) {
    const li = doc.createElement('li'), b = doc.createElement('button');
    li.setAttribute('role', 'none');
    // 1.12 slice 4: { gruppe: true } is a group label of the flat list (no button, not focusable)
    if (p.gruppe) { li.className = 'p-menue-gruppe'; li.setAttribute('role', 'presentation'); li.textContent = p.text; ul.append(li); continue; }
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = p.text; b.disabled = !!p.aus; if (p.titel) b.title = p.titel;
    b.addEventListener('click', () => { schliesseMenue(); p.aktion(); });
    li.append(b); ul.append(li);
  }
  ul.style.left = `${x}px`; ul.style.top = `${y}px`;
  doc.body.append(ul);
  const r = ul.getBoundingClientRect();
  if (r.right > fenster.innerWidth) ul.style.left = `${Math.max(0, fenster.innerWidth - r.width - 4)}px`;
  if (r.bottom > fenster.innerHeight) ul.style.top = `${Math.max(0, fenster.innerHeight - r.height - 4)}px`;
  const zu = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'blur' && e.target !== fenster) return; if (e.type === 'pointerdown' && ul.contains(e.target)) return; schliesseMenue(); };
  const ereignisse = ['pointerdown', 'keydown', 'wheel', 'blur'];
  for (const n of ereignisse) fenster.addEventListener(n, zu, true);
  schliesser = () => { for (const n of ereignisse) fenster.removeEventListener(n, zu, true); ul.remove(); };
  ul.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

// The ONE menu of the track heads (right click on a head). Entries: { text, zeige(strang, ctx) -> boolean, aus?(strang, ctx) -> boolean (shown disabled), aktion(ctx, strang) }. Whoever lands first
// created this array; later strands (1.9 MAKE RACK, 1.10 resample) only append their entry. track_heads.js opens it with the items whose zeige says yes.
export const KOPF_MENUE = [
  { text: 'Group selected tracks (Ctrl+G)', zeige: (strang, ctx) => ctx.st.spurWahl?.size > 0, aktion: (ctx) => ctx.gruppiere() },
  // 1.10 slice 7: every strip kind (track, group, return) and the master, strang = {id, name}
  { text: 'Resample', zeige: (strang) => typeof strang?.id === 'string', aktion: (ctx, strang) => ctx.resample(strang) },
  // 1.9 U7: an instrument track with a device becomes a rack, its device the member g1; disabled at the rack limit. The command goes out here (one undo step)
  { text: 'MAKE RACK', zeige: (s) => s.art === 'instrument' && s.geraet !== undefined && s.geraet.art !== 'rack' && !s.geraet.plugin,
    aus: (s, ctx) => rackBelegt(ctx.st?.projekt?.spuren ?? []) >= MAX_RACK_GERAETE,
    aktion: (ctx, s) => ctx.aendere(`Make rack ${s.id}`, [{ befehl: 'spur_aendern', spur_id: s.id, geraet: { art: 'rack' } }]) },
  // a Surge track stores its sound in the project: the picker offers the patch library, the pick is geraet.patch (spur_aendern, one undo step)
  { text: 'SURGE PATCH', zeige: (s) => s.art === 'instrument' && s.geraet?.art === 'wirt' && !s.geraet.plugin, aktion: (ctx, s) => oeffnePatchWahl(ctx, s) },
  // plan 1.11 task 17: the parameters and the own window of a plugin instrument (the same list and routes as a plugin effect stage, keyed by the track)
  { text: 'PLUGIN PARAMETERS', zeige: (s) => s.art === 'instrument' && !!s.geraet?.plugin, aktion: (ctx, s) => oeffnePluginGeraet(ctx, s) },
  { text: 'PLUGIN WINDOW', zeige: (s) => s.art === 'instrument' && !!s.geraet?.plugin, aktion: (ctx, s) => schaltePluginFenster(ctx, s) },
];
export const kopfMenuePunkte = (ctx, strang) => (strang ? KOPF_MENUE.filter((m) => m.zeige(strang, ctx)).map((m) => ({ text: m.text, aus: !!m.aus?.(strang, ctx), aktion: () => m.aktion(ctx, strang) })) : []);
// the contextmenu handler of every strip head: opens the menu when an entry applies, else the browser menu stays
export function kopfMenueAuf(ctx, e, strang) {
  if (e.target?.tagName === 'INPUT' && e.target.type === 'text') return false;   // a right click in a text field (the name) keeps the browser menu
  const punkte = kopfMenuePunkte(ctx, strang);
  if (!punkte.length) return false;
  e.preventDefault(); oeffneMenue(punkte, e.clientX, e.clientY);
  return true;
}

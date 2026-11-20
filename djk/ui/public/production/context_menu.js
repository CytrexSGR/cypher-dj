import { MAX_RACK_GERAETE, rackBelegt } from './rack_device.js';
import { oeffnePatchWahl } from './surge_patch_choice.js';
import { oeffnePluginGeraet, schaltePluginFenster } from './plugin_device.js';
import { straenge, hatRack, preBefehl } from './inserts.js';
import { naechsteFarbe } from './layout.js';

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
  const zu = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'blur' && e.target !== fenster) return; if ((e.type === 'pointerdown' || e.type === 'wheel') && ul.contains(e.target)) return; schliesseMenue(); };
  const ereignisse = ['pointerdown', 'keydown', 'wheel', 'blur'];
  for (const n of ereignisse) fenster.addEventListener(n, zu, true);
  schliesser = () => { for (const n of ereignisse) fenster.removeEventListener(n, zu, true); ul.remove(); };
  ul.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

// The ONE menu of the strips: the track heads, the group and return heads, the master and the dock cards. Entries: { text | (strang, ctx) -> text, zeige(strang, ctx) -> boolean,
// aus?(strang, ctx) -> boolean (shown disabled), titel?, aktion(ctx, strang, ort) }. `ort` is the element the menu was opened on (a head or a dock card part).
// Whoever lands first created this array; later strands (1.9 MAKE RACK, 1.10 resample) only append their entry. track_heads.js opens it with the items whose zeige says yes.
/** 'spur' | 'grp' | 'ret' | 'pm' | null: the kind of the strip with this id in the project. */
export const strangArt = (p, id) => straenge(p).find((s) => s.id === id)?.art ?? null;
const ARTEN = { spur: 'spuren', grp: 'gruppen', ret: 'returns' };
// the project entry of a strip (its own name, not the display name "Group x"), or null
const roh = (ctx, strang) => {
  const p = ctx.st?.projekt, art = strangArt(p, strang?.id);
  return art && ARTEN[art] ? (p[ARTEN[art]] ?? []).find((x) => x.id === strang.id) ?? null : null;
};
const nameVon = (ctx, strang) => roh(ctx, strang)?.name ?? strang?.name ?? strang?.id;
const artVon = (ctx, strang) => strangArt(ctx.st?.projekt, strang?.id);
const NUR = (...arten) => (strang, ctx) => arten.includes(artVon(ctx, strang));
const FARB_BEFEHL = { spur: ['spur_aendern', 'spur_id', 'Colour'], grp: ['gruppenspur_aendern', 'gruppe_id', 'Colour group'], ret: ['return_aendern', 'return_id', 'Colour return'] };
const LOESCH_BEFEHL = { spur: ['spur_loeschen', 'spur_id', 'Delete track', 'track'], grp: ['gruppenspur_loeschen', 'gruppe_id', 'Delete group', 'group'], ret: ['return_loeschen', 'return_id', 'Delete return', 'return'] };
export const WEG_FRAGE = (art, name) => `Delete the ${art} ${name}? (Undo brings it back)`;
export const RACK_TITEL = 'Add an insert stage first: the rack drives parameters of the chain';
export const KOPF_MENUE = [
  { text: 'Rename', zeige: NUR('spur', 'grp', 'ret'), aktion: (ctx, strang, ort) => ctx.umbenennen?.(strang, ort) },
  { text: 'Colour', zeige: NUR('spur', 'grp', 'ret'), aktion: (ctx, strang) => {
    const r = roh(ctx, strang), [befehl, feld, label] = FARB_BEFEHL[artVon(ctx, strang)];
    if (r) ctx.aendere(`${label} ${r.name}`, [{ befehl, [feld]: strang.id, farbe: naechsteFarbe(r.farbe) }]);
  } },
  { text: 'Rack', zeige: NUR('spur', 'grp', 'ret', 'pm'), titel: RACK_TITEL,
    aus: (strang, ctx) => !ctx.oeffneRack || !hatRack(straenge(ctx.st?.projekt).find((s) => s.id === strang.id)),
    aktion: (ctx, strang) => ctx.oeffneRack?.(strang) },
  { text: (strang, ctx) => (ctx.st?.laneOffen?.has(strang.id) ? 'Hide automation lane' : 'Show automation lane'), zeige: NUR('grp', 'ret', 'pm'), aktion: (ctx, strang) => ctx.laneUmschalten?.(strang.id) },
  { text: (strang, ctx) => (roh(ctx, strang)?.pre ? 'Sends POST fader' : 'Sends PRE fader'), zeige: NUR('ret'),
    aktion: (ctx, strang) => { const r = roh(ctx, strang); if (r) ctx.aendere(`Sends ${r.pre ? 'post' : 'pre'} fader, return ${r.name}`, [preBefehl(strang.id, !r.pre)]); } },
  // 1.10 slice 7: every strip kind (track, group, return) and the master, strang = {id, name}
  { text: 'Resample', zeige: (strang) => typeof strang?.id === 'string', aktion: (ctx, strang) => ctx.resample(strang) },
  { text: 'Group selected tracks (Ctrl+G)', zeige: (strang, ctx) => ctx.st.spurWahl?.size > 0, aktion: (ctx) => ctx.gruppiere() },
  // 1.9 U7: an instrument track with a device becomes a rack, its device the member g1; disabled at the rack limit. The command goes out here (one undo step)
  { text: 'MAKE RACK', zeige: (s) => s.art === 'instrument' && s.geraet !== undefined && s.geraet.art !== 'rack' && !s.geraet.plugin,
    aus: (s, ctx) => rackBelegt(ctx.st?.projekt?.spuren ?? []) >= MAX_RACK_GERAETE,
    aktion: (ctx, s) => ctx.aendere(`Make rack ${s.id}`, [{ befehl: 'spur_aendern', spur_id: s.id, geraet: { art: 'rack' } }]) },
  // a Surge track stores its sound in the project: the picker offers the patch library, the pick is geraet.patch (spur_aendern, one undo step)
  { text: 'SURGE PATCH', zeige: (s) => s.art === 'instrument' && s.geraet?.art === 'wirt' && !s.geraet.plugin, aktion: (ctx, s) => oeffnePatchWahl(ctx, s) },
  // plan 1.11 task 17: the parameters and the own window of a plugin instrument (the same list and routes as a plugin effect stage, keyed by the track)
  { text: 'PLUGIN PARAMETERS', zeige: (s) => s.art === 'instrument' && !!s.geraet?.plugin, aktion: (ctx, s) => oeffnePluginGeraet(ctx, s) },
  { text: 'PLUGIN WINDOW', zeige: (s) => s.art === 'instrument' && !!s.geraet?.plugin, aktion: (ctx, s) => schaltePluginFenster(ctx, s) },
  // the master has no delete; a deleted strip asks first (the dock card and the head menu are one list)
  { text: 'Delete', zeige: NUR('spur', 'grp', 'ret'), aktion: async (ctx, strang) => {
    const r = roh(ctx, strang), art = artVon(ctx, strang);
    if (!r) return;
    const [befehl, feld, label, wort] = LOESCH_BEFEHL[art];
    const frage = ctx.frage ?? globalThis.confirm?.bind(globalThis);
    if (frage && !(await frage(WEG_FRAGE(wort, r.name)))) return;
    ctx.aendere(`${label} ${r.name}`, [{ befehl, [feld]: strang.id }]);
  } },
];
export const kopfMenuePunkte = (ctx, strang, ort) => (strang ? KOPF_MENUE.filter((m) => m.zeige(strang, ctx)).map((m) => ({ text: typeof m.text === 'function' ? m.text(strang, ctx) : m.text, aus: !!m.aus?.(strang, ctx), ...(m.titel && m.aus?.(strang, ctx) ? { titel: m.titel } : {}), aktion: () => m.aktion(ctx, strang, ort) })) : []);
// the contextmenu handler of every strip head: opens the menu when an entry applies, else the browser menu stays
export function kopfMenueAuf(ctx, e, strang) {
  if (e.target?.tagName === 'INPUT' && e.target.type === 'text') return false;   // a right click in a text field (the name) keeps the browser menu
  const punkte = kopfMenuePunkte(ctx, strang, e.target);
  if (!punkte.length) return false;
  e.preventDefault(); oeffneMenue(punkte, e.clientX, e.clientY);
  return true;
}

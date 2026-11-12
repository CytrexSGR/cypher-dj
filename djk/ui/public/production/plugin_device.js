// PRODUCTION (plan 1.11 task 17): the parameters and the window of the plugin instrument of a track. The same list module as a plugin effect stage
// (plugin_parameter.js); only the routes differ: /proj/spur/<spur_id>/geraet/{parameter,param,fenster}. The values live in the plugin host, not in the project.
import { baueParameterListe, alsListe } from './plugin_parameter.js';
import { baueFrontplatte } from '../panel.js';
import { autoPanelAusListe, parameterAusListe, pluginAdapter } from './plugin_panel.js';
export const GERAET_FENSTER_TEXT = { kein_fenster: 'This plugin has no window', keine_anzeige: 'The studio machine has no display for a plugin window',
  host_fehlt: 'The plugin host is not ready' };
export const geraetWeg = (spurId) => `/proj/spur/${encodeURIComponent(spurId)}/geraet`;
// a small panel under the page body; one at a time, closed by a second pick. Default view: the automatic front panel built from the parameter list;
// the "List" toggle shows the searchable list (and "Panel" brings the panel back). `bau` lets a test replace the two builders.
export function oeffnePluginGeraet(ctx, s, wurzel = document, bau = { liste: baueParameterListe, platte: baueFrontplatte }) {
  const alt = wurzel.querySelector('.p-ins-popover.p-geraet-plugin');
  if (alt) { const gleich = alt.dataset.spur === s.id; alt.remove(); if (gleich) return null; }
  const el = wurzel.createElement ? wurzel.createElement('div') : document.createElement('div');
  el.className = 'p-ins-popover p-geraet-plugin'; el.dataset.spur = s.id;
  const weg = geraetWeg(s.id);
  const holeListe = async () => alsListe(await ctx.holeGet(`${weg}/parameter`));
  const sende = (w) => ctx.holeJson(`${weg}/param`, { werte: w });
  const fehler = (r) => ctx.melde(ctx.antwortText(r), true);
  const d = wurzel.createElement ? wurzel : document;
  let listeAn = false, platte = null, stand = 0;
  const umschalter = d.createElement('button');
  umschalter.type = 'button'; umschalter.className = 'p-ins-liste';
  const inhalt = d.createElement('div');
  inhalt.className = 'p-geraet-inhalt';
  const zeige = async () => {
    const mein = ++stand;
    platte?.zerstoere?.(); platte = null;
    umschalter.textContent = listeAn ? 'Panel' : 'List';
    umschalter.setAttribute('aria-label', `${listeAn ? 'Show the front panel' : 'Show the parameter list'} of the plugin on ${s.name ?? s.id}`);
    inhalt.replaceChildren?.();
    if (listeAn) { bau.liste(inhalt, { holeListe, sende, fehler }); return; }
    // a host that is not ready (409 host_fehlt), an error answer or a thrown fetch leaves one line and a Retry in the area, never an empty one
    const zeile = (text) => {
      const p = d.createElement('p'), b = d.createElement('button');
      p.textContent = text; b.type = 'button'; b.className = 'p-geraet-neu'; b.textContent = 'Retry';
      b.addEventListener('click', () => { zeige(); });
      inhalt.replaceChildren?.(p, b);
    };
    let r;
    try { r = await holeListe(); } catch (e) { if (mein === stand) zeile(`The plugin parameters could not be read: ${e.message}`); return; }
    if (mein !== stand) return;   // toggled meanwhile
    if (r.status !== 200 || !Array.isArray(r.j)) { fehler(r); zeile(`The plugin parameters could not be read: ${GERAET_FENSTER_TEXT[r.j?.fehler] ?? ctx.antwortText(r)}`); return; }
    const titel = String(s.name ?? 'Plugin');
    platte = bau.platte(inhalt, { panel: autoPanelAusListe(r.j, titel), parameter: parameterAusListe(r.j), adapter: pluginAdapter(r.j, { sende, fehler }) });
  };
  umschalter.addEventListener('click', () => { listeAn = !listeAn; zeige(); });
  el.append(umschalter, inhalt);
  zeige();
  (wurzel.body ?? document.body).append(el);
  return el;
}
let fensterAn = new Set();
// opens the window of the plugin in the host, or closes it when this page opened it before
export async function schaltePluginFenster(ctx, s) {
  const an = !fensterAn.has(s.id);
  const r = await ctx.holeJson(`${geraetWeg(s.id)}/fenster`, { an });
  if (r.status !== 200) { ctx.melde(GERAET_FENSTER_TEXT[r.j?.fehler] ?? ctx.antwortText(r), true); return false; }
  if (r.j?.fenster) fensterAn.add(s.id); else fensterAn.delete(s.id);
  return true;
}

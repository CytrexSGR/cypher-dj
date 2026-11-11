// PRODUCTION (plan 1.11 task 17): the parameters and the window of the plugin instrument of a track. The same list module as a plugin effect stage
// (plugin_parameter.js); only the routes differ: /proj/spur/<spur_id>/geraet/{parameter,param,fenster}. The values live in the plugin host, not in the project.
import { baueParameterListe } from './plugin_parameter.js';
export const GERAET_FENSTER_TEXT = { kein_fenster: 'This plugin has no window', keine_anzeige: 'The studio machine has no display for a plugin window',
  host_fehlt: 'The plugin host is not ready' };
export const geraetWeg = (spurId) => `/proj/spur/${encodeURIComponent(spurId)}/geraet`;
// a small panel under the page body; one at a time, closed by a second pick
export function oeffnePluginGeraet(ctx, s, wurzel = document) {
  const alt = wurzel.querySelector('.p-ins-popover.p-geraet-plugin');
  if (alt) { const gleich = alt.dataset.spur === s.id; alt.remove(); if (gleich) return null; }
  const el = wurzel.createElement ? wurzel.createElement('div') : document.createElement('div');
  el.className = 'p-ins-popover p-geraet-plugin'; el.dataset.spur = s.id;
  const weg = geraetWeg(s.id);
  baueParameterListe(el, { holeListe: () => ctx.holeGet(`${weg}/parameter`), sende: (w) => ctx.holeJson(`${weg}/param`, { werte: w }),
    fehler: (r) => ctx.melde(ctx.antwortText(r), true) });
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

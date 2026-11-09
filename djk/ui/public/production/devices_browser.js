// PRODUCTION (package 1.16 rest, S3): the DEVICES list of the browser column, from GET /presets/katalog. Instruments (RB-338, Surge, one entry
// per instrument graph) and effects (Compressor active; EQ, Saett, Hall shown greyed with their reason). Every row is draggable with
// the type application/x-djk-geraet (drag.js geraetNutzlast); storage.js turns a drop into spur_neu or insert_setzen.
import { GERAET_TYP, geraetNutzlast } from './drag.js';

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const eintraege = (k) => [...(k?.instrumente ?? []), ...(k?.effekte ?? [])];

export function geraeteHtml(k) {
  if (!k) return '<p class="geraete-leer">Loading…</p>';
  let i = 0;
  const zeile = (e) => {
    // a disabled effect stays draggable: its drop gives no command, only its reason (T6.5 drags EQ for that)
    const n = i++, ziehbar = !!geraetNutzlast(e), aus = e.aktiv === false;
    return `<li data-geraet-i="${n}" class="geraete-zeile${aus ? ' aus' : ''}"${e.grund ? ` title="${html(e.grund)}"` : ''} draggable="${ziehbar}">`
      + `<span class="geraete-name">${html(e.titel)}</span>${e.graph ? '<span class="geraete-art">graph</span>' : ''}</li>`;
  };
  return `<h4>INSTRUMENTS</h4><ul class="geraete-liste">${(k.instrumente ?? []).map(zeile).join('')}</ul>`
    + `<h4>EFFECTS</h4><ul class="geraete-liste">${(k.effekte ?? []).map(zeile).join('')}</ul>`;
}

export function bindeGeraeteBrowser(ctx) {
  const wurzel = document.getElementById('geraete-browser');
  if (!wurzel) return;
  let katalog = null, geladen = false;
  wurzel.innerHTML = geraeteHtml(null);
  async function lade() {
    const r = await ctx.holeGet('/presets/katalog');
    if (r.status === 200) { katalog = r.j; geladen = true; wurzel.innerHTML = geraeteHtml(katalog); }
    else wurzel.innerHTML = `<p class="geraete-leer">Devices: ${html(ctx.antwortText?.(r) ?? r.j?.text ?? 'not available')}</p>`;
  }
  wurzel.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    const n = geraetNutzlast(eintraege(katalog)[Number(li?.dataset.geraetI)]);
    if (!n) { e.preventDefault(); return; }
    e.dataTransfer.setData(GERAET_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy';
  });
  ctx.beimSichtwechsel.push((an) => { if (an && !geladen) lade(); });
}

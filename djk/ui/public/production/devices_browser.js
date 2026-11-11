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

// ---- plan 1.11 task 11: the group PLUGINS (foreign plugins from the index, GET /plugins) ----
// A blocked entry is greyed with its reason as the tooltip and is not draggable. An effect drags as {art: 'host', plugin_id}; an instrument is listed and marked,
// its drop and click come with a later task. The head (search, format, RESCAN) stays; only the list under it is redrawn.
export const PLUGIN_GRUND_TEXT = {
  abgestuerzt: 'The plugin crashed while it was scanned', zeit: 'The plugin took too long while it was scanned', ungueltig: 'The plugin file is not a valid plugin',
  mehrklassen: 'The file holds several plugins: not supported yet',
};
export const pluginGrund = (e) => (e.status === 'blockiert' ? (e.text ?? PLUGIN_GRUND_TEXT[e.grund] ?? 'Blocked') : '');
export const pluginNutzlast = (e) => {
  if (!e || e.status !== 'ok' || typeof e.id !== 'string') return null;
  if (e.art === 'effekt') return { art: 'host', plugin_id: e.id, titel: e.name };
  return e.art === 'instrument' ? { art: 'instrument', plugin_id: e.id, titel: e.name } : null;   // plan 1.11 task 17: an instrument makes a track
};
// the command that creates the plugin instrument track (no slot: the server takes the first free host slot; slot_belegt when both are used)
export const pluginSpurBefehl = (n) => ({ label: `Add ${n.titel ?? 'plugin'} track`,
  befehl: { befehl: 'spur_neu', art: 'instrument', name: String(n.titel ?? 'Plugin').slice(0, 80), geraet: { art: 'wirt', name: 'plugin', plugin_id: n.plugin_id } } });
export function pluginZeilenHtml(liste) {
  if (!liste.length) return '<li class="geraete-leer">No plugins found</li>';
  return liste.map((e, n) => {
    const aus = e.status === 'blockiert', inst = e.art === 'instrument', ziehbar = !!pluginNutzlast(e);
    const titel = aus ? pluginGrund(e) : inst ? 'Click or drag onto the arrangement to add an instrument track' : `${e.name}${e.hersteller ? ` by ${e.hersteller}` : ''}`;
    return `<li data-plugin-i="${n}" class="geraete-zeile plugin-zeile${aus ? ' aus' : ''}${inst ? ' instrument' : ''}" title="${html(titel)}" draggable="${ziehbar}">`
      + `<span class="geraete-name">${html(e.name)}</span><span class="geraete-art plugin-format">${html(e.format)}</span>`
      + (inst ? '<span class="geraete-art plugin-instrument">instrument</span>' : '') + (aus ? `<span class="plugin-grund">${html(pluginGrund(e))}</span>` : '') + '</li>';
  }).join('');
}

export function bindeGeraeteBrowser(ctx) {
  const wurzel = document.getElementById('geraete-browser');
  if (!wurzel) return;
  let katalog = null, geladen = false;
  let plugins = [], pluginsGeladen = false, pluginTimer = null;
  wurzel.innerHTML = '<div data-teil="geraete">' + geraeteHtml(null) + '</div>'
    + '<div class="plugin-gruppe" data-teil="plugins"><h4>PLUGINS</h4><div class="plugin-kopf">'
    + '<input type="search" class="plugin-suche" placeholder="Search plugins" aria-label="Search plugins">'
    + '<select class="plugin-format" aria-label="Plugin format"><option value="">All</option><option value="vst3">VST3</option><option value="lv2">LV2</option></select>'
    + '<button class="plugin-rescan" title="Scan the plugin folders again">Rescan</button></div>'
    + '<div class="plugin-stand" aria-live="polite"></div><ul class="geraete-liste plugin-liste"></ul></div>';
  const teilG = wurzel.querySelector('[data-teil="geraete"]'), suche = wurzel.querySelector('.plugin-suche'), format = wurzel.querySelector('.plugin-format');
  const knopf = wurzel.querySelector('.plugin-rescan'), stand = wurzel.querySelector('.plugin-stand'), pl = wurzel.querySelector('.plugin-liste');
  async function lade() {
    const r = await ctx.holeGet('/presets/katalog');
    if (r.status === 200) { katalog = r.j; geladen = true; teilG.innerHTML = geraeteHtml(katalog); }
    else teilG.innerHTML = `<p class="geraete-leer">Devices: ${html(ctx.antwortText?.(r) ?? r.j?.text ?? 'not available')}</p>`;
  }
  async function ladePlugins() {
    const q = new URLSearchParams({ text: suche.value.trim(), art: '', format: format.value });
    const r = await ctx.holeGet(`/plugins?${q}`);
    const liste = Array.isArray(r.j) ? r.j : r.j?.plugins;   // GET /plugins answers {plugins, scan}
    if (r.status === 200 && Array.isArray(liste)) { plugins = liste; pluginsGeladen = true; pl.innerHTML = pluginZeilenHtml(plugins); stand.textContent = ''; }
    else { stand.textContent = `Plugins: ${ctx.antwortText?.(r) ?? 'not available'}`; }
  }
  suche.addEventListener('input', () => { clearTimeout(pluginTimer); pluginTimer = setTimeout(ladePlugins, 200); });
  format.addEventListener('change', ladePlugins);
  knopf.addEventListener('click', async () => {
    knopf.disabled = true; stand.textContent = 'Scanning…';
    const r = await ctx.holeJson('/plugins/rescan', {});
    knopf.disabled = false;
    if (r.status === 200 || r.status === 202) { stand.textContent = ''; await ladePlugins(); } else { stand.textContent = ''; ctx.melde(ctx.antwortText(r), true); }
  });
  const zeileHost = (li) => pluginNutzlast(plugins[Number(li?.dataset.pluginI)]);
  pl.addEventListener('dragstart', (e) => {
    const n = zeileHost(e.target.closest?.('[data-plugin-i]'));
    if (!n) { e.preventDefault(); return; }
    e.dataTransfer.setData(GERAET_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy';
  });
  // a click puts an effect on the first selected strip's chain (the same path as the drop: ctx.fuegePluginEin from storage.js)
  pl.addEventListener('click', (e) => {
    const li = e.target.closest?.('[data-plugin-i]');
    if (!li) return;
    const el = plugins[Number(li.dataset.pluginI)];
    if (el.status === 'blockiert') { ctx.melde(pluginGrund(el), true); return; }
    const n = pluginNutzlast(el);
    if (n?.art === 'instrument') { const r = pluginSpurBefehl(n); ctx.aendere(r.label, [r.befehl]); return; }
    if (n) ctx.fuegePluginEin?.(n);
  });
  teilG.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    const n = geraetNutzlast(eintraege(katalog)[Number(li?.dataset.geraetI)]);
    if (!n) { e.preventDefault(); return; }
    e.dataTransfer.setData(GERAET_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy';
  });
  ctx.beimSichtwechsel.push((an) => { if (an && !geladen) lade(); if (an && !pluginsGeladen) ladePlugins(); });
}

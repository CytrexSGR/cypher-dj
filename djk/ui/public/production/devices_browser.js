// PRODUCTION (package 1.16 rest, S3): the DEVICES list of the browser column, from GET /presets/katalog. Instruments (RB-338, Surge, one entry
// per instrument graph) and effects (Compressor active; EQ, Saett, Hall shown greyed with their reason). Every row is draggable with
// the type application/x-djk-geraet (drag.js geraetNutzlast); storage.js turns a drop into spur_neu or insert_setzen.
import { GERAET_TYP, geraetNutzlast, instrumentBefehl, effektBefehl } from './drag.js';
import { gruppenVon, gruppeVon, nebenText, ohneVerborgene, sortiere, leseAchse, beiAchse } from '../instrument_groups.js';
import { FAVORITEN_SLUG as FAVORITEN, ZULETZT_SLUG } from '../usage.js';

const FILTER_SPEICHER = 'djk-geraete-filter';   // the chosen filter chip, per browser (a convenience)

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** The instruments in display order: RB-338 and Surge (the rows without a graph) first, then the graphs grouped by the axis (inside a group by the other axis, then by name). */
export function instrumenteGeordnet(k, achse = 'prinzip') {
  const alle = k?.instrumente ?? [];
  return [...alle.filter((e) => !e.graph), ...sortiere(ohneVerborgene(alle.filter((e) => e.graph)), achse)];   // hidden duplicates are not offered as a new track
}
/** The entries in the order the rows are shown: the index of a row (data-geraet-i) is the index here, so a drag and a click find their entry. */
export const eintraege = (k, achse = 'prinzip') => [...instrumenteGeordnet(k, achse), ...(k?.effekte ?? [])];

/** The key of a device in a collection (collections: {art:'geraet', geraet}): bk:<graph> for a graph, else the device name; null for none. Pure. */
export const geraetKey = (e) => (!e || typeof e.geraet !== 'string' ? null : e.geraet === 'bk' ? (typeof e.graph === 'string' ? `bk:${e.graph}` : null) : e.geraet);

/** `opt.zeigen(e)` -> whether the row is listed (a filter); hidden rows keep their index, so data-geraet-i still points into eintraege().
 *  `opt.favoriten` = Set of device keys with a star; `opt.stern` = whether rows carry the star button. */
export function geraeteHtml(k, achse = 'prinzip', opt = {}) {
  if (!k) return '<p class="geraete-leer">Loading…</p>';
  const zeigen = opt.zeigen ?? (() => true), fav = opt.favoriten ?? new Set();
  let i = 0;
  const zeile = (e) => {
    // a disabled effect stays draggable: its drop gives no command, only its reason (T6.5 drags EQ for that)
    const n = i++, ziehbar = !!geraetNutzlast(e), aus = e.aktiv === false;
    if (!zeigen(e)) return '';
    const neben = e.graph && e.ziel === 'spur_neu' ? nebenText(e, achse) : '';
    const key = geraetKey(e), an = key !== null && fav.has(key);
    const stern = opt.stern && key !== null ? `<button type="button" class="geraete-stern${an ? ' an' : ''}" data-stern="${html(key)}" aria-pressed="${an}" title="${an ? 'Remove from favourites' : 'Mark as favourite'}">${an ? '★' : '☆'}</button>` : '';
    return `<li data-geraet-i="${n}" class="geraete-zeile${aus ? ' aus' : ''}"${e.grund ? ` title="${html(e.grund)}"` : e.ziel === 'spur_neu' ? ' title="Double-click or drag to add as a track"' : ''} draggable="${ziehbar}">`
      + `${stern}<span class="geraete-name">${html(e.titel)}</span>${neben ? `<span class="geraete-neben">\u00b7 ${html(neben)}</span>` : ''}${e.graph ? '<span class="geraete-art">graph</span>' : ''}</li>`;
  };
  const inst = instrumenteGeordnet(k, achse);
  let reihen = inst.filter((e) => !e.graph).map(zeile).join('');
  for (const g of gruppenVon(achse)) {
    const in_ = inst.filter((e) => e.graph && gruppeVon(e, achse) === g.id);
    const z = in_.map(zeile).join('');
    if (z) reihen += `<li class="geraete-gruppe"><h5>${html(g.name)}</h5></li>${z}`;
  }
  const eff = (k.effekte ?? []).map(zeile).join('');
  const leer = '<li class="geraete-zeile geraete-leer">None in this filter</li>';
  return `<h4>INSTRUMENTS</h4><p class="geraete-hinweis">Double-click or drag an instrument to add it as a track</p><ul class="geraete-liste">${reihen || leer}</ul>`
    + `<h4>EFFECTS</h4><ul class="geraete-liste">${eff || leer}</ul>`;
}

/** The filter chips above the DEVICES list: All, the favourites (star) and every other collection that holds a device. `koll` = [{slug, name, keys:Set}]. Pure. */
export function filterHtml(koll, filter) {
  const chip = (wert, text, titel) => `<button type="button" class="geraete-chip${filter === wert ? ' an' : ''}" data-filter="${html(wert)}" aria-pressed="${filter === wert}" title="${html(titel)}">${html(text)}</button>`;
  return `<div class="geraete-filter">${chip('alle', 'All', 'Every device')}${chip(FAVORITEN, '★', 'Only the devices with a star')}`
    + koll.filter((c) => c.slug !== FAVORITEN && c.keys.size).map((c) => chip(c.slug, c.name, `Only the devices in the collection ${c.name} (right click a row: Add to, New collection)`)).join('') + '</div>';
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
  let katalog = null, geladen = false, achse = leseAchse();   // achse: the grouping the rows were drawn with (a drag looks its entry up in the same order)
  let plugins = [], pluginsGeladen = false, pluginTimer = null;
  wurzel.innerHTML = '<div data-teil="geraete">' + geraeteHtml(null) + '</div>'
    + '<div class="plugin-gruppe" data-teil="plugins"><h4>PLUGINS</h4><div class="plugin-kopf">'
    + '<input type="search" class="plugin-suche" placeholder="Search plugins" aria-label="Search plugins">'
    + '<select class="plugin-format" aria-label="Plugin format"><option value="">All</option><option value="vst3">VST3</option><option value="lv2">LV2</option></select>'
    + '<button class="plugin-rescan" title="Scan the plugin folders again">Rescan</button></div>'
    + '<div class="plugin-stand" aria-live="polite"></div><ul class="geraete-liste plugin-liste"></ul></div>';
  const teilG = wurzel.querySelector('[data-teil="geraete"]'), suche = wurzel.querySelector('.plugin-suche'), format = wurzel.querySelector('.plugin-format');
  const knopf = wurzel.querySelector('.plugin-rescan'), stand = wurzel.querySelector('.plugin-stand'), pl = wurzel.querySelector('.plugin-liste');
  // favourites and own groups (Andreas 2026-11-18: "ein favoritensternchen ... nur nach fav filtern ... eigene gruppen anlegen und zuordnen"): the collections
  // of the server (/kollektionen) that hold devices; the star writes the collection `favourites`, a right click on a row adds to any other (collections.js)
  let koll = [];   // [{slug, name, keys: Set of device keys}]
  let filter = 'alle';
  try { filter = globalThis.localStorage?.getItem(FILTER_SPEICHER) || 'alle'; } catch { /* no storage: All */ }
  const favoriten = () => koll.find((c) => c.slug === FAVORITEN)?.keys ?? new Set();
  const zeichne = () => {
    if (!geladen) return;
    if (filter !== 'alle' && !koll.some((c) => c.slug === filter)) filter = 'alle';   // a deleted collection
    const keys = filter === 'alle' ? null : koll.find((c) => c.slug === filter)?.keys ?? new Set();
    teilG.innerHTML = filterHtml(koll, filter) + geraeteHtml(katalog, achse, { zeigen: keys ? (e) => keys.has(geraetKey(e)) : undefined, favoriten: favoriten(), stern: true });
  };
  async function ladeKoll() {
    const r = await ctx.holeGet('/kollektionen');
    if (r.status !== 200 || !Array.isArray(r.j)) return;
    const neu = [];
    for (const c of r.j.filter((x) => x.slug !== ZULETZT_SLUG)) {
      const d = await ctx.holeGet(`/kollektionen/${encodeURIComponent(c.slug)}`);
      const keys = new Set((d.j?.posten ?? []).filter((p) => p?.art === 'geraet' && typeof p.geraet === 'string').map((p) => p.geraet));
      neu.push({ slug: c.slug, name: c.name ?? c.slug, keys });
    }
    if (!neu.some((c) => c.slug === FAVORITEN)) neu.unshift({ slug: FAVORITEN, name: 'Favourites', keys: new Set() });
    const abdruck = (l) => JSON.stringify(l.map((c) => [c.slug, c.name, [...c.keys].sort()]));
    if (abdruck(neu) === abdruck(koll)) return;   // unchanged: no redraw (a redraw under the pointer would cancel a drag that just started)
    koll = neu;
    zeichne();
  }
  async function lade() {
    const r = await ctx.holeGet('/presets/katalog');
    if (r.status === 200) { katalog = r.j; geladen = true; achse = leseAchse(); zeichne(); ladeKoll(); }
    else teilG.innerHTML = `<p class="geraete-leer">Devices: ${html(ctx.antwortText?.(r) ?? r.j?.text ?? 'not available')}</p>`;
  }
  teilG.addEventListener('click', async (e) => {
    const chip = e.target.closest?.('[data-filter]');
    if (chip) { filter = chip.dataset.filter; try { globalThis.localStorage?.setItem(FILTER_SPEICHER, filter); } catch { /* only now */ } zeichne(); return; }
    const stern = e.target.closest?.('[data-stern]');
    if (!stern) return;
    e.stopPropagation();
    const key = stern.dataset.stern, an = !favoriten().has(key);
    const r = await ctx.holeJson(`/kollektionen/${FAVORITEN}/posten`, an ? { hinzu: [{ art: 'geraet', geraet: key }] } : { weg: [{ art: 'geraet', geraet: key }] });
    if (r.status !== 200) { ctx.melde(ctx.antwortText?.(r) ?? 'The favourites could not be changed', true); return; }
    const f = koll.find((c) => c.slug === FAVORITEN);
    if (f) { if (an) f.keys.add(key); else f.keys.delete(key); }
    zeichne();
  });
  teilG.addEventListener('mouseenter', () => { if (geladen) ladeKoll(); });   // a right click elsewhere may have changed a collection
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
  // a double click does what the drop does (Andreas 2026-11-18: "machen wir es mit doppelclick anstatt ziehen"): an instrument adds a new track, an effect goes
  // to the end of the chain of the first selected strip (none selected: the reason, nothing sent)
  teilG.addEventListener('dblclick', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    if (!li || !katalog || e.target.closest?.('[data-stern]')) return;
    const n = geraetNutzlast(eintraege(katalog, achse)[Number(li.dataset.geraetI)]);
    if (!n) return;
    if (n.ziel === 'spur_neu') { const r = instrumentBefehl(n); ctx.aendere(r.label, [r.befehl]); return; }
    const strang = [...(ctx.st?.spurWahl ?? [])][0];
    if (!strang) { ctx.melde('Select a track first (click its head), then double click the effect', true); return; }
    const r = effektBefehl(ctx.st.projekt, strang, n);
    if (r.fehler) { ctx.melde(r.text, true); return; }
    ctx.aendere(r.label, [r.befehl]);
  });
  teilG.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    const n = geraetNutzlast(eintraege(katalog, achse)[Number(li?.dataset.geraetI)]);
    if (!n) { e.preventDefault(); return; }
    e.dataTransfer.setData(GERAET_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy';
  });
  beiAchse((neu) => { if (geladen) { achse = neu; zeichne(); } });   // the page-wide grouping changed: redraw, send nothing
  // the list is hidden while the browser component is docked (browser.css); then its own section loads catalogue and plugins and this one stays still
  ctx.beimSichtwechsel.push((an) => { if (!an || wurzel.getClientRects?.().length === 0) return; if (!geladen) lade(); if (!pluginsGeladen) ladePlugins(); });
}

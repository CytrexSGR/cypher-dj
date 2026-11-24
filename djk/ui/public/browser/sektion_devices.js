// INSTRUMENTS AND EFFECTS (browser plan 2, task 10): the old DEVICES list of PRODUCTION moved here (same renderers, same drag payloads), the plugins with
// vendor, version and UNBLOCK, and the plugin search paths with ADD PLUGIN FOLDER. Placing a device (double click, click on a plugin) needs the production
// host (aendere, fuegePluginEin); other views list the rows and say where to place them.
import { baueAbschnitt } from './abschnitt.js';
import { GERAET_TYP, geraetNutzlast, instrumentBefehl, effektBefehl } from '../production/drag.js';
import { eintraege, geraeteHtml, filterHtml, geraetKey, pluginZeilenHtml, pluginNutzlast, pluginGrund, pluginSpurBefehl } from '../production/devices_browser.js';
import { leseAchse, beiAchse } from '../instrument_groups.js';
import { FAVORITEN_SLUG as FAVORITEN, ZULETZT_SLUG } from '../usage.js';
import { postenVonGeraet } from '../collections.js';
import { zeigeKollektionsMenue } from './kollektion_menue.js';

export const NICHT_DA = 'Not available in this build yet';
const FILTER_SPEICHER = 'djk-geraete-filter';
const QUELLE_TEXT = { umgebung: 'Environment', datei: 'Config file', nutzer: 'Added by you', paket: 'Bundled' };
const ok2 = (r) => r.status >= 200 && r.status < 300;

export function pfadeZeilen(a) {
  return (Array.isArray(a?.pfade) ? a.pfade : []).filter((p) => typeof p?.pfad === 'string').map((p) => ({ pfad: p.pfad, quelle: p.quelle, text: QUELLE_TEXT[p.quelle] ?? String(p.quelle ?? ''), entfernbar: p.quelle === 'nutzer' }));
}
export const pluginZusatz = (p) => [p?.hersteller, p?.version].filter((x) => typeof x === 'string' && x !== '' || typeof x === 'number').join(' ');

const FEHLER = (r) => r.j?.text || `The request failed (${r.status || 'no connection'})`;
// every action answers {status: 'ok'|'nicht_da'|'fehler'|'abgebrochen', text?}
export async function ladePfade(host) {
  const r = await host.holeGet('/plugins/pfade');
  if (r.status === 404) return { status: 'nicht_da', zeilen: [] };
  if (!ok2(r)) return { status: 'fehler', zeilen: [], text: FEHLER(r) };
  return { status: 'ok', zeilen: pfadeZeilen(r.j) };
}
export async function fuegePluginOrdnerHinzu(host, dienste) {
  const pfad = await dienste.waehleOrdner?.();
  if (!pfad) return { status: 'abgebrochen' };
  const r = await host.holeJson('/plugins/pfade/dazu', { pfad });
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  const s = await host.holeJson('/plugins/rescan', {});
  if (!ok2(s)) { host.melde(FEHLER(s), true); return { status: 'ok', pfad, scan: false }; }
  return { status: 'ok', pfad, scan: true };
}
export async function entfernePluginOrdner(host, pfad) {
  const r = await host.holeJson('/plugins/pfade/weg', { pfad });
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  const s = await host.holeJson('/plugins/rescan', {});
  if (!ok2(s)) host.melde(FEHLER(s), true);
  return { status: 'ok' };
}
export async function entsperre(host, id) {
  const r = await host.holeJson('/plugins/entsperren', { id });
  if (r.status === 404) { const code = r.j?.grund ?? r.j?.fehler; const text = code === 'plugin_unbekannt' ? 'The plugin is not in the index any more: rescan' : NICHT_DA; if (code) host.melde(text, true); return { status: code ? 'fehler' : 'nicht_da', text }; }
  if (r.status === 409) { const text = 'A scan is running: try again when it is done'; host.melde(text, true); return { status: 'fehler', text }; }
  if (!ok2(r)) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  return { status: 'ok' };
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (text, titel, fn) => {
  const b = el('button', 'b-taste', text);
  b.type = 'button'; b.title = titel;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
  return b;
};

export function baueGeraeteAbschnitt(host, dienste = {}) {
  const a = baueAbschnitt({ id: 'geraete', titel: 'INSTRUMENTS AND EFFECTS', offen: false });
  const kannPlatzieren = typeof host.aendere === 'function';
  let katalog = null, achse = leseAchse(), koll = [], filter = 'alle', plugins = [], pfade = null, pluginsDa = true;
  try { filter = globalThis.localStorage?.getItem(FILTER_SPEICHER) || 'alle'; } catch { /* no storage: All */ }

  const teilG = el('div', 'b-geraete'), kopf = el('div', 'b-plugin-kopf'), stand = el('div', 'b-bib-stand'), plListe = el('ul', 'geraete-liste plugin-liste');
  const pfadKopf = el('div', 'b-untertitel', 'PLUGIN PATHS'), pfadListe = el('div', 'b-pfade'), pfadAdd = taste('ADD PLUGIN FOLDER', 'Search a folder for plugins as well', (b) => aus(b, hinzu));
  const suche = el('input', 'b-name'), format = el('select', 'plugin-format'), rescan = taste('RESCAN', 'Scan the plugin folders again', (b) => aus(b, scanne));
  suche.type = 'search'; suche.placeholder = 'Search plugins'; suche.setAttribute('aria-label', 'Search plugins');
  suche.addEventListener('click', (e) => e.stopPropagation()); suche.addEventListener('keydown', (e) => e.stopPropagation());
  format.setAttribute('aria-label', 'Plugin format');
  for (const [v, t] of [['', 'All'], ['vst3', 'VST3'], ['lv2', 'LV2']]) { const o = el('option', '', t); o.value = v; format.append(o); }
  kopf.append(suche, format, rescan);

  async function aus(b, fn) {
    b.disabled = true;
    let x = null;
    try { x = await fn(); } finally { if (x?.status === 'nicht_da') b.title = NICHT_DA; else b.disabled = false; }
    return x;
  }
  const favoriten = () => koll.find((c) => c.slug === FAVORITEN)?.keys ?? new Set();
  function zeichneGeraete() {
    if (!katalog) return;
    if (filter !== 'alle' && !koll.some((c) => c.slug === filter)) filter = 'alle';
    const keys = filter === 'alle' ? null : koll.find((c) => c.slug === filter)?.keys ?? new Set();
    teilG.innerHTML = filterHtml(koll, filter) + geraeteHtml(katalog, achse, { zeigen: keys ? (e) => keys.has(geraetKey(e)) : undefined, favoriten: favoriten(), stern: true });
    if (!kannPlatzieren) for (const li of teilG.querySelectorAll?.('[data-geraet-i]') ?? []) { li.draggable = false; li.title = 'Open PRODUCTION to place devices'; }
  }
  async function ladeKoll() {
    const r = await host.holeGet('/kollektionen');
    if (r.status !== 200 || !Array.isArray(r.j)) return;
    const neu = [];
    for (const c of r.j.filter((x) => x.slug !== ZULETZT_SLUG)) {
      const d = await host.holeGet(`/kollektionen/${encodeURIComponent(c.slug)}`);
      neu.push({ slug: c.slug, name: c.name ?? c.slug, keys: new Set((d.j?.posten ?? []).filter((p) => p?.art === 'geraet' && typeof p.geraet === 'string').map((p) => p.geraet)) });
    }
    if (!neu.some((c) => c.slug === FAVORITEN)) neu.unshift({ slug: FAVORITEN, name: 'Favourites', keys: new Set() });
    const abdruck = (l) => JSON.stringify(l.map((c) => [c.slug, c.name, [...c.keys].sort()]));
    if (abdruck(neu) === abdruck(koll)) return;
    koll = neu; zeichneGeraete();
  }
  async function ladeKatalog() {
    const r = await host.holeGet('/presets/katalog');
    if (r.status === 200) { katalog = r.j; achse = leseAchse(); zeichneGeraete(); ladeKoll(); }
    else teilG.textContent = `Devices: ${r.status === 404 ? NICHT_DA : (r.j?.text ?? 'not available')}`;
  }
  teilG.addEventListener('click', async (e) => {
    const chip = e.target.closest?.('[data-filter]');
    if (chip) { filter = chip.dataset.filter; try { globalThis.localStorage?.setItem(FILTER_SPEICHER, filter); } catch { /* only now */ } zeichneGeraete(); return; }
    const stern = e.target.closest?.('[data-stern]');
    if (!stern) return;
    e.stopPropagation();
    const key = stern.dataset.stern, an = !favoriten().has(key);
    const r = await host.holeJson(`/kollektionen/${FAVORITEN}/posten`, an ? { hinzu: [{ art: 'geraet', geraet: key }] } : { weg: [{ art: 'geraet', geraet: key }] });
    if (r.status !== 200) { host.melde(r.j?.text ?? 'The favourites could not be changed', true); return; }
    const f = koll.find((c) => c.slug === FAVORITEN);
    if (f) { if (an) f.keys.add(key); else f.keys.delete(key); }
    zeichneGeraete();
  });
  // the double click does what the drop does: an instrument adds a track, an effect goes to the chain of the first selected track
  teilG.addEventListener('dblclick', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    if (!li || !katalog || e.target.closest?.('[data-stern]')) return;
    if (!kannPlatzieren) { host.melde('Open PRODUCTION to place devices', true); return; }
    const n = geraetNutzlast(eintraege(katalog, achse)[Number(li.dataset.geraetI)]);
    if (!n) return;
    if (n.ziel === 'spur_neu') { const r = instrumentBefehl(n); host.aendere(r.label, [r.befehl]); return; }
    const strang = [...(host.spurWahl?.() ?? [])][0];
    if (!strang) { host.melde('Select a track first (click its head), then double click the effect', true); return; }
    const r = effektBefehl(host.projekt?.()?.projekt, strang, n);
    if (r.fehler) { host.melde(r.text, true); return; }
    host.aendere(r.label, [r.befehl]);
  });
  teilG.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    const n = kannPlatzieren && katalog ? geraetNutzlast(eintraege(katalog, achse)[Number(li?.dataset.geraetI)]) : null;
    if (!n) { e.preventDefault(); return; }
    e.dataTransfer.setData(GERAET_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy';
  });
  // right click: "Add to <collection>" (the same menu as the old list; in PRODUCTION this section is the only device list)
  teilG.addEventListener('contextmenu', (e) => {
    const li = e.target.closest?.('[data-geraet-i]');
    const posten = li && katalog ? postenVonGeraet(eintraege(katalog, achse)[Number(li.dataset.geraetI)]) : null;
    if (!posten) return;
    e.preventDefault();
    zeigeKollektionsMenue(host, posten, e.clientX, e.clientY);
  });
  // the page-wide grouping changed: redraw. The listener is removed again when the section is built anew (browser.js calls `ab`)
  const abAchse = beiAchse((neu) => { if (katalog && a.wurzel.isConnected) { achse = neu; zeichneGeraete(); } });

  // plugins: the old rows plus vendor, version and UNBLOCK
  function zeichnePlugins() {
    plListe.innerHTML = pluginZeilenHtml(plugins);
    plugins.forEach((p, n) => {
      const li = plListe.querySelector?.(`[data-plugin-i="${n}"]`);
      if (!li) return;
      const z = pluginZusatz(p);
      if (z) { const s = el('span', 'b-zusatz', z); li.append(s); }
      if (p.status === 'blockiert' && typeof p.id === 'string') li.append(taste('UNBLOCK', 'Try this plugin again at the next scan', (b) => aus(b, async () => { const x = await entsperre(host, p.id); if (x.status === 'ok') { host.melde('The plugin is tried again: scanning', false); await ladePlugins(); } return x; })));
      if (!kannPlatzieren && pluginNutzlast(p)) { li.draggable = false; li.title = 'Open PRODUCTION to place devices'; }
    });
  }
  async function ladePlugins() {
    const q = new URLSearchParams({ text: suche.value.trim(), art: '', format: format.value });
    const r = await host.holeGet(`/plugins?${q}`);
    const liste = Array.isArray(r.j) ? r.j : r.j?.plugins;
    if (r.status === 404) { pluginsDa = false; stand.textContent = 'Plugins are not available in this build'; plListe.textContent = ''; return; }
    pluginsDa = true;
    if (r.status === 200 && Array.isArray(liste)) { plugins = liste; stand.textContent = ''; zeichnePlugins(); }
    else stand.textContent = `Plugins: ${r.j?.text ?? 'not available'}`;
  }
  async function scanne() {
    stand.textContent = 'Scanning…';
    const r = await host.holeJson('/plugins/rescan', {});
    if (ok2(r)) { stand.textContent = ''; await ladePlugins(); return { status: 'ok' }; }
    stand.textContent = ''; host.melde(FEHLER(r), true); return { status: 'fehler' };
  }
  let t0 = 0;
  suche.addEventListener('input', () => { clearTimeout(t0); t0 = setTimeout(ladePlugins, 200); });
  format.addEventListener('change', ladePlugins);
  const wahlRechts = (e) => plugins[Number(e.target.closest?.('[data-plugin-i]')?.dataset.pluginI)];
  plListe.addEventListener('dragstart', (e) => {
    const n = kannPlatzieren ? pluginNutzlast(wahlRechts(e)) : null;
    if (!n) { e.preventDefault(); return; }
    e.dataTransfer.setData(GERAET_TYP, JSON.stringify(n)); e.dataTransfer.effectAllowed = 'copy';
  });
  plListe.addEventListener('click', (e) => {
    if (e.target.closest?.('button')) return;
    const p = wahlRechts(e);
    if (!p) return;
    if (p.status === 'blockiert') { host.melde(pluginGrund(p), true); return; }
    if (!kannPlatzieren) { host.melde('Open PRODUCTION to place devices', true); return; }
    const n = pluginNutzlast(p);
    if (n?.art === 'instrument') { const r = pluginSpurBefehl(n); host.aendere(r.label, [r.befehl]); return; }
    if (n) host.fuegePluginEin?.(n);
  });

  // the search paths: 404 hides the sub-head and the ADD key (no made-up list)
  async function hinzu() { const x = await fuegePluginOrdnerHinzu(host, dienste); if (x.status === 'ok') { await ladePfade2(); await ladePlugins(); } return x; }
  function zeichnePfade(zeilen) {
    pfadListe.textContent = '';
    for (const z of zeilen) {
      const r = el('div', 'b-zeile b-pfad');
      const t = el('span', 'b-text', z.pfad); t.title = z.pfad;
      r.append(t, el('span', 'b-zusatz', z.text));
      if (z.entfernbar) r.append(taste('REMOVE', 'Stop searching this folder (the files stay)', (b) => aus(b, async () => { const x = await entfernePluginOrdner(host, z.pfad); if (x.status === 'ok') { await ladePfade2(); await ladePlugins(); } return x; })));
      pfadListe.append(r);
    }
  }
  async function ladePfade2() {
    const x = await ladePfade(host);
    pfade = x.status === 'ok' ? x.zeilen : null;
    pfadKopf.hidden = pfadListe.hidden = pfadAdd.hidden = pfade === null;
    if (pfade) zeichnePfade(pfade);
    else if (x.status === 'fehler') host.melde(x.text, true);
  }

  async function laden() {
    a.setze('laedt');
    a.setze('inhalt');
    a.rumpf.textContent = '';
    teilG.textContent = 'Loading…';
    a.rumpf.append(teilG, el('div', 'b-untertitel', 'PLUGINS'), kopf, stand, plListe, pfadKopf, pfadListe, pfadAdd);
    pfadKopf.hidden = pfadListe.hidden = pfadAdd.hidden = true;   // shown once the route answers
    await Promise.all([ladeKatalog(), ladePlugins(), ladePfade2()]);
  }
  return { wurzel: a.wurzel, laden, ab: abAchse, get pluginsDa() { return pluginsDa; } };
}

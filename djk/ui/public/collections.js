// PRODUCTION (package 1.16 rest U8, decisions K1, K2): the COLLECTIONS panel of the browser column and "Add to collection".
// A collection is a named list of items on the server (routes /kollektionen, collections/area.ts): {art:'sample', sha}, {art:'preset', id},
// {art:'geraet', geraet}. The server never resolves a reference; the page does (T8.1): a sample through GET /stoebern/detail?sha=, a preset
// through GET /presets/<herkunft>/<geraet>/<slug>, a device through the catalogue GET /presets/katalog. A reference that does not resolve is
// shown as "missing" with a remove button and is never offered for dragging, never dropped silently.
// A row of an open collection is dragged with the same three types as the browser lists (T8.2): a sample as drag.js nutzlast (ZIEH_TYP), a
// preset as preset_target.js presetNutzlast (PRESET_TYP), a device as drag.js geraetNutzlast (GERAET_TYP); storage.js takes all three.
// Right click on a LIBRARY row, a preset row or a device row in PRODUCTION opens "Add to <name>" per collection and "New collection..." (T8.3).
// Andreas' page sends no source header, so the server treats every change as his (K2: he may remove, rename and delete everywhere).
import { ZIEH_TYP, GERAET_TYP, nutzlast, clipName, geraetNutzlast } from './production/drag.js';
import { PRESET_TYP, presetNutzlast } from './production/preset_target.js';
import { oeffneMenue } from './production/context_menu.js';

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SHA = /^[0-9a-f]{64}$/;
const REGISTER_ID = /^(werk|nutzer):([a-z0-9-]+)\/([a-z0-9][a-z0-9-]{0,47})$/;
const GRAPH = /^[a-z0-9_-]{1,32}$/;
// the devices a collection may hold (collections/model.ts GERAET_ARTEN, plus bk:<graph>); the hall is no device of PRODUCTION
const GERAETE = new Set(['rb338', 'surge', 'komp', 'eq', 'saett']);
const ART_TEXT = { sample: 'Sample', preset: 'Preset', geraet: 'Device' };
const katalogEintraege = (k) => [...(k?.instrumente ?? []), ...(k?.effekte ?? [])];
const fehlerText = (r) => r?.j?.text ?? r?.j?.fehler ?? `HTTP ${r?.status ?? 'none'}`;

// ---- T8.3 items from the three browser lists ----
/** A LIBRARY row (stoebern treffer) -> {art:'sample', sha} or null. */
export const postenVonSample = (t) => (t && typeof t.sha === 'string' && SHA.test(t.sha) ? { art: 'sample', sha: t.sha } : null);
/** A row of GET /presets -> {art:'preset', id} or null (a damaged file is no item). */
export function postenVonPreset(e) { const n = presetNutzlast(e); return n ? { art: 'preset', id: n.id } : null; }
/** A catalogue entry of GET /presets/katalog -> {art:'geraet', geraet} or null (the hall is no device of a collection). */
export function postenVonGeraet(e) {
  if (!e || typeof e.geraet !== 'string') return null;
  if (e.geraet === 'bk') return typeof e.graph === 'string' && GRAPH.test(e.graph) ? { art: 'geraet', geraet: `bk:${e.graph}` } : null;
  return GERAETE.has(e.geraet) ? { art: 'geraet', geraet: e.geraet } : null;
}
const postenText = (p) => (p.art === 'sample' ? `sample ${p.sha.slice(0, 8)}` : p.art === 'preset' ? p.id : p.geraet);
const gleichePosten = (a, b) => a.art === b.art && (a.art === 'sample' ? a.sha === b.sha : a.art === 'preset' ? a.id === b.id : a.geraet === b.geraet);

// ---- T8.1 resolving one item ----
const fehlt = (p) => ({ posten: p, text: `${postenText(p)} (missing)`, typ: null, nutzlast: null, fehlt: true });
/** -> {posten, text, typ, nutzlast, fehlt}. typ null: not draggable (missing, or known but without its file). q: {holeGet, katalog}. */
export async function loesePosten(p, q) {
  if (p?.art === 'sample') {
    const r = await q.holeGet(`/stoebern/detail?sha=${p.sha}`);
    const t = r.status === 200 ? r.j?.eintrag : null;
    if (!t) return fehlt(p);
    const n = nutzlast(t), name = clipName(t) ?? postenText(p);
    return n ? { posten: p, text: name, typ: ZIEH_TYP, nutzlast: n, fehlt: false } : { posten: p, text: `${name} (file not available)`, typ: null, nutzlast: null, fehlt: false };
  }
  if (p?.art === 'preset') {
    const m = REGISTER_ID.exec(p.id ?? '');
    if (!m) return fehlt(p);
    const r = await q.holeGet(`/presets/${m[1]}/${m[2]}/${m[3]}`);
    const n = r.status === 200 && r.j && !r.j.fehler ? presetNutzlast({ herkunft: m[1], geraet: m[2], slug: m[3], name: r.j.name }) : null;
    return n ? { posten: p, text: n.name, typ: PRESET_TYP, nutzlast: n, fehlt: false } : fehlt(p);
  }
  if (p?.art === 'geraet') {
    const e = katalogEintraege(q.katalog).find((x) => postenVonGeraet(x)?.geraet === p.geraet);
    const n = geraetNutzlast(e);
    return n ? { posten: p, text: e.titel, typ: GERAET_TYP, nutzlast: n, fehlt: false } : fehlt(p);
  }
  return fehlt(p);
}

// ---- T8.1/T8.4 panel HTML ----
export function kollektionenHtml(z) {
  const o = z.offen;
  if (!o) {
    const zeile = (k) => `<li class="koll-eintrag${k.fehler ? ' kaputt' : ''}"${k.fehler ? '' : ` data-koll-oeffnen="${html(k.slug)}"`}>`
      + `<span class="koll-name">${html(k.name)}</span><span class="koll-anzahl">${k.fehler ? 'damaged file' : `${k.anzahl} item${k.anzahl === 1 ? '' : 's'}`}</span>`
      + `${k.autor === 'cypher' ? '<span class="koll-autor">by Cypher</span>' : ''}</li>`;
    return `<div class="koll-kopf"><span class="koll-titel">COLLECTIONS</span><button data-koll-aktion="neu" title="Create a new collection">NEW</button></div>`
      + (z.liste.length ? `<ul class="koll-liste">${z.liste.map(zeile).join('')}</ul>`
        : '<p class="koll-leer">No collections yet. Right click a row in LIBRARY, PRESETS or DEVICES to start one.</p>');
  }
  const zeile = (x, i) => `<li class="koll-zeile${x.fehlt ? ' fehlt' : ''}" data-koll-i="${i}" draggable="${!!x.typ}"${x.typ ? '' : ' title="Not available: remove it or bring the source back"'}>`
    + `<span class="koll-art">${ART_TEXT[x.posten.art] ?? ''}</span><span class="koll-text">${html(x.text)}</span>`
    + `<button data-koll-aktion="weg" data-koll-i="${i}" title="Remove from the collection">x</button></li>`;
  return `<div class="koll-kopf"><button data-koll-aktion="zurueck" title="All collections">BACK</button><span class="koll-titel">${html(o.name)}</span>`
    + `${o.autor === 'cypher' ? '<span class="koll-autor">by Cypher</span>' : ''}`
    + '<button data-koll-aktion="umbenennen">RENAME</button><button data-koll-aktion="loeschen">DELETE</button></div>'
    + (o.zeilen.length ? `<ul class="koll-posten">${o.zeilen.map(zeile).join('')}</ul>`
      : '<p class="koll-leer">Empty. Right click a row in LIBRARY, PRESETS or DEVICES to add it here.</p>');
}

// ---- T8.3 context menu ----
/** kollektionen: [{slug, name, enthaelt?, fehler?}] -> points for context_menu.js oeffneMenue. */
export function menuePunkte(kollektionen, { hinzu, neu }) {
  return [...kollektionen.filter((k) => !k.fehler).map((k) => ({ text: `Add to ${k.name}`, aus: !!k.enthaelt, ...(k.enthaelt ? { titel: 'Already in this collection' } : {}), aktion: () => hinzu(k.slug) })),
    { text: 'New collection…', aktion: () => neu() }];
}

// ---- binder ----
// ctx: st.sichtbar, beimSichtwechsel, holeGet, holeJson (POST), melde, stoebern() (the LIBRARY result), presetListe() (the rows of the PRESETS panel).
// opt: frage, bestaetige, menue (injectable for tests; the page uses prompt, confirm, oeffneMenue).
export function bindeKollektionen(ctx, opt = {}) {
  const frage = opt.frage ?? ((t, v) => globalThis.prompt?.(t, v) ?? null);
  const bestaetige = opt.bestaetige ?? ((t) => globalThis.confirm?.(t) ?? false);
  const menue = opt.menue ?? oeffneMenue;
  const wurzel = document.getElementById('kollektionen');
  const z = { liste: [], offen: null };
  let katalog = null;
  const zeige = () => { if (wurzel) wurzel.innerHTML = kollektionenHtml(z); };
  async function holeKatalog() {
    if (katalog) return katalog;
    const r = await ctx.holeGet('/presets/katalog');
    if (r.status === 200) katalog = r.j;
    return katalog;
  }
  async function oeffne(slug) {
    const r = await ctx.holeGet(`/kollektionen/${encodeURIComponent(slug)}`);
    if (r.status !== 200) { z.offen = null; ctx.melde(`Collection not available: ${fehlerText(r)}`, true); zeige(); return; }
    await holeKatalog();
    const zeilen = await Promise.all((r.j.posten ?? []).map((p) => loesePosten(p, { holeGet: ctx.holeGet, katalog })));
    z.offen = { slug: r.j.slug ?? slug, name: r.j.name, autor: r.j.autor, geaendert: r.j.geaendert, zeilen };
    zeige();
  }
  async function lade() {
    const r = await ctx.holeGet('/kollektionen');
    if (r.status === 200 && Array.isArray(r.j)) z.liste = r.j;
    else ctx.melde(`Collections not available: ${fehlerText(r)}`, true);
    if (z.offen) await oeffne(z.offen.slug); else zeige();
  }
  async function neu() {
    const name = frage('Name of the new collection', '');
    if (name === null || !name.trim()) return null;
    const r = await ctx.holeJson('/kollektionen', { name });
    if (r.status !== 201) { ctx.melde(`Not created: ${fehlerText(r)}`, true); return null; }
    await lade();
    return r.j.slug;
  }
  async function hinzu(slug, posten) {
    const r = await ctx.holeJson(`/kollektionen/${encodeURIComponent(slug)}/posten`, { hinzu: [posten] });
    if (r.status !== 200) { ctx.melde(`Not added: ${fehlerText(r)}`, true); return false; }
    ctx.melde(`Added to ${z.liste.find((k) => k.slug === slug)?.name ?? slug}`);
    await lade();
    return true;
  }
  async function aktion(a, ds) {
    const o = z.offen;
    if (a === 'neu') return neu();
    if (a === 'zurueck') { z.offen = null; return lade(); }
    if (!o) return null;
    if (a === 'weg') {
      const x = o.zeilen[Number(ds.kollI)];
      if (!x) return null;
      const r = await ctx.holeJson(`/kollektionen/${encodeURIComponent(o.slug)}/posten`, { weg: [x.posten], erwartet: o.geaendert });
      if (r.status !== 200) ctx.melde(`Not removed: ${fehlerText(r)}`, true);
      return lade();
    }
    if (a === 'umbenennen') {
      const name = frage('New name', o.name);
      if (name === null || !name.trim() || name.trim() === o.name) return null;
      const r = await ctx.holeJson(`/kollektionen/${encodeURIComponent(o.slug)}/umbenennen`, { name });
      if (r.status !== 200) { ctx.melde(`Not renamed: ${fehlerText(r)}`, true); return null; }
      o.slug = r.j.slug;
      return lade();
    }
    if (a === 'loeschen') {
      if (!bestaetige(`Delete the collection "${o.name}"? It is moved to the trash folder.`)) return null;
      const r = await ctx.holeJson(`/kollektionen/${encodeURIComponent(o.slug)}/loeschen`, {});
      if (r.status !== 200) { ctx.melde(`Not deleted: ${fehlerText(r)}`, true); return null; }
      z.offen = null;
      return lade();
    }
    return null;
  }
  // "Add to <name>" for one item; a collection that already holds it is shown disabled
  async function zeigeMenue(posten, x, y) {
    const r = await ctx.holeGet('/kollektionen');
    if (r.status !== 200 || !Array.isArray(r.j)) { ctx.melde(`Collections not available: ${fehlerText(r)}`, true); return; }
    z.liste = r.j;
    const mit = await Promise.all(r.j.map(async (k) => {
      if (k.fehler) return k;
      const d = await ctx.holeGet(`/kollektionen/${encodeURIComponent(k.slug)}`);
      return { ...k, enthaelt: d.status === 200 && (d.j.posten ?? []).some((p) => gleichePosten(p, posten)) };
    }));
    menue(menuePunkte(mit, { hinzu: (slug) => hinzu(slug, posten), neu: async () => { const slug = await neu(); if (slug) await hinzu(slug, posten); } }), x, y);
  }

  if (wurzel) {
    wurzel.addEventListener('click', (e) => {
      const b = e.target?.closest?.('[data-koll-aktion]');
      if (b) { if (!b.disabled) aktion(b.dataset.kollAktion, b.dataset); return; }
      const k = e.target?.closest?.('[data-koll-oeffnen]');
      if (k) oeffne(k.dataset.kollOeffnen);
    });
    wurzel.addEventListener('dragstart', (e) => {
      const li = e.target?.closest?.('[data-koll-i]');
      const x = z.offen?.zeilen[Number(li?.dataset.kollI)];
      if (!x?.typ) { e.preventDefault?.(); return; }
      e.dataTransfer.setData(x.typ, JSON.stringify(x.nutzlast)); e.dataTransfer.effectAllowed = 'copy';
    });
  }
  // right click in the three browser lists, PRODUCTION only (the DJ view keeps the browser's own menu)
  const rechts = (el, finde) => el?.addEventListener('contextmenu', (e) => {
    if (!ctx.st.sichtbar) return;
    const p = finde(e);
    if (!p) return;
    e.preventDefault();
    zeigeMenue(p, e.clientX, e.clientY);
  });
  rechts(document.querySelector('#libliste'), (e) => postenVonSample(ctx.stoebern()?.treffer?.[Number(e.target?.closest?.('tr')?.dataset.i)]));
  rechts(document.getElementById('presets'), (e) => {
    const id = e.target?.closest?.('[data-preset-id]')?.dataset.presetId;
    return postenVonPreset((ctx.presetListe?.() ?? []).find((x) => `${x.herkunft}/${x.geraet}/${x.slug}` === id));
  });
  rechts(document.getElementById('geraete-browser'), (e) => postenVonGeraet(katalogEintraege(katalog)[Number(e.target?.closest?.('[data-geraet-i]')?.dataset.geraetI)]));
  ctx.kollektionenZeigen = async () => { await holeKatalog(); return lade(); };
  ctx.beimSichtwechsel.push((an) => { if (an) holeKatalog(); });
}

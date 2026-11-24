// PRESETS (browser plan 2, task 11): the real preset panel (public/presets.js) in the browser column, with PREVIEW, EXPORT and a star on every row,
// IMPORT PRESET, and the save form folded behind SAVE AS PRESET. Routes of the sibling plan answer 404 in older builds: that disables only the key.
import { baueAbschnitt } from './abschnitt.js';
import { PresetPanel, registerId } from '../presets.js';
import { FAVORITEN_SLUG } from '../usage.js';
import { postenVonPreset } from '../collections.js';
import { zeigeKollektionsMenue } from './kollektion_menue.js';

export const NICHT_DA = 'Not available in this build yet';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ok2 = (r) => r.status >= 200 && r.status < 300;

/** The keys PREVIEW, EXPORT and the star of one row (HTML, appended to its action group). `id` is the register id; `nicht` = {vorschau, export, stern}: the route answered 404.
 *  `rendert` marks a preview that is still being made. A damaged file (e.fehler) can be neither previewed nor exported. */
export function presetZusatzHtml(e, id, stern, nicht = {}, rendert = false) {
  const kaputt = !!e?.fehler, i = esc(id);
  const vor = nicht.vorschau ? ' disabled' : kaputt || rendert ? ' disabled' : '';
  const vorTitel = nicht.vorschau ? NICHT_DA : 'Play a short preview on the cue output';
  const expAus = kaputt || nicht.export;
  const exp = expAus
    ? `<a class="preset-export" data-preset-aktion="export" data-preset-id="${i}" aria-disabled="true" disabled title="${esc(nicht.export ? NICHT_DA : 'This file is damaged')}">EXPORT</a>`
    : `<a class="preset-export" data-preset-aktion="export" data-preset-id="${i}" href="/presets/export?id=${encodeURIComponent(id)}" download title="Download this preset as a file">EXPORT</a>`;
  const st = `<button type="button" class="geraete-stern${stern ? ' an' : ''}" data-preset-aktion="stern" data-preset-id="${i}" aria-pressed="${!!stern}"${nicht.stern ? ' disabled' : ''} title="${nicht.stern ? NICHT_DA : stern ? 'Remove from favourites' : 'Mark as favourite'}">${stern ? '★' : '☆'}</button>`;
  return `<button type="button" data-preset-aktion="vorschau" data-preset-id="${i}"${vor} title="${esc(vorTitel)}">${rendert ? 'Rendering…' : 'PREVIEW'}</button>${exp}${st}`;
}

const FEHLER = (r) => r.j?.text || `The request failed (${r.status || 'no connection'})`;
// every action answers {status: 'ok'|'nicht_da'|'fehler', text?}
export async function vorschau(host, id) {
  const r = await host.holeJson('/presets/vorhoeren', { id });
  if (r.status === 404 && !(r.j?.grund ?? r.j?.fehler)) return { status: 'nicht_da' };   // only a missing route; an unknown preset has a code
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  return { status: 'ok', aus_cache: r.j?.aus_cache === true };
}
export async function setzeStern(host, id, an) {
  const posten = { art: 'preset', id };
  const r = await host.holeJson(`/kollektionen/${FAVORITEN_SLUG}/posten`, an ? { hinzu: [posten] } : { weg: [posten] });
  if (!ok2(r)) { const text = r.j?.text ?? 'The favourites could not be changed'; host.melde(text, true); return { status: r.status === 404 ? 'nicht_da' : 'fehler', text }; }
  return { status: 'ok' };
}
/** IMPORT PRESET: the file's text goes as the raw body (Content-Type application/json, nothing else). A refusal shows the server's sentence. */
export async function importiere(host, text, opt = {}) {
  const f = opt.fetchFn ?? globalThis.fetch.bind(globalThis);
  let r;
  try { r = await f('/presets/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text }); } catch (e) { const t = `The import failed: ${e.message}`; host.melde(t, true); return { status: 'fehler', text: t }; }
  let j = null; try { j = await r.json(); } catch { /* no JSON */ }
  if (r.status === 404 && !(j?.grund ?? j?.fehler)) return { status: 'nicht_da' };
  if (r.status < 200 || r.status >= 300 || j?.ok === false) { const t = j?.text || `The import failed (${r.status})`; host.melde(t, true); return { status: 'fehler', text: t }; }
  const schonDa = j?.schon_da === true;
  host.melde(schonDa ? 'That preset is already there: nothing was added' : 'Preset imported', false);
  return { status: 'ok', id: j?.id, schon_da: schonDa };
}
export async function ladeExport(host, id, opt = {}) {
  const f = opt.fetchFn ?? globalThis.fetch.bind(globalThis);
  let r;
  try { r = await f(`/presets/export?id=${encodeURIComponent(id)}`); } catch (e) { const t = `The export failed: ${e.message}`; host.melde(t, true); return { status: 'fehler', text: t }; }
  if (r.status === 404) { let j = null; try { j = await r.json(); } catch { /* none */ } if (!(j?.grund ?? j?.fehler)) return { status: 'nicht_da' }; const t = j.text || 'The preset was not found'; host.melde(t, true); return { status: 'fehler', text: t }; }
  if (r.status !== 200) { const t = `The export failed (${r.status})`; host.melde(t, true); return { status: 'fehler', text: t }; }
  (opt.speichere ?? speichereBlob)(await r.blob(), `${String(id).split('/').pop() || 'preset'}.json`);
  return { status: 'ok' };
}
function speichereBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

export function bauePresetsAbschnitt(host) {
  const a = baueAbschnitt({ id: 'presets', titel: 'PRESETS', offen: false });
  const nicht = {}, rendert = new Set(), sterne = new Set();
  const prod = host.presetHost ?? {};
  const wurzel = el('div', 'presets b-presets');
  const holen = async (pfad) => { const r = await host.holeGet(pfad); return { code: r.status, j: r.j ?? {} }; };
  const senden = async (pfad, daten) => { const r = await host.holeJson(pfad, daten); return { code: r.status, j: r.j ?? {} }; };
  const panel = new PresetPanel(wurzel, {
    ...prod, holen, senden, speichernFalten: true,
    bestaetige: (t) => globalThis.confirm?.(t) ?? false, frage: (t, v) => globalThis.prompt?.(t, v) ?? null,
    zeilenZusatz: (e, id) => { const rid = registerId(id) ?? id; return presetZusatzHtml(e, rid, sterne.has(rid), nicht, rendert.has(rid)); },
  });
  const kopf = el('div', 'b-aktionen'), datei = el('input'), importKnopf = el('button', 'b-taste', 'IMPORT PRESET');
  datei.type = 'file'; datei.accept = '.json,application/json'; datei.hidden = true;
  importKnopf.type = 'button'; importKnopf.title = 'Add a preset file (.json) from this computer';
  importKnopf.addEventListener('click', (e) => { e.stopPropagation(); datei.value = ''; datei.click(); });
  datei.addEventListener('change', async () => {
    const f = datei.files?.[0];
    if (!f) return;
    importKnopf.disabled = true;
    try {
      const x = await importiere(host, await f.text());
      if (x.status === 'nicht_da') { importKnopf.title = NICHT_DA; nicht.import = true; } else { importKnopf.disabled = false; if (x.status === 'ok') await panel.lade(); }
    } finally { if (!nicht.import) importKnopf.disabled = false; }
  });
  kopf.append(importKnopf, datei);

  async function ladeSterne() {
    const r = await host.holeGet(`/kollektionen/${FAVORITEN_SLUG}`);
    sterne.clear();
    for (const p of r.status === 200 ? (r.j?.posten ?? []) : []) if (p?.art === 'preset' && typeof p.id === 'string') sterne.add(p.id);
  }
  wurzel.addEventListener('click', async (ev) => {
    const b = ev.target?.closest?.('[data-preset-aktion]');
    const art = b?.dataset.presetAktion;
    if (!b || b.disabled || !['vorschau', 'stern', 'export'].includes(art)) return;
    const id = b.dataset.presetId;
    if (art === 'export') {
      ev.preventDefault();   // fetched here so that a missing route is seen; the link itself stays a plain download link
      if ((await ladeExport(host, id)).status === 'nicht_da') { nicht.export = true; panel.zeige(); }
    } else if (art === 'vorschau') {
      rendert.add(id); panel.zeige();
      let x; try { x = await vorschau(host, id); } finally { rendert.delete(id); }
      if (x.status === 'nicht_da') nicht.vorschau = true;
      panel.zeige();
    } else {
      const an = !sterne.has(id), x = await setzeStern(host, id, an);
      if (x.status === 'ok') { if (an) sterne.add(id); else sterne.delete(id); } else if (x.status === 'nicht_da') nicht.stern = true;
      panel.zeige();
    }
  });
  // right click on a row: "Add to <collection>"
  wurzel.addEventListener('contextmenu', (e) => {
    const id = e.target?.closest?.('[data-preset-id]')?.dataset.presetId;
    const posten = id ? postenVonPreset((panel.z.liste ?? []).find((x) => `${x.herkunft}/${x.geraet}/${x.slug}` === id)) : null;
    if (!posten) return;
    e.preventDefault();
    zeigeKollektionsMenue(host, posten, e.clientX, e.clientY);
  });
  panel.binde();

  async function laden() {
    a.setze('inhalt');
    if (!wurzel.isConnected) { a.rumpf.textContent = ''; a.rumpf.append(kopf, wurzel); }
    await ladeSterne();
    panel.aktualisiereZiele?.();
    await panel.lade();
  }
  return { wurzel: a.wurzel, laden, panel };
}

// RELATED and batch tags of the browser (browser plan 2, task 13). The row builder and the batch call are pure; the popover is the DOM part.
import { setzen, verwandt } from './tags_client.js';

const GRUPPEN = [['gemacht_aus', 'Made from'], ['steckt_in', 'Used in'], ['passt_zu', 'Fits'], ['aehnlich', 'Similar']];

// an item id -> a readable name (the id of a file is its sha, so a file shows its first eight characters)
// `namen`: optional sha -> file name (from the catalogue row or the tags store); a file without one still shows its first eight characters
export function itemText(item, namen) {
  const s = String(item);
  const i = s.indexOf(':');
  if (i < 0) return s;
  const art = s.slice(0, i), rest = s.slice(i + 1);
  if (art === 'datei') { const n = namen?.get?.(rest) ?? (typeof namen === 'function' ? namen(rest) : null); return n ? String(n) : `file ${rest.slice(0, 8)}`; }
  if (art === 'preset') return rest.slice(rest.lastIndexOf('/') + 1).replace(/^[^:]+:/, '');
  if (art === 'take' || art === 'export') return rest.slice(rest.lastIndexOf('/') + 1);
  return rest;
}

export function verwandtZeilen(v, namen) {
  if (!v || typeof v !== 'object') return [];
  const aus = [];
  for (const [feld, gruppe] of GRUPPEN) {
    const liste = Array.isArray(v[feld]) ? v[feld] : [];
    for (const item of liste) aus.push({ gruppe, item, text: itemText(item, namen) });
  }
  return aus;
}

// one POST for all items (the server takes up to 500 per call)
export async function setzeTagsBatch(host, items, tags, an) {
  const r = await host.holeJson('/tags/setzen', { items, tags, an });
  if (r.status === 404) return { ok: false, text: 'Tags are not available in this build yet' };
  if (r.status >= 200 && r.status < 300 && r.j?.ok !== false) return { ok: true, geaendert: r.j?.geaendert ?? 0 };
  return { ok: false, text: r.j?.text ?? `The request failed (${r.status || 'no connection'})` };
}

// the popover next to a row: groups of related items; a click on one asks zeige(item), which scrolls to its row in the browser or does nothing
export async function zeigeVerwandt({ item, anker, zeige, host }) {
  document.querySelector('.b-verwandt')?.remove();
  const p = document.createElement('div');
  p.className = 'b-verwandt'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Related items');
  const zu = () => { p.remove(); document.removeEventListener('click', aussen, true); };
  const aussen = (e) => { if (!p.contains(e.target)) zu(); };
  p.textContent = 'Loading…';
  const wurzel = anker.closest('#browser') ?? document.body;
  wurzel.append(p);
  const r = anker.getBoundingClientRect(), w = wurzel.getBoundingClientRect();
  p.style.top = `${Math.round(r.bottom - w.top + wurzel.scrollTop)}px`;
  setTimeout(() => document.addEventListener('click', aussen, true), 0);
  let v = null;
  try { v = await verwandt(item); } catch (e) { p.textContent = e.text ?? 'Related items could not be read'; return; }
  // file names: the catalogue row on the page first, then the catalogue entry of the file (the sha stays in the tooltip)
  const namen = new Map();
  for (const feld of ['gemacht_aus', 'steckt_in', 'passt_zu', 'aehnlich']) for (const it of Array.isArray(v?.[feld]) ? v[feld] : []) {
    const m = /^datei:(.+)$/.exec(String(it)); if (!m || namen.has(m[1])) continue;
    const t = document.querySelector(`[data-sha="${m[1]}"] .b-text`)?.textContent;
    if (t) namen.set(m[1], t);
    else try { const d = await host.holeGet(`/stoebern/detail?sha=${encodeURIComponent(m[1])}`); const e = d?.j?.eintrag; const n = e && (e.titel ?? e.name); if (n) namen.set(m[1], n); } catch { /* the short sha stays */ }
  }
  const z = verwandtZeilen(v, namen);
  p.textContent = '';
  if (z.length === 0) { p.textContent = 'Nothing related yet'; return; }
  let letzte = null;
  for (const x of z) {
    if (x.gruppe !== letzte) { const k = document.createElement('div'); k.className = 'b-verwandt-kopf'; k.textContent = x.gruppe.toUpperCase(); p.append(k); letzte = x.gruppe; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'b-verwandt-zeile'; b.textContent = x.text; b.title = x.item;
    b.addEventListener('click', (e) => { e.stopPropagation(); zeige(x.item, x.text); });
    p.append(b);
  }
}

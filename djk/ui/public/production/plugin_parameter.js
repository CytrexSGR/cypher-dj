// PRODUCTION (plan 1.11 task 11): the generic parameter list of a foreign plugin stage (host insert). A plugin may have several hundred parameters, so the
// list is one string of rows (no per-row listeners: one delegated handler), a filter field narrows it, and slider moves are collected for 30 ms and sent as
// ONE POST /proj/insert/<id>/param {werte: {<index>: <0..1>}}. The server owns the values; the project never holds them (a host stage has `werte: {}`).
export const PARAM_ENTPRELLEN_MS = 30;

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// the value as the plugin shows it: the real range when it has one, else the position in percent
export function paramWertText(q, wert) {
  const w = Math.min(Math.max(Number(wert) || 0, 0), 1);
  const spanne = Number.isFinite(q?.min) && Number.isFinite(q?.max) && q.max !== q.min;
  if (!spanne) return `${Math.round(w * 100)} %`;
  const v = q.min + w * (q.max - q.min);
  const t = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return q.einheit ? `${t} ${q.einheit}` : t;
}
// the rows whose name contains the text (case-insensitive); an empty text keeps all
export function paramFilter(liste, text) {
  const t = String(text ?? '').trim().toLowerCase();
  return t === '' ? liste : liste.filter((q) => String(q.name).toLowerCase().includes(t));
}
const zeileHtml = (q) => `<label class="p-hp-zeile" data-index="${q.index}"><span class="p-hp-name" title="${html(q.name)}">${html(q.name)}</span>`
  + `<input type="range" class="p-hp-regler" min="0" max="1" step="0.001" value="${Number(q.wert) || 0}" data-index="${q.index}" aria-label="${html(q.name)}">`
  + `<output class="p-hp-wert">${html(paramWertText(q, q.wert))}</output></label>`;
export const paramListeHtml = (liste) => liste.map(zeileHtml).join('');

// Builds the popover content into `el`. holeListe(): Promise<{status, j}> of GET .../parameter; sende(werte): Promise of the POST. Returns {zeige, neu}.
export function baueParameterListe(el, { holeListe, sende, fehler }) {
  el.innerHTML = '<input type="search" class="p-hp-filter" placeholder="Filter parameters" aria-label="Filter parameters">'
    + '<span class="p-hp-zahl"></span><div class="p-hp-liste" role="group" aria-label="Plugin parameters"></div>';
  const feld = el.querySelector('.p-hp-filter'), liste = el.querySelector('.p-hp-liste'), zahl = el.querySelector('.p-hp-zahl');
  let alle = [], offen = {}, timer = null;
  const zeige = () => {
    const t = paramFilter(alle, feld.value);
    liste.innerHTML = paramListeHtml(t.map((q) => ({ ...q, wert: offen[q.index] ?? q.wert })));
    zahl.textContent = t.length === alle.length ? `${alle.length} parameters` : `${t.length} of ${alle.length}`;
  };
  const schicke = async () => {
    timer = null;
    const werte = offen; offen = {};
    const r = await sende(werte);
    if (r && r.status === 200 && r.j?.werte) {
      for (const q of alle) if (String(q.index) in r.j.werte) q.wert = r.j.werte[q.index];
    } else { for (const q of alle) if (String(q.index) in werte) q.wert = werte[q.index]; if (r && r.status !== 200) fehler?.(r); }
  };
  liste.addEventListener('input', (e) => {
    const r = e.target.closest?.('.p-hp-regler');
    if (!r) return;
    const idx = Number(r.dataset.index), v = Number(r.value), q = alle.find((x) => x.index === idx);
    r.closest('.p-hp-zeile').querySelector('.p-hp-wert').textContent = paramWertText(q, v);
    offen[idx] = v;
    clearTimeout(timer); timer = setTimeout(schicke, PARAM_ENTPRELLEN_MS);
  });
  feld.addEventListener('input', zeige);
  const neu = async () => {
    zahl.textContent = 'Loading…';
    const r = await holeListe();
    if (r.status === 200 && Array.isArray(r.j)) { alle = r.j; zeige(); } else { alle = []; liste.textContent = ''; zahl.textContent = ''; fehler?.(r); }
  };
  neu();
  return { zeige, neu, setze: (l) => { alle = l; zeige(); } };
}

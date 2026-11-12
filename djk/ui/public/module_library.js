// MODULES tab of the library (plan live-module task 10): the saved live modules (GET /module), a search field and a PLACE button that puts the module
// into the open project (POST /modul/einsetzen). Own file so the DJ view (app.js) only binds it.
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The table of the tab as HTML: title, artist, key, date, set and the PLACE button of every module. */
export function modulZeilen(liste) {
  if (!liste.length) return '<tr><td colspan="6" class="leer">No modules saved yet</td></tr>';
  return liste.map((m) => `<tr data-modul="${esc(m.id)}"><td>${esc(m.titel)}${m.stems ? '' : ' <span class="klein">(loop only)</span>'}</td><td>${esc(m.kuenstler)}</td>`
    + `<td>${esc(m.tonart)}</td><td>${esc(m.datum)}</td><td>${esc(m.set)}</td>`
    + `<td><button type="button" data-modul-setzen="${esc(m.id)}" title="Place this module into the open project">PLACE</button></td></tr>`).join('');
}

/** Binds the tab. ruf(methode, pfad, body?) -> {code, j}, melde(text) shows a message; both default to fetch and nothing. */
export function bindeModule({ reiter, tabelle, ruf, melde = () => {} }) {
  const http = ruf ?? (async (methode, pfad, body) => {
    const r = await fetch(pfad, { method: methode, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { code: r.status, j: await r.json().catch(() => ({})) };
  });
  tabelle.innerHTML = '<div class="lib-filter"><input type="search" data-modul-suche placeholder="Search modules: title, artist, set, date, key" autocomplete="off"></div>'
    + '<table><thead><tr><th>Title</th><th>Artist</th><th>Key</th><th>Date</th><th>Set</th><th></th></tr></thead><tbody data-modul-liste></tbody></table>';
  const suche = tabelle.querySelector('[data-modul-suche]'), liste = tabelle.querySelector('[data-modul-liste]');
  const lade = async () => {
    const q = suche.value.trim();
    const a = await http('GET', `/module${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (a.code !== 200) { melde(a.j?.text ?? 'Modules could not be loaded'); return; }
    liste.innerHTML = modulZeilen(a.j.module ?? []);
  };
  const setze = async (id) => {
    const a = await http('POST', '/modul/einsetzen', { modul_id: id });
    melde(a.code === 200 ? `Module placed as group ${a.j.name}${a.j.audio_fehlt ? ' (some audio is missing)' : ''}` : (a.j?.text ?? 'The module was not placed'));
  };
  reiter.addEventListener('click', lade);
  suche.addEventListener('keydown', (e) => { if (e.key === 'Enter') lade(); });
  liste.addEventListener('click', (e) => {
    const b = e.target?.closest?.('[data-modul-setzen]');
    if (b) setze(b.dataset.modulSetzen);
  });
  return { lade, setze };
}

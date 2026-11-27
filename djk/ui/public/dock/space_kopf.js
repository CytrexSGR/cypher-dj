// Cypher Space on a stage panel: the header row (room selector, LOAD IR; panel_kopf.js raumKopfHtml) and what it does. A room choice and a loaded impulse response both
// swap the graph of THIS stage (one insert_setzen with `ersetzen` and the six knob values: one history step). LOAD IR opens a small file picker over the sample roots
// (GET /sampler/dateien, as the tracker and the workbench shelf use it), posts the chosen file to POST /sampler/space_ir and swaps the stage to the copy it answers.
// A replaced stage gets a new id, so macro mappings and automation lanes on its knobs go with the old one (the same as every other replacement of a stage).
import { raumKopfHtml, raumNameAusPanel, raumTauschBefehle } from '../panel_kopf.js';
import { straenge } from '../production/inserts.js';
import { listenUrl, zeilenModell, krumen } from '../werkbank/regal_samples.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fehlerText = (r) => r?.j?.text ?? r?.j?.fehler ?? `HTTP ${r?.status ?? 'none'}`;

/** Draws the Space header into `kz`. host: the dock host (projekt, aendere, melde, holeGet, holeJson); strangId, insertId: the stage; panel: the panel file of its graph;
 *  beiGetauscht(insert): called with the new stage after a swap (the window opens it again, its old id is gone). Returns { zerstoere }. */
export function baueSpaceKopf(host, kz, { strangId, insertId, panel, beiGetauscht }) {
  const strangNeu = () => straenge(host.projekt()).find((x) => x.id === strangId) ?? null;
  const stufe = () => {
    const strang = strangNeu();
    const pos = (strang?.inserts ?? []).findIndex((i) => i.id === insertId);
    return strang && pos >= 0 ? { strang, pos, insert: strang.inserts[pos] } : null;
  };
  const start = stufe();
  const zeile = kz.ownerDocument.createElement('div');
  zeile.innerHTML = raumKopfHtml(start?.insert?.graph, raumNameAusPanel(panel));
  const sel = zeile.querySelector('select.fp-raum');
  if (!sel) return { zerstoere() {} };
  kz.append(zeile);
  let beschaeftigt = false, wahl = null;

  const tausche = async (graph) => {
    const s = stufe();
    if (!s || s.insert.graph === graph || beschaeftigt) return false;
    beschaeftigt = true;
    try {
      const label = `Room ${graph} on ${s.strang.name ?? strangId}`;
      const ok = await host.aendere(label, raumTauschBefehle({ strangId, pos: s.pos, graph, werte: s.insert.werte ?? {} }));
      if (ok === false) return false;
      const neu = strangNeu()?.inserts?.[s.pos];
      if (neu && s.insert.an === false) await host.aendere(`Bypass ${graph}`, [{ befehl: 'insert_an', insert_id: neu.id, an: false }]);
      if (neu) beiGetauscht?.(neu);
      return true;
    } finally { beschaeftigt = false; }
  };

  const ladeIr = async (wurzel, rel) => {
    zuMachen();
    host.melde('Loading and preparing the impulse response...', false);
    let r;
    try { r = await host.holeJson('/sampler/space_ir', { wurzel, rel }); } catch (e) { r = { status: 0, j: { text: e.message } }; }
    if (r.status !== 200 || typeof r.j?.graph !== 'string') { host.melde(`Impulse response not loaded: ${fehlerText(r)}`, true); return; }
    if (await tausche(r.j.graph)) host.melde(`Impulse response loaded: ${r.j.titel ?? r.j.graph}`, false);
  };

  // ---- the picker: roots, folders, files ----
  const zuMachen = () => { wahl?.remove(); wahl = null; kz.ownerDocument.removeEventListener('keydown', taste, true); };
  const taste = (e) => { if (e.key === 'Escape' && wahl) { e.stopPropagation(); zuMachen(); } };
  const zeichneWahl = (pk) => {
    if (wahl !== pk.el) return;
    const kopf = `<div class="fp-ir-kopf"><span>Impulse response: a file of a sample folder (up to 2 s are used)</span><button type="button" class="fp-knopf-klein" data-ir="zu">CLOSE</button></div>`;
    let inhalt;
    if (pk.wurzel === null) {
      inhalt = pk.wurzeln === null ? 'Reading...' : pk.wurzeln.length === 0 ? 'No sample folders yet: add one in the workbench shelf (SOURCES).'
        : pk.wurzeln.map((x) => `<div class="fp-ir-zeile" data-ir="wurzel" data-name="${esc(x.name)}">${esc(x.name)}${x.fehlt ? ' (not on disk)' : ''}</div>`).join('');
    } else {
      const krume = `<div class="fp-ir-zeile" data-ir="hoch">${esc(pk.wurzel)}${krumen(pk.ordner).map((k) => ` / ${esc(k.name)}`).join('')}  (up)</div>`;
      if (pk.antwort === null) inhalt = `${krume}Reading...`;
      else {
        const m = zeilenModell(pk.antwort);
        const z = m.zeilen.map((r) => (r.art === 'ordner' ? `<div class="fp-ir-zeile" data-ir="ordner" data-rel="${esc(r.rel)}">[${esc(r.name)}]</div>`
          : `<div class="fp-ir-zeile" data-ir="datei" data-rel="${esc(r.rel)}">${esc(r.name)} <span>${esc(r.groesse)}</span></div>`)).join('');
        inhalt = krume + (z === '' ? 'No audio files or folders here' : z) + (m.mehr ? '<div>More files than shown</div>' : '');
      }
    }
    pk.el.innerHTML = kopf + inhalt;
  };
  const holeWahl = async (pk) => {
    pk.antwort = null; zeichneWahl(pk);
    const r = await host.holeGet(pk.wurzel === null ? '/sampler/dateien' : listenUrl(pk.wurzel, pk.ordner, ''));
    if (wahl !== pk.el) return;
    if (r?.status !== 200) { host.melde(fehlerText(r), true); if (pk.wurzel === null) pk.wurzeln = []; else pk.antwort = { ordner: pk.ordner, ordner_liste: [], dateien: [] }; }
    else if (pk.wurzel === null) pk.wurzeln = Array.isArray(r.j?.wurzeln) ? r.j.wurzeln : [];
    else pk.antwort = r.j;
    zeichneWahl(pk);
  };
  const oeffneWahl = () => {
    if (wahl) { zuMachen(); return; }
    const el = kz.ownerDocument.createElement('div');
    el.className = 'fp-ir-wahl';
    zeile.after(el);
    wahl = el;
    kz.ownerDocument.addEventListener('keydown', taste, true);
    const pk = { el, wurzeln: null, wurzel: null, ordner: '', antwort: null };
    el.addEventListener('click', (e) => {
      const z = e.target.closest?.('[data-ir]');
      if (!z) return;
      const t = z.getAttribute('data-ir');
      if (t === 'zu') zuMachen();
      else if (t === 'wurzel') { pk.wurzel = z.getAttribute('data-name'); pk.ordner = ''; holeWahl(pk); }
      else if (t === 'ordner') { pk.ordner = z.getAttribute('data-rel'); holeWahl(pk); }
      else if (t === 'hoch') {
        if (pk.ordner !== '') pk.ordner = pk.ordner.split('/').slice(0, -1).join('/'); else { pk.wurzel = null; pk.wurzeln = null; }
        holeWahl(pk);
      } else if (t === 'datei') ladeIr(pk.wurzel, z.getAttribute('data-rel'));
    });
    holeWahl(pk);
  };

  sel.addEventListener('change', () => { tausche(sel.value).then((ok) => { if (!ok) { const s = stufe(); if (s) sel.value = s.insert.graph; } }); });
  zeile.querySelector('[data-fp-ir]').addEventListener('click', oeffneWahl);
  return { zerstoere() { zuMachen(); zeile.remove(); } };
}

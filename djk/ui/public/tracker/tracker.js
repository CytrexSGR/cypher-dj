// TRACKER view (plan 2026-11-18-tracker.md, task 2): the fifth view. An encapsulated module like the workbench (werkbank/werkbank.js): app.js calls
// bindeTracker() once and passes the view switch (zeige/verberge) and every message of /strom (ereignis). Unlike the workbench it shows ANY open
// project (no marker needed) and never closes or replaces one. The SONG column (song.js) writes the section and pattern commands; later tasks append to BINDER.
// ctx: like the workbench ctx (st, $, holeJson, holeGet, melde, lies, merke, beimProjekt, beimEreignis, vorBild, beimSichtwechsel, schreiber, aendere,
// aendereAus, undo, redo, kopfBeat, ladeAktuell, uebernimm) plus beimZeichnen (hooks of ctx.zeichne), beimTaste (key hooks of the grid, a hook returns
// true when it used the key), zeichne(), waehleAbschnitt(id), and from grid_view.js raster(), optionen(), setzeCursor(c).
import { neuerSchreiber } from '../production/writer.js';
import { neuerLader, neuerNachlader } from '../production/load.js';
import { nachladenNoetig } from '../production/stems.js';
import { antwortText, meldeNachSchreiben } from '../production/production.js';
import { kopfStand } from '../production/transport.js';
import { istTextFeld } from '../production/history_display.js';
import { Kopf } from '../wave.js';
import { abschnitte, rollenVonGraphen } from './grid_model.js';
import { bindeKopf } from './kopf.js';
import { bindeRaster } from './grid_view.js';
import { bindeBedienung } from './operation.js';
import { bindeSong } from './song.js';
import { bindeZuDj } from './zu_dj.js';
import { bindeRegal } from './regal.js';
import { bindeInstrumente } from './instruments.js';

export const TRACKER_TEXT = {
  keinProjekt: 'No project is open. Open or create one in PRODUCTION; the tracker shows whatever the server has open.',
};

// the order is the contract: the bar first, then the grid with its columns, then the keyboard (operation.js), then the SONG column (song.js); later tasks append
export const BINDER = [bindeKopf, bindeRaster, bindeBedienung, bindeSong, bindeZuDj, bindeRegal, bindeInstrumente];

// IMPORT MOD (task 26, import.js): the file button and the report line of a ProTracker import
import { bindeImport } from './import.js';
BINDER.push(bindeImport);

// NEW MODULE (task 22, neu.js): its own block, appended after the list above
import { bindeNeu } from './neu.js';
BINDER.push(bindeNeu);

const GERUEST = `
<div class="t-kopf" data-t="kopf" role="toolbar" aria-label="Tracker bar"></div>
<div class="t-regal" data-t="regal" hidden aria-label="Tracker modules"></div>
<div class="t-lied" data-t="lied" aria-label="Song"></div>
<div class="t-raster" data-t="raster" tabindex="0" role="grid" aria-label="Tracker grid"></div>
<div class="t-instr" data-t="instr" aria-label="Instruments"></div>
<div class="t-status" data-t="status" role="status" aria-live="off"></div>
<div class="t-meldung" data-t="meldung" role="status"></div>
<div class="t-leer" data-t="leer" aria-label="No project"></div>
`;

const lies = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
const merke = (k, v) => { try { localStorage.setItem(k, v); } catch { /* without storage: only now */ } };

export function bindeTracker({ post, wurzel = document.querySelector('#tracker'), frage = (t) => globalThis.confirm?.(t) ?? false, zeigeDj = () => {} }) {
  wurzel.innerHTML = GERUEST;
  const $ = (n) => wurzel.querySelector(`[data-t="${n}"]`);
  $('leer').textContent = TRACKER_TEXT.keinProjekt;
  const st = {
    slug: null, projekt: null, sichtbar: false, laeuft: false, arr: null,
    cursor: { spur: 0, spalte: 0, zeile: 0, unterspalte: 'note' }, abschnitt_id: null,
    zahlen: 'hex', spaltenAn: { vol: true, dly: false, chn: false, rpt: false, fx: true }, follow: true,
    audioAn: lies('djk-tr-audio', '1') !== 'zu',
  };
  let meldeUhr = null;
  function melde(text, fehler = false) {
    const m = $('meldung'); m.textContent = text; m.classList.toggle('fehler', fehler);
    clearTimeout(meldeUhr); meldeUhr = setTimeout(() => { m.textContent = ''; }, 6000); meldeUhr?.unref?.();
  }
  async function holeJson(weg, koerper) {
    try { const r = await post(weg, koerper); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }
    catch (e) { return { status: 0, j: { fehler: 'netz', text: e.message } }; }
  }
  async function holeGet(weg) {
    try { const r = await fetch(weg); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }
    catch (e) { return { status: 0, j: { fehler: 'netz', text: e.message } }; }
  }
  const kopf = new Kopf();
  let arrZeit = null;
  const ctx = {
    st, $, holeJson, holeGet, melde, lies, merke, antwortText, frage: (t) => frage(t), zeigeDj: () => zeigeDj(),
    beimProjekt: [], beimEreignis: [], vorBild: [], beimSichtwechsel: [], beimZeichnen: [], beimTaste: [],
  };
  // An overlay (menu, shelf, picker) closes on Escape and on a click beside it. `innen`: the elements a click does not close it from; `offen()`: is it open;
  // `ausnahme(e)`: a click that does not count as beside (the button that opens it). A click inside is marked on the event, because the click may redraw
  // (and detach) its target before the listener on the document sees it.
  ctx.beiAussen = (innen, offen, schliesse, ausnahme = () => false) => {
    const marke = Symbol('innen');
    for (const i of innen) i?.addEventListener('click', (e) => { e[marke] = true; });
    const klick = (e) => { if (offen() && !e[marke] && !innen.some((i) => i?.contains?.(e.target)) && !ausnahme(e)) schliesse(); };
    const taste = (e) => { if (e.key === 'Escape' && offen()) schliesse(); };
    for (const z of [wurzel, document]) { z.addEventListener('click', klick); z.addEventListener('keydown', taste); }
  };
  ctx.kopfBeat = (t = performance.now()) => kopfStand({ arr: st.arr, arrZeit, t, hochrechne: (x) => kopf.beat(x), loop: st.projekt?.loop }).kopfBeat;
  ctx.zeichne = () => {
    const t0 = performance.now();
    for (const h of ctx.beimZeichnen) h();
    try { performance.measure('tracker-zeichne-alle', { start: t0, end: performance.now() }); } catch { /* no timeline */ }   // the whole draw, for the measuring
  };

  // the selected section: kept while it exists, else the first one (D10: ids a1, a2, ...)
  const pruefeAbschnitt = () => {
    const ids = st.projekt ? abschnitte(st.projekt).map((a) => a.id) : [];
    if (!ids.includes(st.abschnitt_id)) st.abschnitt_id = ids[0] ?? null;
  };
  ctx.waehleAbschnitt = (id) => {
    if (!st.projekt || id === st.abschnitt_id || !abschnitte(st.projekt).some((a) => a.id === id)) return;
    st.abschnitt_id = id;
    ctx.zeichne();
  };

  function setzeProjekt(slug, p) {
    if (p && slug !== null && slug === st.slug && st.projekt && p.rev < st.projekt.rev) return;   // an older state of the same project is dropped
    const wechsel = slug !== st.slug;
    st.slug = p ? slug : null; st.projekt = p ?? null;
    if (p) ctx.schreiber.setze(slug, p.rev);
    if (wechsel) { st.abschnitt_id = null; st.cursor = { spur: 0, spalte: 0, zeile: 0, unterspalte: 'note' }; }
    pruefeAbschnitt();
    for (const n of ['kopf', 'lied', 'raster', 'instr', 'status']) $(n).hidden = !p;
    $('leer').hidden = !!p;
    for (const h of ctx.beimProjekt) h(st.projekt, wechsel);
    ctx.zeichne();
  }
  ctx.uebernimm = (slug, p) => setzeProjekt(slug, p);

  const ladeRoh = neuerLader({
    hole: () => holeGet('/proj/aktuell'),
    uebernimm: (slug, p) => ctx.uebernimm(slug, p),
    leere: () => setzeProjekt(null, null),
    beiWeg: (r) => melde(antwortText(r), true),
    beiDa: () => {},
  });
  const nachlader = neuerNachlader(ladeRoh, 30);
  ctx.ladeAktuell = nachlader.starte;

  // Writer: one after another, every request with the last known rev; a rev_veraltet answer reloads (same rule as PRODUCTION and the workbench).
  ctx.schreiber = neuerSchreiber({
    holeJson,
    beiProjekt: (slug, p, rev, j) => { ctx.uebernimm(slug, p); meldeNachSchreiben(j, melde); },
    beiFehler: (a, r) => {
      melde(antwortText(r), true);
      if (r.status === 409 && r.j?.fehler === 'rev_veraltet') return ctx.ladeAktuell();
    },
    beiWiederhole: async () => { nachlader.starte(); await nachlader.fertig(); },
    beiFremdeRev: () => nachlader.plane(),
    beiVerworfen: (n) => melde(`The project changed elsewhere: reloaded, ${n} waiting change${n === 1 ? '' : 's'} dropped, please repeat`, true),
  });
  ctx.aendere = (label, befehle, schluessel, optionen) => (st.projekt ? ctx.schreiber.aendere(label, befehle, schluessel, optionen) : Promise.resolve(false));
  ctx.aendereAus = (rechne) => {
    const slug = st.slug;
    return ctx.schreiber.aendereMit(() => {
      const p = st.projekt;
      if (!p || st.slug !== slug) return null;
      const x = rechne(p);
      return x ? { ...x, rev: p.rev } : null;
    });
  };
  ctx.undo = () => (st.projekt ? ctx.schreiber.undo() : Promise.resolve(false));
  ctx.redo = () => (st.projekt ? ctx.schreiber.redo() : Promise.resolve(false));

  for (const binde of BINDER) binde(ctx);

  // undo / redo while the view is shown (outside text fields), like the workbench
  document.addEventListener('keydown', (e) => {
    if (!st.sichtbar || !st.projekt || istTextFeld(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key).toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); ctx.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); ctx.redo(); }
  });

  function bild() {
    if (!st.sichtbar) { st.laeuft = false; return; }
    const t0 = performance.now();
    for (const h of ctx.vorBild) h(t0);
    requestAnimationFrame(bild);
  }
  // the roles of the devices (INS column, OFS and REV hints) come from the device register through GET /graphen
  ctx.rollenVon = rollenVonGraphen(null);
  async function ladeRollen() {
    const r = await holeGet('/graphen');
    if (r.status !== 200) return;
    ctx.rollenVon = rollenVonGraphen(r.j?.graphen);
    ctx.zeichne();
  }
  function zeige() {
    st.sichtbar = true;
    ladeRollen();
    for (const h of ctx.beimSichtwechsel) h(true);
    ctx.ladeAktuell();
    if (!st.laeuft) { st.laeuft = true; requestAnimationFrame(bild); }
  }
  function verberge() { st.sichtbar = false; for (const h of ctx.beimSichtwechsel) h(false); }
  let standN = 0;
  function ereignis(a, f) {
    if (a === '/zustand/arr') { st.arr = f; arrZeit = performance.now(); kopf.melde(Number(f.projekt_beat), st.projekt?.tempo_bpm ?? 120, arrZeit, f.status === 2); }
    // the first state of the stream comes at every (re)connect: after an outage fetch the project again
    if (a === 'stand') { standN++; if (st.sichtbar && standN > 1) nachlader.plane(); }
    // our own change arrives as SSE before the HTTP answer: no reload for it (the answer carries the state)
    if (nachladenNoetig(a, f, { sichtbar: st.sichtbar, slug: st.slug, rev: st.projekt?.rev, eigene: ctx.schreiber.istEigeneRev })) nachlader.plane();
    for (const h of ctx.beimEreignis) h(a, f);
  }
  setzeProjekt(null, null);
  return { zeige, verberge, ereignis, ctx };
}

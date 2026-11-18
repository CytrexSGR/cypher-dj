// Workbench view (stage 1, plan 2026-11-15-werkbank-stage1.md, D4, D5, D15): the fourth view STUDIO. An encapsulated module like PRODUCTION
// (production/production.js): app.js calls bindeWerkbank() once and passes the view switch (zeige/verberge) and every message of /strom (ereignis).
// The view has its own small context (writer, loader, hooks) and five region binders that dock only through ctx; it edits the project the server has
// open, and only when that project is a module (marker werkbank: {schema: 1}). It never closes or replaces a project on its own: opening or creating
// a module is a click of the person, through the live-container confirmation. UI texts English.
import { neuerSchreiber } from '../production/writer.js';
import { neuerLader, neuerNachlader } from '../production/load.js';
import { nachladenNoetig } from '../production/stems.js';
import { mitBestaetigung } from '../production/project_choice.js';
import { antwortText, meldeNachSchreiben } from '../production/production.js';
import { kopfStand } from '../production/transport.js';
import { istTextFeld } from '../production/history_display.js';
import { Kopf } from '../wave.js';
import { bindeKopf } from './kopf.js';
import { bindeRegal, bindeRegalSchublade } from './regal.js';
import { bindeSpuren } from './tracks.js';
import { bindeRaster } from './grid_view.js';
import { bindeKlang } from './sound.js';
import { bindeSchnittKit } from './schnitt_kit.js';
import { bindeFenster } from './window.js';
import { bindeDock } from './dock.js';
import { bindeExport } from './export.js';
import { bindeZuSeq } from './zu_seq.js';
import { bindeAnalyse } from './analysis.js';
import { bindeKlangRunde } from './sound_runde.js';
import { fokus } from '../controller_fokus.js';

export const WERKBANK_TEXT = {
  keinModul: 'No module is open.',
  keinWerkbank: 'The open project is not a module. Open a module or create one; the open project stays open until you do.',
  tempoBereich: 'Tempo: 60 to 200 BPM',
  neuerName: 'Module name, Enter',
  oeffnen: 'Open module…',
  leeresModul: '+ empty module',
};

export const istModul = (p) => p?.werkbank?.schema === 1;

// The order is the contract (D15): top bar, shelf, tracks, notes, sound plumbing (panel source, faces, cut strip), the cut/kit dialog, the windows, the dock.
// EXPORT, then TO SEQ DECK, then ANALYZE, then FIND SOUND, then the SHELF button append their controls to the top bar in this order (the dock and the windows use what sound.js puts on ctx).
const BINDER = [bindeKopf, bindeRegal, bindeSpuren, bindeRaster, bindeKlang, bindeSchnittKit, bindeFenster, bindeDock, bindeExport, bindeZuSeq, bindeAnalyse, bindeKlangRunde, bindeRegalSchublade];

const GERUEST = `
<div class="w-kopf" data-w="kopf" role="toolbar" aria-label="Workbench"></div>
<div class="w-pan w-spuren" data-w="spuren" aria-label="Tracks"></div>
<div class="w-pan w-noten" data-w="noten" aria-label="Notes"></div>
<div class="w-pan w-dock" data-w="dock" aria-label="Device dock"></div>
<div class="w-klang" data-w="klang" aria-label="Sound" hidden></div>
<div class="w-fenster-flaeche" data-w="fenster-flaeche"></div>
<div class="w-pan w-leer" data-w="leer" aria-label="No module"></div>
<div class="w-pan w-regal" data-w="regal" aria-label="Shelf"></div>
<div class="w-meldung" data-w="meldung" role="status"></div>
`;

const lies = (k, v) => { try { return localStorage.getItem(k) ?? v; } catch { return v; } };
const merke = (k, v) => { try { localStorage.setItem(k, v); } catch { /* without storage: only now */ } };

export function bindeWerkbank({ post, wurzel = document.querySelector('#werkbank'), frage = (t) => globalThis.confirm?.(t) ?? false, zeigeDj = () => {} }) {
  wurzel.innerHTML = GERUEST;
  const $ = (n) => wurzel.querySelector(`[data-w="${n}"]`);
  // projekt: the open module or null; fremd: a project that is no module is open (the empty state says so, nothing is written to it)
  const st = { slug: null, projekt: null, fremd: false, sichtbar: false, laeuft: false, wahl: null, arr: null };
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
    beimProjekt: [], beimEreignis: [], vorBild: [], beiWahl: [], beimSichtwechsel: [],
    info: () => null,   // task 4 (bindeSpuren) replaces it with the instrument info cache
  };
  ctx.kopfBeat = (t = performance.now()) => kopfStand({ arr: st.arr, arrZeit, t, hochrechne: (x) => kopf.beat(x), loop: st.projekt?.loop }).kopfBeat;

  // Track selection: remembered per module, the first instrument track by default; a vanished track falls back to the default.
  const pruefeWahl = (wechsel) => {
    const ids = (st.projekt?.spuren ?? []).filter((s) => s.art === 'instrument').map((s) => s.id);
    if (!wechsel && ids.includes(st.wahl)) return false;
    const gemerkt = st.slug ? lies(`djk-wb-wahl-${st.slug}`, null) : null;
    const neu = ids.includes(gemerkt) ? gemerkt : ids[0] ?? null;
    if (neu === st.wahl) return false;
    st.wahl = neu;
    return true;
  };
  ctx.waehle = (spurId) => {
    st.wahl = spurId;
    if (st.slug) merke(`djk-wb-wahl-${st.slug}`, String(spurId));
    for (const h of ctx.beiWahl) h(spurId);
  };

  // Controller follow: the selected instrument track is the synth in front while this view is shown (ctx.waehle and a track that fell back both end in beiWahl).
  ctx.beiWahl.push((spurId) => { if (st.sichtbar && spurId) fokus.melde({ spur_id: spurId }, 'werkbank'); });
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar && st.wahl) fokus.melde({ spur_id: st.wahl }, 'werkbank'); });
  fokus.registriere('werkbank', () => (st.sichtbar && st.wahl ? { spur_id: st.wahl } : null));   // window focus

  function setzeProjekt(slug, p) {
    const modul = istModul(p);
    if (modul && slug !== null && slug === st.slug && st.projekt && p.rev < st.projekt.rev) return;   // an older state of the same module is dropped
    const neuerSlug = modul ? slug : null;
    const wechsel = neuerSlug !== st.slug;
    st.slug = neuerSlug; st.projekt = modul ? p : null; st.fremd = !!p && !modul;
    if (modul) ctx.schreiber.setze(slug, p.rev);
    for (const n of ['spuren', 'noten', 'dock']) $(n).hidden = !modul;
    $('leer').hidden = modul;
    const wahlNeu = pruefeWahl(wechsel);
    for (const h of ctx.beimProjekt) h(st.projekt, wechsel);
    if (wahlNeu) for (const h of ctx.beiWahl) h(st.wahl);
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

  // Writer: one after another, every request with the last known rev; a rev_veraltet answer reloads (same rule as PRODUCTION).
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
  // Nothing is ever written to a project that is no module (or to none): the writes of the regions refuse here, not in each region.
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

  // Open or create a module: Andreas' click, through the confirmation of the live container; "no" sends nothing more (D5, review focus 1).
  async function ueber(weg, koerper) {
    const r = await mitBestaetigung(holeJson, weg, koerper, (t) => ctx.frage(t));
    if (r.abgelehnt) return false;
    if (r.status === 200 && r.j?.projekt) { ctx.uebernimm(r.j.slug, r.j.projekt); return true; }
    melde(antwortText(r), true);
    return false;
  }
  ctx.oeffneModul = (slug) => ueber('/proj/oeffnen', { slug });
  ctx.neuesModul = ({ name, vorlage }) => ueber('/proj/neu', { name, werkbank: true, ...(vorlage ? { vorlage } : {}) });

  for (const binde of BINDER) binde(ctx);

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
  function zeige() {
    st.sichtbar = true;
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

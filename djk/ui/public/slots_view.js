// Places and mixer wiring: layout, places, loops lock.
import { ladeLayout, wendeAn, wendeMixerAn, wendeStudioZuegeAn, kopf as platzKopf, still, wahl, zielName, wechsel, speichereLayout, folgeServer, PLAETZE } from './slots.js';
import { aktuellesZiel, typSperre } from './remix_platz.js';
import { modulAnsicht } from './live_module.js';   // live modules task 4
import { DECKS } from './curves.js';
import { $, $$, melde, zustand } from './page_state.js';
import { remixFenster } from './effects_gemeinsam.js';
import { zeigeRemix } from './remix_window.js';
import { graphenGeladen } from './graphs_view.js';
import { eintragVon } from './deck_view.js';
import { live, zeigeExport } from './live_view.js';
import { loopImportLaeuft } from './browse_table.js';
import { ladeMini, speichereMini, ordneSpalten, wendeMiniAn, umschalten } from './platz_mini.js';
import { seqAnsicht } from './seq_field.js';
import { zeichneSeq, ordneSeqStudio } from './seq_view.js';

// ---------- DJ view places (plan 2026-11-13 tasks 13, 14): four cells, each shows Track (deck N), Strudel or Loops ----------
// The layout lives in the browser (slots.js: key djk-plaetze, try/catch). A place switches only while silent (every channel of the place closed, PFL off);
// the core is never touched by a switch: a hidden deck keeps playing and shows unchanged when its place returns.
const speicherOderNull = () => { try { return localStorage; } catch { return null; } };
let plaetzeLayout = ladeLayout(speicherOderNull());
let platzMini = ladeMini(speicherOderNull());
export const aktuellesLayout = () => plaetzeLayout;
const PLATZ_KNOTEN = { strudel: '#deck-c', loops: '#platz-loops', remix: '#platz-remix' };
const platzKnoten = (key) => (key.startsWith('deck/') ? $(`.deck[data-deck="${key.slice(5)}"]`) : key.startsWith('seq/') ? $(`section.seqplatz[data-seq="${key.slice(4)}"]`) : $(PLATZ_KNOTEN[key]));
function zugKnoten(key) {
  const [, art, nr] = key.split('/');
  return $(art === 'deck' ? `.zug[data-deck="${nr}"]` : `.zug[data-boxzug="${nr}"]`);
}
const knotenAmPlatz = (p) => $(`#pult [data-platz="${p}"]`);
const alleKnoten = () => [...$$('#pult .deck'), $('#deck-c'), $('#platz-loops'), $('#platz-remix'), ...$$('#pult .seqplatz')];
const zeigeMini = () => wendeMiniAn($, plaetzeLayout, platzMini, knotenAmPlatz, alleKnoten());
// The Studio view: the deck strip of every SEQ place joins the strip row after L2 (the node moves, it is not copied)
function ordneStudioZuege() {
  for (const key of wendeStudioZuegeAn(plaetzeLayout, zugKnoten)) $('#mischer-unten').append(zugKnoten(key));
}
function wendePlaetzeAn() {
  wendeAn(plaetzeLayout, platzKnoten);
  ordneSeqStudio(plaetzeLayout);   // the Studio view places the SEQ nodes by their order
  ordneSpalten($, knotenAmPlatz);
  zeigeMini();
  ordneStudioZuege();
  const mix = wendeMixerAn(plaetzeLayout, zugKnoten);   // the mixer strips follow the places (only attributes change)
  $('#pult').dataset.mixAussen = mix.spalten.aussen;      // which outer strip columns the grid needs
  for (const [sel, zeile] of [['#mischer .mitte', '1'], ['#fxmitte', '2']]) { const e = $(sel); if (e) { e.dataset.mixSpalte = String(mix.spalten.mitte); e.dataset.mixZeile = zeile; } }
  zeigeLoopsSperre();
  zeigePlaetze();
  zeichneSeq();
  if (remixFenster) { const r = $('#platz-remix'); r.hidden = false; r.classList.remove('platz-aus'); }   // the Remix window shows the plate, whatever the stored layout says
  zeigeRemix();
}
function platzZustand(platz) {
  const typ = plaetzeLayout[platz - 1];
  if (typ === 'loops') {
    const a = modulAnsicht(live.projekt, live.stand, live.stems, zustand.regler);
    return { typ, slots: a.offen ? a.slots.filter((s) => !s.leer).map((s) => ({ nr: s.kanal.nr, titel: s.titel, tonart: s.tonart, takte: Number.isFinite(s.beats) ? Math.round(s.beats / 4 * 100) / 100 : undefined })) : [] };
  }
  if (typ === 'remix') return { typ, ziel: aktuellesZiel(graphenGeladen) };
  if (typ === 'seq') { const a = seqAnsicht(live.projekt, platz); return { typ, folgen: a.vorhanden ? a.folgen.length : undefined }; }
  if (typ !== 'track') return { typ };
  const n = platz, z = zustand.decks[n], id = z?.material_id ?? zustand.geladen[n], e = id ? eintragVon(id) : null;
  if (!id) return { typ };
  const g = z ?? zustand.geladenFelder?.[n] ?? e;
  return { typ, titel: e?.titel ?? id, tonart: e?.camelot, bpm: Number(g?.basis_bpm ?? e?.basis_bpm) };
}
// The page follows the server (slots.js folgeServer): a place that holds a SEQ deck but is not typed SEQ turns SEQ as soon as it is silent. Called at the start of
// zeigePlaetze, which runs whenever the live project, a fader or a PFL changes, so a place that is open now switches the moment it is closed. Before the core's
// first state arrived (zustand.regler empty) no verdict is given: the silence rule would count every fader closed. Returns true when the layout changed.
let plaetzeGebunden = false;
const hatDeck = (platz) => seqAnsicht(live.projekt, platz).vorhanden;
function folgeDemServer() {
  if (!plaetzeGebunden || !live.projekt) return false;
  const r = folgeServer(plaetzeLayout, PLAETZE.filter(hatDeck), (platz, layout) => (Object.keys(zustand.regler).length === 0 ? null : still(layout, platz, zustand.regler)));
  if (r.gewechselt.length === 0) return false;
  plaetzeLayout = r.layout;
  speichereLayout(speicherOderNull(), plaetzeLayout);
  for (const platz of r.gewechselt) melde(`Place ${platz} shows its SEQ deck`);
  wendePlaetzeAn();
  return true;
}
export function zeigePlaetze() {
  if (folgeDemServer()) return;   // the layout changed: wendePlaetzeAn has shown the places already
  for (const platz of PLAETZE) {
    const k = $(`.platzkopf[data-platz-kopf="${platz}"]`);
    if (!k) continue;
    $('[data-platz-text]', k).textContent = platzKopf(platz, platzZustand(platz));
    const s = still(plaetzeLayout, platz, zustand.regler);
    const sp = plaetzeLayout[platz - 1] === 'remix' ? typSperre(graphenGeladen) : { gesperrt: false, text: '' };   // the device on a target pins the place to REMIX
    const belegt = plaetzeLayout[platz - 1] === 'seq' && seqAnsicht(live.projekt, platz).vorhanden;   // a SEQ place holds its deck: clear it first
    const deckDa = plaetzeLayout[platz - 1] !== 'seq' && !s.still && hatDeck(platz);   // the server holds a SEQ deck here that this place does not show yet
    $('[data-platz-hinweis]', k).textContent = sp.gesperrt ? sp.text : belegt ? 'clear the SEQ deck to switch' : deckDa ? `SEQ deck on deck/${platz}: close this place to show it` : s.still ? '' : `${s.text}: close it to switch`;
    for (const w of wahl(plaetzeLayout, platz)) {
      const b = $(`[data-platz-typ="${w.typ}"]`, k);
      b.classList.toggle('an', w.aktuell);
      b.setAttribute('aria-pressed', String(w.aktuell));
      b.disabled = !w.aktuell && (!w.frei || !s.still || sp.gesperrt);
      if (belegt && !w.aktuell) b.disabled = true;
      b.title = w.aktuell ? `Place ${platz} shows ${w.typ}` : belegt ? 'Clear the SEQ deck of this place first' : sp.gesperrt ? sp.text : !w.frei ? `${w.typ} is already shown in another place` : !s.still ? `Not silent: ${s.text}` : `Show ${w.typ} here`;
    }
  }
}
// EXPORT and the library's load buttons need a Loops place; without one they are disabled with the hint (Cypher's tools export regardless of the layout)
export const HINWEIS_LOOPS = 'switch a place to LOOPS';
export const loopsPlatzDa = () => plaetzeLayout.includes('loops');
function zeigeLoopsSperre() {
  const da = loopsPlatzDa();
  for (const b of $$('#loopliste button.laden')) {
    b.disabled = !da || b.closest('tr')?.classList.contains('defekt') === true;
    b.title = da ? (b.dataset.titel0 ?? '') : HINWEIS_LOOPS;
  }
  for (const b of $$('button.in-box')) {
    b.disabled = !da || loopImportLaeuft || b.dataset.ok !== '1';
    b.title = da ? (b.dataset.titel0 ?? '') : HINWEIS_LOOPS;
  }
  for (const n of DECKS) zeigeExport(n);
}
export const zielNameVon = (k) => zielName(k);
let plaetzeFrist = 0;
export function zeigePlaetzeSpaeter() { if (!plaetzeFrist) plaetzeFrist = requestAnimationFrame(() => { plaetzeFrist = 0; zeigePlaetze(); }); }
export function bindePlaetze() {
  for (const k of $$('.platzkopf')) {
    const platz = Number(k.dataset.platzKopf);
    for (const b of $$('[data-platz-typ]', k)) b.addEventListener('click', () => {
      if (plaetzeLayout[platz - 1] === 'remix' && b.dataset.platzTyp !== 'remix' && typSperre(graphenGeladen).gesperrt) { melde(`Place ${platz}: ${typSperre(graphenGeladen).text}`, true); zeigePlaetze(); return; }
      const r = wechsel(plaetzeLayout, platz, b.dataset.platzTyp, still(plaetzeLayout, platz, zustand.regler), seqAnsicht(live.projekt, platz).vorhanden);
      if (!r.ok) { melde(`Place ${platz}: ${r.grund === 'offen' ? `not silent, ${r.text}` : r.grund === 'doppelt' ? `${b.dataset.platzTyp} is already shown` : r.grund === 'belegt' ? 'clear the SEQ deck first' : r.grund}`, true); zeigePlaetze(); return; }
      plaetzeLayout = r.layout;
      speichereLayout(speicherOderNull(), plaetzeLayout);
      wendePlaetzeAn();
    });
  }
  for (const k of $$('.platzkopf')) {   // MINI in the head, or a double click on the head text, folds a Track place
    const platz = Number(k.dataset.platzKopf);
    const falte = () => {
      if (plaetzeLayout[platz - 1] !== 'track') return;
      platzMini = umschalten(platzMini, platz);
      speichereMini(speicherOderNull(), platzMini);
      zeigeMini();
    };
    $('[data-platz-mini]', k)?.addEventListener('click', falte);
    $('[data-platz-text]', k)?.addEventListener('dblclick', falte);
  }
  plaetzeGebunden = true;
  wendePlaetzeAn();
}

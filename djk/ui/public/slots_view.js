// Places and mixer wiring: layout, places, loops lock.
import { ladeLayout, ladeDeckDa, wendeAn, wendeMixerAn, wendeStudioZuegeAn, kopf as platzKopf, still, wahl, zielName, wechsel, speichereLayout, folgeServer, loopPlatzAbweichung, zugKopf, platzKanalInhalt, PLAETZE } from './slots.js';
import { aktuellesZiel, typSperre } from './remix_platz.js';
import { DECKS } from './curves.js';
import { $, $$, melde, zustand } from './page_state.js';
import { remixFenster } from './effects_gemeinsam.js';
import { zeigeRemix } from './remix_window.js';
import { graphenGeladen } from './graphs_view.js';
import { eintragVon } from './deck_view.js';
import { live, zeigeExport, arrBeat, holeJson } from './live_view.js';
import { loopImportLaeuft } from './browse_table.js';
import { ladeMini, speichereMini, ordneSpalten, wendeMiniAn, umschalten } from './platz_mini.js';
import { seqAnsicht, deckGruppe, msBisTakt } from './seq_field.js';
import { proTaktJetzt } from './bar_live.js';
import { zeichneSeq, ordneSeqStudio } from './seq_view.js';
import { zeigeLoopdecks } from './loopdeck/view.js';

// ---------- DJ view places (plan 2026-11-13 tasks 13, 14): four cells, each shows Track (deck N), Strudel, Loop deck 1 or Loop deck 2 or SEQ ----------
// The layout lives in the browser (slots.js: key djk-plaetze, try/catch). A place switches only while silent (every channel of the place closed, PFL off);
// the core is never touched by a switch: a hidden deck keeps playing and shows unchanged when its place returns.
const speicherOderNull = () => { try { return localStorage; } catch { return null; } };
let plaetzeLayout = ladeLayout(speicherOderNull());
let platzMini = ladeMini(speicherOderNull());
export const aktuellesLayout = () => plaetzeLayout;
const PLATZ_KNOTEN = { strudel: '#deck-c', loops: '#platz-loops', loops2: '#platz-loops2', remix: '#platz-remix' };
const platzKnoten = (key) => (key.startsWith('deck/') ? $(`.deck[data-deck="${key.slice(5)}"]`) : key.startsWith('seq/') ? $(`section.seqplatz[data-seq="${key.slice(4)}"]`) : $(PLATZ_KNOTEN[key]));
function zugKnoten(key) {
  const [, art, nr] = key.split('/');
  return $(art === 'deck' ? `.zug[data-deck="${nr}"]` : `.zug[data-boxzug="${nr}"]`);
}
const knotenAmPlatz = (p) => $(`#pult [data-platz="${p}"]`);
const alleKnoten = () => [...$$('#pult .deck'), $('#deck-c'), $('#platz-loops'), $('#platz-loops2'), $('#platz-remix'), ...$$('#pult .seqplatz')];
const zeigeMini = () => wendeMiniAn($, plaetzeLayout, platzMini, knotenAmPlatz, alleKnoten());
// The Studio view: the deck strip of every SEQ place joins the strip row after L2 (the node moves, it is not copied)
function ordneStudioZuege() {
  for (const key of wendeStudioZuegeAn(plaetzeLayout, zugKnoten)) $('#mischer-unten').append(zugKnoten(key));
}
// The faders belong to the places: the loop decks of the live project sound on the channel of the place that shows them (POST /loopdeck/plaetze, both
// decks in one undo step). Called after every place change and whenever the live project is drawn; it only writes when a deck sounds elsewhere. A refused
// request is not repeated until the project revision moves (the key), so a refusal does not become a request storm.
let loopPlatzSchluessel = '';
async function gleicheLoopPlaetzeAb() {
  if (!plaetzeGebunden || !live.projekt?.live) return;
  const body = loopPlatzAbweichung(plaetzeLayout, live.projekt);
  if (!body) { loopPlatzSchluessel = ''; return; }
  const schluessel = `${live.rev}:${JSON.stringify(body)}`;
  if (schluessel === loopPlatzSchluessel) return;
  loopPlatzSchluessel = schluessel;
  const r = await holeJson('/loopdeck/plaetze', { platz: body });
  if (r.status !== 200 || r.j.ok === false) melde(`Loop deck output: ${r.j.text ?? r.j.fehler ?? r.j.grund ?? `refused (${r.status})`}`, true);
}
// The strip heads name the loop deck that sounds on the strip ("L2 · LOOP 1")
function zeigeZugKoepfe() {
  for (const [art, nr] of [['deck', 1], ['deck', 2], ['pad', 1], ['pad', 2]]) {
    const k = $(`.zug[${art === 'deck' ? 'data-deck' : 'data-boxzug'}="${nr}"] .zugname`);
    if (k) k.textContent = zugKopf(plaetzeLayout, art, nr);
  }
}
// Place channel: report the content of places 3/4 to the server (thin pass-through to the kern), only what changed since the last report
let platzKanalGemeldet = [null, null];
export function meldePlatzKanal() {
  platzKanalInhalt(plaetzeLayout).forEach((inhalt, i) => {
    if (platzKanalGemeldet[i] === inhalt) return;
    platzKanalGemeldet[i] = inhalt;
    fetch('/platz/kanal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: i + 1, inhalt }) })
      .then((r) => { if (!r.ok) platzKanalGemeldet[i] = null; }).catch(() => { platzKanalGemeldet[i] = null; });   // retried at the next change
  });
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
  zeigeZugKoepfe();
  zeigeLoopsSperre();
  zeigePlaetze();
  zeichneSeq();
  zeigeLoopdecks();   // a loop deck place shows: read its stand, create the deck when it does not exist yet
  if (remixFenster) { const r = $('#platz-remix'); r.hidden = false; r.classList.remove('platz-aus'); }   // the Remix window shows the plate, whatever the stored layout says
  zeigeRemix();
  meldePlatzKanal();
}
function platzZustand(platz) {
  const typ = plaetzeLayout[platz - 1];
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
// A deck the page turns its place to SEQ for: one whose group is not muted. A muted (parked) deck stays where the place was switched away from it.
const deckAktiv = (platz) => hatDeck(platz) && deckGruppe(live.projekt, platz)?.mute !== true;
function folgeDemServer() {
  if (!plaetzeGebunden || !live.projekt) return false;
  const r = folgeServer(plaetzeLayout, PLAETZE.filter(deckAktiv), (platz, layout) => (Object.keys(zustand.regler).length === 0 ? null : still(layout, platz, zustand.regler)));
  if (r.gewechselt.length === 0) return false;
  plaetzeLayout = r.layout;
  speichereLayout(speicherOderNull(), plaetzeLayout);
  for (const platz of r.gewechselt) melde(`Place ${platz} shows its SEQ deck`);
  wendePlaetzeAn();
  return true;
}
export function zeigePlaetze() {
  if (folgeDemServer()) return;   // the layout changed: wendePlaetzeAn has shown the places already
  gleicheLoopPlaetzeAb();   // also after the live project arrives or changes
  zeigeLadeSperre();
  for (const platz of PLAETZE) {
    const k = $(`.platzkopf[data-platz-kopf="${platz}"]`);
    if (!k) continue;
    $('[data-platz-text]', k).textContent = platzKopf(platz, platzZustand(platz));
    const s = still(plaetzeLayout, platz, zustand.regler);
    const sp = plaetzeLayout[platz - 1] === 'remix' ? typSperre(graphenGeladen) : { gesperrt: false, text: '' };   // the device on a target pins the place to REMIX
    const belegt = plaetzeLayout[platz - 1] === 'seq' && seqAnsicht(live.projekt, platz).vorhanden;   // a switch away parks the deck (mutes its group)
    const deckDa = plaetzeLayout[platz - 1] !== 'seq' && !s.still && deckAktiv(platz);   // the server holds a playing SEQ deck here that this place does not show yet
    $('[data-platz-hinweis]', k).textContent = sp.gesperrt ? sp.text : deckDa ? `SEQ deck on deck/${platz}: close this place to show it` : s.still || belegt ? '' : `${s.text}: close it to switch`;
    for (const w of wahl(plaetzeLayout, platz)) {
      const b = $(`[data-platz-typ="${w.typ}"]`, k);
      b.classList.toggle('an', w.aktuell);
      b.setAttribute('aria-pressed', String(w.aktuell));
      b.disabled = !w.aktuell && (!w.frei || (!s.still && !belegt) || sp.gesperrt);
      b.title = w.aktuell ? `Place ${platz} shows ${w.typ}` : sp.gesperrt ? sp.text : !w.frei ? `${w.typ} is already shown in another place`
        : belegt ? `Show ${w.typ} here: the SEQ deck is muted on the next bar and kept, SEQ shows it again` : !s.still ? `Not silent: ${s.text}` : `Show ${w.typ} here`;
    }
  }
}
// The library's load buttons and the deck export need no Loops place (they load through /loopdeck/laden); only the busy state of the imports is shown here
function zeigeLoopsSperre() {
  for (const b of $$('button.in-box')) {
    b.disabled = loopImportLaeuft || b.dataset.ok !== '1';   // the library buttons load through /loopdeck/laden: no place needed (loop deck P3)
    b.title = b.dataset.titel0 ?? '';
  }
  for (const n of DECKS) zeigeExport(n);
}
// The LOAD buttons exist for four decks (every creation site sets data-deck); a deck whose place is not a Track place cannot be loaded: disabled with a hint, not hidden
export const hinweisTrack = (deck) => `LOAD is off: switch place ${deck} to TRACK`;
function zeigeLadeSperre() {
  for (const b of $$('button.laden[data-deck]')) {
    const n = Number(b.dataset.deck), da = ladeDeckDa(plaetzeLayout, n);
    b.disabled = !da;
    b.title = da ? '' : hinweisTrack(n);
  }
}
export const zielNameVon = (k) => zielName(k);
let plaetzeFrist = 0;
export function zeigePlaetzeSpaeter() { if (!plaetzeFrist) plaetzeFrist = requestAnimationFrame(() => { plaetzeFrist = 0; zeigePlaetze(); }); }
// Parks the SEQ deck of a place that switches away: its group is muted in the live container (one write, POST /proj/aendern). True when it is muted now.
async function parkeDeck(platz) {
  const g = deckGruppe(live.projekt, platz);
  if (!g || g.mute) return true;
  const ms = msBisTakt(arrBeat(performance.now()), proTaktJetzt(), live.projekt?.tempo_bpm);   // a playing deck leaves on the bar, not mid-phrase
  if (ms !== null) await new Promise((r) => setTimeout(r, ms));
  try {
    const r = await fetch('/proj/aendern', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rev: live.rev, label: `SEQ ${platz}: park`, befehle: [{ befehl: 'gruppenspur_aendern', gruppe_id: g.id, mute: true }] }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 200 && j.projekt) { live.projekt = j.projekt; live.rev = j.rev ?? j.projekt.rev; melde(`SEQ ${platz} parked: muted and kept, SEQ shows it again`); return true; }
    melde(`Place ${platz}: the SEQ deck could not be muted (${j.text ?? j.fehler ?? r.status})`, true);
  } catch (e) { melde(`Place ${platz}: the SEQ deck could not be muted (${e.message})`, true); }
  return false;
}
export function bindePlaetze() {
  for (const k of $$('.platzkopf')) {
    const platz = Number(k.dataset.platzKopf);
    for (const b of $$('[data-platz-typ]', k)) b.addEventListener('click', async () => {
      if (plaetzeLayout[platz - 1] === 'remix' && b.dataset.platzTyp !== 'remix' && typSperre(graphenGeladen).gesperrt) { melde(`Place ${platz}: ${typSperre(graphenGeladen).text}`, true); zeigePlaetze(); return; }
      const r = wechsel(plaetzeLayout, platz, b.dataset.platzTyp, still(plaetzeLayout, platz, zustand.regler), seqAnsicht(live.projekt, platz).vorhanden);
      if (!r.ok) { melde(`Place ${platz}: ${r.grund === 'offen' ? `not silent, ${r.text}` : r.grund === 'doppelt' ? `${b.dataset.platzTyp} is already shown` : r.grund}`, true); zeigePlaetze(); return; }
      if (r.parken && !(await parkeDeck(platz))) { zeigePlaetze(); return; }
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

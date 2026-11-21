// Places wiring (container core, lane U, U3): the four places come from GET /lage (`plaetze`, `container`) and change only with POST /plaetze.
// The page keeps no layout: no browser storage, no channel report, no crossfader write, no deck output. A place switch asks still() first (an early
// hint, the server judges again), posts, and renders from the next /lage. A refusal of the server is shown and never repeated.
import { plaetzeAusLage, typVon, gruppeVon, erlaubt, still, wechselKoerper, zugKopf } from './slots.js';
import { pfadVonPlatz } from './kanaele.js';
import { ladeMini, speichereMini, ordneSpalten, wendeMiniAn, umschalten } from './platz_mini.js';
import { DECKS } from './curves.js';
import { $, $$, melde, zustand } from './page_state.js';
import { eintragVon } from './deck_view.js';
import { live, zeigeExport } from './live_view.js';
import { loopImportLaeuft } from './browse_table.js';
import { remixFenster } from './effects_gemeinsam.js';
import { zeigeRemix } from './remix_window.js';
import { seqAnsicht } from './seq_field.js';
import { zeichneSeq, ordneSeqStudio } from './seq_view.js';
import { zeigeLoopdecks } from './loopdeck/view.js';
import { zeichneStems } from './stems_view.js';
import { zeigeStromZeilen } from './strudel_module.js';

const speicherOderNull = () => { try { return localStorage; } catch { return null; } };
let platzMini = ladeMini(speicherOderNull());   // the fold state of a Track place is a view preference of this browser, not a place layout
const PLAETZE = [1, 2, 3, 4];
/** The type of every place, in place order ('leer' without a live project): the shape the SEQ view and the mini fold read. */
const typen = () => PLAETZE.map((n) => typVon(zustand.plaetze, n));
export const aktuelleTypen = typen;

// ---------- reading /lage ----------
let lageNr = 0;
/** Reads GET /lage and shows its places. A stale answer (a newer read started meanwhile) is dropped. */
export async function holeLage() {
  const nr = ++lageNr;
  try {
    const j = await (await fetch('/lage')).json();
    if (nr !== lageNr) return;
    zustand.plaetze = plaetzeAusLage(j);
    zustand.container = Array.isArray(j.container) ? j.container : null;
    wendePlaetzeAn();
  } catch { /* the next event or the next click reads again */ }
}

// ---------- nodes: one body per place ----------
const KNOTEN = () => [...$$('#pult .deck'), $('#deck-c'), $('#platz-loops'), $('#platz-loops2'), $('#platz-remix'), ...$$('#pult .seqplatz'), ...$$('#pult .stemsplatz')];
// The loop deck identity (1|2) a loops place shows: the LoopDeck.platz of its group; a group the page does not know yet falls back to the order of the loops places.
function loopDeckVon(n) {
  const id = gruppeVon(zustand.plaetze, n), g = live.projekt?.gruppen?.find((x) => x.id === id);
  if (g?.loopdeck?.platz) return g.loopdeck.platz;
  return PLAETZE.filter((m) => typVon(zustand.plaetze, m) === 'loops').indexOf(n) === 1 ? 2 : 1;
}
// D1: one body per place type. Each entry finds the node of its body; `leer` has none (the head says EMPTY, the strip stays). The bodies do not know each other.
const PLATZ_ANSICHT = {
  leer: () => null,
  track: (n) => $(`.deck[data-deck="${n}"]`),
  strudel: () => $('#deck-c'),
  seq: (n) => $(`section.seqplatz[data-seq="${n}"]`),
  loops: (n) => $(loopDeckVon(n) === 2 ? '#platz-loops2' : '#platz-loops'),
  stems: (n) => $(`section.stemsplatz[data-stems="${n}"]`),
};
const knotenVon = (n) => PLATZ_ANSICHT[typVon(zustand.plaetze, n)]?.(n) ?? null;
const knotenAmPlatz = (p) => $(`#pult [data-platz="${p}"]`);
// Only attributes change: data-platz (the grid cell), hidden and platz-aus, so the node objects, their listeners and the Strudel editors stay as they are.
function ordneKnoten() {
  const platz = new Map();
  for (const n of PLAETZE) { const k = knotenVon(n); if (k) platz.set(k, n); }
  for (const k of KNOTEN()) {
    if (!k) continue;
    const p = platz.get(k);
    if (p === undefined) { delete k.dataset.platz; k.hidden = true; k.classList.add('platz-aus'); }
    else { k.dataset.platz = String(p); k.hidden = false; k.classList.remove('platz-aus'); }
  }
}
const zeigeMini = () => wendeMiniAn($, typen(), platzMini, knotenAmPlatz, KNOTEN());
// The strip heads name the container letter and the type ("C strudel"); the strips are the container strips of the places
function zeigeZugKoepfe() {
  for (const n of PLAETZE) {
    const k = $(`.zug[data-kanalzug="${pfadVonPlatz(n)}"] .zugname`);
    if (k) k.textContent = zugKopf(zustand.plaetze, n);
  }
}
// The Studio view has no deck strips of its own: the strip of place 1 or 2 shows there while the place holds something, after the pad strips
function zeigeStudioZuege() {
  for (const n of [1, 2]) {
    const z = $(`.zug[data-kanalzug="${pfadVonPlatz(n)}"]`);
    if (!z) continue;
    if (typVon(zustand.plaetze, n) === 'leer') { delete z.dataset.studioZug; continue; }
    z.dataset.studioZug = '1';
    $('#mischer-unten').append(z);
  }
}
// The one entry point after a /lage answer: attributes of existing nodes only
export function wendePlaetzeAn() {
  ordneKnoten();
  ordneSeqStudio(typen());   // the Studio view places the SEQ nodes by their order
  ordneSpalten($, knotenAmPlatz);
  zeigeMini();
  zeigeZugKoepfe();
  zeigeStudioZuege();
  zeigeLoopsSperre();
  zeigePlaetze();
  zeichneSeq();
  zeichneStems();
  zeigeStromZeilen();   // the rows of the Strudel module follow the project
  zeigeLoopdecks();   // a loop deck place shows: read its stand, create the deck when it does not exist yet
  if (remixFenster) { const r = $('#platz-remix'); r.hidden = false; r.classList.remove('platz-aus'); }   // the Remix window shows the plate
  zeigeRemix();
}

// ---------- heads ----------
const TYP_KOPF = { leer: 'EMPTY', strudel: 'STRUDEL', stems: 'STEMS' };
function kopfText(platz) {
  const typ = typVon(zustand.plaetze, platz);
  if (TYP_KOPF[typ]) return TYP_KOPF[typ];
  if (typ === 'loops') return `LOOP ${loopDeckVon(platz)}`;   // the deck view draws its own head row (name, grid, set menu)
  if (typ === 'seq') { const a = seqAnsicht(live.projekt, platz); return `SEQ ${platz} · ${a.vorhanden ? `${a.folgen.length} pattern${a.folgen.length === 1 ? '' : 's'}` : 'empty'}`; }
  const z = zustand.decks[platz], id = z?.material_id ?? zustand.geladen[platz], e = id ? eintragVon(id) : null;
  if (!id) return `TRACK ${platz} · no track loaded`;
  const g = z ?? zustand.geladenFelder?.[platz] ?? e, bpm = Number(g?.basis_bpm ?? e?.basis_bpm);
  return [`TRACK ${platz}`, e?.titel ?? id, e?.camelot, Number.isFinite(bpm) ? String(Math.round(bpm)) : null].filter(Boolean).join(' · ');
}
// A place that holds a SEQ deck or a loop deck is parked by the server, not emptied: the still rule does not hold it (same exemption as POST /plaetze)
const parkt = (platz) => ['seq', 'loops'].includes(typVon(zustand.plaetze, platz));
export function zeigePlaetze() {
  zeigeLadeSperre();
  const offen = !!zustand.plaetze;
  for (const platz of PLAETZE) {
    const k = $(`.platzkopf[data-platz-kopf="${platz}"]`);
    if (!k) continue;
    $('[data-platz-text]', k).textContent = kopfText(platz);
    const s = still(zustand.plaetze, platz, zustand.regler), frei = s.still || parkt(platz);
    $('[data-platz-hinweis]', k).textContent = !offen ? 'open the live set to place modules' : frei ? '' : `${s.text}: close it to switch`;
    const aktuell = typVon(zustand.plaetze, platz);
    for (const b of $$('[data-platz-typ]', k)) {
      const typ = b.dataset.platzTyp, an = offen && typ === aktuell;
      b.classList.toggle('an', an);
      b.setAttribute('aria-pressed', String(an));
      b.disabled = !offen || (!an && (!erlaubt(zustand.plaetze, platz, typ) || !frei));
      b.title = !offen ? 'Open the live set first' : an ? `Place ${platz} shows ${typ}` : !erlaubt(zustand.plaetze, platz, typ) ? `${typ} is already shown in another place`
        : !frei ? `Not silent: ${s.text}` : `Show ${typ} here`;
    }
  }
}
// The library's load buttons and the deck export need no Loops place (they load through /loopdeck/laden); only the busy state of the imports is shown here
function zeigeLoopsSperre() {
  for (const b of $$('button.in-box')) {
    b.disabled = loopImportLaeuft || b.dataset.ok !== '1';
    b.title = b.dataset.titel0 ?? '';
  }
  for (const n of DECKS) zeigeExport(n);
}
// The LOAD buttons exist for four decks; only a deck whose place N is a Track place can be loaded: disabled with a hint, not hidden
export const hinweisTrack = (deck) => `LOAD is off: switch place ${deck} to TRACK`;
function zeigeLadeSperre() {
  for (const b of $$('button.laden[data-deck]')) {
    const n = Number(b.dataset.deck), da = typVon(zustand.plaetze, n) === 'track';
    b.disabled = !da;
    b.title = da ? '' : hinweisTrack(n);
  }
}
let plaetzeFrist = 0;
export function zeigePlaetzeSpaeter() { if (!plaetzeFrist) plaetzeFrist = requestAnimationFrame(() => { plaetzeFrist = 0; zeigePlaetze(); }); }

// ---------- switching ----------
async function wechsle(platz, typ) {
  if (!zustand.plaetze || typ === typVon(zustand.plaetze, platz)) return;
  const s = still(zustand.plaetze, platz, zustand.regler);
  if (!s.still && !parkt(platz)) { melde(`Place ${platz}: not silent, ${s.text}`, true); zeigePlaetze(); return; }
  let r;
  try {
    const a = await fetch('/plaetze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wechselKoerper(platz, typ)) });
    r = { ok: a.ok, j: await a.json().catch(() => ({})) };
  } catch (e) { r = { ok: false, j: { text: `page server unreachable: ${e.message}` } }; }
  if (!r.ok) { melde(`Place ${platz}: ${r.j.text ?? r.j.fehler ?? 'refused'}`, true); zeigePlaetze(); return; }   // no optimistic head: the server said no
  await holeLage();   // the head follows the next /lage, not the answer
}
export function bindePlaetze() {
  for (const k of $$('.platzkopf')) {
    const platz = Number(k.dataset.platzKopf);
    for (const b of $$('[data-platz-typ]', k)) b.addEventListener('click', () => { if (!b.disabled) wechsle(platz, b.dataset.platzTyp); });
  }
  for (const k of $$('.platzkopf')) {   // MINI in the head, or a double click on the head text, folds a Track place
    const platz = Number(k.dataset.platzKopf);
    const falte = () => {
      if (typVon(zustand.plaetze, platz) !== 'track') return;
      platzMini = umschalten(platzMini, platz);
      speichereMini(speicherOderNull(), platzMini);
      zeigeMini();
    };
    $('[data-platz-mini]', k)?.addEventListener('click', falte);
    $('[data-platz-text]', k)?.addEventListener('dblclick', falte);
  }
  wendePlaetzeAn();   // nothing placed yet: every node hides until /lage answers
  holeLage();
}

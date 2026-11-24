// SEQ place v2 (spec 2026-11-14-seq-deck-design, section 6): the DOM part. Four nodes section.seqplatz[data-seq="N"] are built here, one per place; slots.js
// (wendeAn) shows the one whose place is typed SEQ. All decisions (view of the deck, requests, what is drawn after an answer, the instrument exchange) are in
// seq_field.js and seq_logic.js; this file builds the blocks, turns pointer events into those calls and draws. The deck is read from the live project the page holds.
//
// DOM:
//   section.seqplatz[data-seq=N]
//   (section.seqplatz.gross = the large view: the place fixed under the page header to the bottom edge, one place at a time, style.css)
//     .deckkopf: .sq-zahl .sq-baukasten .sq-stand | .sq-rechts: [data-sq-spiel] · [data-sq-gross] · .sq-breite [data-sq-breite] · [data-sq-alle-zu] · [data-sq-leer-aus] · [data-sq-produktion] · [data-sq-neu] · [data-sq-modul] · [data-seq-leeren]
//     .sq-leer (no deck: [data-seq-anlegen])
//     .sq-feld (scrolls both ways; --sq-beat = pixels per beat)
//       .sq-folge[data-folge=<spur_id>][data-clip=<clip_id>] (.stumm, .fremd = arranged in PRODUCTION)
//         .sq-folgenkopf: [data-sq-zu] (collapse chevron) [data-sq-name] [data-sq-geraet] [data-sq-laenge] [data-sq-stumm] .sq-hinter [data-sq-unbenutzt] (kit patterns) [data-sq-neue-zeile]
//           (.sq-folge.zu = collapsed: the head only, no ruler and no lanes)
//         .sq-lineal: .sq-nr (one per beat; .wiederholung after the pattern end up to the visible width)
//         .sq-zeile[data-folge][data-zeile=<lane id>][data-art=noten|werte|kurve]
//           .sq-zeilenkopf: .sq-zeilenname, .sq-zeilenmeta ([data-sq-ziel] target, [data-sq-gitter] grid, [data-sq-eigen] own length, [data-sq-form] shape), [data-sq-weg]
//           .sq-zellen: .sq-zelle[data-z=<cell>] (.an .akzent .gebunden .versatz .mehrere | .wert .gesperrt .nurlesen .geklemmt, .wiederholt = pale repeat of a shorter value lane,
//                       .wiederholung = pale repeat of a note lane up to the visible width: a div, aria-hidden, no pointer)
//                       | svg.sq-svg (.sq-pfad, .sq-pfad.spaeter, .sq-marke dashed mark at every repeat, .sq-punkt[data-i] circles, .sq-kopflinie)
import { $, $$, el, melde, BUCHSTABE } from './page_state.js';
import { live, arrBeat, arrLaeuft, pruefeLiveSpaeter } from './live_view.js';
import { zeigePlaetzeSpaeter } from './slots_view.js';
import { oeffneMenue, menueOffen } from './production/context_menu.js';
import { berichtText, modulListe } from './module_after_seq.js';
import { SeqFehler, zelleBefehle, zeileNeuBefehle, zeileWegBefehle, zeileAendernBefehle, laengeBefehle, TEILER } from './seq_logic.js';
import { setzeAnsicht, produktion } from './seitenrahmen.js';
import { zeigeSzenen } from './seq_szenen.js';
import { menuePunkte, oeffneAchsenMenue } from './instrument_groups.js';
import { proTaktJetzt } from './bar_live.js';
import { fokus } from './controller_fokus.js';
import { kannGeraetFenster, oeffneGeraetFenster, GERAET_FENSTER_TEXT } from './device_open.js';
import {
  seqAnsicht, deckAnsicht, infosAusCache, fehlendeInfos, ladeInfos, geraetWahl, wechselBefehle, anlegenZustand, zellKlassen, zellText, zellTitel, zeileTitel, kopfZelle, kopfPos,
  griffArt, velNeu, laengeNeu, tonNeu, loslassFelder, imRechteck, radFelder, tonVonText, kurvePfad, laengeText, laengeAusSchritten, pxProBeat,
  sende, legeAn, leereDeck, ladeModul, neueFolge, laengenWahl, SICHT_BREITEN, sichtbarBeats, linealZellen, freierName, holeMitFrist, pruefeReglerInfo, vergissLeereInfos, grossLesen, grossSchreiben, grossUmschalten, grossGilt, grossEscape,
  ueberlagere, wertAusPos, wertBruch, wertText, wertSchreibe, wiederholZellen, kurveBeatAusX, kurveWertAusY, kurveY, kurvePunkte, kurveMarken, kurveNeu, kurveVerschiebe, kurveWeg, kurvePunktBei,
  kurveSchreibe, FORM_ARTEN, formAus, formSchreibe, eigenLaengen, eigenLaengeText, eigenAusSchritten, laengeZeileBefehle, zielWahl, zielUmhaengen, sprungZiel, leereZeilen, zeileBenutzt,
  deckSpielt, deckSpielSchritt, msBisTakt,
} from './seq_field.js';

const PLAETZE = [1, 2, 3, 4];
const FARBE = { 1: 'var(--a)', 2: 'var(--b)', 3: 'var(--d3)', 4: 'var(--d3)' };   // the colour of the deck strip the sequencer plays on
const FOLGEN_FARBEN = ['var(--b)', 'var(--a)', 'var(--c)', 'var(--d3)', 'var(--c3)', 'var(--kill)', 'var(--gut)', 'var(--warn)'];   // one per pattern, cycled
const KOPF_BREITE = 230;   // px: the lane head column (style.css --sq-kopf)
const KURVE_HOEHE = 44;    // px
const RAD_WARTEN = 90;     // ms: wheel ticks of one cell are sent as one request
const GITTER_TEXT = { 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' };
const EPS = 1e-9;
const DOPPEL_FRIST = 400;  // ms: a second press on the same value cell within this time belongs to a double click
const PUNKT_R = 5;         // px: radius of a curve point

const knoten = new Map();  // place -> node

// Per-viewer view state (localStorage, never the project): collapsed patterns and the patterns whose "hide unused" is on, both as lists of track ids.
// Every storage access may throw (private window, blocked data): the page then works with the state of this page load only.
const ZU_SCHLUESSEL = 'djk-seq-zu', UNBENUTZT_SCHLUESSEL = 'djk-seq-unbenutzt';
const liesListe = (schluessel) => {
  try { const v = JSON.parse(localStorage.getItem(schluessel)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const schreibeListe = (schluessel, menge) => { try { localStorage.setItem(schluessel, JSON.stringify([...menge])); } catch { /* no storage: this page load only */ } };
// Track ids (s1, s2, ...) are counters of one project, so an entry is kept under the identity of the project it was made in. The page has no stable project
// id (the live container is always slug "live", ids are counters), so the best available identity is the slug plus the project name.
const TRENNER = '\u0001', MAX_EINTRAEGE = 400;
const bereich = () => `${live.slug ?? ''}|${live.projekt?.name ?? ''}`;
const bereichsMenge = (schluessel) => {
  const roh = new Set(liesListe(schluessel));   // "<project identity>\u0001<track id>"
  const schl = (id) => `${bereich()}${TRENNER}${id}`;
  return { roh, has: (id) => roh.has(schl(id)), add: (id) => roh.add(schl(id)), delete: (id) => roh.delete(schl(id)) };
};
const zuMenge = bereichsMenge(ZU_SCHLUESSEL);              // collapsed patterns
const unbenutztAn = bereichsMenge(UNBENUTZT_SCHLUESSEL);   // patterns with "hide unused" on (the hidden set itself lives in node._unbenutzt)
/** Reads both lists from the storage again (a page load does it once at import; the tests call it after they filled the storage). */
export function ladeSeqSicht() {
  zuMenge.roh.clear(); unbenutztAn.roh.clear();
  for (const x of liesListe(ZU_SCHLUESSEL)) zuMenge.roh.add(x);
  for (const x of liesListe(UNBENUTZT_SCHLUESSEL)) unbenutztAn.roh.add(x);
  for (const k of knoten.values()) k._unbenutzt = new Map();
  for (const n of PLAETZE) neuZeichnen(n);
}
// Writes both lists; track ids that no longer exist in any deck are dropped from the lists first (nothing to drop while no project is held).
function sichereSeqSicht() {
  if (live.projekt) {
    const da = new Set(PLAETZE.flatMap((n) => ansicht(n, live.projekt).folgen.map((f) => f.spur_id)));
    const vorsatz = `${bereich()}${TRENNER}`;
    // stale entries go only within the scope of the open project; entries of other projects stay; an entry without a scope (older format) is dropped
    for (const { roh } of [zuMenge, unbenutztAn]) for (const e of [...roh]) if (!e.includes(TRENNER) || (e.startsWith(vorsatz) && !da.has(e.slice(vorsatz.length)))) roh.delete(e);
  }
  for (const { roh } of [zuMenge, unbenutztAn]) while (roh.size > MAX_EINTRAEGE) roh.delete(roh.values().next().value);   // the oldest entries go first
  schreibeListe(ZU_SCHLUESSEL, zuMenge.roh); schreibeListe(UNBENUTZT_SCHLUESSEL, unbenutztAn.roh);
}
const istKit = (f) => f.spur?.geraet?.art === 'intern' && f.spur.geraet.name === 'kit';
// Keys "spur_id/lane id" of the trigger lanes of a kit pattern that hold no note now (the samples the pattern does not use).
const unbenutzteZeilen = (f) => new Set((f.sicht?.zeilen ?? []).filter((z) => z.art === 'noten' && z.ton !== undefined && !zeileBenutzt(z)).map((z) => `${f.spur_id}/${z.id}`));
// The hidden set is taken when the toggle goes on and is not recomputed under the owner's hand (a lane he empties stays); a hidden lane that holds a note
// again (hand tool, text, another window) leaves the set and shows. A pattern whose toggle was stored but whose set is not taken yet (page load) takes it here.
function pflegeUnbenutzt(k, a) {
  if (k._bereich !== bereich()) { k._unbenutzt = new Map(); k._bereich = bereich(); }   // another project: its patterns have the same ids but another state
  for (const f of a.folgen) {
    if (!f.editierbar || !istKit(f)) { k._unbenutzt.delete(f.spur_id); continue; }
    let menge = k._unbenutzt.get(f.spur_id);
    if (!menge && unbenutztAn.has(f.spur_id)) { menge = unbenutzteZeilen(f); k._unbenutzt.set(f.spur_id, menge); }
    if (!menge) continue;
    for (const schl of [...menge]) {
      const z = f.sicht?.zeilen.find((x) => `${f.spur_id}/${x.id}` === schl);
      if (!z || zeileBenutzt(z)) menge.delete(schl);
    }
  }
}
// The deck as drawn: the lanes carry the pending length of a lane that has no envelope yet (node._eigen, seq_field.js ueberlagere).
const ansicht = (n, p) => ueberlagere(deckAnsicht(p, n, infosAusCache(p, n)), knoten.get(n)?._eigen);
// Draws the field again from the project even when it looks the same (a gesture changed the nodes by hand: a bar, a point).
function neuZeichnen(n) { const f = $('.sq-feld', knoten.get(n)); if (f) f._sig = ''; zeichnePlatz(n); }
let kette = Promise.resolve();   // one write at a time: the next one starts from the project the last answer left
const einreihen = (f) => { kette = kette.then(f, f); return kette; };

// The requests of the SEQ place carry a time limit (seq_field.js holeMitFrist): one that is never answered must not hold the write chain and live.seqLaeuft.
const holeGet = (weg) => holeMitFrist((...a) => fetch(...a), weg);
const holeJsonFrist = (weg, daten) => holeMitFrist((...a) => fetch(...a), weg, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });

// Runs one write through the pure functions: `aufruf(projekt)` answers { ok, projekt, neuLesen, text } (seq_field.js). A refusal is a message and the drawn
// state stays the project's; a command list that cannot be written (SeqFehler, names lane and cell) is a message and nothing is sent; when the answer
// carries no project (or the deck is lost) the project is read from the server again.
function schreibe(aufruf) {
  return einreihen(async () => {
    live.seqLaeuft += 1;   // pruefeLive waits: it must not replace the project under a request that is out
    try {
      const r = await aufruf(live.projekt);
      if (r.ok) { live.projekt = r.projekt; live.rev = r.projekt?.rev ?? live.rev; if (r.text) melde(r.text, true); } else if (r.text) melde(r.text, true);
      if (r.neuLesen) live.rev = null;
      return r;
    } catch (e) {
      if (e instanceof SeqFehler) {
        melde(e.message, true);
        if (e.grund === 'info_laedt') for (const n of PLAETZE) vergissLeereInfos(live.projekt, n);   // the redraw below asks for the info again
        return { ok: false, neuLesen: false };
      }
      melde(`SEQ: ${e.message}`, true);
      live.rev = null;
      return { ok: false, neuLesen: true };
    } finally {
      live.seqLaeuft -= 1;
      zeichneSeq();
      zeigePlaetzeSpaeter();   // our own write may change what a place holds: the places look at the project again
    }
  }).then((r) => { if (r?.neuLesen) pruefeLiveSpaeter(0); });
}

const knopf = (klasse, text, attr) => {
  const b = el('button', klasse, text);
  b.type = 'button';
  if (attr) b.dataset[attr] = '';
  return b;
};

// PLAY/STOP of one deck (seq_field.js deckSpielSchritt): group mutes through POST /proj/aendern, then the transport when the step needs it. A deck that joins
// or leaves a running transport switches just before the next bar, so it comes in on the one; the button says so while it waits.
const gruppenSchreiben = (befehle, label) => async (p) => {
  const r = await holeJsonFrist('/proj/aendern', { rev: p?.rev ?? live.rev, label, befehle });
  if (r.status === 200 && r.j?.projekt) return { ok: true, projekt: r.j.projekt };
  return { ok: false, neuLesen: true, text: `${label} refused: ${r.j?.text ?? r.j?.fehler ?? r.status}` };
};
async function deckSpiel(n, b) {
  if (live.projekt?.live !== true) { melde('Open the live container first (LIVE)', true); return; }
  if (b.dataset.wartet) return;
  const laeuft = arrLaeuft(performance.now());
  const an = !deckSpielt(live.projekt, n, laeuft);
  const schritt = deckSpielSchritt(live.projekt, n, an, laeuft);
  const label = `SEQ ${n}: ${an ? 'play' : 'stop'}`;
  b.disabled = true;
  try {
    if (schritt.befehle.length && laeuft) {   // joins or leaves a running transport: on the next bar
      const ms = msBisTakt(arrBeat(performance.now()), proTaktJetzt(), live.projekt?.tempo_bpm);
      if (ms !== null) {
        b.dataset.wartet = '1'; b.textContent = an ? '▶ next bar…' : '■ next bar…';
        await new Promise((r) => setTimeout(r, ms));
      }
    }
    if (schritt.befehle.length) {
      let ok = false;
      await schreibe(async (p) => { const x = await gruppenSchreiben(schritt.befehle, label)(p); ok = x.ok; return x; });   // schreibe answers nothing itself
      if (!ok) return;
    }
    if (schritt.transport) {
      const r = await holeJsonFrist('/proj/transport', schritt.transport === 'start' ? { aktion: 'start', beat: 0 } : { aktion: 'stopp' });
      const q = r.j?.quittung;
      if (r.status !== 200) melde(`${label} refused: ${r.j?.text ?? r.j?.fehler ?? r.status}`, true);
      else if (q === null) melde(`${label}: the core did not answer`, true);
      else if (q && [4, 6, 7, 8].includes(q.status)) melde(`${label} refused: ${q.grund}`, true);
    }
  } finally { delete b.dataset.wartet; b.disabled = false; const k = knoten.get(n); if (k) k._laeuft = undefined; }
}

// The menu key of the SEQ deck head: the five secondary keys keep their data hooks and their handlers, the menu only holds them. It closes on Escape
// (before the library's own Escape handler sees the key), on a click outside, and after a click on one of its items.
const offeneMenues = new Set();
let menueHaken = false;
export function seqKopfMenue(k) {
  if (k._menue) return k._menue;
  const mehr = $('.sq-mehr', k), menue = $('.sq-menue', k);
  const schliesse = () => { menue.hidden = true; mehr.setAttribute('aria-expanded', 'false'); offeneMenues.delete(k); };
  const oeffne = () => {
    for (const x of [...offeneMenues]) x._menue.schliesse();
    const r = mehr.getBoundingClientRect();
    menue.style.top = `${Math.round((r.bottom || 0) + 2)}px`;
    menue.style.right = `${Math.max(4, Math.round((globalThis.innerWidth ?? 0) - (r.right || 0)))}px`;
    menue.hidden = false; mehr.setAttribute('aria-expanded', 'true'); offeneMenues.add(k);
  };
  mehr.addEventListener('click', (e) => { e.stopPropagation?.(); if (menue.hidden) oeffne(); else schliesse(); });
  menue.addEventListener('click', (e) => { if (e.target?.closest?.('button')) setTimeout(schliesse, 0); });   // the item's own handler reads its rect first
  k._menue = { oeffne, schliesse, offen: () => !menue.hidden };
  if (!menueHaken) {
    menueHaken = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !offeneMenues.size) return;
      e.stopImmediatePropagation?.(); e.preventDefault?.();
      for (const x of [...offeneMenues]) x._menue.schliesse();
    }, true);
    document.addEventListener('click', (e) => {
      if (e.target?.closest?.('.sq-menue, .sq-mehr')) return;
      for (const x of [...offeneMenues]) x._menue.schliesse();
    });
  }
  return k._menue;
}

function bauePlatz(n) {
  const k = document.createElement('section');
  k.className = 'seqplatz deckflaeche';
  k.dataset.seq = String(n);
  k.dataset.platzBody = 'seq';
  k.hidden = true;
  k.style.setProperty('--farbe', FARBE[n]);
  k.setAttribute('aria-label', `SEQ ${n}`);
  k._wahl = 'all';
  const kopf = el('div', 'deckkopf');
  const rechts = el('div', 'sq-rechts');
  const breite = el('div', 'sq-breite');
  breite.title = 'Visible width in bars';
  for (const w of SICHT_BREITEN) { const b = knopf('sq-chip', String(w)); b.dataset.sqBreite = String(w); breite.append(b); }
  const sprung = knopf('sq-chip sq-produktion', 'open in PRODUCTION ↗', 'sqProduktion');
  sprung.title = 'Open the clip of the pattern you touched last in PRODUCTION';
  const neu = knopf('sq-chip sq-neu', '+ pattern', 'sqNeu');
  neu.title = 'Add a pattern: it plays one instrument';
  const modul = knopf('sq-chip sq-modul', 'LOAD MODULE', 'sqModul');
  modul.title = 'Load a Workbench module into this place: one pattern per instrument track';
  const leeren = knopf('sq-chip sq-leeren', 'CLEAR', 'seqLeeren');
  leeren.title = 'Remove the sequencer of this place with its patterns';
  const gross = knopf('sq-chip sq-gross', '⤢', 'sqGross');
  gross.title = 'Large view'; gross.setAttribute('aria-pressed', 'false');
  // PLAY/STOP: the transport of the live container (POST /proj/transport); every SEQ deck and loop deck track of the container starts and stops with it
  const spiel = knopf('sq-chip sq-spiel', '▶ PLAY', 'sqSpiel');
  spiel.title = 'Play or stop this deck: it joins a running transport on the next bar; on a stopped one it starts alone';
  const leerAus = knopf('sq-chip sq-leer-aus', 'hide empty', 'sqLeerAus');
  leerAus.title = 'Hide the lanes that are empty now; press again to show them'; leerAus.setAttribute('aria-pressed', 'false');
  const alleZu = knopf('sq-chip sq-alle-zu', 'collapse all', 'sqAlleZu');
  alleZu.title = 'Collapse or expand all patterns of this deck';
  // The primary row keeps PLAY, + pattern, the width chips (with their label) and the large view; everything else sits behind the menu key
  const breiteWort = el('span', 'sq-breite-wort', 'bars');
  breiteWort.title = 'Visible width in bars';
  const mehr = knopf('sq-chip sq-mehr', '⋯', 'sqMehr');
  mehr.title = 'More: load module, clear, hide empty, collapse all, open in PRODUCTION';
  mehr.setAttribute('aria-haspopup', 'true'); mehr.setAttribute('aria-expanded', 'false');
  const menue = el('div', 'sq-menue');
  menue.hidden = true; menue.setAttribute('role', 'menu');
  menue.append(modul, leeren, leerAus, alleZu, sprung);
  rechts.append(spiel, neu, breiteWort, breite, gross, mehr, menue);
  kopf.append(el('span', 'buchstabe', BUCHSTABE[n]), el('span', 'decktitel', `SEQ ${n}`), el('span', 'sq-zahl'), el('span', 'sq-baukasten'), el('span', 'sq-stand'), rechts);
  const leer = el('div', 'sq-leer');
  const anlegen = el('button', 'sq-anlegen', 'CREATE');
  anlegen.type = 'button'; anlegen.dataset.seqAnlegen = '';
  leer.append(el('b', '', 'No sequencer in this place'), el('span', 'sq-leerhinweis'), anlegen,
    el('span', 'sq-beschreibung', 'A deck holds patterns. Each pattern plays one instrument, with lanes of notes, values and curves, and plays on the channel of this place.'));
  const feld = el('div', 'sq-feld');
  feld.setAttribute('role', 'grid'); feld.hidden = true;
  k.append(kopf, leer, feld);
  $('#pult').append(k);
  knoten.set(n, k);
  seqKopfMenue(k);
  bindePlatz(k, n, feld, anlegen, leeren, neu, breite, sprung, modul);
  gross.addEventListener('click', () => { grossWahl = grossUmschalten(grossWahl, n); wendeGross(); });
  spiel.addEventListener('click', () => deckSpiel(n, spiel));
  alleZu.addEventListener('click', () => {
    const ids = ansicht(n, live.projekt).folgen.filter((f) => f.editierbar).map((f) => f.spur_id);
    if (ids.some((id) => !zuMenge.has(id))) for (const id of ids) zuMenge.add(id); else for (const id of ids) zuMenge.delete(id);
    sichereSeqSicht();
    neuZeichnen(n);
  });
  leerAus.addEventListener('click', () => {
    k._versteckt = k._versteckt ? null : leereZeilen(ansicht(n, live.projekt));
    neuZeichnen(n);
  });
  return k;
}

// The pattern touched last (controller follow); the window focus sends it again while its lane field is still on the page.
let seqZuletzt = null;
fokus.registriere('seq', () => (seqZuletzt && document.querySelector(`.sq-feld [data-folge="${seqZuletzt}"]`) ? { spur_id: seqZuletzt } : null));

// ---------- drawing ----------
// The field is rebuilt when anything it shows changes (a signature of the view); the playhead and the pending wheel note only touch single cells.
// Where the focus sits inside the field, by pattern, lane and button or cell (not by node: the nodes are replaced), and the way back to it after a rebuild.
function fokusMerken(feld) {
  const ak = document.activeElement;
  if (!ak || ak.closest?.('.sq-feld') !== feld) return null;
  const folge = ak.closest('.sq-folge')?.dataset.folge, zeile = ak.closest('.sq-zeile')?.dataset.zeile;
  const eigen = ak.dataset?.z !== undefined ? { z: ak.dataset.z } : { sq: Object.keys(ak.dataset ?? {}).find((s) => s.startsWith('sq')) };
  return folge === undefined || (eigen.z === undefined && !eigen.sq) ? null : { folge, zeile, ...eigen };
}
function fokusZurueck(feld, m) {
  if (!m) return;
  const folge = [...feld.querySelectorAll('.sq-folge')].find((x) => x.dataset.folge === m.folge);
  const zeile = m.zeile === undefined ? folge : [...(folge?.querySelectorAll('.sq-zeile') ?? [])].find((x) => x.dataset.zeile === m.zeile);
  const sel = m.z !== undefined ? '.sq-zelle' : `[data-${m.sq.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
  const ziel = [...(zeile?.querySelectorAll(sel) ?? [])].find((x) => m.z === undefined || (x.dataset.z === m.z && x.tagName === 'BUTTON'));
  try { ziel?.focus({ preventScroll: true }); } catch { /* the node cannot take the focus: it stays on the page */ }
}
function baueFeld(k, feld, a, px, sichtbar) {
  const fokus = fokusMerken(feld);
  feld.replaceChildren();
  feld.style.setProperty('--sq-beat', String(px));
  k._zeilen = new Map();
  if (!a.folgen.length) feld.append(el('div', 'sq-keine', 'No pattern yet: + pattern adds one'));
  a.folgen.forEach((f, i) => feld.append(f.editierbar ? baueFolge(k, f, i, px, sichtbar) : baueFremd(f, i)));
  fokusZurueck(feld, fokus);
}

function baueFremd(f, i) {
  const b = el('div', 'sq-folge fremd');
  b.dataset.folge = f.spur_id;
  b.style.setProperty('--col', FOLGEN_FARBEN[i % FOLGEN_FARBEN.length]);
  b.append(el('span', 'sq-fremdname', f.name), el('span', 'sq-geraet-text', f.geraet_text), el('span', 'sq-fremd', 'arranged in PRODUCTION'));
  return b;
}

function baueFolge(k, f, i, px, sichtbar) {
  const sicht = f.sicht;
  const zu = zuMenge.has(f.spur_id);
  const b = el('div', `sq-folge${f.stumm ? ' stumm' : ''}${zu ? ' zu' : ''}`);
  b.dataset.folge = f.spur_id; b.dataset.clip = f.clip_id ?? '';
  b.style.setProperty('--col', FOLGEN_FARBEN[i % FOLGEN_FARBEN.length]);
  const kopf = el('div', 'sq-folgenkopf');
  const name = el('input', 'sq-folgenname');
  name.type = 'text'; name.value = f.name; name.maxLength = 80; name.dataset.sqName = ''; name.setAttribute('aria-label', 'Pattern name');
  const geraet = knopf('sq-chip sq-geraet', `${f.geraet_text} ▾`, 'sqGeraet'); geraet.title = 'Instrument of this pattern';
  const laenge = knopf('sq-chip', `${laengeText(sicht.laenge_beats, proTaktJetzt())} ▾`, 'sqLaenge'); laenge.title = 'Pattern length';
  const stumm = knopf(f.stumm ? 'sq-chip an' : 'sq-chip', 'M', 'sqStumm'); stumm.title = 'Mute this pattern'; stumm.setAttribute('aria-pressed', String(f.stumm));
  const zuKnopf = knopf('sq-chip sq-zu', zu ? '▸' : '▾', 'sqZu'); zuKnopf.title = 'Collapse or expand this pattern'; zuKnopf.setAttribute('aria-expanded', String(!zu));
  kopf.append(zuKnopf, name, geraet);
  if (kannGeraetFenster(f.spur)) { const fenster = knopf('sq-chip sq-fenster', GERAET_FENSTER_TEXT.knopf, 'sqFenster'); fenster.title = GERAET_FENSTER_TEXT.titel; kopf.append(fenster); }   // the instrument in its own browser window
  kopf.append(laenge, stumm);
  if (sicht.hinter_loop > 0) kopf.append(el('span', 'sq-hinter', `${sicht.hinter_loop} note${sicht.hinter_loop === 1 ? '' : 's'} behind the loop`));
  const weg = sicht.zeilen.filter((z) => k._versteckt?.has(`${f.spur_id}/${z.id}`));   // hidden by "hide empty"
  if (weg.length) kopf.append(el('span', 'sq-hinter', `${weg.length} empty lane${weg.length === 1 ? '' : 's'} hidden`));
  const unbenutzt = k._unbenutzt?.get(f.spur_id);   // set only on a kit pattern with the toggle on
  if (istKit(f)) {
    const u = knopf(unbenutzt ? 'sq-chip sq-unbenutzt an' : 'sq-chip sq-unbenutzt', unbenutzt ? `show unused (${unbenutzt.size})` : 'hide unused', 'sqUnbenutzt');
    u.title = 'Hide the sample lanes of this kit pattern that hold no note; press again to show them'; u.setAttribute('aria-pressed', String(!!unbenutzt));
    kopf.append(u);
  }
  const neueZeile = knopf('sq-chip sq-neuezeile', '+ lane ▾', 'sqNeueZeile');
  kopf.append(el('span', 'sq-grow'), neueZeile);
  b.append(kopf);
  if (zu) return b;   // collapsed: the head only (name, instrument, length and mute stay usable)
  const lineal = el('div', 'sq-lineal');
  lineal.append(el('div', 'sq-zeilenkopf'));
  const takte = el('div', 'sq-zellen');
  for (const c of linealZellen(sicht.laenge_beats, sichtbar, proTaktJetzt())) {   // the ruler runs on pale after the pattern end, up to the visible width
    const s = el('span', `${c.takt ? 'sq-nr takt' : 'sq-nr'}${c.wiederholung ? ' wiederholung' : ''}`, c.takt ? String(c.beat / proTaktJetzt() + 1) : '');
    s.style.setProperty('--w', String(c.breite));
    if (c.wiederholung) s.setAttribute('aria-hidden', 'true');
    takte.append(s);
  }
  lineal.append(takte);
  b.append(lineal);
  for (const z of sicht.zeilen) if (!weg.includes(z) && !unbenutzt?.has(`${f.spur_id}/${z.id}`)) b.append(baueZeile(k, f, z, sicht, px, sichtbar));
  return b;
}

function baueZeile(k, f, z, sicht, px, sichtbar) {
  const r = el('div', 'sq-zeile');
  r.dataset.folge = f.spur_id; r.dataset.zeile = z.id; r.dataset.art = z.art;
  const kopf = el('div', 'sq-zeilenkopf');
  const titel = el('span', 'sq-zeilenname', zeileTitel(z));
  titel.title = z.abgeleitet ? `${zeileTitel(z)} (shown from the data of the pattern)` : zeileTitel(z);
  const meta = el('div', 'sq-zeilenmeta');
  const feldZiel = z.art === 'werte' && (z.ziel === 'vel' || z.ziel === 'laenge');   // these use the grid of their note lane and the length of the pattern
  if (z.art !== 'noten') { const t = knopf('sq-chip', '→ ▾', 'sqZiel'); t.title = 'Target of this lane'; meta.append(t); }
  if (z.art !== 'kurve') {
    if (feldZiel) meta.append(el('span', 'sq-chip fest', GITTER_TEXT[z.teiler] ?? String(z.teiler)));
    else { const g = knopf('sq-chip', `${GITTER_TEXT[z.teiler] ?? z.teiler} ▾`, 'sqGitter'); g.title = 'Grid of this lane'; meta.append(g); }
  }
  if (z.art !== 'noten' && !feldZiel) {
    const e = knopf(z.eigen_laenge ? 'sq-chip an' : 'sq-chip', `${z.eigen_laenge ? eigenLaengeText(z.laenge_beats, proTaktJetzt()) : 'with pattern'} ▾`, 'sqEigen');
    e.title = 'Length of this lane: it repeats inside the pattern'; meta.append(e);
  }
  if (z.art === 'kurve') { const fo = knopf(z.form ? 'sq-chip an' : 'sq-chip', 'shape ▾', 'sqForm'); fo.title = z.form ? `Shape: ${z.form.art}` : 'Write a shape (sine, ramp, …) into this curve'; meta.append(fo); }
  if (z.kein_regler) meta.append(el('span', 'sq-chip fest', 'no such knob'));
  const weg = knopf('sq-chip sq-weg', '×', 'sqWeg'); weg.title = 'Remove this lane';
  meta.append(weg);
  kopf.append(titel, meta);
  const zellen = el('div', z.art === 'kurve' ? 'sq-zellen sq-kurve' : 'sq-zellen');
  const rec = { zeile: z, zellen: [], kopf: -1, linie: null, px };
  if (z.art === 'kurve') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'sq-svg'); svg.setAttribute('width', String(sichtbar * px)); svg.setAttribute('height', String(KURVE_HOEHE));
    svg.setAttribute('data-hoehe', String(KURVE_HOEHE));
    svg.setAttribute('aria-label', `${z.name}: click adds a point`);
    const pfad = kurvePfad(z.punkte, z.laenge_beats, sichtbar, px, KURVE_HOEHE, z.bereich);
    rec.pfade = [];
    for (const [d, klasse] of [[pfad.erste, 'sq-pfad'], [pfad.spaeter, 'sq-pfad spaeter']]) {
      if (!d) continue;
      const p = document.createElementNS(ns, 'path'); p.setAttribute('class', klasse); p.setAttribute('d', d); svg.append(p); rec.pfade.push(p);
    }
    for (const m of kurveMarken(z.laenge_beats, sichtbar)) {   // a dashed mark where the lane starts again
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('class', 'sq-marke'); l.setAttribute('x1', String(m * px)); l.setAttribute('x2', String(m * px)); l.setAttribute('y1', '0'); l.setAttribute('y2', String(KURVE_HOEHE));
      svg.append(l);
    }
    const linie = document.createElementNS(ns, 'line');
    linie.setAttribute('class', 'sq-kopflinie'); linie.setAttribute('y1', '0'); linie.setAttribute('y2', String(KURVE_HOEHE)); linie.setAttribute('opacity', '0');
    svg.append(linie);
    rec.punkte = kurvePunkte(z, px, KURVE_HOEHE).map((q) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('class', q.geklemmt ? 'sq-punkt geklemmt' : 'sq-punkt'); c.setAttribute('data-i', String(q.i));
      c.setAttribute('cx', String(q.x)); c.setAttribute('cy', String(q.y)); c.setAttribute('r', String(PUNKT_R));
      svg.append(c);
      return c;
    });
    zellen.append(svg);
    rec.linie = linie;
  } else {
    const zelleBauen = (zelle, i, vonBeat, breite, wiederholt) => {
      const noten = z.art === 'noten';
      const klassen = zellKlassen(zelle, z);
      if (wiederholt) klassen.push(noten ? 'wiederholung' : 'wiederholt', 'nurlesen');
      const c = noten && !wiederholt ? knopf(klassen.join(' ')) : el('div', klassen.join(' '));   // a repeat is no control: no button, no tab stop
      c.dataset.z = String(i);
      c.style.setProperty('--w', String(breite));
      if (Math.floor(vonBeat + EPS) % 2 === 1) c.classList.add('q');
      if (vonBeat > EPS && Math.abs(vonBeat / proTaktJetzt() - Math.round(vonBeat / proTaktJetzt())) < EPS) c.classList.add('takt');
      if (wiederholt) c.setAttribute('aria-hidden', 'true');
      if (noten) {
        c.style.setProperty('--vel', String(zelle.vel ?? 100));
        if (!wiederholt) { c.setAttribute('aria-pressed', String(zelle.an)); c.setAttribute('aria-label', `${z.name} cell ${i + 1}`); }
      } else if (zelle.wert !== null) c.style.setProperty('--wert', String(wertBruch(z, zelle.wert)));
      const wartet = wiederholt ? undefined : k._wartet?.get(`${f.spur_id}/${z.id}/${i}`);
      const text = zellText(zelle, z, wartet);
      if (text) c.textContent = text;
      if (wartet !== undefined && zelle.an) c.classList.add('wartet');
      c.title = zellTitel(z, i, zelle);
      zellen.append(c);
      return c;
    };
    z.zellen.forEach((zelle, i) => {
      const vonBeat = i * z.teiler;
      rec.zellen.push(zelleBauen(zelle, i, vonBeat, Math.min(z.teiler, z.laenge_beats - vonBeat), false));
    });
    for (const w of wiederholZellen(z, sichtbar)) zelleBauen(z.zellen[w.quelle], w.quelle, w.von, w.breite, true);   // pale copies after the lane's own length, up to the visible width
  }
  r.append(kopf, zellen);
  k._zeilen.set(`${f.spur_id}/${z.id}`, rec);
  return r;
}

function zeichnePlatz(n) {
  const k = knoten.get(n);
  if (!k) return;
  if (k._griff) { k._nachzeichnen = true; return; }   // a gesture holds a cell: the field is not replaced under the hand
  const a = ansicht(n, live.projekt);
  const leer = $('.sq-leer', k), feld = $('.sq-feld', k), leeren = $('[data-seq-leeren]', k), neu = $('[data-sq-neu]', k), breite = $('.sq-breite', k);
  leer.hidden = a.vorhanden; feld.hidden = !a.vorhanden; leeren.hidden = !a.vorhanden; neu.hidden = !a.vorhanden; breite.hidden = !a.vorhanden; $('[data-sq-produktion]', k).hidden = !a.vorhanden;
  $('[data-sq-spiel]', k).hidden = !a.vorhanden; $('[data-sq-leer-aus]', k).hidden = !a.vorhanden;
  const la = $('[data-sq-leer-aus]', k);
  pflegeUnbenutzt(k, a);
  const az = $('[data-sq-alle-zu]', k), editierbar = a.folgen.filter((f) => f.editierbar);
  az.hidden = !editierbar.length;
  az.textContent = editierbar.length && editierbar.every((f) => zuMenge.has(f.spur_id)) ? 'expand all' : 'collapse all';
  la.classList.toggle('an', !!k._versteckt); la.setAttribute('aria-pressed', String(!!k._versteckt)); la.textContent = k._versteckt ? `show empty (${k._versteckt.size})` : 'hide empty';
  $('.sq-zahl', k).textContent = a.vorhanden ? `${a.folgen.length} pattern${a.folgen.length === 1 ? '' : 's'}` : '';   // the DJ view has it in the place head
  const bk = $('.sq-baukasten', k);
  bk.textContent = a.baukasten ? `${a.baukasten} Cypher Modular` : '';
  bk.title = a.baukasten ? 'Patterns that play a Cypher Modular instrument: each costs processing time while the transport runs' : '';
  if (!a.vorhanden) {
    const z = anlegenZustand(live.projekt), b = $('[data-seq-anlegen]', k);
    b.disabled = z.aus || k.dataset.beschaeftigt === '1';
    b.title = z.aus ? `Create a sequencer: ${z.hinweis}` : 'Create a sequencer in this place';
    $('.sq-leerhinweis', k).textContent = z.hinweis;
    feld._sig = '';
    return;
  }
  for (const b of $$('[data-sq-breite]', k)) b.classList.toggle('an', b.dataset.sqBreite === String(k._wahl));
  const px = pxProBeat(k._wahl, a.laenge_beats, Number(feld.clientWidth) - KOPF_BREITE, proTaktJetzt()), sichtbar = sichtbarBeats(k._wahl, a.laenge_beats, proTaktJetzt());
  const sig = JSON.stringify([px, sichtbar, proTaktJetzt(), [...(k._versteckt ?? [])], a.folgen.map((f) => [f.spur_id, f.clip_id, f.name, f.geraet_text, f.stumm, f.editierbar, f.sicht, zuMenge.has(f.spur_id), istKit(f), k._unbenutzt.has(f.spur_id) ? [...k._unbenutzt.get(f.spur_id)] : null])]);
  if (feld._sig !== sig) { baueFeld(k, feld, a, px, sichtbar); feld._sig = sig; k._px = px; }
  if (fehlendeInfos(live.projekt, n).length) ladeInfos(live.projekt, n, holeGet).then(() => zeichnePlatz(n));   // knob names and kit sounds arrive later
  setzeKopf(k, k._beat ?? null);
}
export function zeichneSeq() { for (const n of PLAETZE) zeichnePlatz(n); zeigeSzenen(live.projekt); }   // + the scene row (seq_szenen.js)

// ---------- the playhead: one cell lit per lane (a line in a curve), from the arrangement beat, in an animation frame ----------
function setzeKopf(k, beat) {
  k._beat = beat;
  for (const rec of k._zeilen?.values() ?? []) {
    if (rec.linie) {
      const p = kopfPos(beat, rec.zeile);
      rec.linie.setAttribute('opacity', p < 0 ? '0' : '1');
      if (p >= 0) { const x = String(Math.round(p * rec.px * 100) / 100); rec.linie.setAttribute('x1', x); rec.linie.setAttribute('x2', x); }
      continue;
    }
    const i = kopfZelle(beat, rec.zeile);
    if (i === rec.kopf) continue;
    rec.zellen[rec.kopf]?.classList.remove('kopf');
    rec.zellen[i]?.classList.add('kopf');
    rec.kopf = i;
  }
}
function bild() {
  const sichtbar = [...knoten.values()].filter((k) => !k.hidden);
  if (sichtbar.length) {
    const t = performance.now(), beat = arrBeat(t), laeuft = arrLaeuft(t);
    for (const k of sichtbar) {
      setzeKopf(k, beat);
      const spielt = deckSpielt(live.projekt, Number(k.dataset.seq), laeuft), b = $('[data-sq-spiel]', k);
      if (k._laeuft !== spielt && !b.dataset.wartet) { k._laeuft = spielt; b.textContent = spielt ? '■ STOP' : '▶ PLAY'; b.classList.toggle('an', spielt); b.setAttribute('aria-pressed', String(spielt)); }
    }
  }
  requestAnimationFrame(bild);
}

// ---------- gestures and buttons ----------
const muster = (n, p, folgeId, zeileId) => {
  const f = ansicht(n, p).folgen.find((x) => x.spur_id === folgeId);
  return { f, z: f?.sicht?.zeilen.find((x) => x.id === zeileId), info: infosAusCache(p, n)[folgeId] };
};
const verschwunden = (was) => { throw new SeqFehler('argument_ungueltig', `${was} is gone: the page shows the saved state`); };

function bindePlatz(k, n, feld, anlegen, leeren, neu, breite, sprung, modul) {
  const stand = $('.sq-stand', k);
  k._wartet = new Map();
  k._eigen = new Map();   // "spur_id/lane id" -> beats: the length of a lane that has no envelope yet (seq_field.js ueberlagere)
  new ResizeObserver(() => { if (k.classList.contains('gross')) messeRahmen(k); zeichnePlatz(n); }).observe(feld);   // the width of the place sets the scale of the axis; a large place follows the header

  anlegen.addEventListener('click', async () => {
    if (anlegen.disabled) return;
    k.dataset.beschaeftigt = '1'; zeichnePlatz(n);
    await schreibe((p) => legeAn(n, p, holeJsonFrist));
    k.dataset.beschaeftigt = '0'; zeichnePlatz(n);
  });
  leeren.addEventListener('click', () => {
    const namen = deckAnsicht(live.projekt, n).folgen.map((f) => f.name);
    if (!window.confirm(`Remove the sequencer of place ${n}? Its patterns are removed${namen.length ? `: ${namen.join(', ')}` : ''}.`)) return;
    schreibe((p) => leereDeck(n, p, holeJsonFrist));
  });
  breite.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-sq-breite]');
    if (!b) return;
    k._wahl = b.dataset.sqBreite === 'all' ? 'all' : Number(b.dataset.sqBreite);
    zeichnePlatz(n);
  });
  // LOAD MODULE: the Workbench modules (GET /proj/liste, entries with werkbank: true) in a menu; the pick loads it into this place (POST /seq/modul)
  modul.addEventListener('click', async () => {
    if (live.projekt?.live !== true) { melde('Open the live container first (LIVE)', true); return; }
    const r = modul.getBoundingClientRect();
    const liste = modulListe((await holeGet('/proj/liste')).j);
    if (liste.length === 0) { melde('No Workbench module saved yet', true); return; }
    oeffneMenue(liste.map((m) => ({ text: m.name, aktion: async () => {
      let bericht = null;
      await schreibe((p) => ladeModul(n, m.slug, p, holeJsonFrist).then((x) => { bericht = x.bericht ?? null; return x; }));
      if (bericht) melde(berichtText(bericht));
    } })), r.left, r.bottom);
  });
  neu.addEventListener('click', async () => {
    const r = neu.getBoundingClientRect();
    const [g, kits] = await Promise.all([holeGet('/graphen'), holeGet('/proj/kits')]);
    const wahl = geraetWahl(g.j?.graphen, kits.j?.kits);
    oeffneAchsenMenue((achse, umschalten) => menuePunkte(wahl, g.j?.graphen, achse, (e) => schreibe((p) => neueFolge(n, freierName(e.name, seqAnsicht(p, n).folgen.map((f) => f.name)), e.geraet, undefined, p, holeJsonFrist)), umschalten),
      (punkte) => oeffneMenue(punkte, r.left, r.bottom));
  });

  // The jump: the clip of the pattern touched last, in PRODUCTION (the view switches, the group unfolds, the clip is selected once the project is loaded).
  sprung.addEventListener('click', async () => {
    const z = sprungZiel(ansicht(n, live.projekt), k._letzte);
    if (!z.clip_id) { melde(z.meldung, true); return; }
    if (!produktion) { melde('PRODUCTION is not available', true); return; }
    setzeAnsicht('produktion');
    await produktion.waehleClip(z.clip_id);
  });

  // A cell of a note lane: click toggles, drag up or down sets the velocity, drag right lengthens (pitched lane), the wheel moves the pitch.
  // A cell of a value lane: the bar follows the pointer (drawn only), the value goes out on release; a double click removes it.
  // A curve: click adds a point, a point is dragged (drawn only) and goes out on release, a double click removes it.
  let griff = null, letzterDruck = { schl: '', t: 0 };   // the press that came last (by cell, not node: the field may be drawn again between two presses)
  const zelleSenden = (folgeId, zeileId, i, felder) => schreibe((p) => {
    const { f, z } = muster(n, p, folgeId, zeileId);
    if (!z) verschwunden(`The lane ${zeileId}`);
    return sende(n, 'Cell', zelleBefehle(f.spur, f.clip, z, i, felder), p, holeJsonFrist);
  });
  // `aufruf(f, z, info)` builds the command list of a value or curve gesture from the project as it is when the write is its turn
  const zeileSenden = async (label, folgeId, zeileId, aufruf) => {
    await schreibe((p) => {
      const { f, z, info } = muster(n, p, folgeId, zeileId);
      if (!z) verschwunden(`The lane ${zeileId}`);
      return sende(n, label, aufruf(f, z, info), p, holeJsonFrist);
    });
    neuZeichnen(n);   // the bar or point the hand moved shows the saved state again, whatever the answer was
  };
  const ende = () => { k._griff = null; stand.textContent = ''; if (k._nachzeichnen) { k._nachzeichnen = false; zeichnePlatz(n); } };
  const balken = (g) => {
    g.c.style.setProperty('--wert', String(wertBruch(g.z, g.wert)));
    g.c.classList.add('an', 'wartet');
    stand.textContent = `${g.z.name} ${wertText(g.z, g.wert)}`;
  };
  const kurveOrt = (g, e) => { const r = g.svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const zeichnePunkt = (g) => {
    g.punkt?.setAttribute('cx', String(Math.round(g.beat * g.px * 100) / 100));
    g.punkt?.setAttribute('cy', String(Math.round(kurveY(g.wert, KURVE_HOEHE, g.z.bereich) * 100) / 100));
  };
  feld.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const block = e.target.closest?.('.sq-folge');
    if (block?.dataset.folge) k._letzte = block.dataset.folge;   // the jump takes this pattern
    const reihe = e.target.closest?.('.sq-zeile');
    const kurve = e.target.closest?.('.sq-svg');
    if (kurve && reihe) {
      const { z } = muster(n, live.projekt, reihe.dataset.folge, reihe.dataset.zeile), rec = k._zeilen.get(`${reihe.dataset.folge}/${reihe.dataset.zeile}`);
      if (!z || !rec) return;
      const punkt = e.target.closest?.('.sq-punkt'), i = punkt ? Number(punkt.dataset.i) : -1;
      let zweiter = false;
      if (punkt) {   // by lane and beat of the point, not by node: a second quick press on the same point removes it
        const schl = `${reihe.dataset.folge}/${reihe.dataset.zeile}/p${z.punkte[i]?.beat}`;
        zweiter = letzterDruck.schl === schl && Date.now() - letzterDruck.t < DOPPEL_FRIST;
        letzterDruck = { schl, t: Date.now() };
      }
      griff = { typ: punkt ? 'punkt' : 'flaeche', folge: reihe.dataset.folge, zeile: reihe.dataset.zeile, svg: kurve, punkt, i, z, px: rec.px, x0: e.clientX, y0: e.clientY, bewegt: false, zweiter,
        beat: punkt ? z.punkte[i]?.beat : 0, beat0: punkt ? z.punkte[i]?.beat : 0, wert: punkt ? z.punkte[i]?.wert : 0 };
      k._griff = griff;
      try { (punkt ?? kurve).setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives over the lane */ }
      return;
    }
    const c = e.target.closest?.('.sq-zelle');
    if (!c || !reihe || c.classList.contains('nurlesen') || c.classList.contains('wiederholt')) return;
    const i = Number(c.dataset.z);
    const { z } = muster(n, live.projekt, reihe.dataset.folge, reihe.dataset.zeile), zelle = z?.zellen[i];
    if (!zelle) return;
    if (z.art === 'werte') {
      const rect = c.getBoundingClientRect(), schl = `${reihe.dataset.folge}/${reihe.dataset.zeile}/${i}`, zweiter = z.ziel !== 'vel' && z.ziel !== 'laenge' && letzterDruck.schl === schl && Date.now() - letzterDruck.t < DOPPEL_FRIST;   // a velocity or length belongs to its notes: no removal
      letzterDruck = { schl, t: Date.now() };
      griff = { typ: 'wert', folge: reihe.dataset.folge, zeile: reihe.dataset.zeile, i, c, z, rect, zweiter, wert: wertAusPos(z, e.clientY, rect.top, rect.height) };
      k._griff = griff;
      balken(griff);
      try { c.setPointerCapture(e.pointerId); } catch { /* no capture */ }
      return;
    }
    const note = zelle.noten?.find((x) => x.ton === zelle.ton);
    griff = { typ: 'noten', folge: reihe.dataset.folge, zeile: reihe.dataset.zeile, i, c, x0: e.clientX, y0: e.clientY, art: null, an: zelle.an, vel: zelle.vel, ton: z.ton === undefined,
      zelle, zellen0: note ? Math.max(1, Math.round(note.laenge / z.teiler)) : 1, breite: c.getBoundingClientRect().width || 1, max: z.zellen.length - i };
    k._griff = griff;
    try { c.setPointerCapture(e.pointerId); } catch { /* no capture: the move still arrives over the cell */ }
  });
  feld.addEventListener('pointermove', (e) => {
    if (!griff) return;
    if (griff.typ === 'wert') { griff.wert = wertAusPos(griff.z, e.clientY, griff.rect.top, griff.rect.height); balken(griff); return; }
    if (griff.typ === 'punkt' || griff.typ === 'flaeche') {
      if (!griff.bewegt && griffArt(e.clientX - griff.x0, e.clientY - griff.y0, true) === null) return;   // below the threshold: still a click
      griff.bewegt = true;
      if (griff.typ === 'punkt') {
        const { x, y } = kurveOrt(griff, e);
        griff.beat = kurveBeatAusX(x, griff.px, griff.z.laenge_beats); griff.wert = kurveWertAusY(griff.z, y, KURVE_HOEHE);
        zeichnePunkt(griff);
        stand.textContent = `${griff.z.name} ${wertText(griff.z, griff.wert)} at beat ${griff.beat}`;
      }
      return;
    }
    if (!griff.an) return;   // only a note that is there has a velocity and a length
    const dx = e.clientX - griff.x0, dy = e.clientY - griff.y0;
    const art = griff.art ?? griffArt(dx, dy, griff.ton);
    if (!art) return;
    griff.art = art;
    if (art === 'vel') { griff.vel = velNeu(griff.zelle.vel, dy); stand.textContent = `velocity ${griff.vel}`; }
    else { griff.laenge = laengeNeu(griff.zellen0, dx, griff.breite, griff.max); stand.textContent = `length ${griff.laenge}`; }
  });
  const loslassen = (e) => {
    const g = griff; griff = null;
    ende();
    if (!g) return;
    const abbruch = e.type === 'pointercancel';
    if (g.typ === 'wert') {
      if (abbruch) { neuZeichnen(n); return; }
      if (g.zweiter) {   // second quick press on the same cell: the value goes (the browser drops click and dblclick when the field is drawn again, so it is recognised here)
        letzterDruck = { schl: '', t: 0 };
        zeileSenden('Remove value', g.folge, g.zeile, (f, z, info) => wertSchreibe(f.spur, f.clip, z, g.i, null, info));
        return;
      }
      zeileSenden('Value', g.folge, g.zeile, (f, z, info) => wertSchreibe(f.spur, f.clip, z, g.i, g.wert, info));
      return;
    }
    if (g.typ === 'punkt') {
      if (abbruch) { neuZeichnen(n); return; }
      if (!g.bewegt) {
        if (!g.zweiter) return;   // a first press that did not move changes nothing and does not draw the field again: the circle stays for the second press
        letzterDruck = { schl: '', t: 0 };
        // the point is named by its beat when the write is its turn: a write that is still out may have re-sorted the list
        zeileSenden('Remove curve point', g.folge, g.zeile, (f, z, info) => {
          const i = kurvePunktBei(z, g.beat0, g.i);
          if (i < 0) verschwunden('The curve point');
          return kurveSchreibe(f.spur, f.clip, z, kurveWeg(z, i), info);
        });
        return;
      }
      zeileSenden('Curve point', g.folge, g.zeile, (f, z, info) => {
        const i = kurvePunktBei(z, g.beat0, g.i);
        if (i < 0) verschwunden('The curve point');
        return kurveSchreibe(f.spur, f.clip, z, kurveVerschiebe(z, i, g.beat, g.wert), info);
      });
      return;
    }
    if (g.typ === 'flaeche') {
      if (abbruch || g.bewegt) return;   // a press that moved is not a click
      const { x, y } = kurveOrt(g, e);
      if (x / g.px > g.z.laenge_beats + EPS) return;   // the pale repeats are not the lane
      const beat = kurveBeatAusX(x, g.px, g.z.laenge_beats), wert = kurveWertAusY(g.z, y, KURVE_HOEHE);
      zeileSenden('Curve point', g.folge, g.zeile, (f, z, info) => kurveSchreibe(f.spur, f.clip, z, kurveNeu(z, beat, wert), info));
      return;
    }
    if (abbruch) return;
    const felder = loslassFelder(g, imRechteck(e.clientX, e.clientY, g.c.getBoundingClientRect()));
    if (felder) zelleSenden(g.folge, g.zeile, g.i, felder);
  };
  // Controller follow: touching a pattern (pointer or keyboard focus inside its lane field or header) puts its track in front; the track is the synth the pattern plays.
  const folgeBeruehrt = (e) => { const id = e.target.closest?.('[data-folge]')?.dataset.folge; if (id) { seqZuletzt = id; fokus.melde({ spur_id: id }, 'seq'); } };
  feld.addEventListener('pointerdown', folgeBeruehrt);
  feld.addEventListener('focusin', folgeBeruehrt);
  feld.addEventListener('pointerup', loslassen);
  feld.addEventListener('pointercancel', loslassen);
  feld.addEventListener('click', (e) => {
    const c = e.target.closest?.('.sq-zelle');
    if (c && c.tagName === 'BUTTON' && !c.classList.contains('nurlesen') && e.detail === 0) { const r = c.closest('.sq-zeile'); zelleSenden(r.dataset.folge, r.dataset.zeile, Number(c.dataset.z), {}); }   // the keyboard: a click without a pointer
    const b = e.target.closest?.('button');
    if (b) knopfGedrueckt(n, b);
  });
  // The wheel over a pitched cell moves its note (shift: octaves). Ticks of one cell collect for a moment and go out as one request.
  const frist = new Map();
  feld.addEventListener('wheel', (e) => {
    const c = e.target.closest?.('.sq-zelle.ton');
    if (!c) return;
    const reihe = c.closest('.sq-zeile'), i = Number(c.dataset.z), schl = `${reihe.dataset.folge}/${reihe.dataset.zeile}/${i}`;
    const { z } = muster(n, live.projekt, reihe.dataset.folge, reihe.dataset.zeile), zelle = z?.zellen[i];
    if (!zelle?.an) return;   // a cell that is off has no note to move: the wheel scrolls the page there
    e.preventDefault();
    const ton = tonNeu(k._wartet.get(schl) ?? zelle.ton, e.deltaY || e.deltaX, e.shiftKey);
    k._wartet.set(schl, ton);
    c.textContent = zellText(zelle, z, ton); c.classList.add('wartet');
    clearTimeout(frist.get(schl));
    frist.set(schl, setTimeout(async () => {
      frist.delete(schl);
      const gesammelt = k._wartet.get(schl), jetzt = muster(n, live.projekt, reihe.dataset.folge, reihe.dataset.zeile).z?.zellen[i], felder = radFelder(jetzt, gesammelt);
      if (!felder) { k._wartet.delete(schl); neuZeichnen(n); return; }   // nothing defined to write (the cell went off, or the note is the stored one)
      await zelleSenden(reihe.dataset.folge, reihe.dataset.zeile, i, felder);
      if (k._wartet.get(schl) === gesammelt) k._wartet.delete(schl);   // only our own entry: a newer tick of this cell stays pending for its own timer
      neuZeichnen(n);   // whatever the answer was, the cell shows the saved state (a refused write leaves the old note, not the pending one)
    }, RAD_WARTEN));
  }, { passive: false });
  feld.addEventListener('change', (e) => {   // the name of a pattern
    const i = e.target.closest?.('[data-sq-name]');
    if (!i) return;
    const folgeId = i.closest('.sq-folge').dataset.folge, name = String(i.value).trim();
    schreibe((p) => {
      const f = seqFolge(n, p, folgeId);
      if (!name || name === f.name) return { ok: true, projekt: p, neuLesen: false, text: '' };
      return sende(n, 'Pattern name', [{ befehl: 'spur_aendern', spur_id: folgeId, name }], p, holeJsonFrist);
    }).then(() => neuZeichnen(n));   // an empty, unchanged or refused name: the field shows the name of the saved state again
  });
}

const seqFolge = (n, p, folgeId) => ansicht(n, p).folgen.find((x) => x.spur_id === folgeId) ?? verschwunden('The pattern');
// the buttons of a pattern head and a lane head
function knopfGedrueckt(n, b) {
  const r = b.getBoundingClientRect(), folgeId = b.closest('.sq-folge')?.dataset.folge, d = b.dataset;
  const schreibeFolge = (label, befehle) => schreibe((p) => { const f = seqFolge(n, p, folgeId); return sende(n, label, befehle(f, p), p, holeJsonFrist); });
  if ('sqZu' in d) {
    if (folgeId) { if (zuMenge.has(folgeId)) zuMenge.delete(folgeId); else zuMenge.add(folgeId); sichereSeqSicht(); neuZeichnen(n); }
  } else if ('sqUnbenutzt' in d) {
    const k = knoten.get(n), f = ansicht(n, live.projekt).folgen.find((x) => x.spur_id === folgeId);
    if (!k || !f) return;
    k._unbenutzt ??= new Map();
    if (k._unbenutzt.has(folgeId)) { k._unbenutzt.delete(folgeId); unbenutztAn.delete(folgeId); } else { k._unbenutzt.set(folgeId, unbenutzteZeilen(f)); unbenutztAn.add(folgeId); }
    sichereSeqSicht();
    neuZeichnen(n);
  } else if ('sqFenster' in d) {
    oeffneGeraetFenster(folgeId, melde);
  } else if ('sqStumm' in d) {
    schreibe((p) => sende(n, 'Mute', [{ befehl: 'spur_aendern', spur_id: folgeId, mute: !seqFolge(n, p, folgeId).spur.mute }], p, holeJsonFrist));
  } else if ('sqLaenge' in d) {
    const setze = (beats) => schreibeFolge('Pattern length', (f) => laengeBefehle(f.spur, f.clip, beats));
    const maxBeats = seqFolge(n, live.projekt, folgeId).clip?.laenge_beats ?? 16 * proTaktJetzt();   // the stored clip bounds the length
    oeffneMenue([...laengenWahl(maxBeats, proTaktJetzt()).map((t) => ({ text: laengeText(t * proTaktJetzt(), proTaktJetzt()), aktion: () => setze(t * proTaktJetzt()) })),
      { text: 'Steps…', aktion: () => {
        const beats = laengeAusSchritten(window.prompt(`Pattern length in steps of 1/16 (1 to ${maxBeats * 4})`, ''), proTaktJetzt(), maxBeats);
        if (beats === null) melde(`A step count is a whole number from 1 to ${maxBeats * 4}`, true); else setze(beats);
      } }], r.left, r.bottom);
  } else if ('sqGeraet' in d) {
    holeGet('/graphen').then(async (g) => {
      const kits = await holeGet('/proj/kits');
      const aktuell = ansicht(n, live.projekt).folgen.find((x) => x.spur_id === folgeId)?.spur?.geraet;
      const behalte = aktuell?.art === 'intern' && aktuell.name === 'bk' ? aktuell.graph : undefined;   // the graph this pattern plays: listed even when hidden
      const wahl = geraetWahl(g.j?.graphen, kits.j?.kits, behalte);
      // the instrument menu: Baukasten entries under the groups of the page-wide axis (instrument_groups.js), the first entry switches the axis and reopens it here
      oeffneAchsenMenue((achse, umschalten) => menuePunkte(wahl, g.j?.graphen, achse, (e) => schreibe((p) => {
        const f = seqFolge(n, p, folgeId), w = wechselBefehle(f.spur, f.clip, e.geraet, infosAusCache(p, n)[folgeId]);
        if (w.meldung) { melde(w.meldung, true); return { ok: false, projekt: p, neuLesen: false, text: '' }; }
        if (w.frage && !window.confirm(w.frage)) return { ok: true, projekt: p, neuLesen: false, text: '' };
        return sende(n, 'Instrument', w.befehle, p, holeJsonFrist);
      }), umschalten, behalte), (punkte) => oeffneMenue(punkte, r.left, r.bottom));
    });
  } else if ('sqNeueZeile' in d) {
    const f = ansicht(n, live.projekt).folgen.find((x) => x.spur_id === folgeId);
    if (!f) return;
    const info = infosAusCache(live.projekt, n)[folgeId], belegt = new Set(f.sicht.zeilen.filter((z) => z.art === 'noten' && z.ton !== undefined).map((z) => z.ton));
    const hatTon = f.sicht.zeilen.some((z) => z.art === 'noten' && z.ton === undefined);
    const neueZeile = (zeile) => schreibeFolge('Lane', (fa, p) => zeileNeuBefehle(fa.spur, fa.clip, zeile, infosAusCache(p, n)[folgeId]));
    const punkte = [{ gruppe: true, text: 'Trigger lane' }, ...(info?.klaenge ?? []).filter((x) => !belegt.has(x.ton)).map((x) => ({ text: `${x.name} (${x.ton})`, aktion: () => neueZeile({ art: 'noten', teiler: 0.25, ton: x.ton }) })),
      { text: 'Note number or name…', aktion: () => {
        const ton = tonVonText(window.prompt('Note number (0 to 127) or note name (C3 = 60)', ''));
        if (ton === null) melde('A note is a number from 0 to 127 or a name like C3', true);
        else if (belegt.has(ton)) melde(`Note ${ton} has a lane already`, true);
        else neueZeile({ art: 'noten', teiler: 0.25, ton });
      } },
      { gruppe: true, text: 'Pitched lane' }, { text: 'Pitch lane', aus: hatTon, titel: hatTon ? 'A pattern has one pitched lane' : undefined, aktion: () => neueZeile({ art: 'noten', teiler: 0.25 }) },
      { gruppe: true, text: 'Values and curves' },
      ...[['werte', 'Values per step…'], ['kurve', 'Curve…']].map(([art, text]) => ({ text, aktion: () => {
        const fa = ansicht(n, live.projekt).folgen.find((x) => x.spur_id === folgeId);
        if (!fa) return;
        // the second step: the target of the new lane (velocity, length, every knob of the instrument by name, transpose, track level, track pan)
        const wahl = zielWahl(fa.sicht, fa.spur, infosAusCache(live.projekt, n)[folgeId], art), liste = [];
        let gruppe = null;
        for (const e of wahl) {
          if (e.gruppe !== gruppe) { gruppe = e.gruppe; liste.push({ gruppe: true, text: gruppe }); }
          liste.push({ text: e.text, aus: e.aus, titel: e.titel, aktion: () => neueZeile(e.zeile) });
        }
        oeffneMenue(liste, r.left, r.bottom);
      } }))];
    oeffneMenue(punkte, r.left, r.bottom);
  } else if ('sqGitter' in d) {
    const zeileId = b.closest('.sq-zeile').dataset.zeile;
    oeffneMenue(TEILER.map((t) => ({ text: GITTER_TEXT[t], aktion: () => schreibeFolge('Grid', (f, p) => zeileAendernBefehle(f.spur, f.clip, zeileId, { teiler: t }, infosAusCache(p, n)[folgeId])) })), r.left, r.bottom);
  } else if ('sqZiel' in d) {
    const zeileId = b.closest('.sq-zeile').dataset.zeile, f = seqFolge(n, live.projekt, folgeId), z = f.sicht?.zeilen.find((x) => x.id === zeileId);
    if (!z) return;
    const wahl = zielUmhaengen(z, f.sicht, f.spur, infosAusCache(live.projekt, n)[folgeId]);
    oeffneMenue(wahl.map((e) => ({ text: `${e.aktuell ? '✓ ' : ''}${e.text}`, aus: e.aus || e.aktuell, titel: e.titel,
      aktion: () => schreibeFolge('Lane target', (fa, p) => {
        const info = infosAusCache(p, n)[folgeId];
        pruefeReglerInfo(z.ziel, info); pruefeReglerInfo(e.ziel, info);   // the values move to another base: not on a guessed one
        return zeileAendernBefehle(fa.spur, fa.clip, zeileId, { ziel: e.ziel }, info);
      }) })), r.left, r.bottom);
  } else if ('sqEigen' in d) {
    const zeileId = b.closest('.sq-zeile').dataset.zeile, f = seqFolge(n, live.projekt, folgeId), z = f.sicht?.zeilen.find((x) => x.id === zeileId);
    if (!z) return;
    const schl = `${folgeId}/${zeileId}`;
    const setze = (beats) => {
      if (z.hat_huellkurve) schreibeFolge('Lane length', (fa, p) => {
        const zz = fa.sicht?.zeilen.find((x) => x.id === zeileId);
        if (!zz) verschwunden(`The lane ${zeileId}`);
        return laengeZeileBefehle(fa.spur, fa.clip, zz, beats, infosAusCache(p, n)[folgeId]) ?? [];
      });
      else { if (beats === null) knoten.get(n)._eigen.delete(schl); else knoten.get(n)._eigen.set(schl, beats); neuZeichnen(n); }   // no envelope yet: the page keeps the length for the first point
    };
    oeffneMenue([...eigenLaengen(f.sicht.laenge_beats, proTaktJetzt()).map((e) => ({ text: e.text, aktion: () => setze(e.beats) })),
      { text: 'Steps…', aktion: () => {
        const beats = eigenAusSchritten(window.prompt(`Lane length in steps of 1/16 (1 to ${f.sicht.laenge_beats * 4})`, ''), f.sicht.laenge_beats);
        if (beats === null) melde(`A step count is a whole number from 1 to ${f.sicht.laenge_beats * 4}`, true); else setze(beats);
      } }], r.left, r.bottom);
  } else if ('sqForm' in d) {
    const zeileId = b.closest('.sq-zeile').dataset.zeile, f = seqFolge(n, live.projekt, folgeId), z = f.sicht?.zeilen.find((x) => x.id === zeileId);
    if (!z) return;
    const schreibeForm = (aend, art) => schreibeFolge('Shape', (fa, p) => {
      const zz = fa.sicht?.zeilen.find((x) => x.id === zeileId);
      if (!zz) verschwunden(`The lane ${zeileId}`);
      return formSchreibe(fa.spur, fa.clip, zz, infosAusCache(p, n)[folgeId], formAus(zz, art ?? zz.form?.art ?? 'sinus', aend));
    });
    const wert = (was) => {
      const v = Number(String(window.prompt(`${was} (${z.bereich.min} to ${z.bereich.max})`, '') ?? '').replace(',', '.'));
      return Number.isFinite(v) && v >= z.bereich.min && v <= z.bereich.max ? v : (melde(`${was} takes a number from ${z.bereich.min} to ${z.bereich.max}`, true), null);
    };
    oeffneMenue([...FORM_ARTEN.map(([art, text]) => ({ text, aktion: () => schreibeForm({}, art) })),
      { gruppe: true, text: 'Range' },
      { text: `From${z.form ? ` (${z.form.von})` : ''}…`, aktion: () => { const v = wert('From'); if (v !== null) schreibeForm({ von: v }); } },
      { text: `To${z.form ? ` (${z.form.bis})` : ''}…`, aktion: () => { const v = wert('To'); if (v !== null) schreibeForm({ bis: v }); } },
      ...(z.form?.art === 'zufall' ? [{ text: 'Re-roll', aktion: () => schreibeForm({ saat: Math.floor(Math.random() * 2147483647) }) }] : [])], r.left, r.bottom);
  } else if ('sqWeg' in d) {
    const zeileId = b.closest('.sq-zeile').dataset.zeile, f = seqFolge(n, live.projekt, folgeId), z = f.sicht?.zeilen.find((x) => x.id === zeileId);
    const inhalt = z && (z.zellen?.some((c) => c.an || c.da) || z.punkte?.length);
    if (inhalt && !window.confirm(`Remove lane ${zeileTitel(z)} with its ${z.art === 'noten' ? 'notes' : 'values'}?`)) return;
    schreibeFolge('Remove lane', (fa) => zeileWegBefehle(fa.spur, fa.clip, zeileId));
  }
}

// ---------- the large view ----------
// One place can take the page under the header (style.css .seqplatz.gross: position fixed). The choice per place is kept in localStorage (seq_field.js grossLesen);
// it counts while the place is typed SEQ and shows, so it is judged whenever the layout is applied (ordneSeqStudio, called after slots.js wendeAn has set the nodes).
let grossWahl = {};
const speicherOderNull = () => { try { return localStorage; } catch { return null; } };
// The top edge is the bottom edge of the page header element (its height differs by view and mode: no header on the tablet) plus the gap the page keeps below it,
// the side margin is the padding of the page: nothing is measured in fixed pixels.
function messeRahmen(k) {
  const kopf = $('#kopf')?.getBoundingClientRect?.(), stil = getComputedStyle(document.body);
  const mass = (v, vorgabe) => { const x = parseFloat(v); return Number.isFinite(x) ? x : vorgabe; };
  const oben = Math.max(0, Math.round(kopf?.bottom ?? 0)) + (kopf?.bottom > 0 ? mass(stil.rowGap, 8) : 0), rand = mass(stil.paddingLeft, 8);
  k.style.setProperty('--sq-oben', `${oben}px`); k.style.setProperty('--sq-rand', `${rand}px`);
}
let layoutJetzt = [];   // the layout the page applied last (ordneSeqStudio): until the first one no place counts as SEQ
const grossJetzt = () => grossGilt(grossWahl, layoutJetzt, (n) => !knoten.get(n)?.hidden);
function wendeGross() {
  const gilt = grossJetzt();
  grossWahl = gilt.wahl;   // what no longer counts is gone from the choice
  grossSchreiben(speicherOderNull(), grossWahl);
  for (const [n, k] of knoten) {
    const an = gilt.platz === n;
    k.classList.toggle('gross', an);
    $('[data-sq-gross]', k)?.setAttribute('aria-pressed', String(an));
    if (an) messeRahmen(k);
  }
}
// Escape closes the large view: not under a menu or the list menu, not in an input field, not over the device page or in PRODUCTION where the node is not shown, and never in TRACKER (its grid owns Escape).
function grossTaste(e) {
  if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
  const b = document.body.classList;
  const gross = grossJetzt().platz !== null && !b.contains('produktion') && !b.contains('werkbank') && !b.contains('tracker') && !b.contains('geraeteseite');
  const eingabe = !!e.target?.closest?.('input, textarea, select, [contenteditable]'), menue = menueOffen() || $('#listen-menue')?.hidden === false;
  if (!grossEscape({ gross, menue, eingabe })) return;
  e.preventDefault(); e.stopPropagation();   // the Escape of the page (library drawer) does not also fire
  grossWahl = {}; wendeGross();
}

// The Studio view places the nodes of the SEQ places itself (style.css): their order (data-seq-sp) and their number (#pult data-seq-n) pick the grid areas.
export function ordneSeqStudio(layout) {
  layoutJetzt = layout;
  wendeGross();   // the large view follows the layout: a place that is no SEQ place or is hidden is never large
  let i = 0;
  for (const n of PLAETZE) {
    const k = knoten.get(n);
    if (!k) continue;
    if (layout[n - 1] === 'seq') k.dataset.seqSp = String(++i); else delete k.dataset.seqSp;
  }
  $('#pult').dataset.seqN = String(i);
  $('#pult').style.setProperty('--seq-n', String(i));   // the Studio strip row grows by one strip per SEQ place (style.css --mu-breite)
}

// Called once from app.js, before the layout is applied (bindePlaetze): the nodes must exist for wendeAn.
export function baueSeqPlaetze() {
  grossWahl = grossLesen(speicherOderNull());
  for (const n of PLAETZE) bauePlatz(n);
  window.addEventListener('keydown', grossTaste, true);   // first on the window: a menu that opens later registers after it, so `menueOffen` still says open
  zeichneSeq();
  requestAnimationFrame(bild);
}

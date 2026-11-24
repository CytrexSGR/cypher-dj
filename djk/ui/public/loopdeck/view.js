// Loop deck view (plan loop deck P2): draws loop deck 1 and 2 into the containers `.loopdeck[data-deck]` of the places `loops` and `loops2`.
// State comes from GET /loopdeck/stand (read when a container shows, on every 'proj' event and after an own change) and from the SSE event
// { a: 'loopdeck', f: { deck, spur, lauf } } (run state of one track). The nodes are built once and only updated afterwards, so focus and
// drags survive a redraw. Per deck: head row (name, grid, STOP ALL, set menu, create button), scene column, four track columns.
import { $$, el, melde } from '../page_state.js';
import { leereWellen, starteTakt } from '../session/waves.js';
import { baueSpalte } from '../session/spalte.js';
import { KERN, kernAusX, kernZuX } from '../curves.js';
import { knopf, EQ_OPT, SEND_OPT, EQ_BAENDER, FX_EINHEITEN } from '../session/strip.js';
import { zeigeColorName } from '../color_kinds.js';
import { baueMenue } from './menue.js';
import { baueSetMenue } from './sets.js';
import { schreibeZelle } from './drag.js';
import { RASTER, SPUREN, ZELLEN, beatJetzt, deckAnsicht, laufEreignis, neueUhr, uhrMelde } from './model.js';

const jetzt = () => performance.now();
const stand = { decks: { 1: null, 2: null }, geladen: false };
const uhr = neueUhr();
const ansichten = new Map();   // deck number -> { wurzel, kopf, szenen, spuren: [...], ziel: {spur, zelle} | null, neuVersucht }
let letztesDeck = null;       // the deck whose load target was selected last (export target when none is selected)
let exportDeck = null;        // the deck chosen with the toggle of the track decks' export row; null = follow the selection
const hoerer = new Set();     // called after every change of the stand or of the export target (the export row redraws itself)
let ladend = false, nochmal = false, veraltet = false, schleifeAb = null;   // schleifeAb: unsubscribes from the shared animation loop (waves.js)
let standAngefragt = false;    // the stand was asked for once (the export row asks when no loop place does)
const exportLaeuft = new Set();   // track decks with an export request in flight

// The live container belongs to live_view.js (which imports this module): it registers how to read "is it open" and how to open it (with its own
// confirmation). Without it (tests of this view alone) the container counts as closed and opening fails.
const haken = { liveOffen: () => false, oeffneLive: async () => ({ ok: false }), frage: (t) => window.confirm(t) };
export function setzeLiveHaken(h) { Object.assign(haken, h); }
// The large view of a deck (gross.js, the pop-up) registers how to open it: the head button and a double click on the deck name call it.
let grossHaken = null;
export function setzeGrossHaken(f) { grossHaken = typeof f === 'function' ? f : null; }
const GROSS_TITEL = 'Open the loop deck large: cells, strips and the clip editor';
// Reasons the page words itself when the server sends none (the server's `text` wins).
const GRUND_TEXTE = { zelle_laedt: 'That cell is still loading.', nichts_gespielt: 'Nothing played on that track yet.', kein_platz: 'No room for another effect stage or return.', graph_unbekannt: 'That effect cannot be used on a loop deck track.', nur_loop: 'A one-shot has no slices to jump to.' };
export const FRAGE_PROJEKT = 'Opening the live container closes the open project. Continue?';

// ---------- requests ----------
// Every write of this view goes through here. `projekt_offen` (a project other than the live container is open, the server never closes one by
// itself): ask once; on Yes open the live container the page's usual way and repeat the call once; on No nothing more happens.
// `ohneFrage`: the automatic create never asks.
async function senden(weg, daten, { ohneFrage = false, wiederholt = false } = {}) {
  try {
    const r = await fetch(weg, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.grund === 'projekt_offen' && !wiederholt) {
      if (ohneFrage || !haken.frage(FRAGE_PROJEKT)) return { ok: false, j, abgelehnt: true };
      const o = await haken.oeffneLive();
      if (!o?.ok) return { ok: false, j, abgelehnt: true };
      return senden(weg, daten, { wiederholt: true });
    }
    if (!r.ok || j.ok === false) { melde(`Loop deck: ${j.text ?? GRUND_TEXTE[j.grund] ?? j.grund ?? `refused (${r.status})`}`, true); return { ok: false, j }; }
    return { ok: true, j };
  } catch (e) { melde(`Loop deck: page server unreachable: ${e.message}`, true); return { ok: false, j: {} }; }
}
// Continuous controls (slider, knob): one request in flight per control, the latest value follows it.
const fluege = new Map();
function schickeLetzten(schluessel, weg, daten) {
  const f = fluege.get(schluessel) ?? { laeuft: false, spaeter: null };
  fluege.set(schluessel, f);
  if (f.laeuft) { f.spaeter = daten; return; }
  f.laeuft = true;
  senden(weg, daten).finally(() => {
    f.laeuft = false;
    if (f.spaeter) { const d = f.spaeter; f.spaeter = null; schickeLetzten(schluessel, weg, d); }
  });
}

// null / undefined / '' are no number (Number(null) would be 0: a clock at beat 0 that never was)
const zahl = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));
export async function ladeStand() {
  standAngefragt = true;
  if (ladend) { nochmal = true; return; }
  ladend = true;
  try {
    do {
      nochmal = false; veraltet = false;
      try {
        const r = await fetch('/loopdeck/stand');
        if (r.ok) {
          const j = await r.json();
          stand.decks = { 1: j.decks?.['1'] ?? null, 2: j.decks?.['2'] ?? null }; stand.geladen = true;
          uhrMelde(uhr, zahl(j.beat), zahl(j.bpm), jetzt());
        }
      } catch { /* the next event or redraw reads again */ }
      zeichneAlle();
      anlegenFallsNoetig();
      meldeExport();
    } while (nochmal);
  } finally { ladend = false; }
}

// ---------- building ----------
// ---------- strip row: HI MID LOW, COLOR HALL DLY knobs and the keys 1 2 3 per lane (M and the fader sit on the lane's foot) ----------
export const STRIP_VORGABE = false;   // collapsed by default: measured at 1920 x 1080 with the dock open, the place is 765 x 302 px and each of the 8 cell rows
                                      // is 17 px; a 28 px strip would push them under the 14 px minimum. The STRIP toggle shows it. Flip here if the place grows.
const COLOR_TITEL = 'COLOR: the effect chosen at the main mixer (FILTER: low-pass left, high-pass right); centre is dry (double click: centre)';
const stripSchluessel = (nr) => `loopdeck.strip.${nr}`;
function leseStrip(nr) {
  try { const w = globalThis.localStorage?.getItem(stripSchluessel(nr)); if (w === '1') return true; if (w === '0') return false; } catch { /* storage blocked: the default */ }
  return STRIP_VORGABE;
}
function schreibeStrip(nr, an) { try { globalThis.localStorage?.setItem(stripSchluessel(nr), an ? '1' : '0'); } catch { /* storage blocked: not remembered */ } }

function baueStrip(nr, s) {
  const strip = el('div', 'ld-strip'), baender = {}, sends = {};
  const einheit = (klasse, k, text) => { const e = el('div', `ld-einheit ${klasse}`); const n = el('span', 'ld-sendname', text); e.append(k.knoten, n); strip.append(e); return n; };
  for (const [band, text] of EQ_BAENDER) {
    const k = knopf(0, (db) => {
      const sp = stand.decks[nr]?.spuren?.[s];
      const loese = !!sp?.kill?.[band];   // a killed band shows its knob fully left; turning it takes the kill off in the same request
      if (sp) { sp.eq = { ...(sp.eq ?? {}), [band]: db }; if (loese) sp.kill = { ...sp.kill, [band]: false }; }
      schickeLetzten(`eq/${nr}/${s}/${band}`, '/loopdeck/spur', { deck: nr, spur: s + 1, eq: { [band]: db }, ...(loese ? { kill: { [band]: false } } : {}) });
    }, { ...EQ_OPT, klasse: 'ld-mini', label: `${text} EQ`, titel: `${text}: band gain in dB, fully left is off (double click: 0 dB)` });
    einheit('ld-band-einheit', k, text); baender[band] = { knopf: k };
  }
  // COLOR is the lane's `filter` (-1..+1, centre = dry); its label names the art chosen at the main mixer
  const color = knopf(0, (v) => {
    const sp = stand.decks[nr]?.spuren?.[s]; if (sp) sp.filter = v;
    schickeLetzten(`filter/${nr}/${s}`, '/loopdeck/spur', { deck: nr, spur: s + 1, filter: v });
  }, { klasse: 'ld-mini', label: 'COLOR', titel: COLOR_TITEL });
  const colorName = einheit('ld-color', color, 'COLOR'); colorName.dataset.colorname = '1'; zeigeColorName(colorName);
  for (const [art, text] of [['hall', 'HALL'], ['delay', 'DLY']]) {
    const k = knopf(-200, (db) => {
      const sp = stand.decks[nr]?.spuren?.[s]; if (sp) sp.send = { ...(sp.send ?? {}), [art]: db };
      schickeLetzten(`send/${nr}/${s}/${art}`, '/loopdeck/spur', { deck: nr, spur: s + 1, send: { [art]: db } });
    }, { ...SEND_OPT, klasse: 'ld-mini', label: `${text} send`, titel: `${text} send in dB (double click: off)` });
    einheit('ld-send', k, text).parentElement.dataset.send = art; sends[art] = k;
  }
  // keys 1 2 3: Beat FX 1, Beat FX 2 and FX3 (Remix) of this lane, lit = assigned (the look of the 1 2 3 keys of a mixer channel)
  const fxTasten = {}, fxReihe = el('div', 'ld-fxreihe');
  for (const u of FX_EINHEITEN) {
    const b = el('button', 'ld-fxtaste', u); b.type = 'button'; b.dataset.einheit = u; b.setAttribute('aria-pressed', 'false');
    b.title = `Assign this lane to ${u === '3' ? 'FX3 (Remix)' : `Beat FX ${u}`}`;
    b.addEventListener('click', () => {
      const sp = stand.decks[nr]?.spuren?.[s];
      const alt = !!sp?.fx?.[u], neu = !alt;
      if (sp) sp.fx = { ...(sp.fx ?? {}), [u]: neu };
      zeichneDeck(nr);
      senden('/loopdeck/spur', { deck: nr, spur: s + 1, fx: { [u]: neu } }).then((r) => {
        if (!r.ok && sp && !!sp.fx?.[u] === neu) { sp.fx = { ...sp.fx, [u]: alt }; zeichneDeck(nr); }
      });
    });
    fxReihe.append(b); fxTasten[u] = b;
  }
  strip.append(fxReihe);
  return { strip, baender, sends, color, colorName, fxTasten };
}

function baueSpur(nr, s) {
  const spur = el('div', 'ld-spur');
  // the column and cell component (session/spalte.js, shared with the pop-up), compact: head, now-playing strip, eight cells, stop; the strip row goes into its zug-slot
  const spalte = baueSpalte(spur, {
    variante: 'kompakt',
    beiStart: (zelle) => klickZelle(nr, s, zelle),   // a filled cell launches
    beiWahl: (zelle) => klickZelle(nr, s, zelle),    // an empty one is selected as load target
    beiStopp: () => senden('/loopdeck/stopp', { deck: nr, spur: s + 1 }),
    beiAblegen: (zelle, inhalt) => ablegen(nr, s + 1, zelle, inhalt),
    beiWelleKlick: (anteil) => klickWelle(nr, s, anteil),
    beiMenue: (zelle, anker) => oeffneZellmenue(nr, s, zelle, anker),
    beiZiehen: (zelle, e) => schreibeZelle(e, { deck: nr, spur: s + 1, zelle }),
  });
  const fuss = el('div', 'ld-fuss');
  const mute = el('button', 'ld-mute', 'M'); mute.type = 'button'; mute.title = 'Mute'; mute.setAttribute('aria-pressed', 'false');
  const fader = el('input', 'live-regler ld-fader'); fader.type = 'range'; fader.setAttribute('type', 'range'); fader.min = '-60'; fader.max = '6'; fader.step = '0.5'; fader.value = '0'; fader.title = 'Track volume (dB)';
  mute.addEventListener('click', () => {
    const sp = stand.decks[nr]?.spuren?.[s];
    const alt = sp?.mute ?? false, neu = !alt;
    if (sp) sp.mute = neu;
    zeichneDeck(nr);
    senden('/loopdeck/spur', { deck: nr, spur: s + 1, mute: neu }).then((r) => { if (!r.ok && sp && sp.mute === neu) { sp.mute = alt; zeichneDeck(nr); } });
  });
  fader.addEventListener('input', () => {
    const v = Number(fader.value), sp = stand.decks[nr]?.spuren?.[s];
    if (sp) sp.fader_db = v;
    schickeLetzten(`fader/${nr}/${s}`, '/loopdeck/spur', { deck: nr, spur: s + 1, fader_db: v });
  });
  fuss.append(mute, fader);   // COLOR lives in the STRIP row only
  const kz = baueStrip(nr, s);
  spur.querySelector('.zug-slot').append(kz.strip);
  spur.append(fuss);
  return { spur, spalte, mute, fader, strip: kz };
}

function baueDeck(wurzel, nr) {
  wurzel.classList.add('loopdeck-bau');
  const kopf = el('div', 'ld-kopfzeile');
  const name = el('span', 'ld-deckname', `LOOP ${nr}`);
  const raster = el('span', 'ld-raster'); raster.setAttribute('role', 'group'); raster.setAttribute('aria-label', 'Launch grid');
  const rasterKnoepfe = RASTER.map(([wert, text]) => {
    const b = el('button', 'ld-r', text); b.type = 'button'; b.dataset.raster = wert; b.title = `Launch on the next grid point: ${text}`;
    b.addEventListener('click', () => {
      const d = stand.decks[nr], alt = d?.raster;
      if (d) { d.raster = wert; zeichneDeck(nr); }
      senden('/loopdeck/raster', { deck: nr, raster: wert }).then((r) => { if (!r.ok && d && d.raster === wert) { d.raster = alt; zeichneDeck(nr); } });
    });
    raster.append(b); return b;
  });
  const stopAlle = el('button', 'ld-stopall', 'STOP ALL'); stopAlle.type = 'button';
  stopAlle.addEventListener('click', () => senden('/loopdeck/stopp', { deck: nr }));
  const set = el('button', 'ld-set', 'SET'); set.type = 'button'; set.title = 'Set menu'; set.setAttribute('aria-haspopup', 'true');
  const menue = el('div', 'ld-setmenu'); menue.hidden = true;
  const schliesseSet = () => { menue.hidden = true; set.classList.remove('an'); };
  const setMenue = baueSetMenue(menue, {
    schliesse: schliesseSet, frage: (t) => haken.frage(t), liste: holeSets,
    speichern: (name) => speichereSet(nr, name), laden: (name) => ladeSet(nr, name), leeren: () => leereDeck(nr),
  });
  set.addEventListener('click', () => { menue.hidden = !menue.hidden; set.classList.toggle('an', !menue.hidden); if (!menue.hidden) setMenue.zuruecksetzen(); });
  const neu = el('button', 'ld-neu', 'CREATE DECK'); neu.type = 'button'; neu.hidden = true; neu.title = 'Create this loop deck in the live container';
  neu.addEventListener('click', () => anlegen(nr));
  const hinweis = el('span', 'ld-hinweis', 'The live container is not open: CREATE DECK opens it.'); hinweis.hidden = true;
  const stripTaste = el('button', 'ld-strip-taste', 'STRIP'); stripTaste.type = 'button'; stripTaste.title = 'Show or hide the lane strip row (EQ, COLOR, sends, FX 1 2 3)';
  const setzeStrip = (an) => { wurzel.classList.toggle('mit-strip', an); stripTaste.classList.toggle('an', an); stripTaste.setAttribute('aria-pressed', String(an)); };
  setzeStrip(leseStrip(nr));
  stripTaste.addEventListener('click', () => { const an = !wurzel.classList.contains('mit-strip'); setzeStrip(an); schreibeStrip(nr, an); });
  const gross = el('button', 'ld-gross', '⤢'); gross.type = 'button'; gross.title = GROSS_TITEL;
  gross.addEventListener('click', () => grossHaken?.(nr, gross));
  name.addEventListener('dblclick', () => grossHaken?.(nr, gross));
  name.title = GROSS_TITEL;
  kopf.append(name, raster, hinweis, stopAlle, set, stripTaste, neu, gross);
  const rumpf = el('div', 'ld-rumpf');
  // the scene column has the row template of a track (head, strip, cell rows, stop, [strip row], foot): its buttons sit exactly beside the cell rows
  const szenen = el('div', 'ld-szenen'), szenenZeilen = el('div', 'ld-szenenzeilen');
  for (let z = 1; z <= ZELLEN; z++) {
    const b = el('button', 'ld-szene', String(z)); b.type = 'button'; b.dataset.zeile = String(z); b.title = `Launch row ${z} of all tracks`;
    b.addEventListener('click', () => senden('/loopdeck/szene', { deck: nr, zeile: z }));
    szenenZeilen.append(b);
  }
  szenen.append(el('span', 'ld-szenenluecke'), el('span', 'ld-szenenluecke'), szenenZeilen, el('span', 'ld-szenenluecke'), el('span', 'ld-szenenluecke ld-szenenstrip'), el('span', 'ld-szenenluecke'));
  const spurenKnoten = el('div', 'ld-spuren');
  const spuren = Array.from({ length: SPUREN }, (_, s) => { const x = baueSpur(nr, s); spurenKnoten.append(x.spur); return x; });
  rumpf.append(szenen, spurenKnoten);
  // cells are at least 20 px high: when the deck is lower, the rows scroll (all tracks and the scene column together) instead of lying under STOP
  let gleiche = false;
  rumpf.addEventListener('scroll', (e) => {
    if (gleiche || !(e.target instanceof Element) || !e.target.matches('.zellen, .ld-szenenzeilen')) return;
    gleiche = true;
    for (const z of rumpf.querySelectorAll('.zellen, .ld-szenenzeilen')) if (z !== e.target) z.scrollTop = e.target.scrollTop;
    gleiche = false;
    markiereSchnitt();
  }, true);
  // cut hint (UI check M1): `ld-schnitt` on the body of the deck while rows lie below the visible area; the CSS fades the lower edge of the rows
  const markiereSchnitt = () => {
    const z = rumpf.querySelector('.zellen');
    rumpf.classList.toggle('ld-schnitt', !!z && z.scrollHeight > z.clientHeight + 2 && z.scrollTop + z.clientHeight < z.scrollHeight - 2);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(markiereSchnitt).observe(rumpf);
  const zellmenue = baueMenue((koerper) => { const m = zellmenue.ctx; if (m) zelleAendern(nr, m, koerper); });
  zellmenue.ctx = null;
  wurzel.append(kopf, menue, rumpf, zellmenue.knoten);
  return { wurzel, name, rasterKnoepfe, neu, hinweis, menue, zellmenue, spuren, ziel: null, neuVersucht: false };
}

// ---------- actions ----------
// A click in the strip jumps the track to the slice under the pointer (the playing cell, else the last one that played; the server decides).
// A one-shot has no slices: nothing is posted. Without any cell known the server answers nichts_gespielt, which the page shows.
function klickWelle(nr, s, anteil) {
  const sp = stand.decks[nr]?.spuren?.[s];
  const n = sp?.lauf?.zelle ?? sp?.lauf?.zuletzt ?? null;
  if (n !== null && sp?.zellen?.[n - 1]?.art === 'einmal') return;
  const slice = Math.min(8, Math.max(1, Math.floor(anteil * 8) + 1));
  senden('/loopdeck/sprung', { deck: nr, spur: s + 1, slice });
}
function klickZelle(nr, s, zelle) {
  const d = stand.decks[nr], sp = d?.spuren?.[s];
  if (sp?.zellen?.[zelle - 1]) { senden('/loopdeck/start', { deck: nr, spur: s + 1, zelle }); return; }
  const a = ansichten.get(nr);
  if (!a) return;
  a.ziel = { spur: s + 1, zelle }; letztesDeck = nr; exportDeck = null;   // one load target per deck; a new selection overrides the toggle
  zeichneDeck(nr);
  meldeExport();
}
// Drop on a cell: a library row / module entry loads into it, a cell of any deck moves into it. The target changes only after the server said ok
// (the stand is read again); a drop on the cell the drag started from does nothing and posts nothing.
let ablageLaeuft = false;
async function ablegen(nr, spur, zelle, inhalt) {
  if (ablageLaeuft) return;
  if (inhalt.art === 'zelle') {
    const von = inhalt.von;
    if (von.deck === nr && von.spur === spur && von.zelle === zelle) return;
    ablageLaeuft = true;
    try {
      const r = await senden('/loopdeck/bewegen', { von, nach: { deck: nr, spur, zelle } });
      if (!r.ok) return;
      melde(`Moved to LOOP ${nr}, track ${spur}, cell ${zelle}`);
      await ladeStand();
    } finally { ablageLaeuft = false; }
    return;
  }
  ablageLaeuft = true;
  try { await ladeInZelle(nr, spur, zelle, inhalt.quelle); } finally { ablageLaeuft = false; }
}
async function ladeInZelle(nr, spur, zelle, quelle) {
  const r = await senden('/loopdeck/laden', { deck: nr, spur, zelle, quelle });
  if (!r.ok) return false;
  melde(`Loaded into LOOP ${nr}, track ${r.j.spur ?? spur}, cell ${r.j.zelle ?? zelle}`);
  await ladeStand();
  return true;
}

// ---------- sets ----------
async function holeSets() {
  try {
    const r = await fetch('/loopsets');
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.sets) ? j.sets : null;
  } catch { return null; }
}
async function speichereSet(nr, name) {
  const r = await senden('/loopset/speichern', { deck: nr, name });
  if (r.ok) melde(`Set "${name}" saved from LOOP ${nr}`);
  return r.ok;
}
async function ladeSet(nr, name) {
  const r = await senden('/loopset/laden', { deck: nr, name });
  if (!r.ok) return false;
  melde(`Set "${name}" loaded into LOOP ${nr}`);
  await ladeStand();
  return true;
}
async function leereDeck(nr) {
  const r = await senden('/loopdeck/leeren', { deck: nr });
  if (!r.ok) return false;
  melde(`LOOP ${nr} cleared`);
  await ladeStand();
  return true;
}

// The launch grid of a deck as the place has it (the large view shows the same value); null before the stand is read.
export const deckRaster = (nr) => stand.decks[nr]?.raster ?? null;
export const zielVon = (nr) => ansichten.get(nr)?.ziel ?? null;
// The export row of the track decks (P5) and the library buttons share this one target: the deck of the toggle, else the deck that holds the
// selected cell, else the only loop deck there is, else deck 1; plus the selected cell when it lies in that deck.
const deckDa = (nr) => !!stand.decks[nr];
export const loopdeckAnzahl = () => (deckDa(1) ? 1 : 0) + (deckDa(2) ? 1 : 0);
export function exportZiel() {
  let nr = exportDeck ?? letztesDeck;
  if (nr === null || !deckDa(nr)) nr = deckDa(1) === deckDa(2) ? 1 : deckDa(2) ? 2 : 1;
  const z = zielVon(nr);
  return z ? { deck: nr, spur: z.spur, zelle: z.zelle } : { deck: nr, spur: null, zelle: null };
}
export function setzeExportDeck(nr) { exportDeck = nr === 2 ? 2 : 1; meldeExport(); }
export function wechsleExportDeck() { setzeExportDeck(exportZiel().deck === 1 ? 2 : 1); }
export function beiExportAenderung(f) { hoerer.add(f); }
function meldeExport() { for (const f of hoerer) f(); }
// Library buttons -> L1 / L2: load `quelle` ({ sha } ...) into the selected cell of deck nr, or let the server pick the first empty one.
export async function ladeInDeck(nr, quelle) {
  const z = zielVon(nr);
  const r = await senden('/loopdeck/laden', z ? { deck: nr, spur: z.spur, zelle: z.zelle, quelle } : { deck: nr, quelle });
  if (!r.ok) return false;
  const a = ansichten.get(nr); if (a) a.ziel = null;
  melde(`Loaded into LOOP ${nr}, track ${r.j.spur ?? '?'}, cell ${r.j.zelle ?? '?'}`);
  await ladeStand();
  return true;
}

// Strudel place -> L1 / L2 1..4: a finished loop of the library goes into the first empty cell of track `spur` of deck nr (no selected cell).
export async function ladeLoopInSpur(nr, spur, name) {
  const r = await senden('/loopdeck/laden', { deck: nr, spur, quelle: { loop: name } });
  if (!r.ok) return false;
  melde(`Strudel sum loaded into LOOP ${nr}, track ${r.j.spur ?? spur}, cell ${r.j.zelle ?? '?'}`);
  await ladeStand();
  return true;
}

// EXPORT / LOOP -> 1..4 of track deck `von`: the running loop goes into loop deck track `spur` (cell: the selected one when it lies in that track,
// else the first empty one) or, without `spur`, into the first empty cell of the target deck. The server opens or creates the live container.
export const exportBusy = (von) => exportLaeuft.has(von);
// The stand is read once for the export row even when no loop place shows (the L1/L2 toggle and the target need it).
export function sorgeFuerStand() { if (!standAngefragt) ladeStand(); }
export async function exportiereVonDeck(von, spur = null) {
  if (exportLaeuft.has(von)) return false;   // one request per track deck: a double click does not fill two cells
  exportLaeuft.add(von); meldeExport();
  try { return await sendeExport(von, spur); } finally { exportLaeuft.delete(von); meldeExport(); }
}
async function sendeExport(von, spur) {
  const ziel = exportZiel();
  const koerper = { deck: ziel.deck, quelle: { von_deck: von } };
  if (spur !== null) { koerper.spur = spur; if (ziel.spur === spur) koerper.zelle = ziel.zelle; }
  const r = await senden('/loopdeck/laden', koerper);
  if (!r.ok) return false;
  const a = ansichten.get(ziel.deck); if (a) a.ziel = null;
  melde(`Loop exported to LOOP ${ziel.deck} track ${r.j.spur ?? '?'}, cell ${r.j.zelle ?? '?'}`);
  await ladeStand();
  return true;
}

// ---------- cell menu ----------
function oeffneZellmenue(nr, s, zelle, anker) {
  const a = ansichten.get(nr), z = stand.decks[nr]?.spuren?.[s]?.zellen?.[zelle - 1];
  if (!a || !z) return;   // an empty cell has no menu
  a.zellmenue.ctx = { spur: s + 1, zelle };
  a.zellmenue.oeffne(z, anker);
}
async function zelleAendern(nr, ctx, koerper) {
  const r = await senden('/loopdeck/zelle', { deck: nr, spur: ctx.spur, zelle: ctx.zelle, ...koerper });
  if (r.ok) await ladeStand();
}
if (typeof document !== 'undefined') {   // a click outside closes the open menus
  document.addEventListener?.('pointerdown', (e) => {
    for (const a of ansichten.values()) if (a.zellmenue.istOffen() && !a.zellmenue.knoten.contains(e.target)) a.zellmenue.schliesse();
  });
}

// Asks the server which project is open right now (awaited, not the page's cached live.projekt: a `proj` event reads the stand before pruefeLive has
// run, and creating a deck while another project is open is answered 409 projekt_offen). Anything but the live set, or no answer: false.
async function liveJetztOffen() {
  try { return (await (await fetch('/proj/aktuell?nur=rev')).json()).slug === 'live'; } catch { return false; }
}
async function anlegen(nr, automatisch = false) {
  if (automatisch && !(await liveJetztOffen())) { const a = ansichten.get(nr); if (a) a.neuVersucht = false; return; }   // the try is not used up: the live set may open later
  const r = await senden('/loopdeck/neu', { deck: nr }, { ohneFrage: automatisch });
  if (r.ok) await ladeStand();
}
// A deck that does not exist yet is created once when its place shows (spec 7), but only while the live container is already open: creating
// opens it, which closes a production project. Otherwise the head shows CREATE DECK and a hint; the button asks first (senden).
function anlegenFallsNoetig() {
  if (!stand.geladen || !haken.liveOffen()) return;
  for (const [nr, a] of ansichten) {
    if (stand.decks[nr] === null && !a.neuVersucht && sichtbar(a.wurzel)) { a.neuVersucht = true; anlegen(nr, true); }
  }
}

// ---------- drawing ----------
function sichtbar(w) {
  for (let e = w; e; e = e.parentElement) if (e.hidden || e.classList?.contains('platz-aus')) return false;
  return true;
}
export function zeichneDeck(nr) {
  const a = ansichten.get(nr);
  if (!a) return;
  const v = deckAnsicht(stand.decks[nr], nr);
  if (a.ziel && stand.decks[nr]?.spuren?.[a.ziel.spur - 1]?.zellen?.[a.ziel.zelle - 1]) a.ziel = null;   // the target got filled meanwhile
  if (a.zellmenue.istOffen() && !stand.decks[nr]?.spuren?.[a.zellmenue.ctx.spur - 1]?.zellen?.[a.zellmenue.ctx.zelle - 1]) a.zellmenue.schliesse();
  a.neu.hidden = v.da || !stand.geladen;
  a.hinweis.hidden = a.neu.hidden || haken.liveOffen();
  a.wurzel.classList.toggle('leer', !v.da);
  for (const b of a.rasterKnoepfe) { const an = b.dataset.raster === v.raster; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
  v.spuren.forEach((s, k) => {
    const x = a.spuren[k];
    x.spur.className = `ld-spur${s.spielt ? ' spielt' : ''}${s.verwaist ? ' verwaist' : ''}${s.mute ? ' stumm' : ''}`;
    x.mute.classList.toggle('an', s.mute); x.mute.setAttribute('aria-pressed', String(s.mute));
    if (document.activeElement !== x.fader) x.fader.value = String(s.faderDb);
    const roh = stand.decks[nr]?.spuren?.[k];
    for (const art of ['hall', 'delay']) if (!x.strip.sends[art].gegriffen()) x.strip.sends[art].setze(Number(roh?.send?.[art] ?? -200));
    if (!x.strip.color.gegriffen()) x.strip.color.setze(s.filter);
    zeigeColorName(x.strip.colorName);
    for (const [band] of EQ_BAENDER) {
      const bd = x.strip.baender[band], gekillt = !!roh?.kill?.[band];
      if (!bd.knopf.gegriffen()) bd.knopf.setze(gekillt ? -200 : Number(roh?.eq?.[band] ?? 0));   // a killed band shows its knob fully left
    }
    for (const u of FX_EINHEITEN) { const t = x.strip.fxTasten[u], an = !!roh?.fx?.[u]; t.classList.toggle('an', an); t.setAttribute('aria-pressed', String(an)); }
    x.spalte.zeichne({ kurz: s.name, name: s.titel, zellen: roh?.zellen ?? [], lauf: s.lauf }, a.ziel && a.ziel.spur === s.nr ? a.ziel.zelle : null, uhr.bpm);
  });
  zeichnePositionen(jetzt());
  starteSchleife();
}
function zeigeHinweis(nr) { const a = ansichten.get(nr); if (a) a.hinweis.hidden = a.neu.hidden || haken.liveOffen(); }
export function zeichneAlle() { for (const nr of ansichten.keys()) zeichneDeck(nr); }

// Play position of every playing track (the head over the waveform and the progress edge of the lit cell).
export function zeichnePositionen(t) {
  const beat = beatJetzt(uhr, t);
  for (const [nr, a] of ansichten) {
    const v = deckAnsicht(stand.decks[nr], nr);
    v.spuren.forEach((_, k) => a.spuren[k].spalte.position(beat, uhr.bpm));
  }
}
function istAktiv() { return [...ansichten.keys()].some((nr) => deckAnsicht(stand.decks[nr], nr).spuren.some((s) => s.spielt)); }
function starteSchleife() {
  if (schleifeAb || !istAktiv()) return;
  schleifeAb = starteTakt(() => {
    zeichnePositionen(jetzt());
    if (!istAktiv()) { schleifeAb?.(); schleifeAb = null; }
  });
}

// ---------- entry points ----------
// Called with every redraw of the places (live_view.js zeichneLive and slots_view.js wendePlaetzeAn): builds the nodes once,
// reads the stand when a container shows for the first time or a 'proj' event came while none was shown.
export function zeigeLoopdecks() {
  for (const w of $$('.loopdeck[data-deck]')) {
    const nr = Number(w.dataset.deck);
    if (!ansichten.has(nr) && (nr === 1 || nr === 2)) { ansichten.set(nr, baueDeck(w, nr)); zeichneDeck(nr); }
  }
  const zeigt = [...ansichten.values()].some((a) => sichtbar(a.wurzel));
  if (zeigt && (!stand.geladen || veraltet)) { veraltet = false; ladeStand(); }
  else { for (const nr of ansichten.keys()) zeigeHinweis(nr); anlegenFallsNoetig(); }
}
// The page's event stream (stream.js): the run state of one track, the project, the beat clock.
export function loopdeckEreignis(a, f) {
  if (a === '/uhr') { uhrMelde(uhr, zahl(f.beat), zahl(f.bpm), jetzt()); return; }
  if (a === 'loopdeck') { if (laufEreignis({ decks: stand.decks }, f)) zeichneDeck(Number(f.deck)); return; }
  if (a === 'proj' || a === 'stand') {   // 'stand': the stream (re)connected, run states may have changed unseen
    if ([...ansichten.values()].some((x) => sichtbar(x.wurzel))) ladeStand(); else veraltet = true;
  }
}
// For tests: forget everything built and read so far.
export function zuruecksetzen() {
  ansichten.clear(); letztesDeck = null; exportDeck = null; stand.decks = { 1: null, 2: null }; stand.geladen = false; leereWellen(); fluege.clear();
  ladend = false; nochmal = false; veraltet = false; schleifeAb?.(); schleifeAb = null; standAngefragt = false; exportLaeuft.clear(); Object.assign(uhr, neueUhr());
}

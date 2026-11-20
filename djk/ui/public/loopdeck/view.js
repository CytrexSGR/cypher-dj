// Loop deck view (plan loop deck P2): draws loop deck 1 and 2 into the containers `.loopdeck[data-deck]` of the places `loops` and `loops2`.
// State comes from GET /loopdeck/stand (read when a container shows, on every 'proj' event and after an own change) and from the SSE event
// { a: 'loopdeck', f: { deck, spur, lauf } } (run state of one track). The nodes are built once and only updated afterwards, so focus and
// drags survive a redraw. Per deck: head row (name, grid, STOP ALL, set menu, create button), scene column, four track columns.
import { $$, el, melde } from '../page_state.js';
import { leseWelle, spalten, zeichneSpalte } from '../wave.js';
import { KERN, kernAusX, kernZuX } from '../curves.js';
import { baueMenue, baueFxMenue } from './menue.js';
import { oeffneGeraetFenster } from '../device_open.js';
import { baueSetMenue } from './sets.js';
import { bindeAblage, schreibeZelle } from './drag.js';
import { RASTER, SPUREN, ZELLEN, beatJetzt, deckAnsicht, laufEreignis, neueUhr, spielPos, uhrMelde } from './model.js';

const jetzt = () => performance.now();
const stand = { decks: { 1: null, 2: null }, geladen: false };
const uhr = neueUhr();
const ansichten = new Map();   // deck number -> { wurzel, kopf, szenen, spuren: [...], ziel: {spur, zelle} | null, neuVersucht }
let letztesDeck = null;       // the deck whose load target was selected last (export target when none is selected)
let exportDeck = null;        // the deck chosen with the toggle of the track decks' export row; null = follow the selection
const hoerer = new Set();     // called after every change of the stand or of the export target (the export row redraws itself)
let ladend = false, nochmal = false, veraltet = false, schleifeLaeuft = false;
const wellen = new Map();      // sha -> Promise of the decoded waveform or null (no waveform: the strip stays empty); a failed request is not kept
let standAngefragt = false;    // the stand was asked for once (the export row asks when no loop place does)
let effekteListe = null, effekteAnfrage = null;   // GET /loopdeck/effekte, fetched once per page load; a failed request is asked again at the next opening
const exportLaeuft = new Set();   // track decks with an export request in flight

// The live container belongs to live_view.js (which imports this module): it registers how to read "is it open" and how to open it (with its own
// confirmation). Without it (tests of this view alone) the container counts as closed and opening fails.
const haken = { liveOffen: () => false, oeffneLive: async () => ({ ok: false }), frage: (t) => window.confirm(t) };
export function setzeLiveHaken(h) { Object.assign(haken, h); }
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
// Rotary knob. Without `opt` it is the filter knob (-1..+1, double click 0). `opt` generalises it for the strip row: the knob works on
// x = nachX(value) between nachX(min) and nachX(max); drag and keys move x, `beiWert` gets vonX(x) rounded to 1/rund; a double click sets `neutral`.
function knopf(wert, beiWert, opt = {}) {
  const { klasse = 'knopf ld-filter', label = 'Filter', titel = 'Filter: low-pass left, high-pass right (double click: off)', min = -1, max = 1, neutral = 0,
    nachX = (v) => v, vonX = (x) => x, schritt = 0.05, rund = 100 } = opt;
  const x0 = nachX(min), x1 = nachX(max), spanne = x1 - x0;
  const k = el('div', klasse); k.setAttribute('role', 'slider'); k.tabIndex = 0; k.setAttribute('tabindex', '0');
  k.setAttribute('aria-label', label); k.title = titel;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 48 48');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); ring.setAttribute('class', 'ring'); ring.setAttribute('cx', '24'); ring.setAttribute('cy', '24'); ring.setAttribute('r', '20');
  const zeiger = document.createElementNS('http://www.w3.org/2000/svg', 'line'); zeiger.setAttribute('class', 'zeiger'); zeiger.setAttribute('x1', '24'); zeiger.setAttribute('y1', '24');
  svg.append(ring, zeiger); k.append(svg);
  const xVon = (v) => Math.max(x0, Math.min(x1, nachX(Math.max(min, Math.min(max, v)))));
  const runde = (v) => Math.round(v * rund) / rund;
  let akt = wert;
  const setze = (v) => {
    const w = Math.max(min, Math.min(max, v)); akt = w;
    const a = ((xVon(w) - x0) / spanne * 2 - 1) * 135 * Math.PI / 180;
    zeiger.setAttribute('x2', (24 + 15 * Math.sin(a)).toFixed(2)); zeiger.setAttribute('y2', (24 - 15 * Math.cos(a)).toFixed(2));
    k.setAttribute('aria-valuenow', w.toFixed(2));
  };
  const ausX = (x) => runde(Math.max(min, Math.min(max, vonX(Math.max(x0, Math.min(x1, x))))));
  let start = null;
  k.addEventListener('pointerdown', (e) => { start = { y: e.clientY ?? 0, x: xVon(akt) }; k.classList.add('gegriffen'); k.setPointerCapture?.(e.pointerId); });
  k.addEventListener('pointermove', (e) => {
    if (!start) return;
    const v = ausX(start.x + (start.y - (e.clientY ?? 0)) / (e.shiftKey ? 600 : 150) * spanne);
    setze(v); beiWert(v);
  });
  const ende = () => { start = null; k.classList.remove('gegriffen'); };
  k.addEventListener('pointerup', ende); k.addEventListener('pointercancel', ende);
  k.addEventListener('dblclick', () => { setze(neutral); beiWert(neutral); });
  k.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? schritt : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -schritt : null;
    if (d === null) return;
    e.preventDefault?.();
    const v = ausX(xVon(akt) + d);
    setze(v); beiWert(v);
  });
  setze(wert);
  return { knoten: k, setze, gegriffen: () => start !== null };
}

async function holeEffekte() {
  if (effekteListe) return effekteListe;
  effekteAnfrage ??= (async () => {
    try {
      const r = await fetch('/loopdeck/effekte');
      const j = r.ok ? await r.json() : null;
      if (Array.isArray(j?.graphen)) effekteListe = j.graphen;
    } catch { /* the choice shows what it has */ }
    effekteAnfrage = null;
    return effekteListe;
  })();
  return effekteAnfrage;
}
// Same rule as the server's `kurz` (index 1.4): name without `fx-`, first 6 characters, upper case; the server's list wins once it is loaded.
const kurzVon = (graph) => effekteListe?.find((g) => g.name === graph)?.kurz ?? String(graph).replace(/^fx-/, '').slice(0, 6).toUpperCase();

// ---------- strip row (channel strip PZ1): LO MID HI per track, kill on the label ----------
export const STRIP_VORGABE = false;   // collapsed by default: measured at 1920 x 1080 with the dock open, the place is 765 x 302 px and each of the 8 cell rows
                                      // is 17 px; a 28 px strip would push them under the 14 px minimum. The STRIP toggle shows it. Flip here if the place grows.
const BAENDER = [['tief', 'LO'], ['mitte', 'MID'], ['hoch', 'HI']];
const stripSchluessel = (nr) => `loopdeck.strip.${nr}`;
function leseStrip(nr) {
  try { const w = globalThis.localStorage?.getItem(stripSchluessel(nr)); if (w === '1') return true; if (w === '0') return false; } catch { /* storage blocked: the default */ }
  return STRIP_VORGABE;
}
function schreibeStrip(nr, an) { try { globalThis.localStorage?.setItem(stripSchluessel(nr), an ? '1' : '0'); } catch { /* storage blocked: not remembered */ } }

function baueStrip(nr, s) {
  const strip = el('div', 'ld-strip'), baender = {};
  for (const [band, text] of BAENDER) {
    const einheit = el('div', 'ld-einheit');
    const k = knopf(0, (db) => {
      const sp = stand.decks[nr]?.spuren?.[s]; if (sp) sp.eq = { ...(sp.eq ?? {}), [band]: db };
      schickeLetzten(`eq/${nr}/${s}/${band}`, '/loopdeck/spur', { deck: nr, spur: s + 1, eq: { [band]: db } });
    }, { klasse: 'ld-mini', label: `${text} EQ`, titel: `${text}: band gain in dB (double click: 0 dB)`, min: -200, max: 6, neutral: 0,
      nachX: (db) => kernZuX(KERN.eq, db), vonX: (x) => kernAusX(KERN.eq, x), schritt: 0.025 });
    const b = el('button', 'ld-band', text); b.type = 'button'; b.dataset.band = band; b.title = `${text}: click to kill the band`; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const sp = stand.decks[nr]?.spuren?.[s];
      const alt = !!sp?.kill?.[band], neu = !alt;
      if (sp) sp.kill = { ...(sp.kill ?? {}), [band]: neu };
      zeichneDeck(nr);
      senden('/loopdeck/spur', { deck: nr, spur: s + 1, kill: { [band]: neu } }).then((r) => {
        if (!r.ok && sp && !!sp.kill?.[band] === neu) { sp.kill = { ...sp.kill, [band]: alt }; zeichneDeck(nr); }
      });
    });
    einheit.append(k.knoten, b); strip.append(einheit); baender[band] = { knopf: k, label: b };
  }
  // PZ2: HALL and DLY sends (the fader law up to 0 dB, double click turns the send off) and the effect chip
  const sends = {};
  for (const [art, text] of [['hall', 'HALL'], ['delay', 'DLY']]) {
    const einheit = el('div', 'ld-einheit ld-send'); einheit.dataset.send = art;
    const k = knopf(-200, (db) => {
      const sp = stand.decks[nr]?.spuren?.[s]; if (sp) sp.send = { ...(sp.send ?? {}), [art]: db };
      schickeLetzten(`send/${nr}/${s}/${art}`, '/loopdeck/spur', { deck: nr, spur: s + 1, send: { [art]: db } });
    }, { klasse: 'ld-mini', label: `${text} send`, titel: `${text} send in dB (double click: off)`, min: -200, max: 0, neutral: -200,
      nachX: (db) => kernZuX(KERN.fader, db), vonX: (x) => Math.min(0, kernAusX(KERN.fader, x)), schritt: 0.025 });
    const name = el('span', 'ld-sendname', text);
    einheit.append(k.knoten, name); strip.append(einheit); sends[art] = k;
  }
  const fx = el('button', 'ld-fx', '+'); fx.type = 'button'; fx.title = 'Effect slot: click to choose';
  fx.addEventListener('click', () => klickChip(nr, s));
  strip.append(fx);
  return { strip, baender, sends, fx };
}

function baueSpur(nr, s) {
  const spur = el('div', 'ld-spur');
  const titel = el('div', 'ld-titel', '');
  const welle = el('div', 'ld-welle'), leinwand = document.createElement('canvas'); leinwand.width = 240; leinwand.height = 36;
  const kopf = el('div', 'ld-kopf'); kopf.hidden = true;
  welle.append(leinwand); for (let i = 1; i < 8; i++) { const m = el('span', 'ld-marke'); m.style.left = `${i * 12.5}%`; welle.append(m); }
  welle.append(kopf);
  welle.addEventListener('click', (e) => klickWelle(nr, s, e, welle));
  const zellen = el('div', 'ld-zellen'), knoepfe = [];
  for (let i = 0; i < ZELLEN; i++) {
    const b = el('button', 'ld-zelle leer'); b.type = 'button'; b.dataset.zelle = String(i + 1);
    const chip = el('span', 'ld-chip'), icon = el('span', 'ld-art', ''), name = el('span', 'ld-name', '');
    const griff = el('span', 'ld-griff', '⋮'); griff.title = 'Cell menu'; griff.hidden = true;
    b.append(chip, icon, name, griff);
    b.addEventListener('click', () => klickZelle(nr, s, i + 1));
    b.addEventListener('contextmenu', (e) => { e.preventDefault?.(); oeffneZellmenue(nr, s, i + 1); });
    griff.addEventListener('click', (e) => { e.stopPropagation?.(); oeffneZellmenue(nr, s, i + 1); });
    b.addEventListener('dragstart', (e) => {   // a filled cell, playing or not, can be dragged; an empty one cannot
      if (!stand.decks[nr]?.spuren?.[s]?.zellen?.[i]) { e.preventDefault?.(); return; }
      schreibeZelle(e, { deck: nr, spur: s + 1, zelle: i + 1 });
    });
    bindeAblage(b, (inhalt) => ablegen(nr, s + 1, i + 1, inhalt));
    zellen.append(b); knoepfe.push({ b, chip, icon, name, griff });
  }
  const fuss = el('div', 'ld-fuss');
  const stopp = el('button', 'ld-stopp', 'STOP'); stopp.type = 'button'; stopp.title = 'Stop this track on the next grid point';
  const mute = el('button', 'ld-mute', 'M'); mute.type = 'button'; mute.title = 'Mute'; mute.setAttribute('aria-pressed', 'false');
  const fader = el('input', 'live-regler ld-fader'); fader.type = 'range'; fader.setAttribute('type', 'range'); fader.min = '-60'; fader.max = '6'; fader.step = '0.5'; fader.value = '0'; fader.title = 'Track volume (dB)';
  const filter = knopf(0, (v) => {
    const sp = stand.decks[nr]?.spuren?.[s]; if (sp) sp.filter = v;
    schickeLetzten(`filter/${nr}/${s}`, '/loopdeck/spur', { deck: nr, spur: s + 1, filter: v });
  });
  stopp.addEventListener('click', () => senden('/loopdeck/stopp', { deck: nr, spur: s + 1 }));
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
  fuss.append(stopp, mute, fader, filter.knoten);
  const kz = baueStrip(nr, s);
  spur.append(titel, welle, zellen, kz.strip, fuss);
  return { spur, titel, leinwand, kopf, knoepfe, stopp, mute, fader, filter, strip: kz, sha: null };
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
  const stripTaste = el('button', 'ld-strip-taste', 'STRIP'); stripTaste.type = 'button'; stripTaste.title = 'Show or hide the channel strip row (EQ, sends, effect)';
  const setzeStrip = (an) => { wurzel.classList.toggle('mit-strip', an); stripTaste.classList.toggle('an', an); stripTaste.setAttribute('aria-pressed', String(an)); };
  setzeStrip(leseStrip(nr));
  stripTaste.addEventListener('click', () => { const an = !wurzel.classList.contains('mit-strip'); setzeStrip(an); schreibeStrip(nr, an); });
  kopf.append(name, raster, hinweis, stopAlle, set, stripTaste, neu);
  const rumpf = el('div', 'ld-rumpf');
  // the scene column has the row template of a track (title, wave, cell rows, foot): its buttons sit exactly beside the cell rows
  const szenen = el('div', 'ld-szenen'), szenenZeilen = el('div', 'ld-szenenzeilen');
  for (let z = 1; z <= ZELLEN; z++) {
    const b = el('button', 'ld-szene', String(z)); b.type = 'button'; b.dataset.zeile = String(z); b.title = `Launch row ${z} of all tracks`;
    b.addEventListener('click', () => senden('/loopdeck/szene', { deck: nr, zeile: z }));
    szenenZeilen.append(b);
  }
  szenen.append(el('span', 'ld-szenenluecke'), el('span', 'ld-szenenluecke'), szenenZeilen, el('span', 'ld-szenenluecke ld-szenenstrip'), el('span', 'ld-szenenluecke'));
  const spurenKnoten = el('div', 'ld-spuren');
  const spuren = Array.from({ length: SPUREN }, (_, s) => { const x = baueSpur(nr, s); spurenKnoten.append(x.spur); return x; });
  rumpf.append(szenen, spurenKnoten);
  const zellmenue = baueMenue((koerper) => { const m = zellmenue.ctx; if (m) zelleAendern(nr, m, koerper); });
  zellmenue.ctx = null;
  const fxmenue = baueFxMenue((koerper) => { const sp = fxmenue.spurNr(); if (sp) setzeEffekt(nr, sp, koerper); });
  wurzel.append(kopf, menue, rumpf, zellmenue.knoten, fxmenue.knoten);
  return { wurzel, name, rasterKnoepfe, neu, hinweis, menue, zellmenue, fxmenue, spuren, ziel: null, neuVersucht: false };
}

// ---------- actions ----------
// A click in the strip jumps the track to the slice under the pointer (the playing cell, else the last one that played; the server decides).
// A one-shot has no slices: nothing is posted. Without any cell known the server answers nichts_gespielt, which the page shows.
function klickWelle(nr, s, e, welle) {
  const sp = stand.decks[nr]?.spuren?.[s];
  const n = sp?.lauf?.zelle ?? sp?.lauf?.zuletzt ?? null;
  if (n !== null && sp?.zellen?.[n - 1]?.art === 'einmal') return;
  const r = welle.getBoundingClientRect(), w = r.width;
  if (!(w > 0)) return;
  const slice = Math.min(8, Math.max(1, Math.floor(((e.clientX ?? 0) - r.left) / w * 8) + 1));
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

// ---------- effect slot ----------
// The chip: without a stage it opens the choice; with a stage the first click opens the choice, a second click while it is open closes it
// and opens the device window of the stage (`ins:<stage id>`).
async function klickChip(nr, s) {
  const a = ansichten.get(nr), sp = stand.decks[nr]?.spuren?.[s];
  if (!a) return;
  if (a.fxmenue.istOffen() && a.fxmenue.spurNr() === s + 1) {
    a.fxmenue.schliesse();
    if (sp?.effekt?.id) oeffneGeraetFenster(`ins:${sp.effekt.id}`, melde);
    return;
  }
  const graphen = (await holeEffekte()) ?? [];
  a.fxmenue.oeffne(graphen, sp?.effekt ?? null, a.spuren[s].strip.fx, s + 1);
}
// One request per pick; the chip changes only with the server's answer (a refusal shows its text and changes nothing).
async function setzeEffekt(nr, spurNr, koerper) {
  const r = await senden('/loopdeck/effekt', { deck: nr, spur: spurNr, ...koerper });
  if (!r.ok) return;
  const sp = stand.decks[nr]?.spuren?.[spurNr - 1];
  if (sp) { sp.effekt = r.j.effekt ?? null; zeichneDeck(nr); }
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
function oeffneZellmenue(nr, s, zelle) {
  const a = ansichten.get(nr), z = stand.decks[nr]?.spuren?.[s]?.zellen?.[zelle - 1];
  if (!a || !z) return;   // an empty cell has no menu
  a.zellmenue.ctx = { spur: s + 1, zelle };
  a.zellmenue.oeffne(z, a.spuren[s].knoepfe[zelle - 1].b);
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

async function anlegen(nr, automatisch = false) {
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
function zeichneWelle(sp, sha) {
  if (sp.sha === sha) return;
  sp.sha = sha;
  const g = sp.leinwand.getContext('2d'), B = sp.leinwand.width, H = sp.leinwand.height;
  g.clearRect(0, 0, B, H);
  if (!sha) return;
  if (!wellen.has(sha)) {
    let fehl = false;
    const p = (async () => {
      try {
        const r = await fetch(`/welle?sha=${encodeURIComponent(sha)}`);
        if (!r.ok) { fehl = true; return null; }
        return leseWelle(await r.arrayBuffer());
      } catch { fehl = true; return null; }
    })();
    wellen.set(sha, p);
    p.then(() => { if (fehl && wellen.get(sha) === p) wellen.delete(sha); });   // a failed request is asked again at the next change of the playing cell
  }
  wellen.get(sha).then((w) => {
    if (!w || sp.sha !== sha) return;
    for (let x = 0; x < B; x++) zeichneSpalte(g, x, H / 2, spalten(w, x * w.spalten / B, (x + 1) * w.spalten / B), w.gain);
  });
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
    x.titel.textContent = s.titel;
    x.stopp.classList.toggle('wartend', s.stoppWartet);
    x.mute.classList.toggle('an', s.mute); x.mute.setAttribute('aria-pressed', String(s.mute));
    if (document.activeElement !== x.fader) x.fader.value = String(s.faderDb);
    if (!x.filter.gegriffen()) x.filter.setze(s.filter);   // a redraw does not take the knob out of the hand
    const roh = stand.decks[nr]?.spuren?.[k];
    for (const art of ['hall', 'delay']) if (!x.strip.sends[art].gegriffen()) x.strip.sends[art].setze(Number(roh?.send?.[art] ?? -200));
    const fxn = roh?.effekt ?? null, chipKnoten = x.strip.fx;
    chipKnoten.textContent = fxn ? kurzVon(fxn.graph) : '+';
    chipKnoten.classList.toggle('aus', !!fxn && fxn.an === false); chipKnoten.classList.toggle('gesetzt', !!fxn);
    chipKnoten.title = fxn ? `${fxn.graph}${fxn.an === false ? ' (off)' : ''}: click to change, again to open its window` : 'Effect slot: click to choose';
    for (const [band] of BAENDER) {
      const bd = x.strip.baender[band], gekillt = !!roh?.kill?.[band];
      if (!bd.knopf.gegriffen()) bd.knopf.setze(Number(roh?.eq?.[band] ?? 0));   // the stored value, also while killed
      bd.knopf.knoten.classList.toggle('kill', gekillt); bd.label.classList.toggle('kill', gekillt); bd.label.setAttribute('aria-pressed', String(gekillt));
    }
    s.zellen.forEach((z, i) => {
      const c = x.knoepfe[i], ziel = a.ziel && a.ziel.spur === s.nr && a.ziel.zelle === z.nr && z.zustand === 'leer';
      c.b.className = `ld-zelle ${z.zustand}${ziel ? ' ziel' : ''}${z.laedt ? ' laedt' : ''}`;
      c.chip.style.background = z.farbe ?? 'transparent'; c.chip.dataset.farbe = z.farbe ?? '';
      c.icon.textContent = z.zustand === 'leer' ? '' : z.art === 'einmal' ? '▪' : '↻';
      c.name.textContent = z.name;
      c.griff.hidden = z.zustand === 'leer';
      c.b.draggable = z.zustand !== 'leer'; c.b.setAttribute('draggable', String(z.zustand !== 'leer'));
      c.b.title = z.zustand === 'leer' ? 'Empty: click to select it as load target (or drop a loop here)'
        : `${z.name}: click launches on the next grid point${z.laedt ? ' (still loading: a launch is refused until it is decoded)' : ''}; drag to move it`;
    });
    zeichneWelle(x, s.sha);
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
    v.spuren.forEach((s, k) => {
      const x = a.spuren[k], p = spielPos(s.lauf, s.spielZelle, beat, uhr.bpm);
      x.kopf.hidden = p === null;
      if (p !== null) x.kopf.style.left = `${(p * 100).toFixed(2)}%`;
      s.zellen.forEach((z, i) => { if (z.zustand === 'spielt') x.knoepfe[i].b.style.setProperty('--pos', p === null ? '0' : p.toFixed(3)); });
    });
  }
}
function istAktiv() { return [...ansichten.keys()].some((nr) => deckAnsicht(stand.decks[nr], nr).spuren.some((s) => s.spielt)); }
function starteSchleife() {
  if (schleifeLaeuft || typeof requestAnimationFrame !== 'function' || !istAktiv()) return;
  schleifeLaeuft = true;
  const schritt = () => {
    zeichnePositionen(jetzt());
    if (istAktiv()) requestAnimationFrame(schritt); else schleifeLaeuft = false;
  };
  requestAnimationFrame(schritt);
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
  ansichten.clear(); letztesDeck = null; exportDeck = null; stand.decks = { 1: null, 2: null }; stand.geladen = false; wellen.clear(); fluege.clear(); effekteListe = null; effekteAnfrage = null;
  ladend = false; nochmal = false; veraltet = false; schleifeLaeuft = false; standAngefragt = false; exportLaeuft.clear(); Object.assign(uhr, neueUhr());
}

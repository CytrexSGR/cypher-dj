// djk MVP-Oberfläche (Scheibe 60m). Kein Ton: diese Seite erzeugt und spielt nie Audio.
// Öffnen sendet nichts an den Kern: gesendet wird nur auf einen Griff (Zeiger, Rad, Klick) oder LOAD.
// Lesen: /strom (Kern über den Seiten-Server), Leitstand-WS als Rolle "anzeige" (takt, ansage, ereignis).
import { DECKS, ERZEUGER, LOOPBOXEN, GRIFF, art, griffZuMidi, formatiere, vorgabe, setzeZielKurve } from './kurven.js';
import { KOPIE_TEXT, HAND_PRUEFMODUS_TEXT, cypherStand } from './meldungen.js';
import { leseWelle, Kopf, Laufansicht, Uebersicht, SR, laengeFrames } from './welle.js';
import { bindeSpurbaender } from './spurband_ansicht.js';

const $ = (s, w = document) => w.querySelector(s);
const $$ = (s, w = document) => [...w.querySelectorAll(s)];
const BUCHSTABE = { 1: 'A', 2: 'B' };
const STATUS_TEXT = ['LOADED', 'LOADED', 'PLAYING', 'LOOP', 'ROLL', 'FALLBACK'];
const LOOP_LAENGEN = [1, 2, 4, 8, 16];                      // Plan E9: Loop-Reihe (Beats)
// AUFTRAG 2026-09-28: zwei Beat-FX-Einheiten, drei Parameter je Einheit (S8-Layout). fxStand/fxZuweisung sind je
// Einheit (Index 0 = FX1, 1 = FX2). Nur param1 wirkt im Kern (Vorgabe je Art, aus S8-Abgleich).
const FX_ARTEN = [{ art: 1, name: 'ECHO', param1: 'FEEDBACK' }, { art: 2, name: 'FLANGER', param1: 'FEEDBACK' },
  { art: 3, name: 'PHASER', param1: 'RESONANCE' }, { art: 4, name: 'FILTER', param1: 'Q' }];
const FX_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16];
const FX_VORGABE = { wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5 };   // RESET setzt hierauf zurück (nicht art/beats/an)
const fxStand = [
  { art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: false, gegriffen: false },
  { art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: false, gegriffen: false },
];
const fxZuweisung = [{}, {}];   // fxZuweisung[u][kanal] = true/false
const FARBE_SHOT = '#58d66b', FARBE_LOOP = '#2fd6c3';       // Plan E9: Hotcue-Marken
// Studio S1: Zustand je Instanz in `instanzen` (unten)
const jsonPost = (pfad, daten) => fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });

const zustand = {
  regler: {},             // pfad → Wert laut Kern (/e/regler)
  decks: {},              // deck → letzte /zustand/deck
  bestand: [],            // aus /bestand
  geladen: {},            // deck → material_id
  eigeneLaden: new Map(), // id → deck (für /q)
  loops: {},              // box → letzte /e/loop (MVP 2)
  loopliste: [],          // aus /loops
};
window.djk = zustand;      // für die Prüfung (lesen)
const deckAnsicht = {};    // deck → { lauf, ueber, kopf, id, raster } (Plan Oberfläche T5)
window.djkAnsicht = deckAnsicht;  // für die Prüfung (lesen)
let recBeats = 4, recLaeuft = false, recAktiv = '';  // MVP 2 Scheibe 2: REC-Knopf im Kopf von C; recAktiv = Name des eigenen REC

// ---------- Senden: nacheinander, damit die Reihenfolge Stellung → Wert am Kern gilt ----------
const schlange = [];
let unterwegs = false;
window.djkGesendet = [];   // jede Antwort des Servers (Prüfung)
function sende(pfad, u, stellung = false) {
  const letzte = schlange.at(-1);
  if (!stellung && letzte && letzte.pfad === pfad && !letzte.stellung) letzte.u = u; // Bewegung zusammenfassen
  else schlange.push({ pfad, u, stellung });
  pumpe();
}
async function pumpe() {
  if (unterwegs) return;
  unterwegs = true;
  while (schlange.length) {
    const g = schlange.shift();
    try {
      const r = await fetch('/griff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad: g.pfad, u: g.u }) });
      const j = await r.json();
      window.djkGesendet.push({ ...g, code: r.status, antwort: j });
      if (r.status === 409 && j.fehler === 'pruefmodus_aus') zeigePruefmodus('aus');
      else if (!r.ok) melde(`Rejected: ${g.pfad} (${j.fehler})`, true);
    } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
  }
  unterwegs = false;
}

let meldungZeit = 0;
function melde(text, fehler = false, dauerhaft = false) {
  const m = $('#meldung');
  m.textContent = text;
  m.className = fehler ? 'fehler' : 'ok';
  clearTimeout(meldungZeit);
  if (!dauerhaft) meldungZeit = setTimeout(() => { m.textContent = ''; }, 6000);
}

// Kern ohne Prüfmodus: die Hand der Seite (/test/hand) kommt nicht an, bis 35 hand_osc bringt. Sichtbar, nicht still.
let pruefmodusAus = false;
function zeigePruefmodus(stand) {
  const aus = stand === 'aus';
  $('#v-kern').classList.toggle('ohne-hand', aus);
  $('#v-kern').title = aus ? `Audio core (via page server): ${HAND_PRUEFMODUS_TEXT}` : 'Audio core (via page server)';
  if (aus) melde(HAND_PRUEFMODUS_TEXT, true, true);
  else if (pruefmodusAus) melde('');
  pruefmodusAus = aus;
}

// ---------- Aufbau ----------
function baueDecks() {
  for (const n of DECKS) {
    const d = $(`.deck[data-deck="${n}"]`);
    d.append($('#deck-vorlage').content.cloneNode(true));
    deckAnsicht[n] = { lauf: new Laufansicht($('[data-lauf]', d)), ueber: new Uebersicht($('[data-ueber]', d)), kopf: new Kopf(), id: null, raster: null };
    $('[data-lauf]', d).addEventListener('wheel', (e) => {   // Mausrad zoomt 2 bis 64 Takte (Andreas 2026-09-27)
      e.preventDefault();
      if (deckAnsicht[n].zieh) return;   // Review E9 F10: während des Ziehens nicht zoomen, sonst ändert sich die Sprungweite
      const l = deckAnsicht[n].lauf;
      l.takte = Math.min(64, Math.max(2, e.deltaY > 0 ? l.takte * 2 : l.takte / 2));
      $('[data-lauf]', d).title = `${l.takte} bars · mouse wheel zooms`;
    }, { passive: false });
    bindeDeckBedienung(n, d);   // Plan E9
    $('.buchstabe', d).textContent = BUCHSTABE[n];
    $('.nr', d).textContent = n;
    $('[data-kanal]', d).dataset.kanal = `deck/${n}`;
    for (const t of $$('[data-taste]', d)) { t.dataset.pfad = `deck/${n}/${t.dataset.taste}`; t.disabled = true; }
    const z = $(`.zug[data-deck="${n}"]`);
    z.append($('#zug-vorlage').content.cloneNode(true));
    for (const e of $$('[data-teil]', z)) e.dataset.pfad = `deck/${n}/${e.dataset.teil}`;
    for (const e of $$('[data-wert-teil]', z)) e.dataset.wert = `deck/${n}/${e.dataset.wertTeil}`;
    $('[data-kanal]', z).dataset.kanal = `deck/${n}`;
    for (const b of $$('[data-fxzuweisung]', z)) b.dataset.kanal = `deck/${n}`;
  }
  for (const k of ERZEUGER) {  // Strudel-Kanal (Plan 2026-09-27): Kanalzug wie ein Deck, ohne Tasten
    const z = $(`.zug[data-kanalzug="${k}"]`);
    if (!z) continue;   // Studio S1: Kanalzug erst ab Task 7 im Markup
    z.append($('#zug-vorlage').content.cloneNode(true));
    for (const e of $$('[data-teil]', z)) e.dataset.pfad = `${k}/${e.dataset.teil}`;
    for (const e of $$('[data-wert-teil]', z)) e.dataset.wert = `${k}/${e.dataset.wertTeil}`;
    $('[data-kanal]', z).dataset.kanal = k;
    for (const b of $$('[data-fxzuweisung]', z)) b.dataset.kanal = k;
  }
}

// ---------- Regler: Knopf (senkrecht ziehen), Fader (senkrecht), Crossfader (waagrecht) ----------
const regler = new Map(); // pfad → { el, x, gegriffen, zeige() }
window.djkRegler = regler; // für die Prüfung (lesen)

function neuerRegler(el) {
  const pfad = el.dataset.pfad;
  const a = art(pfad);
  const r = { el, pfad, a, x: GRIFF[a].stellung(vorgabe(pfad)), gegriffen: false };
  r.zeige = () => zeichne(r);
  regler.set(pfad, r);
  const weg = () => (el.classList.contains('knopf') ? 220 : el.classList.contains('waagrecht') ? $('.bahn', el).clientWidth : $('.bahn', el).clientHeight);
  let start = null;
  const setze = (x) => {
    r.x = Math.max(0, Math.min(1, x));
    r.zeige();
    sende(pfad, griffZuMidi(pfad, r.x));
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    r.gegriffen = true;
    el.classList.add('gegriffen');
    start = { x: r.x, px: e.clientX, py: e.clientY };
    sende(pfad, griffZuMidi(pfad, r.x), true); // Stellung zuerst (§7.3 Punkt 2)
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || !el.hasPointerCapture(e.pointerId)) return;
    const d = el.classList.contains('waagrecht') ? (e.clientX - start.px) : (start.py - e.clientY);
    const fein = e.shiftKey ? 0.2 : 1;
    setze(start.x + (d / weg()) * fein);
  });
  const los = (e) => {
    if (!start) return;
    start = null;
    r.gegriffen = false;
    el.classList.remove('gegriffen');
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    r.x = GRIFF[a].stellung(zustand.regler[pfad] ?? GRIFF[a].wert(r.x)); // Stellung auf den Kern-Wert
    r.zeige();
  };
  el.addEventListener('pointerup', los);
  el.addEventListener('pointercancel', los);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    sende(pfad, griffZuMidi(pfad, r.x), true);
    setze(r.x + (e.deltaY < 0 ? 0.02 : -0.02));
  }, { passive: false });
  el.addEventListener('dblclick', () => {               // zurück auf die Vorgabe (Fader und Pegel bleiben: kein Ruck nach oben)
    if (a === 'fader' || a === 'pegel') return;
    sende(pfad, griffZuMidi(pfad, r.x), true);
    setze(GRIFF[a].stellung(vorgabe(pfad)));
  });
  r.zeige();
}

function bogenPfad(x) {
  const w0 = -135, w = w0 + 270 * x;
  const p = (g) => [30 + 24 * Math.sin((g * Math.PI) / 180), 30 - 24 * Math.cos((g * Math.PI) / 180)];
  const [x0, y0] = p(w0), [x1, y1] = p(w);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A 24 24 0 ${w - w0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function zeichne(r) {
  const { el, x } = r;
  if (el.classList.contains('knopf')) {
    $('.zeiger', el).setAttribute('transform', `rotate(${-135 + 270 * x} 30 30)`);
    $('.bogen', el).setAttribute('d', x > 0.001 ? bogenPfad(x) : '');
  } else if (el.classList.contains('senkrecht')) {
    $('.kappe', el).style.bottom = `${x * 100}%`;
  } else {
    $('.kappe', el).style.left = `${x * 100}%`;
  }
  el.setAttribute('aria-valuenow', x.toFixed(3));
}

// Ohne Meldung vom Kern steht die Vorgabe aus §1.5 grau da (der Kern schickt beim Abonnieren keinen Stand)
function zeigeWert(pfad) {
  const bestaetigt = pfad in zustand.regler;
  const w = bestaetigt ? zustand.regler[pfad] : vorgabe(pfad);
  for (const o of $$(`[data-wert="${CSS.escape(pfad)}"]`)) {
    o.textContent = formatiere(pfad, w);
    o.classList.toggle('vorgabe', !bestaetigt);
    o.title = bestaetigt ? 'value reported by the core' : 'default, not yet reported by the core';
  }
  const r = regler.get(pfad);
  if (r && !r.gegriffen && bestaetigt) { r.x = GRIFF[r.a].stellung(w); r.zeige(); }
  for (const b of $$(`.xzuweisung[data-pfad="${CSS.escape(pfad)}"] button`)) {
    b.classList.toggle('an', Number(b.dataset.stufe) === Math.round(w));
    b.classList.toggle('vorgabe', !bestaetigt);
  }
  const k = $(`.schalter[data-pfad="${CSS.escape(pfad)}"]`);
  if (k) k.classList.toggle('an', w >= 0.5);
}

function bindeKnoepfe() {
  for (const el of $$('.regler[data-pfad]')) neuerRegler(el);
  for (const k of $$('.schalter[data-pfad]')) {   // Kill und PFL: Umschalter
    k.addEventListener('click', () => {
      const pfad = k.dataset.pfad;
      const ist = (zustand.regler[pfad] ?? 0) >= 0.5 ? 1 : 0;
      sende(pfad, ist, true);          // Stellung = jetziger Schalter
      sende(pfad, 1 - ist);
    });
  }
  for (const g of $$('.xzuweisung[data-pfad]')) {   // Crossfader-Zuweisung A/THRU/B (2026-09-27): Stellung = jetzige Seite
    for (const b of $$('button', g)) b.addEventListener('click', () => {
      const pfad = g.dataset.pfad;
      sende(pfad, GRIFF.xseite.stellung(zustand.regler[pfad] ?? vorgabe(pfad)), true);
      sende(pfad, GRIFF.xseite.stellung(Number(b.dataset.stufe)));
    });
  }
  for (const t of $$('[data-taste]')) {
    const pfad = t.dataset.pfad;
    t.addEventListener('pointerdown', (e) => { if (e.button !== 0 || t.disabled) return; t.classList.add('gedrueckt'); sende(pfad, 1); });
    const los = () => { if (!t.classList.contains('gedrueckt')) return; t.classList.remove('gedrueckt'); sende(pfad, 0); };
    t.addEventListener('pointerup', los);
    t.addEventListener('pointerleave', los);
  }
}

// ---------- Bestand ----------
const fmtZeit = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const takteVon = (e) => (e.beats ? Math.floor((e.beats - e.erste_eins_quell_beat) / 4) : null);

async function ladeBestand() {
  const r = await fetch('/bestand');
  zustand.bestand = await r.json();
  const tb = $('#liste');
  tb.textContent = '';
  for (const e of zustand.bestand) {
    const tr = document.createElement('tr');
    tr.dataset.material = e.material_id;
    const zellen = [
      [e.titel, 'titelzelle'], [e.camelot ?? '–', 'zahl'], [e.quelle_bpm.toFixed(1), 'zahl'],
      [`${e.basis_bpm.toFixed(0)}${e.fassung > 1 ? ` r${e.fassung}` : ''}`, 'zahl'], [fmtZeit(e.dauer_s), 'zahl'],
      [takteVon(e) ?? '–', 'zahl'], [e.lufs.toFixed(1), 'zahl'], [e.tore_ok ? 'OK' : 'open', e.tore_ok ? 'tor-ok' : 'tor-nein'],
    ];
    for (const [t, k] of zellen) { const td = document.createElement('td'); td.textContent = t; td.className = k; tr.append(td); }
    const td = document.createElement('td');
    td.className = 'aktion';
    for (const n of DECKS) {
      const b = document.createElement('button');
      b.className = `laden ${BUCHSTABE[n].toLowerCase()}`;
      b.textContent = `LOAD ${BUCHSTABE[n]}`;
      b.dataset.deck = n;
      b.addEventListener('click', () => laden(n, e));
      td.append(b);
    }
    tr.append(td);
    tb.append(tr);
  }
  zeigeReiterInfo();
  filtere();
}

async function laden(deck, e) {
  const r = await fetch('/laden', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deck, material_id: e.material_id, basis_bpm: e.basis_bpm, fassung: e.fassung }) });
  const j = await r.json();
  window.djkGesendet.push({ laden: deck, material_id: e.material_id, code: r.status, antwort: j });
  if (!r.ok) return melde(`Load rejected: “${e.titel}” ${KOPIE_TEXT[j.fehler] ?? j.fehler}`, true);
  zustand.eigeneLaden.set(j.felder.id, { deck, titel: e.titel });
  melde(`Loading “${e.titel}” to deck ${BUCHSTABE[deck]} …`);
}

// KOPIE_TEXT (Antwort des Seiten-Servers, wenn nichts an den Kern ging) steht in meldungen.js

const GRUND_TEXT = {
  deck_hoerbar: 'deck is playing with its fader open: stop it or pull the fader down first', material_fehlt: 'track not in the working set',
  pruefung: 'version failed the check', budget_speicher: 'not enough memory',
};

// ---------- Decks ----------
function eintragVon(id) { return zustand.bestand.find((e) => e.material_id === id); }

// Review F1–F3: Schlüssel ist die GESPIELTE Fassung (material|bpm|fassung aus /zustand/deck), die alte Welle verschwindet
// sofort, nach jedem await wird geprüft, ob noch dieselbe Fassung gemeint ist; Fehler lassen das Deck leer statt alt.
async function ladeDeckWelle(n, f) {
  const a = deckAnsicht[n], schluessel = `${f.material_id}|${f.basis_bpm}|${f.fassung}`;
  a.id = schluessel; a.raster = null;
  a.lauf.setzeWelle(null, null); a.ueber.setzeWelle(null);
  try {
    const q = `material=${f.material_id}&bpm=${f.basis_bpm}&fassung=${f.fassung}`;
    const [rw, rf] = await Promise.all([fetch(`/welle?${q}`), fetch(`/fassung?${q}`)]);
    if (!rw.ok || !rf.ok || a.id !== schluessel) return;
    const buf = await rw.arrayBuffer(), fj = await rf.json();
    if (a.id !== schluessel) return;
    a.raster = { basisSchlag: fj.erster_schlag_frame, ersterSchlagFrame: fj.erster_schlag_frame, framesProBeat: SR * 60 / f.basis_bpm, eins: fj.erste_eins_quell_beat };
    const w = leseWelle(buf);
    a.lauf.setzeWelle(w, a.raster); a.ueber.setzeWelle(w);
    holeHotcues(n);   // Plan E9: Marken und Pads der geladenen Fassung
    holeRaster(n);    // Plan Grid
  } catch (err) { if (a.id === schluessel) melde(`Waveform deck ${BUCHSTABE[n]}: ${err.message}`, true); }
}

function zeigeDeck(n) {
  const d = $(`.deck[data-deck="${n}"]`);
  const z = zustand.decks[n];
  const id = z?.material_id ?? zustand.geladen[n];
  const e = id ? eintragVon(id) : null;
  const status = z ? z.status : (id ? 1 : 0);
  const st = $('[data-status]', d);
  st.textContent = status === 0 ? 'EMPTY' : STATUS_TEXT[status] ?? String(status);
  st.className = `status ${status >= 2 ? 'laeuft' : status === 1 ? 'geladen' : ''}`;
  for (const t of $$('[data-taste]', d)) t.disabled = status === 0;
  for (const t of $$('.bedienreihe button', d)) t.disabled = status === 0;   // Plan E9
  const la = loopAktiv(z);
  $('[data-loopan]', d)?.classList.toggle('an', la);
  if (deckAnsicht[n] && deckAnsicht[n].loopWar !== la) { deckAnsicht[n].loopWar = la; if (la) holeLoop(n); else deckAnsicht[n].loop = null; }
  $('.taste.play', d).classList.toggle('an', status >= 2);
  if (!id) return;
  const g = z ?? zustand.geladenFelder?.[n] ?? e;      // gespielte Fassung vor Bestands-Eintrag (Review F3)
  if (g?.basis_bpm && g?.fassung && deckAnsicht[n].id !== `${id}|${g.basis_bpm}|${g.fassung}`) {
    ladeDeckWelle(n, { material_id: id, basis_bpm: g.basis_bpm, fassung: g.fassung });
  }
  $('[data-titel]', d).textContent = e?.titel ?? id;
  $('[data-meta]', d).textContent = e
    ? `${e.camelot ?? '–'} · orig ${e.quelle_bpm.toFixed(1)} BPM · plays at ${e.basis_bpm.toFixed(0)} · ${fmtZeit(e.dauer_s)}`
    : id;
  // Plan Tempo-Folge: Decks haben noch keinen Keylock und starten nur bei ihrer Basis (Kern: kein_stretcher).
  const basis = g?.basis_bpm ?? e?.basis_bpm;
  const fremd = Boolean(basis) && zustand.bpm != null && Math.abs(zustand.bpm / basis - 1) >= 1e-6;
  d.classList.toggle('tempo-fremd', fremd);
  if (fremd) $('[data-meta]', d).textContent += ` · master at ${zustand.bpm.toFixed(2)}: set ${basis.toFixed(0)} BPM to play (no keylock yet)`;
  const gesamt = e ? takteVon(e) : null;
  const eins = e?.erste_eins_quell_beat ?? 0;
  if (!z) { $('[data-bar]', d).textContent = '1.1'; $('[data-von]', d).textContent = gesamt ? `/ ${gesamt}` : ''; return; }
  const rel = z.quell_beat - eins;
  const bar = Math.floor(rel / 4) + 1;
  const schlag = Math.floor(((rel % 4) + 4) % 4) + 1;
  $('[data-bar]', d).textContent = rel < 0 ? '–' : `${bar}.${schlag}`;
  $('[data-von]', d).textContent = gesamt ? `/ ${gesamt}` : '';
  $('[data-rest]', d).textContent = Number.isFinite(z.beats_bis_ende) ? `${Math.max(0, Math.floor(z.beats_bis_ende / 4))} bars` : 'loop';
  for (const tr of $$('#liste tr')) tr.classList.toggle(`auf-${n}`, tr.dataset.material === id);
}

function zeigePegel(kanal, db) {
  const anteil = db <= -60 ? 0 : Math.min(1, (db + 60) / 60);
  for (const m of $$(`.meter[data-kanal="${CSS.escape(kanal)}"] i`)) {
    if (m.parentElement.classList.contains('senkrecht')) m.style.height = `${anteil * 100}%`;
    else m.style.width = `${anteil * 100}%`;
  }
  const z = $(`[data-pegelzahl="${CSS.escape(kanal)}"]`);
  if (z) z.textContent = db <= -199 ? '−∞' : db.toFixed(1).replace('-', '−');
}

// ---------- Uhr (Kopf) ----------
function zeigeSchlag(beat) {
  const s = Math.floor(((beat % 4) + 4) % 4);
  $$('#schlaege i').forEach((i, k) => i.classList.toggle('an', k === s));
}

// ---------- Strom vom Seiten-Server (Kern) ----------
// ---------- Loop-Boxen (MVP 2, ADR 025) ----------
const BOX_STATUS = ['EMPTY', 'READY', 'CUED', 'PLAYING', 'ENDING', 'TEMPO'];
const BOXEN = LOOPBOXEN.map((_, i) => i + 1);
const FPB = SR * 60 / 128;                               // Loops sind immer 128 BPM (ADR 025)
const loopAnsicht = {};                                   // box → { ansicht, name }
const uhrKopf = new Kopf();                               // Master-Beat, hochgerechnet (Spec E4)
async function ladeLoopWelle(n, name) {
  const a = loopAnsicht[n];
  a.name = name;
  a.ansicht.setzeWelle(null, null);                        // Review F1: alte Loop-Welle sofort weg
  if (!name) return;
  try {
    const r = await fetch(`/welle?loop=${encodeURIComponent(name)}`);
    if (!r.ok || a.name !== name) return;
    const buf = await r.arrayBuffer();
    if (a.name !== name) return;                             // Review F2
    a.raster = { ersterSchlagFrame: a.versatz ?? 0, framesProBeat: FPB, eins: 0 };
    a.ansicht.setzeWelle(leseWelle(buf), a.raster);
    holeLoopRaster(n);   // Plan Grid
  } catch (err) { if (a.name === name) melde(`Waveform L${n}: ${err.message}`, true); }
}

// Plan Grid (D6): Loop-Versatz. Linien bei versatz + k·FPB, der Kopf ebenfalls um den Versatz gedreht (wie der Kern).
async function holeLoopRaster(n) {
  try {
    const r = await fetch(`/loop/raster?box=${n}`);
    if (r.ok) zeigeLoopRaster(n, await r.json());
  } catch { /* nächster Anlass */ }
}
function zeigeLoopRaster(n, j) {
  const a = loopAnsicht[n], b = $(`.box[data-box="${n}"]`);
  a.versatz = j.versatz_frames;
  if (a.raster) a.raster.ersterSchlagFrame = j.versatz_frames;
  $('[data-gridwert]', b).textContent = msText(j.versatz_frames);
  $('[data-gridfix]', b).classList.toggle('offen', j.versatz_frames !== j.gespeichert_frames);
  window.djkLoopRaster = window.djkLoopRaster ?? {}; window.djkLoopRaster[n] = j.versatz_frames;
}
async function loopRasterPost(n, daten) {
  try {
    const r = await fetch('/loop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ box: n, ...daten }) });
    const j = await r.json();
    if (!r.ok) { melde(`Loop grid: ${j.fehler}`, true); return; }
    zeigeLoopRaster(n, j);
  } catch { melde('Loop grid: page server unreachable', true); }
}

function baueBoxen() {
  for (const n of BOXEN) {
    const b = $(`.box[data-box="${n}"]`);
    b.append($('#box-vorlage').content.cloneNode(true));
    loopAnsicht[n] = { ansicht: new Laufansicht($('[data-loopwelle]', b)), name: null };
    $('.boxname', b).textContent = `L${n} · LOOP`;
    const k = LOOPBOXEN[n - 1];
    const z = $(`.zug[data-boxzug="${n}"]`);   // Traktor-Raster: der Zug der Zelle sitzt im Mixer unten
    z.append($('#zug-vorlage').content.cloneNode(true));
    for (const e of $$('[data-teil]', z)) e.dataset.pfad = `${k}/${e.dataset.teil}`;
    for (const e of $$('[data-wert-teil]', z)) e.dataset.wert = `${k}/${e.dataset.wertTeil}`;
    $('[data-kanal]', z).dataset.kanal = k;
    for (const b of $$('[data-fxzuweisung]', z)) b.dataset.kanal = k;
    $('[data-boxplay]', b).addEventListener('click', () => {
      const s = zustand.loops[n]?.status ?? 0;
      loopAktion({ aktion: s === 2 || s === 3 ? 'stopp' : 'start', box: n });
    });
    for (const g of $$('[data-gridschritt]', b)) g.addEventListener('click', (e) => loopRasterPost(n, { aktion: 'raster', schritt_ms: Number(g.dataset.gridschritt) * (e.shiftKey ? 1 : 5) }));
    $('[data-gridwert]', b).addEventListener('contextmenu', (e) => { e.preventDefault(); loopRasterPost(n, { aktion: 'raster', versatz_frames: 0 }); });
    $('[data-gridfix]', b).addEventListener('click', () => loopRasterPost(n, { aktion: 'raster_fix' }));
  }
}

// MVP 2 Scheibe 2 (§4.9 /k/loop/rec): REC-Knopf mit Längenwahl 1/2/4/8 im Kopf von C. Name c-<hhmmss>-<n>t.
// MVP 2 Scheibe 3 (E3): Längen in Beats; Anzeige in Takten (¼ ½ 1 2 4 8)
const taktText = (beats) => (beats === 1 ? '¼ bar' : beats === 2 ? '½ bar' : `${beats / 4} bar${beats > 4 ? 's' : ''}`);

function recName(beats) {
  const d = new Date();
  const z = (x) => String(x).padStart(2, '0');
  return `c-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${beats}b`;
}

// Anzeige wie im Kern: Einsatz auf dem nächsten Vielfachen von 4·N Beats (Schätzung aus der Uhr beim Klick).
let letzterBeat = null, recPlan = null, recFertigZeit = 0;
function zeigeRec(beat) {
  const k = $('#rec-knopf');
  if (!recLaeuft || !recPlan || beat == null) return;
  const warten = beat < recPlan.start;
  k.classList.toggle('wartet', warten);
  k.classList.toggle('an', !warten);
  const lang = recPlan.ende - recPlan.start;  // unter einem Takt zählt REC Beats herunter, sonst Takte
  k.textContent = warten ? `WAIT ${Math.ceil(recPlan.start - beat)}`
    : `REC ${Math.max(1, Math.ceil((recPlan.ende - beat) / (lang < 4 ? 1 : 4)))}`;
}

function recEnde(ok) {
  recLaeuft = false; recPlan = null;
  const k = $('#rec-knopf');
  k.classList.remove('an', 'wartet');
  clearTimeout(recFertigZeit);
  if (ok === true || ok === false) {  // Scheibe 3 (E4): auch das Scheitern steht am Knopf (Tempo, Überlappung)
    k.classList.add(ok ? 'fertig' : 'gescheitert'); k.textContent = ok ? 'SAVED' : 'FAILED';
    recFertigZeit = setTimeout(() => { k.classList.remove('fertig', 'gescheitert'); k.textContent = 'REC'; }, 4000);
  } else k.textContent = 'REC';
}

function baueRec() {
  const kopf = $('#deck-c');
  for (const b of $$('[data-recbeats]', kopf)) {
    b.addEventListener('click', () => {
      recBeats = Number(b.dataset.recbeats);
      for (const x of $$('[data-recbeats]', kopf)) x.classList.toggle('an', x === b);
    });
  }
  $('#rec-knopf').addEventListener('click', async () => {
    if (recLaeuft) return;
    recLaeuft = true;
    clearTimeout(recFertigZeit);
    $('#rec-knopf').classList.remove('fertig');
    if (letzterBeat != null) {
      const raster = recBeats, start = Math.ceil(letzterBeat / raster) * raster;
      recPlan = { start, ende: start + raster };
      zeigeRec(letzterBeat);
    } else $('#rec-knopf').classList.add('wartet');
    const name = recName(recBeats);
    recAktiv = name;
    try {
      const r = await fetch('/loop', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aktion: 'rec', beats: recBeats, name }) });
      const j = await r.json();
      window.djkGesendet.push({ loop: { aktion: 'rec', beats: recBeats, name }, code: r.status, antwort: j });
      if (!r.ok) { melde(`Recording refused: ${j.fehler}`, true); recEnde(false); }
      else if (j.quittung?.status === 6) { melde(`Recording refused: ${j.quittung.grund === 'ausserhalb_bereich' ? 'the tempo is changing, wait for the ramp to finish' : (LOOP_GRUND[j.quittung.grund] ?? j.quittung.grund)}`, true); recEnde(false); }
    } catch (e) { melde(`Page server unreachable: ${e.message}`, true); recEnde(false); }
  });
}

const LOOP_GRUND = { pruefung: 'the core could not read the loop files', ki_gestoppt: 'Stop Cypher is set',
  nicht_geladen: 'the box is empty', ausserhalb_bereich: 'out of range' };
async function loopAktion(body) {
  try {
    const r = await fetch('/loop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    window.djkGesendet.push({ loop: body, code: r.status, antwort: j });
    if (!r.ok) melde(`Loop ${body.aktion} refused: ${j.grund ?? j.fehler}`, true);
    else if (j.quittung?.status === 6) melde(`Loop ${body.aktion} refused: ${LOOP_GRUND[j.quittung.grund] ?? j.quittung.grund}`, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}

// Plan Tempo-Folge: Master-Tempo. Enter im Feld oder − / + (Shift: 0,1); der Kern fährt es ab der nächsten Eins
// über einen Takt. Die Ablehnung steht als Meldung da (läuft ein Deck: kein Keylock, kein Tempowechsel).
const TEMPO_GRUND = { kein_stretcher: 'a deck is playing; without keylock the tempo only changes while the decks are stopped',
  bereich: '60 to 200 BPM', ueberlappung: 'a tempo change is already running', karte_voll: 'too many tempo changes queued' };
let tempoZiel = null;   // Code-Review F6: − / + rechnen vom zuletzt bestellten Ziel, nicht vom Momentanwert in der Rampe
async function setzeTempo(bpm) {
  try {
    const r = await fetch('/tempo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bpm }) });
    const j = await r.json();
    window.djkGesendet.push({ tempo: bpm, code: r.status, antwort: j });
    if (!r.ok) melde(`Tempo refused: ${TEMPO_GRUND[j.fehler] ?? j.fehler}`, true);
    else if (j.quittung?.status === 6) melde(`Tempo refused: ${TEMPO_GRUND[j.quittung.grund] ?? j.quittung.grund}`, true);
    else if (!j.quittung) melde('Tempo: no answer from the core', true);   // Code-Review F5
    else tempoZiel = bpm;
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}
function bindeTempo() {
  const f = $('#bpm');
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = Number(f.value.replace(',', '.')); f.blur(); if (Number.isFinite(v)) setzeTempo(v); else melde('Tempo: not a number', true); }
    if (e.key === 'Escape') f.blur();
  });
  f.addEventListener('focus', () => f.select());
  for (const [id, d] of [['#bpm-minus', -1], ['#bpm-plus', 1]]) {
    $(id).addEventListener('click', (e) => setzeTempo(Math.round(((tempoZiel ?? zustand.bpm ?? 128) + d * (e.shiftKey ? 0.1 : 1)) * 100) / 100));
  }
}

// MVP 2 Scheibe 3 (E2): → STRUDEL macht den Loop zum Klang im Zusatz-Kit. Die Antwort steht AM Knopf (Hörtest
// e17c208: Meldungen fern vom Griff werden übersehen): s("rec0") zum Abtippen, oder der Grund der Ablehnung.
function strudelKnopf(name) {
  const b = document.createElement('button');
  b.className = 'zustrudel';
  b.textContent = '→ STRUDEL';
  b.title = 'Make this loop a Strudel sound (no restart)';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await fetch('/loop', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aktion: 'kit', name }) });
      const j = await r.json();
      window.djkGesendet.push({ loop: { aktion: 'kit', name }, code: r.status, antwort: j });
      if (r.ok) { b.textContent = `s("${j.klang}")`; b.classList.add('fertig'); b.title = `Strudel sound ${j.klang}, ready from the next bar`; }
      else { b.textContent = 'FAILED'; b.classList.add('fehler'); b.title = j.text ?? j.fehler; b.disabled = false; }
    } catch (e) { b.textContent = 'FAILED'; b.classList.add('fehler'); b.title = e.message; b.disabled = false; }
  });
  return b;
}

async function ladeLoops() {
  zustand.loopliste = await (await fetch('/loops')).json();
  const tb = $('#loopliste');
  tb.textContent = '';
  for (const l of zustand.loopliste) {
    const tr = document.createElement('tr');
    if (l.ladbar === false) { tr.classList.add('defekt'); tr.title = `Cannot be loaded: ${l.grund}`; }
    for (const [t, k] of [[l.name, 'titelzelle'], [taktText(l.beats), 'zahl'], [l.quelle || '–', ''], [l.erstellt || '–', 'zahl']]) {
      const td = document.createElement('td'); td.textContent = t; td.className = k; tr.append(td);
    }
    if (l.ladbar === false) {   // Name durchgestrichen, der Grund lesbar daneben
      const z = tr.cells[0]; z.textContent = '';
      const n = document.createElement('span'); n.className = 'name'; n.textContent = l.name;
      const g = document.createElement('span'); g.className = 'grund'; g.textContent = l.grund;
      z.append(n, g);
    }
    const td = document.createElement('td');
    td.className = 'aktion';
    for (const n of BOXEN) {
      const b = document.createElement('button');
      b.className = `laden l${n}`;
      b.textContent = `LOAD L${n}`;
      if (l.ladbar === false) { b.disabled = true; b.title = `Cannot be loaded: ${l.grund}`; }
      b.addEventListener('click', () => loopAktion({ aktion: 'laden', box: n, name: l.name }));
      td.append(b);
    }
    td.append(strudelKnopf(l.name));
    tr.append(td);
    tb.append(tr);
  }
  zeigeReiterInfo();
  filtere();                                                // Review F5: Suche gilt auch nach Neuaufbau
}

// ---------- Library (Mediathek, Plan 2026-10-03) ----------
async function sucheLibrary() {
  const p = new URLSearchParams({ limit: '100' });
  const text = $('#lib-suche').value.trim(), key = $('#lib-key').value.trim(), bpm = $('#lib-bpm').value.trim();
  if (text) p.set('text', text); if (key) p.set('camelot', key.toUpperCase()); if (bpm) p.set('bpm', bpm.replace(/\s/g, ''));
  const r = await fetch(`/mediathek?${p}`);
  const j = await r.json();
  if (!r.ok) return melde(`Library: ${j.fehler}`, true);
  zustand.library = j.treffer;
  const tb = $('#libliste');
  tb.textContent = '';
  for (const t of j.treffer) tb.append(libZeile(t));
  // gesamt_genau:false → die Zahl ist nur eine Untergrenze (Server hat bei sehr vielen Kandidaten abgebrochen)
  const zahl = j.gesamt_genau === false ? `${j.gesamt}+` : `${j.gesamt}`;
  zustand.libraryInfo = `${zahl} ${j.gesamt === 1 && j.gesamt_genau !== false ? 'track' : 'tracks'} in the library${j.gesamt > j.treffer.length || j.gesamt_genau === false ? `, showing ${j.treffer.length}` : ''}`;
  zeigeReiterInfo();
}
function libZeile(t) {
  const tr = document.createElement('tr');
  tr.dataset.material = t.material_id;
  const titel = t.mix ? `${t.titel ?? '–'} (${t.mix})` : (t.titel ?? '–');
  for (const [w, k] of [[titel, 'titelzelle'], [t.kuenstler ?? '–', ''], [t.bpm ?? '–', 'zahl'], [t.camelot ?? '–', 'zahl'],
    [t.genre ?? '–', ''], [t.dauer_s ? fmtZeit(t.dauer_s) : '–', 'zahl']]) {
    const td = document.createElement('td'); td.textContent = w; td.className = k; tr.append(td);
  }
  const td = document.createElement('td');
  td.className = 'aktion';
  libKnoepfe(td, t);
  tr.append(td);
  const tdSet = document.createElement('td');
  tdSet.className = 'aktion';
  const plus = document.createElement('button');
  plus.className = 'laden in-set'; plus.textContent = '+ SET'; plus.title = 'Add to the active set';
  plus.addEventListener('click', () => inSet(t));
  tdSet.append(plus);
  tr.append(tdSet);
  return tr;
}
function libKnoepfe(td, t) {
  td.textContent = '';
  const e = zustand.bestand.find((x) => x.material_id === t.material_id);
  if (e) {
    for (const n of DECKS) {
      const b = document.createElement('button');
      b.className = `laden ${BUCHSTABE[n].toLowerCase()}`; b.textContent = `LOAD ${BUCHSTABE[n]}`;
      b.addEventListener('click', () => laden(n, e));
      td.append(b);
    }
    return;
  }
  const b = document.createElement('button');
  b.className = 'laden';
  if (!t.pfad_da) { b.textContent = 'MISSING'; b.disabled = true; b.title = 'File not found (drive unplugged?)'; }
  else if (t.vorbereitung === 'laeuft') { b.textContent = 'PREPARING…'; b.disabled = true; }
  else { b.textContent = 'PREPARE'; b.addEventListener('click', () => vorbereiten(t, td)); }
  td.append(b);
}
async function vorbereiten(t, td) {
  const r = await fetch('/mediathek/vorbereiten', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ material_id: t.material_id }) });
  const j = await r.json();
  if (r.status === 200) { await ladeBestand(); return libKnoepfe(td, t); }
  if (r.status !== 202) return melde(`Prepare rejected: “${t.titel}” ${j.fehler}`, true);
  t.vorbereitung = 'laeuft'; libKnoepfe(td, t);
  melde(`Preparing “${t.titel}” (about a minute) …`);
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const rs = await fetch(`/mediathek/vorbereiten?material_id=${t.material_id}`);
    const s = await rs.json();
    if (rs.ok && s.status === 'laeuft') continue;
    t.vorbereitung = null;
    if (!rs.ok || s.status === 'fehler') { libKnoepfe(td, t); return melde(`Prepare failed: “${t.titel}” ${s.grund ?? ''}`, true); }
    await ladeBestand();
    libKnoepfe(td, t);
    return melde(`“${t.titel}” is ready to load`);
  }
}
function bindeLibrary() {
  for (const id of ['#lib-suche', '#lib-key', '#lib-bpm']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') sucheLibrary(); });
}
// ---------- Sets (Plan 2026-10-03-sets-mit-tracks) ----------
const SET_STATUS_TEXT = { ready: 'READY', prepare: 'PREPARE', missing: 'MISSING', wartet: 'QUEUED', laeuft: 'PREPARING…', fehler: 'FAILED', unbekannt: '?' };
function aktivesSet() { try { return localStorage.getItem('djk-set') || ''; } catch { return ''; } }
function setzeAktivesSet(slug) { try { localStorage.setItem('djk-set', slug); } catch { /* ohne Speicher: nur jetzt */ } }
async function postJson(pfad, daten) {
  const r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten ?? {}) });
  return { ok: r.ok, code: r.status, j: await r.json() };
}
let listenGeladen = false;
async function ladeImportListen() {
  if (listenGeladen) return;
  try {
    const r = await fetch('/mediathek/listen');
    if (!r.ok) return;
    for (const l of await r.json()) {
      const o = document.createElement('option');
      o.value = String(l.id); o.textContent = `${l.name} (${l.n})`;
      $('#set-import').append(o);
    }
    listenGeladen = true;
  } catch { /* ohne Listen: nur der Import fehlt */ }
}
async function ladeSetListe() {
  ladeImportListen();
  const liste = await (await fetch('/sammlungen')).json();
  const sel = $('#set-wahl');
  sel.textContent = '';
  for (const s of liste) {
    const o = document.createElement('option');
    o.value = s.slug; o.textContent = s.fehler ? `${s.name} (broken)` : s.name;
    sel.append(o);
  }
  const a = aktivesSet();
  if (liste.some((s) => s.slug === a)) sel.value = a; else if (liste[0]) { sel.value = liste[0].slug; setzeAktivesSet(liste[0].slug); }
  await zeigeSet();
}
async function zeigeSet() {
  const slug = $('#set-wahl').value;
  const tb = $('#setliste');
  tb.textContent = '';
  if (!slug) { $('#set-zusammenfassung').textContent = 'No set yet — name one and press NEW SET'; return; }
  const r = await fetch(`/sammlungen/${encodeURIComponent(slug)}`);
  const j = await r.json();
  if (!r.ok) return melde(`Set: ${j.fehler}`, true);
  zustand.set = j;
  for (const p of j.posten) tb.append(setZeile(p));
  const u = j.uebersicht;
  const bpm = u.bpm ? (u.bpm.min === u.bpm.max ? `${u.bpm.min} BPM` : `${u.bpm.min}–${u.bpm.max} BPM`) : 'BPM –';
  const keys = Object.entries(u.camelot).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}×${n}`).join(' ');
  const st = Object.entries(u.status).map(([k, n]) => `${n} ${(SET_STATUS_TEXT[k] ?? k).toLowerCase()}`).join(', ');
  $('#set-zusammenfassung').textContent = `${u.tracks} ${u.tracks === 1 ? 'track' : 'tracks'} · ${fmtZeit(u.dauer_s)} · ${bpm}${keys ? ` · ${keys}` : ''}${st ? ` · ${st}` : ''}`;
  $('#set-zusammenfassung').title = Object.entries(u.genre).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}: ${n}`).join('\n');
}
function setZeile(p) {
  const tr = document.createElement('tr');
  tr.dataset.posten = p.id;
  const titel = p.mix ? `${p.titel ?? '–'} (${p.mix})` : (p.titel ?? p.material_id);
  for (const [w, k] of [[titel, 'titelzelle'], [p.kuenstler ?? '–', ''], [p.bpm ?? '–', 'zahl'], [p.camelot ?? '–', 'zahl'],
    [p.genre ?? '–', ''], [p.dauer_s ? fmtZeit(p.dauer_s) : '–', 'zahl'], [SET_STATUS_TEXT[p.status] ?? p.status, `status st-${p.status}`]]) {
    const td = document.createElement('td'); td.textContent = w; td.className = k; tr.append(td);
  }
  if (p.grund) tr.title = p.grund;
  const td = document.createElement('td');
  td.className = 'aktion';
  const e = p.laden_mid ? zustand.bestand.find((x) => x.material_id === p.laden_mid) : null;
  if (e) for (const n of DECKS) {
    const b = document.createElement('button');
    b.className = `laden ${BUCHSTABE[n].toLowerCase()}`; b.textContent = `LOAD ${BUCHSTABE[n]}`;
    b.addEventListener('click', () => laden(n, e));
    td.append(b);
  }
  const weg = document.createElement('button');
  weg.className = 'laden weg'; weg.textContent = '✕'; weg.title = 'Remove from set';
  weg.addEventListener('click', async () => {
    const r = await postJson(`/sammlungen/${encodeURIComponent(zustand.set.slug)}/posten/entfernen`, { id: p.id });
    if (!r.ok) return melde(`Remove: ${r.j.fehler}`, true);
    zeigeSet();
  });
  td.append(weg);
  tr.append(td);
  return tr;
}
async function neuesSet() {
  const name = $('#set-name').value.trim();
  if (!name) return melde('Give the set a name', true);
  const r = await postJson('/sammlungen', { name });
  if (!r.ok) return melde(`New set: ${r.j.fehler}`, true);
  $('#set-name').value = '';
  setzeAktivesSet(r.j.slug);
  await ladeSetListe();
  melde(`Set “${name}” created`);
}
async function inSet(t) {
  let slug = aktivesSet();
  if (!slug) return melde('No active set — create one in SETS', true);
  const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/posten`, { art: 'track', material_id: t.material_id });
  if (!r.ok) return melde(`Add to set: ${r.j.fehler}`, true);
  melde(r.j.schon_drin ? `“${t.titel}” is already in the set` : `“${t.titel}” added to the set`);
}
let setUhr = null;
function beobachteSet() {
  if (setUhr) return;
  setUhr = setInterval(async () => {
    if ($('[data-tabelle="sets"]').hidden) { clearInterval(setUhr); setUhr = null; return; }
    const vorher = (zustand.set?.posten ?? []).filter((p) => p.status === 'ready').length;
    await zeigeSet();
    const jetzt = zustand.set.posten;
    if (jetzt.filter((p) => p.status === 'ready').length > vorher) { await ladeBestand(); await zeigeSet(); }
    if (!jetzt.some((p) => p.status === 'wartet' || p.status === 'laeuft')) { clearInterval(setUhr); setUhr = null; melde('Set prepared'); }
  }, 3000);
}
function bindeSets() {
  $('#set-neu').addEventListener('click', neuesSet);
  $('#set-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') neuesSet(); });
  $('#set-import').addEventListener('change', async () => {
    const v = $('#set-import').value;
    if (!v) return;
    const r = await postJson('/sammlungen/import', { liste_id: Number(v) });
    $('#set-import').value = '';
    if (!r.ok) return melde(`Import: ${r.j.fehler}`, true);
    setzeAktivesSet(r.j.slug);
    await ladeSetListe();
    melde(`Imported ${r.j.posten} tracks`);
  });
  $('#set-alle').addEventListener('click', async () => {
    const slug = $('#set-wahl').value;
    if (!slug) return;
    const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/vorbereiten`, {});
    if (!r.ok) return melde(`Prepare all: ${r.j.fehler}`, true);
    melde(`${r.j.eingereiht} ${r.j.eingereiht === 1 ? 'track' : 'tracks'} queued (about a minute each, two at a time)`);
    beobachteSet();
  });
  $('#set-loeschen').addEventListener('click', async () => {
    const slug = $('#set-wahl').value;
    if (!slug || !confirm(`Move set “${$('#set-wahl').selectedOptions[0].textContent}” to the trash?`)) return;
    const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/loeschen`, {});
    if (!r.ok) return melde(`Delete set: ${r.j.fehler}`, true);
    setzeAktivesSet(''); ladeSetListe();
  });
  $('#set-wahl').addEventListener('change', () => { setzeAktivesSet($('#set-wahl').value); zeigeSet(); });
}

function zeigeReiterInfo() {
  if (!$('[data-tabelle="sets"]').hidden) { $('#bestand-info').textContent = 'Sets: a free collection, prepared ahead'; return; }
  if (!$('[data-tabelle="library"]').hidden) { $('#bestand-info').textContent = zustand.libraryInfo ?? 'Search the whole library, Enter to run'; return; }
  const loops = !$('[data-tabelle="loops"]').hidden;
  $('#bestand-info').textContent = loops ? `${zustand.loopliste.length} ${zustand.loopliste.length === 1 ? 'loop' : 'loops'}, stored at 128 BPM, played at master tempo`
    : `${zustand.bestand.length} versions, all rendered at 128 BPM`;
}

function bindeReiter() {
  for (const b of $$('[data-reiter]')) b.addEventListener('click', () => {
    for (const x of $$('[data-reiter]')) x.classList.toggle('an', x === b);
    for (const t of $$('[data-tabelle]')) t.hidden = t.dataset.tabelle !== b.dataset.reiter;
    if (b.dataset.reiter === 'loops') ladeLoops(); else if (b.dataset.reiter === 'library') { $('#lib-suche').focus(); zeigeReiterInfo(); } else if (b.dataset.reiter === 'sets') { ladeSetListe(); zeigeReiterInfo(); } else zeigeReiterInfo();
  });
}

// Plan Oberfläche T7: Library klappbar (L, Esc, Knopf), Suche nach Titel und Key; Zustand je Betrachter im localStorage
function filtere() {
  const s = ($('#suche')?.value ?? '').trim().toLowerCase();
  for (const tr of $$('#liste tr, #loopliste tr')) {        // nur Titel (1. Zelle) und Key (2. Zelle, Tracks), Spec E2
    const text = `${tr.cells[0]?.textContent ?? ''} ${tr.closest('#liste') ? tr.cells[1]?.textContent ?? '' : ''}`.toLowerCase();
    tr.hidden = s !== '' && !text.includes(s);
  }
}
function schublade(auf) {
  document.body.classList.toggle('lib-zu', !auf);
  $('#schublade').textContent = auf ? '▾' : '▸';
  try { localStorage.setItem('djk-lib', auf ? 'auf' : 'zu'); } catch { /* ohne Speicher: nur jetzt */ }
}
function bindeSchublade() {
  $('#schublade').addEventListener('click', () => schublade(document.body.classList.contains('lib-zu')));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // Review: Strg+L u. a. bleiben beim Browser
    if (e.key === 'l' || e.key === 'L') schublade(document.body.classList.contains('lib-zu'));
    if (e.key === 'Escape') schublade(false);
  });
  $('#suche').addEventListener('input', filtere);
  let gespeichert = 'auf';
  try { gespeichert = localStorage.getItem('djk-lib') ?? 'auf'; } catch { /* leer */ }
  schublade(gespeichert !== 'zu');
}

function zeigeBox(n) {
  const b = $(`.box[data-box="${n}"]`);
  const z = zustand.loops[n];
  const s = z?.status ?? 0;
  const st = $('[data-boxstatus]', b);
  st.textContent = BOX_STATUS[s] ?? String(s);
  st.className = `status ${s === 3 || s === 4 ? 'laeuft' : s >= 1 ? 'geladen' : ''}`;
  const p = $('[data-boxplay]', b);
  p.disabled = s === 0;
  p.textContent = s === 2 || s === 3 ? 'STOP' : 'PLAY';
  p.classList.toggle('an', s === 3 || s === 4);
  p.classList.toggle('blinkt', s === 2 || s === 4);
  $('[data-looptitel]', b).textContent = z?.name || 'No loop';
  $('[data-loopmeta]', b).textContent = z?.name ? `${taktText(z.beats)} · follows master tempo` : 'Pick one under LIBRARY › LOOPS';
  if ((z?.name || null) !== loopAnsicht[n].name) ladeLoopWelle(n, z?.name || null);
  loopAnsicht[n].ansicht.takte = Math.max(1, (z?.beats ?? 4) / 4);   // ganze Loop-Länge im Bild
}

function strom() {
  const q = new EventSource('/strom');
  q.onmessage = (m) => {
    const { a, f } = JSON.parse(m.data);
    switch (a) {
      case 'stand':
        Object.assign(zustand.regler, f.regler);
        for (const [n, z] of Object.entries(f.decks)) zustand.decks[n] = z;
        for (const [n, g] of Object.entries(f.geladen)) zustand.geladen[n] = g.material_id;
        for (const p of Object.keys(f.regler)) zeigeWert(p);
        DECKS.forEach(zeigeDeck);
        for (const [n, l] of Object.entries(f.loops ?? {})) zustand.loops[n] = l;
        if (Array.isArray(f.fx)) f.fx.forEach((x, u) => { if (x) fxVomKern(u, x); });
        if (f.fxZuweisung) f.fxZuweisung.forEach((m, u) => { for (const [kanal, an] of Object.entries(m)) fxZuweisungVomKern(u, kanal, an ? 1 : 0); });
        if (f.fxRouting) fxRoutingVomKern(f.fxRouting === 'insert' ? 1 : 0);
        BOXEN.forEach(zeigeBox);
        $('#v-kern').classList.toggle('an', f.kern === 'verbunden');
        zeigePruefmodus(f.pruefmodus);
        break;
      case 'pruefmodus': zeigePruefmodus(f.stand); break;
      case 'kern': $('#v-kern').classList.toggle('an', f.zustand === 'verbunden'); break;
      case '/uhr':
        $('#v-kern').classList.add('an');
        zeigeSchlag(f.beat);
        uhrKopf.melde(f.beat, f.bpm, performance.now(), true);
        letzterBeat = f.beat; zeigeRec(f.beat);
        if (!taktVomLeitstand) { $('#takt').textContent = Math.floor(f.beat / 4) + 1; $('#phrase').textContent = Math.floor(f.beat / 32) + 1; }
        if (document.activeElement !== $('#bpm')) $('#bpm').value = f.bpm.toFixed(2);
        if (zustand.bpm !== f.bpm) { zustand.bpm = f.bpm; zeigeDeck(1); zeigeDeck(2); }
        break;
      case '/e/regler': zustand.regler[f.pfad] = f.wert; zeigeWert(f.pfad); break;
      case '/zustand/deck':
        zustand.decks[f.deck] = f;
        deckAnsicht[f.deck]?.kopf.melde(f.quell_beat, zustand.bpm ?? 128, performance.now(), f.status >= 2);
        if (f.deck <= 2) zeigeDeck(f.deck);
        break;
      case '/e/hotcue': if (f.deck <= 2) holeHotcues(f.deck); break;   // Plan E9
      case '/e/raster': if (f.deck <= 2) holeRaster(f.deck); break;     // Plan Grid
      case '/e/fx': fxVomKern(Number(f.einheit) - 1, f); break;
      case '/e/fx/zuweisung': fxZuweisungVomKern(Number(f.einheit) - 1, String(f.kanal), Number(f.an)); break;
      case '/e/fx/routing': fxRoutingVomKern(Number(f.routing)); break;
      case '/e/geladen': {
        zustand.geladen[f.deck] = f.material_id;
        (zustand.geladenFelder ??= {})[f.deck] = f;
        delete zustand.decks[f.deck];
        const e = eintragVon(f.material_id);
        melde(`Deck ${BUCHSTABE[f.deck] ?? f.deck}: “${e?.titel ?? f.material_id}” loaded`);
        const d = $(`.deck[data-deck="${f.deck}"]`);
        if (deckAnsicht[f.deck]) deckAnsicht[f.deck].id = null;
        if (f.deck <= 2) zeigeDeck(f.deck);
        break;
      }
      case '/q': {
        const eig = zustand.eigeneLaden.get(f.id);
        if (eig && f.status === 6) melde(`Load to deck ${BUCHSTABE[eig.deck]} refused: ${GRUND_TEXT[f.grund] ?? f.grund}`, true);
        break;
      }
      case '/pegel': zeigePegel(f.kanal, f.spitze_db); break;
      case '/e/loop': zustand.loops[f.box] = f; zeigeBox(f.box); break;
      case '/e/mitschnitt':
        if (f.name === recAktiv) recEnde(f.status === 0);  // ein fremder REC (Cypher) beendet den eigenen nicht
        melde(f.status === 0 ? `Loop “${f.name}” recorded (${taktText(f.beats)})`
          : `Recording “${f.name}” failed`, f.status !== 0);
        if (!$('[data-tabelle="loops"]').hidden) ladeLoops();
        break;
      case '/e/neustart': zustand.loops = {}; BOXEN.forEach(zeigeBox); recEnde(); break;  // REC: Puffer starb mit dem Kern
      case '/e/protokollfehler': melde(`Core rejected ${f.adresse}: ${f.grund}`, true); break;
      default: break;
    }
  };
  q.onerror = () => $('#v-kern').classList.remove('an');
}

// ---------- Leitstand (nur lesend, Rolle anzeige, §9.2) ----------
const NB = ['core is back', 'EMERGENCY LOOP playing', 'emergency loop faded out', 'handing back to the core'];
function englisch(e) {
  switch (e.art) {
    case 'geladen': return [`deck ${BUCHSTABE[e.deck] ?? e.deck} loaded “${eintragVon(e.material_id)?.titel ?? e.material_id}”`, 'info'];
    case 'neustart': return [`core restarted (generation ${e.generation})`, 'warnung'];
    case 'luecke': return [`core dropout, ${e.frames} frames`, 'warnung'];
    case 'rueckfall': return [`fallback loop deck ${BUCHSTABE[e.deck] ?? e.deck} ${e.an === 1 ? 'on' : 'off'}`, 'warnung'];
    case 'notbahn': return [NB[e.zustand] ?? `emergency path ${e.zustand}`, e.zustand === 0 ? 'info' : 'warnung'];
    case 'plan_vorgeschlagen': return [`Cypher proposes: ${e.vorschlag.text}`, 'info'];
    case 'vorschlag_angenommen': return ['proposal accepted', 'info'];
    case 'vorschlag_verworfen': return ['proposal rejected', 'info'];
    case 'vorschlag_verfallen': return ['proposal expired', 'warnung'];
    case 'ki_stopp': return [e.gestoppt === 1 ? 'Cypher stopped' : 'Cypher released', 'warnung'];
    case 'invariante': return [`safety rule ${e.invariante} held a plan`, 'warnung'];
    default: return null;
  }
}
let leitstandDa = false;
// Cyphers Vorschlag und Stopp-Taste (Plan M-1 Annahme-Weg): die Seite zeigt den offenen Vorschlag und schickt Andreas' Taste an den Kern
let cypherLage = { vorschlag: null, gestoppt: false };
function zeigeCypher() {
  const v = cypherLage.vorschlag;
  $('#vorschlag').hidden = !v;
  if (v) $('#vorschlag').textContent = `Cypher proposes (bar ${Math.floor(v.start_beat / 4) + 1}): ${v.text}`;
  $('#t-annehmen').hidden = !v; $('#t-verwerfen').hidden = !v;
  $('#t-stopp').hidden = cypherLage.gestoppt; $('#t-freigabe').hidden = !cypherLage.gestoppt;
}
async function sendeTaste(name) {
  const r = await fetch('/taste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); melde(`Key “${name}” not sent: ${j.text ?? j.fehler ?? r.status}`, true); }
}
for (const n of ['annehmen', 'verwerfen', 'stopp', 'freigabe']) $(`#t-${n}`).addEventListener('click', () => sendeTaste(n));
function cypherEreignis(e) {
  const neu = cypherStand(cypherLage, e);
  if (neu) { cypherLage = neu; zeigeCypher(); }
}
let taktVomLeitstand = false; // BAR/PHRASE aus dem Takt-Strom (§9.3), bis dahin aus /uhr
async function leitstand() {
  const k = await (await fetch('/konfig')).json();
  if (k.ziel_kurve) setzeZielKurve(k.ziel_kurve);   // Kern oder Attrappe: was der Server meldet, rechnet die Seite
  let seq = 0;
  const verbinde = () => {
    const ws = new WebSocket(k.leitstand_ws);
    ws.onopen = () => ws.send(JSON.stringify({ v: 1, seq: ++seq, von: 'anzeige', typ: 'hallo',
      zeit: { sample: 0, beat: 0, takt: 1, phrase: 1 }, daten: { rolle: 'anzeige', name: 'oberflaeche', protokoll: 1 } }));
    ws.onmessage = (m) => {
      const n = JSON.parse(m.data);
      if (n.typ === 'willkommen') { leitstandDa = true; $('#v-leitstand').classList.add('an'); }
      if (n.typ === 'takt') { taktVomLeitstand = true; $('#takt').textContent = n.daten.takt; $('#phrase').textContent = n.daten.phrase; }
      // Die Ansage-Sätze des Leitstands sind deutsch (ADR 019); die Seite ist englisch und sagt Ereignisse selbst an
      if (n.typ === 'ereignis') cypherEreignis(n.daten);
      if (n.typ === 'ereignis') { const t = englisch(n.daten); if (t) { const a = $('#ansage'); a.textContent = `Bar ${n.daten.takt}: ${t[0]}`; a.className = `ansage ${t[1]}`; } }
    };
    ws.onclose = () => { cypherLage = { ...cypherLage, vorschlag: null }; zeigeCypher(); leitstandDa = false; taktVomLeitstand = false; seq = 0; $('#v-leitstand').classList.remove('an'); setTimeout(verbinde, 2000); };
  };
  verbinde();
}

// ---------- Strudel-Instanzen (Plan 2 Spec E5/E6; Studio S1: drei Instanzen, je Strom ein Zustand) ----------
// AUTO-Schalter je Instanz (Andreas 2026-09-28): an = Cypher spielt selbst, das Feld folgt. Aus = das laufende Muster
// spielt weiter, bis Andreas eins schickt. Tippt er bei AUTO an, legt die Seite AUTO dieser Instanz selbst aus.
const instanzen = new Map();   // strom → { strom, w (Wurzel), server, schmutzig, fremd, frage, angewandt, statusFehler }
function musterStandText(s) {
  if (!s.text) return 'no pattern yet';
  const wer = s.von === 'andreas' ? 'you' : (s.von ?? '?');
  const ab = s.status?.ab_beat != null && Number.isFinite(s.status.ab_beat) ? ` · since bar ${Math.floor(s.status.ab_beat / 4) + 1}` : '';
  return `pattern ${s.status?.nr ?? '–'} by ${wer}${ab}`;
}
function neueInstanz(w) {
  const i = { strom: Number(w.dataset.strom), w, server: null, schmutzig: false, fremd: null, frage: 0, angewandt: 0, statusFehler: false };
  const q = (s) => $(s, w);
  const zeigeAuto = (an) => { const k = q('.muster-auto'); k.classList.toggle('an', an); k.setAttribute('aria-pressed', String(an)); };
  const zeigeFehler = (t) => { q('.muster-fehler').textContent = t; q('.muster-fehler').className = 'muster-fehler fehler'; };
  const zeigeOk = (t) => { q('.muster-fehler').textContent = t; q('.muster-fehler').className = 'muster-fehler ok'; };
  i.hole = async () => {
    const n = ++i.frage;
    let s;
    try { s = await (await fetch(`/strudel?strom=${i.strom}`)).json(); } catch { return; }
    if (n < i.angewandt) return;   // Review m2: eine ältere Antwort kam nach einer neueren
    i.angewandt = n;
    const neu = !i.server || s.text !== i.server.text;
    i.server = s;
    zeigeAuto(s.autonom !== false);
    q('.muster-stand').textContent = musterStandText(s);
    if (s.status?.fehler && !i.schmutzig) { zeigeFehler(s.status.fehler); i.statusFehler = true; }
    else if (i.statusFehler && !s.status?.fehler) { q('.muster-fehler').textContent = ''; i.statusFehler = false; }
    if (!neu) return;
    if (!i.schmutzig) { q('.muster-feld').value = s.text; i.fremd = null; q('.muster-uebernehmen').hidden = true; }
    else { i.fremd = s.text; q('.muster-uebernehmen').hidden = false; q('.muster-uebernehmen').textContent = `${s.von ?? '?'} changed it · take over`; }
  };
  i.setzeAuto = async (an) => {
    zeigeAuto(an);
    try { await jsonPost('/strudel/autonom', { an, strom: i.strom }); } catch { zeigeFehler('page server unreachable, AUTO unchanged'); }
    await i.hole();
  };
  i.sende = async () => {
    const text = q('.muster-feld').value;
    let r, j;
    try { r = await jsonPost('/strudel', { text, strom: i.strom }); j = await r.json(); }
    catch { return zeigeFehler('page server unreachable, nothing sent'); }   // Review F10
    if (!r.ok) return zeigeFehler(j.fehler);
    zeigeOk('from the next bar');
    if (q('.muster-feld').value === text) { i.schmutzig = false; q('.muster-uebernehmen').hidden = true; }   // Review m1
    await i.hole();
  };
  // STOP (Andreas 2026-09-28): Stille ab dem nächsten Takt, AUTO dieser Instanz aus, der Text bleibt im Feld
  i.stoppe = async () => {
    const f = q('.muster-feld');
    const text = f.value;
    if (i.server?.autonom !== false) { i.server = { ...i.server, autonom: false }; await i.setzeAuto(false); }
    let r, j;
    try { r = await jsonPost('/strudel', { text: 'silence', strom: i.strom }); j = await r.json(); }
    catch { return zeigeFehler('page server unreachable, not stopped'); }
    if (!r.ok) return zeigeFehler(j.fehler);
    f.value = text; i.schmutzig = text !== 'silence';
    zeigeOk('stopped from the next bar');
    await i.hole();
    f.value = text;
    q('.muster-uebernehmen').hidden = true; i.fremd = null;
  };
  const f = q('.muster-feld');
  f.addEventListener('input', () => {
    i.schmutzig = f.value !== (i.server?.text ?? '');
    q('.muster-fehler').textContent = '';
    if (i.schmutzig && i.server?.autonom !== false) { i.server = { ...i.server, autonom: false }; i.setzeAuto(false); }
  });
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); i.sende(); }
    if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); i.stoppe(); }
    if (e.key === '.' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.value = i.server?.text ?? ''; i.schmutzig = false; }
    if (e.key === 'Tab') { e.preventDefault(); f.setRangeText('  ', f.selectionStart, f.selectionEnd, 'end'); f.dispatchEvent(new Event('input')); }
  });
  q('.muster-auto').addEventListener('click', () => i.setzeAuto(!q('.muster-auto').classList.contains('an')));
  q('.muster-senden').addEventListener('click', i.sende);
  q('.muster-stopp').addEventListener('click', i.stoppe);
  q('.muster-zurueck').addEventListener('click', () => { f.value = i.server?.text ?? ''; i.schmutzig = false; q('.muster-uebernehmen').hidden = true; });
  q('.muster-uebernehmen').addEventListener('click', () => { f.value = i.fremd ?? f.value; i.schmutzig = false; i.fremd = null; q('.muster-uebernehmen').hidden = true; });
  return i;
}
// Rollenwahl in der DJ-Ansicht: zeigt eine Instanz und ihren Kanalzug; gemerkt pro Browser (nur Bequemlichkeit)
function waehleRolle(strom) {
  for (const b of $$('.rollen [data-rolle]')) { const an = Number(b.dataset.rolle) === strom; b.classList.toggle('an', an); b.setAttribute('aria-selected', String(an)); }
  for (const w of $$('#deck-c .instanz')) w.classList.toggle('an', Number(w.dataset.strom) === strom);
  for (const z of $$('.zugplatz > .zug')) z.classList.toggle('an', z.dataset.kanalzug === `erz/${strom}`);
  try { localStorage.setItem('djk-rolle', String(strom)); } catch { /* ohne Speicher: Vorgabe DRUMS */ }
}
// Studio S1: Ansicht DJ | STUDIO; wechselt nur die Sicht, nie den Klang. Gemerkt pro Browser (nur Bequemlichkeit).
function setzeAnsicht(a) {
  document.body.classList.toggle('studio', a === 'studio');
  for (const b of $$('[data-ansicht]')) { const an = b.dataset.ansicht === a; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
  try { localStorage.setItem('djk-ansicht', a); } catch { /* ohne Speicher: DJ */ }
}
function bindeAnsicht() {
  for (const b of $$('[data-ansicht]')) b.addEventListener('click', () => setzeAnsicht(b.dataset.ansicht));
  let a = 'dj';
  try { a = localStorage.getItem('djk-ansicht') === 'studio' ? 'studio' : 'dj'; } catch { /* Vorgabe */ }
  setzeAnsicht(a);
}
function bindeMusterFeld() {
  for (const w of $$('#deck-c .instanz')) instanzen.set(Number(w.dataset.strom), neueInstanz(w));
  for (const b of $$('.rollen [data-rolle]')) b.addEventListener('click', () => waehleRolle(Number(b.dataset.rolle)));
  let gemerkt = 1;
  try { gemerkt = Number(localStorage.getItem('djk-rolle')) || 1; } catch { /* Vorgabe */ }
  waehleRolle([1, 2, 3].includes(gemerkt) ? gemerkt : 1);
  const alle = () => { for (const i of instanzen.values()) i.hole(); };
  setInterval(alle, 1000);
  alle();
}

// ---------- Beat-FX (AUFTRAG 2026-09-28): zwei Einheiten (u = 0 FX1, 1 FX2), S8-Layout WET/P1/P2/P3/ON/RESET ----------
const fxBeatText = (b) => (b === 0.25 ? '¼' : b === 0.5 ? '½' : String(b));
const fxBlock = (u) => $(`#fx-${u + 1}`);
function zeigeFx(u) {
  const bl = fxBlock(u);
  if (!bl) return;   // Slice 1: Block für u=1 (FX2) existiert erst ab Slice 2
  const t = FX_ARTEN.find((x) => x.art === fxStand[u].art) ?? FX_ARTEN[0];
  $('[data-fx-art]', bl).textContent = t.name;
  $('[data-fx-param1-name]', bl).textContent = t.param1;
  $('[data-fx-beat]', bl).textContent = fxBeatText(fxStand[u].beats);
  $('[data-fx-an]', bl).classList.toggle('an', fxStand[u].an);
  for (const k of $$('.fxknopf', bl)) zeichne({ el: k, x: fxStand[u][k.dataset.fx] });
  for (const b of $$(`[data-fxzuweisung="${u + 1}"]`)) b.classList.toggle('an', !!fxZuweisung[u][b.dataset.kanal]);
}
function fxVomKern(u, f) {   // /e/fx: der Kern hat es übernommen (auch von der Welle); beim Greifen gilt die Hand
  if (fxStand[u].gegriffen) return;
  Object.assign(fxStand[u], { art: f.art || fxStand[u].art, beats: f.beats, wet: f.wet, param1: f.param1, param2: f.param2, param3: f.param3, an: f.an === 1 });
  zeigeFx(u);
}
function fxZuweisungVomKern(u, kanal, an) {   // /e/fx/zuweisung
  fxZuweisung[u][kanal] = an === 1;
  zeigeFx(u);
}
const fxWartet = [null, null];
function sendeFx(u) {   // gedrosselt wie die Griffe: höchstens alle 30 ms eine Anfrage, die letzte gewinnt
  zeigeFx(u);
  if (fxWartet[u]) return;
  fxWartet[u] = setTimeout(async () => {
    fxWartet[u] = null;
    const { art, beats, wet, param1, param2, param3, an } = fxStand[u];
    const r3 = (x) => Math.round(x * 1000) / 1000;
    await deckPost('/fx', { einheit: u + 1, art, beats, wet: r3(wet), param1: r3(param1), param2: r3(param2), param3: r3(param3), an }, `FX${u + 1}`);
  }, 30);
}
function sendeFxZuweisung(u, kanal) {
  const an = !fxZuweisung[u][kanal];
  fxZuweisung[u][kanal] = an;   // optimistisch zeigen, /e/fx/zuweisung bestätigt
  zeigeFx(u);
  deckPost('/fx/zuweisung', { einheit: u + 1, kanal, an }, `FX${u + 1} assign`);
}
function bindeFxEinheit(u) {
  const bl = fxBlock(u);
  if (!bl) return;   // Slice 1: nur u=0 (FX1) vorhanden
  const artSchritt = (d) => { const i = FX_ARTEN.findIndex((x) => x.art === fxStand[u].art); fxStand[u].art = FX_ARTEN[(i + d + FX_ARTEN.length) % FX_ARTEN.length].art; sendeFx(u); };
  $('[data-fx-art]', bl).addEventListener('click', () => artSchritt(1));
  $('[data-fx-art]', bl).addEventListener('contextmenu', (e) => { e.preventDefault(); artSchritt(-1); });
  $('[data-fx-art]', bl).addEventListener('wheel', (e) => { e.preventDefault(); artSchritt(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  const beat = (d) => { const i = FX_BEATS.indexOf(fxStand[u].beats); fxStand[u].beats = FX_BEATS[Math.max(0, Math.min(FX_BEATS.length - 1, i + d))]; sendeFx(u); };
  $('[data-fx-beat-minus]', bl).addEventListener('click', () => beat(-1));
  $('[data-fx-beat-plus]', bl).addEventListener('click', () => beat(1));
  $('[data-fx-an]', bl).addEventListener('click', () => { fxStand[u].an = !fxStand[u].an; sendeFx(u); });
  $('[data-fx-reset]', bl).addEventListener('click', () => {   // S8 FX Button 2: alle Parameter auf Vorgabe (nicht art/beats/an)
    Object.assign(fxStand[u], FX_VORGABE);
    sendeFx(u);
  });
  for (const k of $$('.fxknopf', bl)) {   // senkrecht ziehen wie die Kanalknöpfe (220 px für den ganzen Weg), Umschalt = fein
    let start = null;
    k.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; k.setPointerCapture(e.pointerId); fxStand[u].gegriffen = true; start = { x: fxStand[u][k.dataset.fx], py: e.clientY }; e.preventDefault(); });
    k.addEventListener('pointermove', (e) => {
      if (!start) return;
      fxStand[u][k.dataset.fx] = Math.max(0, Math.min(1, start.x + (start.py - e.clientY) / 220 * (e.shiftKey ? 0.2 : 1)));
      sendeFx(u);
    });
    const los = () => { start = null; fxStand[u].gegriffen = false; };
    k.addEventListener('pointerup', los);
    k.addEventListener('pointercancel', los);
    k.addEventListener('wheel', (e) => { e.preventDefault(); fxStand[u][k.dataset.fx] = Math.max(0, Math.min(1, fxStand[u][k.dataset.fx] + (e.deltaY < 0 ? 0.02 : -0.02))); sendeFx(u); }, { passive: false });
  }
  zeigeFx(u);
}
function bindeFx() { for (let u = 0; u < 2; u++) bindeFxEinheit(u); bindeFxRouting(); }
// Ohr T18: Taste FX-Routing (eine für beide Einheiten und alle Kanalzüge). Die Anzeige folgt allein dem Kern
// (/e/fx/routing, auch aus einem zweiten Fenster); der Klick bittet nur darum.
let fxRoutingInsert = false;
function zeigeFxRouting() {
  const b = $('#fx-routing');
  if (!b) return;
  b.textContent = fxRoutingInsert ? 'INSERT' : 'POST FADER';
  b.classList.toggle('an', fxRoutingInsert);
  b.setAttribute('aria-pressed', String(fxRoutingInsert));
}
function fxRoutingVomKern(routing) { fxRoutingInsert = routing === 1; zeigeFxRouting(); }
function bindeFxRouting() {
  const b = $('#fx-routing');
  if (!b) return;
  b.addEventListener('click', () => deckPost('/fx/routing', { routing: fxRoutingInsert ? 'post_fader' : 'insert' }, 'FX routing'));
  zeigeFxRouting();
}
function bindeFxZuweisung() {   // Tasten [1] [2] je Kanalzug (wie an der S8: links FX1, rechts FX2)
  for (const b of $$('[data-fxzuweisung]')) {
    const u = Number(b.dataset.fxzuweisung) - 1;
    b.addEventListener('click', () => sendeFxZuweisung(u, b.dataset.kanal));
  }
}

// ---------- Deck-Bedienung (Plan E9): Raster, Sprung per Übersicht, Ziehen, Hotcues SHOT/LOOP, Loop ----------
async function deckPost(pfad, daten, was) {
  try {
    const r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
    const j = await r.json();
    if (!r.ok) { melde(`${was}: ${j.fehler}`, true); return null; }
    return j;
  } catch { melde(`${was}: page server unreachable`, true); return null; }
}
// Plan Grid: Versatz des Rasters (Frames). Die Laufansicht hält a.raster als Objekt, die neue Linie gilt ab dem nächsten Bild.
const msText = (v) => { const ms = v / 48; return `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms).toFixed(1)} ms`; };
async function holeRaster(n) {
  try {
    const r = await fetch(`/deck/raster?deck=${n}`);
    if (r.ok) zeigeRaster(n, await r.json());
  } catch { /* nächster Anlass: /e/raster oder nächstes Laden */ }
}
function zeigeRaster(n, j) {
  const a = deckAnsicht[n], d = $(`.deck[data-deck="${n}"]`);
  if (a.raster) a.raster.ersterSchlagFrame = a.raster.basisSchlag + j.versatz_frames;
  // ganze Beats (aus SET) getrennt vom Feinversatz: „−1b +2.0“ statt „−466.7 ms“ (kurz, sonst ragt FIX aus dem Deck)
  const fpb = a.raster?.framesProBeat, k = fpb ? Math.round(j.versatz_frames / fpb) : 0;
  $('[data-gridwert]', d).textContent = k ? `${k > 0 ? '+' : '−'}${Math.abs(k)}b ${msText(j.versatz_frames - Math.round(k * fpb)).replace(' ms', '')}` : msText(j.versatz_frames);
  $('[data-gridwert]', d).title = k ? `grid ${k} beats and ${msText(j.versatz_frames - Math.round(k * fpb))} from the analysis` : '';
  $('[data-gridfix]', d).classList.toggle('offen', j.versatz_frames !== j.gespeichert_frames);
  window.djkRaster = window.djkRaster ?? {}; window.djkRaster[n] = a.raster ? a.raster.ersterSchlagFrame - a.raster.basisSchlag : null;
}
async function holeHotcues(n) {
  try { deckAnsicht[n].hotcues = await (await fetch(`/deck/hotcues?deck=${n}`)).json(); } catch { return; }
  zeigePads(n);
}
function zeigePads(n) {
  const h = deckAnsicht[n].hotcues ?? {};
  for (const p of $$(`.deck[data-deck="${n}"] .pad`)) {
    const e = h[p.dataset.nr];
    p.className = `pad ${e ? e.art : 'leer'}`;
    p.title = e ? `Cue ${p.dataset.nr}: ${e.art.toUpperCase()}${e.art === 'loop' ? ` ${e.laenge}` : ''} · click = play · shift+click = SHOT/LOOP · right click = delete`
      : `Cue ${p.dataset.nr}: empty · click = set here (while a loop runs: store that loop)`;
  }
}
// Marken der Wellen: Hotcues (Loop-Cues mit Bereich) und der aktive Deck-Loop (heller Bereich, ohne Nummer)
function hotcueMarken(a) {
  if (!a.raster) return [];
  const f = (q) => a.raster.ersterSchlagFrame + q * a.raster.framesProBeat;
  const m = Object.entries(a.hotcues ?? {}).map(([nr, h]) => (h.art === 'loop'
    ? { frame: f(h.quell_beat), bis: f(h.quell_beat + (h.laenge ?? 4)), farbe: FARBE_LOOP, bereich: 'rgba(47,214,195,0.16)', text: nr }
    : { frame: f(h.quell_beat), farbe: FARBE_SHOT, text: nr }));
  if (a.loop?.laenge) m.unshift({ frame: f(a.loop.start), bis: f(a.loop.start + a.loop.laenge), farbe: '#ffd23f', bereich: 'rgba(255,210,63,0.22)' });
  return m;
}
// Aktiver Deck-Loop vom Seiten-Server (Start, Länge); geholt, wenn der Loop-Zustand des Decks kippt und nach Loop-Griffen
async function holeLoop(n) {
  try { deckAnsicht[n].loop = await (await fetch(`/deck/loop?deck=${n}`)).json(); } catch { /* nächster Anlass */ }
}
// Loop aktiv: läuft darin (Status 3) oder scharf bei stehendem Deck (Kern meldet dann beats_bis_ende null, gemessen Instanz i)
function loopAktiv(z) { return !!z && (z.status === 3 || (z.status >= 1 && z.beats_bis_ende === null)); }   // INFINITY kommt als null
function setzeMuell(n, an) {
  deckAnsicht[n].muell = an;
  $(`.deck[data-deck="${n}"] [data-muell]`).classList.toggle('an', an);
}
// Traktor-Weg: CUE-Art wählen (SHOT/LOOP), leeres Pad = Cue hier; gesetztes Pad = reinspringen; 🗑 dann Pad = löschen
async function padKlick(n, nr, e) {
  const a = deckAnsicht[n], h = (a.hotcues ?? {})[nr];
  let daten;
  if (e.type === 'contextmenu') { e.preventDefault(); if (!h) return; daten = { aktion: 'loeschen' }; }
  else if (a.muell) { setzeMuell(n, false); if (!h) return; daten = { aktion: 'loeschen' }; }
  else if (!h && a.cueArt === 'loop' && loopAktiv(zustand.decks[n])) daten = { aktion: 'setzen', aus_loop: true, laenge: a.loopLaenge, raster: a.rasterWahl };
  else if (!h && a.cueArt === 'loop') daten = { aktion: 'setzen', quell_beat: a.kopf.beat(performance.now()), art: 'loop', laenge: a.loopLaenge, raster: a.rasterWahl };
  else if (!h) daten = { aktion: 'setzen', quell_beat: a.kopf.beat(performance.now()), art: 'shot', raster: a.rasterWahl };
  else if (e.shiftKey) daten = { aktion: 'setzen', quell_beat: h.quell_beat, art: h.art === 'loop' ? 'shot' : 'loop', laenge: a.loopLaenge, raster: 0.25 };
  else daten = { aktion: 'spielen', raster: a.rasterWahl };
  if (await deckPost('/deck/hotcue', { deck: n, nr: Number(nr), ...daten }, `Cue ${nr}`)) { holeHotcues(n); setTimeout(() => holeLoop(n), 400); }
}
function bindeDeckBedienung(n, d) {
  const a = deckAnsicht[n];
  a.rasterWahl = 4; a.loopLaenge = 4; a.hotcues = {}; a.zieh = 0; a.cueArt = 'shot'; a.muell = false;
  for (const b of $$('[data-cueart]', d)) b.addEventListener('click', () => {
    a.cueArt = b.dataset.cueart;
    for (const x of $$('[data-cueart]', d)) x.classList.toggle('an', x === b);
  });
  $('[data-muell]', d).addEventListener('click', () => setzeMuell(n, !a.muell));
  // laufenden Deck-Loop sichern (Bibliothek › LOOPS) und gleich in L1/L2 laden
  for (const b of $$('[data-nachbox]', d)) b.addEventListener('click', async () => {
    if (!loopAktiv(zustand.decks[n])) { melde('Loop → L: no loop running on this deck', true); return; }
    const j = await deckPost('/deck/loop/sichern', { deck: n, box: Number(b.dataset.nachbox) }, `Loop → L${b.dataset.nachbox}`);
    if (j) { melde(`Loop saved as ${j.name}, loaded into L${b.dataset.nachbox}`); ladeLoops(); }
  });
  for (const b of $$('[data-raster]', d)) b.addEventListener('click', () => {
    a.rasterWahl = Number(b.dataset.raster);
    for (const x of $$('[data-raster]', d)) x.classList.toggle('an', x === b);
  });
  const pads = $('[data-pads]', d);
  for (let nr = 1; nr <= 8; nr++) {
    const p = document.createElement('button');
    p.className = 'pad leer'; p.dataset.nr = String(nr); p.textContent = String(nr);
    p.addEventListener('click', (e) => padKlick(n, String(nr), e));
    p.addEventListener('contextmenu', (e) => padKlick(n, String(nr), e));
    pads.append(p);
  }
  const loops = $('[data-loops]', d);
  for (const l of LOOP_LAENGEN) {
    const b = document.createElement('button');
    b.textContent = String(l); b.dataset.loopl = String(l); b.title = `Loop length ${l} beat${l > 1 ? 's' : ''}`;
    b.classList.toggle('an', l === a.loopLaenge);
    b.addEventListener('click', () => { a.loopLaenge = l; for (const x of $$('[data-loopl]', d)) x.classList.toggle('an', x === b); });
    loops.append(b);
  }
  const an = document.createElement('button');
  an.textContent = 'LOOP'; an.dataset.loopan = ''; an.title = 'Loop on/off at the snap grid';
  an.addEventListener('click', async () => {
    await deckPost('/deck/loop', { deck: n, laenge: an.classList.contains('an') ? 0 : a.loopLaenge, raster: a.rasterWahl }, 'Loop');
    setTimeout(() => holeLoop(n), 400);
  });
  loops.append(an);
  // Springen in der Übersicht: Klick → Quell-Beat, der Server rastet ein (stehend) bzw. hält die Phase (laufend)
  $('[data-ueber]', d).addEventListener('click', (e) => {
    if (!a.ueber.w || !a.raster) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frame = (e.clientX - r.left) / r.width * laengeFrames(a.ueber.w);
    deckPost('/deck/sprung', { deck: n, ziel: (frame - a.raster.ersterSchlagFrame) / a.raster.framesProBeat, raster: a.rasterWahl }, 'Jump');
  });
  // Ziehen im Zoomfenster: die Welle folgt der Hand, beim Loslassen EIN Sprung um die Strecke (D7, ohne Raster)
  const lauf = $('[data-lauf]', d);
  let x0 = null;
  lauf.addEventListener('pointerdown', (e) => { if (a.raster && a.lauf.w) { x0 = e.clientX; lauf.setPointerCapture(e.pointerId); } });
  lauf.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const fpp = a.lauf.takte * 4 * a.raster.framesProBeat / lauf.getBoundingClientRect().width;
    a.zieh = -(e.clientX - x0) * fpp;
  });
  const los = async (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, delta = a.zieh / a.raster.framesProBeat;
    x0 = null;
    if (Math.abs(dx) < 3) { a.zieh = 0; return; }
    await deckPost('/deck/sprung', { deck: n, delta, raster: 0 }, 'Drag');
    a.zieh = 0;
  };
  lauf.addEventListener('pointerup', los);
  lauf.addEventListener('pointercancel', () => { x0 = null; a.zieh = 0; });
  // Plan Grid (D4): ◀ ▶ 5 ms, Shift 1 ms; Rechtsklick auf den Wert: zurück auf die Analyse (0); FIX speichert
  for (const b of $$('[data-gridschritt]', d)) b.addEventListener('click', async (e) => {
    const j = await deckPost('/deck/raster', { deck: n, schritt_ms: Number(b.dataset.gridschritt) * (e.shiftKey ? 1 : 5) }, 'Grid');
    if (j) zeigeRaster(n, j);
  });
  $('[data-gridwert]', d).addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const j = await deckPost('/deck/raster', { deck: n, versatz_frames: 0 }, 'Grid');
    if (j) zeigeRaster(n, j);
  });
  // SET (Traktor „Set Grid Marker“): nur bei stehendem Deck; der Schlag unter dem Kopf wird Takt-Eins
  $('[data-gridset]', d).addEventListener('click', async () => {
    if ((zustand.decks[n]?.status ?? 0) >= 2) { melde('Grid SET: stop the deck on the downbeat first', true); return; }
    const j = await deckPost('/deck/raster', { deck: n, set: true }, 'Grid SET');
    if (j) zeigeRaster(n, j);
  });
  $('[data-gridfix]', d).addEventListener('click', async () => {
    const j = await deckPost('/deck/raster/fix', { deck: n }, 'Grid FIX');
    if (j) zeigeRaster(n, j);
  });
}

// Bildschleife (Plan Oberfläche T4/T5): Wellen und Köpfe je Bild, Kopf zwischen Meldungen hochgerechnet
window.djkBild = [];       // Zeichendauer je Bild in ms, Ring 600 (Plan T8, Prüfung: lesen)
function bild() {
  const jetzt = performance.now(), beat = uhrKopf.beat(jetzt);
  for (const n of BOXEN) {
    const z = zustand.loops[n], a = loopAnsicht[n];
    const lang = z?.beats ?? 4, laeuft = z && (z.status === 3 || z.status === 4);
    const pos = laeuft ? ((beat % lang) + lang) % lang : 0;
    const kopf = (((pos * FPB + (a.versatz ?? 0)) % (lang * FPB)) + lang * FPB) % (lang * FPB);   // Plan Grid: gedreht wie im Kern
    a.ansicht.zeichne((lang * FPB) / 2, kopf);        // ganze Loop steht, der Kopf wandert (wie Traktors Remix-Slots)
  }
  for (const n of DECKS) {
    const a = deckAnsicht[n];
    if (!a.raster) { a.lauf.zeichne(0); a.ueber.zeichne(0, 0); continue; }
    const f = a.raster.ersterSchlagFrame + a.kopf.beat(jetzt) * a.raster.framesProBeat + (a.zieh ?? 0);
    const marken = hotcueMarken(a);
    a.lauf.zeichne(f, null, marken); a.ueber.zeichne(f, a.lauf.takte * 4 * a.raster.framesProBeat, marken);
  }
  window.djkBild.push(performance.now() - jetzt); if (window.djkBild.length > 600) window.djkBild.shift();
  requestAnimationFrame(bild);
}
// ---------- Aufbau: am Ende der Datei, nach allen Definitionen (dreimal am 2026-09-28 griff der Aufbau auf ein const,
// das weiter unten stand: Temporal Dead Zone; hier unten gilt jedes const der Datei schon) ----------
zeigeCypher();
baueDecks();
baueBoxen();
baueRec();
bindeReiter();
bindeLibrary();
bindeSets();
bindeSchublade();
bindeTempo();
bindeMusterFeld();
try { bindeSpurbaender(jsonPost, () => letzterBeat); } catch (e) { console.error('Studio S7 lanes:', e); }   // Studio S7
bindeAnsicht();
bindeFx();
bindeFxZuweisung();
bindeKnoepfe();
for (const o of $$('[data-wert]')) zeigeWert(o.dataset.wert);
for (const k of $$('.schalter[data-pfad]')) zeigeWert(k.dataset.pfad);
for (const g of $$('.xzuweisung[data-pfad]')) zeigeWert(g.dataset.pfad);  // Vorgabe THRU blass, bis der Kern meldet
DECKS.forEach(zeigeDeck);
ladeBestand().then(() => DECKS.forEach(zeigeDeck));
BOXEN.forEach(zeigeBox);
ladeLoops();
requestAnimationFrame(bild);
strom();
leitstand();

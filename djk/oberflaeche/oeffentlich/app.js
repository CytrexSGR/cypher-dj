// djk MVP-Oberfläche (Scheibe 60m). Kein Ton: diese Seite erzeugt und spielt nie Audio.
// Öffnen sendet nichts an den Kern: gesendet wird nur auf einen Griff (Zeiger, Rad, Klick) oder LOAD.
// Lesen: /strom (Kern über den Seiten-Server), Leitstand-WS als Rolle "anzeige" (takt, ansage, ereignis).
import { DECKS, ERZEUGER, LOOPBOXEN, GRIFF, art, griffZuMidi, formatiere, vorgabe, setzeZielKurve } from './kurven.js';
import { KOMP_PRESETS, KOMP_SCHLUESSEL, kennlinienPfad, AUTO_BEREICH, DURCHGAENGE, AUTO_VORLAGEN, vorlagePunkte, punktAusStelle, fxInhaltText } from './effekte.js';
import { KOPIE_TEXT, HAND_PRUEFMODUS_TEXT, cypherStand, ausgangAnzeige, keylockStand, keylockAnfrage, keylockMeldung, variText, einsHinweis, EINS_HINWEIS_TEXT } from './meldungen.js';
import { leseWelle, Kopf, Laufansicht, Uebersicht, SR, laengeFrames, ersteVolleEins } from './welle.js';
import { bindeSpurbaender } from './spurband_ansicht.js';
import { ScrubZieher } from './scrub.js';
import { bindeProduktion } from './produktion/produktion.js';
import { vorhoerFolgt, vorhoerCursor, SPALTEN, LISTEN_SPALTEN, LISTEN_TEXT, TYP_TEXT, stoebernUrl, zelle, baueBaum, listenArtFuer, ziehZiel, postenArtText, filterFuer, filterBereinigt, detailFakten, welleStatus, feldText, aktionenFuer, loopBoxStatus, IMPORT_FEHLER_TEXT, vorbereitText, statusText, setzeVorbereitLive, fehlerAnzeige } from './stoebern.js';

const $ = (s, w = document) => w.querySelector(s);
const $$ = (s, w = document) => [...w.querySelectorAll(s)];
const BUCHSTABE = { 1: 'A', 2: 'B' };
const STATUS_TEXT = ['LOADED', 'LOADED', 'PLAYING', 'LOOP', 'ROLL', 'FALLBACK'];
const LOOP_LAENGEN = [1, 2, 4, 8, 16];                      // Plan E9: Loop-Reihe (Beats)
// AUFTRAG 2026-09-28: zwei Beat-FX-Einheiten, drei Parameter je Einheit (S8-Layout). fxStand/fxZuweisung sind je
// Einheit (Index 0 = FX1, 1 = FX2). Nur param1 wirkt im Kern (Vorgabe je Art, aus S8-Abgleich).
const FX_ARTEN = [{ art: 1, name: 'ECHO', param1: 'FEEDBACK' }, { art: 2, name: 'FLANGER', param1: 'FEEDBACK' },
  { art: 3, name: 'PHASER', param1: 'RESONANCE' }, { art: 4, name: 'FILTER', param1: 'Q' },
  { art: 5, name: 'REVERB', param1: 'SIZE' }, { art: 6, name: 'DELAY', param1: 'TONE' },
  { art: 7, name: 'PING PONG', param1: 'FEEDBACK' }, { art: 8, name: 'TRANS', param1: 'DUTY' },
  { art: 9, name: 'ROLL', param1: '-' }, { art: 10, name: 'SLIP ROLL', param1: '-' }, { art: 11, name: 'VINYL BRAKE', param1: '-' },
  { art: 12, name: 'SPIRAL', param1: 'FEEDBACK' }];
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
    const hinweis = einsHinweis(e);   // Tor eins: unsichere Takt-Eins steht in der Zeile
    if (hinweis) {
      const h = document.createElement('span');
      h.className = 'eins-hinweis'; h.textContent = hinweis; h.title = EINS_HINWEIS_TEXT;
      tr.querySelector('td.titelzelle').append(' ', h);
    }
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
    ? `${e.camelot ?? '–'} · orig ${e.quelle_bpm.toFixed(1)} BPM · plays at ${Number(g?.basis_bpm ?? e.basis_bpm).toFixed(0)} · ${fmtZeit(e.dauer_s)}`
    : id;
  // Welle 3 (ADR 028): bei Master ≠ Basis folgt das Deck im Varispeed, die Tonhöhe wandert um 12·log2(Master/Basis) Halbtöne.
  // Keylock 3b: VARI nur, wenn das Deck wirklich im Varispeed klingt (Knopf UND Hörweg aus /zustand/deck, meldungen.js variText)
  const basis = g?.basis_bpm ?? e?.basis_bpm;
  const vari = variText({ bpm: zustand.bpm, basis, knopf: keylockStand(zustand.regler), hoerweg: z?.hoerweg });
  d.classList.toggle('tempo-fremd', vari !== null);
  if (vari) $('[data-meta]', d).textContent += ` · ${vari}`;
  // Takt und Hinweis gelten für die GESPIELTE Fassung (eine Korrektur legt r2 mit anderer Eins neben r1; eintragVon liefert r1)
  const eg = g?.fassung ? zustand.bestand.find((x) => x.material_id === id && x.basis_bpm === g.basis_bpm && x.fassung === g.fassung) ?? e : e;
  const hinweis = einsHinweis(eg), hEl = $('[data-einshinweis]', d);
  if (hEl) { hEl.hidden = !hinweis; hEl.textContent = hinweis ?? ''; hEl.title = EINS_HINWEIS_TEXT; }
  const r = deckAnsicht[n]?.raster;   // Zählung ab der ersten vollen Eins im Track, nicht erst ab dem analysierten Stück
  const eins = r ? ersteVolleEins(eg?.erste_eins_quell_beat ?? r.eins ?? 0, r.ersterSchlagFrame, r.framesProBeat) : (eg?.erste_eins_quell_beat ?? 0);
  const gesamt = eg?.beats ? Math.floor((eg.beats - eins) / 4) : null;
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
  const fz = $(`[data-fxpegel="${CSS.escape(kanal)}"]`);   // Effekt-Sektion: Pegel je Streifen
  if (fz) fz.textContent = db <= -199 ? '−∞' : db.toFixed(1).replace('-', '−');
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
    else return true;
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
  return false;
}

// Plan Tempo-Folge: Master-Tempo. Enter im Feld oder − / + (Shift: 0,1); der Kern fährt es ab der nächsten Eins
// über einen Takt. Die Ablehnung steht als Meldung da. Laufende Decks folgen im Varispeed (Welle 3, ADR 028).
const TEMPO_GRUND = { bereich: '60 to 200 BPM', ueberlappung: 'a tempo change is already running', karte_voll: 'too many tempo changes queued' };
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
// Keylock 3 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4): EIN globaler Knopf `keylock` (Vorgabe an) für Decks und
// Loop-Boxen; gesetzt über /regler (sofort, Quelle andreas), angezeigt aus /e/regler. 3b: ohne Meldung unbekannt (KEY ?).
function zeigeKeylock() {
  const k = $('#keylock');
  if (!k) return;
  const an = keylockStand(zustand.regler);
  k.classList.toggle('an', an === true);
  k.classList.toggle('unbekannt', an === null);
  k.textContent = an === null ? 'KEY ?' : 'KEY';
  k.setAttribute('aria-pressed', an === null ? 'mixed' : String(an));
}
async function schalteKeylock() {
  const body = keylockAnfrage(keylockStand(zustand.regler));
  try {
    const r = await fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    window.djkGesendet.push({ keylock: body.nach, code: r.status, antwort: j });
    const m = keylockMeldung(r.status, j);
    if (m) melde(m, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}

// Effekt-Sektion (Plan 2026-10-11-effekt-sektion.md, Andreas: „tauschoberfläche gegen die libary unten“): unten LIBRARY |
// EFFECTS; EFFECTS zeigt je Quellkanal einen Streifen mit dem Kompressor (<k>/komp/*), Bedienung über /regler (sofort),
// Absenkung aus /zustand/komp (10 Hz je aktivem Kompressor). Der gewählte Bereich gilt je Betrachter (localStorage).
const FX_KANAELE = [['deck/1', 'A'], ['deck/2', 'B'], ['erz/1', 'DRUMS'], ['erz/2', 'BASS'], ['erz/3', 'MELODY'], ['pad/1', 'L1'], ['pad/2', 'L2']];
const FX_INDEX = { 'deck/1': 0, 'deck/2': 1, 'erz/1': 4, 'erz/2': 5, 'erz/3': 6, 'pad/1': 12, 'pad/2': 13 };   // Mixer-Index (komp/sc = Index + 1)
const KOMP_REGLER = [
  { feld: 'schwelle', name: 'THR', min: -60, max: 0, schritt: 0.5, vorgabe: -18, text: (w) => `${w.toFixed(1)}` },
  { feld: 'ratio', name: 'RATIO', min: 1, max: 20, schritt: 0.1, vorgabe: 4, text: (w) => `${w.toFixed(1)}:1` },
  { feld: 'mix', name: 'MIX', min: 0, max: 1, schritt: 0.01, vorgabe: 1, text: (w) => `${Math.round(w * 100)}%` },
];
const kompGr = {};   // kanal -> { db, t }
function kompWert(k, feld, vor) { const w = zustand.regler?.[`${k}/komp/${feld}`]; return typeof w === 'number' ? w : vor; }
function setzeBereich(b) {
  document.body.classList.toggle('bereich-effekte', b === 'effekte');
  for (const t of $$('[data-bereich]')) { const an = t.dataset.bereich === b; t.classList.toggle('an', an); t.setAttribute('aria-selected', String(an)); }
  $('#effekte').hidden = b !== 'effekte';
  if (b === 'effekte') holeFxInhalt();
  try { localStorage.setItem('djk-bereich', b); } catch { /* ohne Speicher: nur jetzt */ }
}
async function setzeKomp(pfad, nach) {
  try {
    const r = await fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, nach, ab: 'jetzt' }) });
    const j = await r.json();
    window.djkGesendet.push({ [pfad]: nach, code: r.status, antwort: j });
    if (r.status !== 200) melde(`Compressor refused: ${j?.fehler ?? r.status}`, true);
    else if (j?.quittung?.status === 6) melde(`Compressor refused: ${j.quittung.grund}`, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}
function baueFxStreifen() {
  const reihe = $('#fxstreifen');
  reihe.replaceChildren();
  for (const [k, name] of FX_KANAELE) {
    const s = document.createElement('div');
    s.className = 'fxstreifen';
    s.dataset.kanal = k;
    s.innerHTML = `<div class="fxname"><span>${name}</span><button class="komp-an" title="Compressor on/off (${k})">COMP</button></div>`
      + `<div class="fxinhalt" data-fxinhalt="${k}" title="What plays on this channel">–</div>`
      + `<div class="fxpegel"><div class="meter waagrecht" data-kanal="${k}"><i></i></div><span data-fxpegel="${k}">−∞</span></div>`
      + KOMP_REGLER.map((r) => `<label>${r.name}<input type="range" data-komp-feld="${r.feld}" min="${r.min}" max="${r.max}" step="${r.schritt}" aria-label="${name} compressor ${r.name}"><output></output></label>`).join('')
      + '<div class="gr" title="Gain reduction"><i></i></div><div class="grzahl">GR –</div>';
    s.querySelector('.komp-an').addEventListener('click', () => setzeKomp(`${k}/komp/an`, kompWert(k, 'an', 0) >= 0.5 ? 0 : 1));
    for (const inp of s.querySelectorAll('input[data-komp-feld]')) {
      let warte = null;
      inp.addEventListener('input', () => {
        s.querySelector(`input[data-komp-feld="${inp.dataset.kompFeld}"] + output`).textContent = KOMP_REGLER.find((r) => r.feld === inp.dataset.kompFeld).text(Number(inp.value));
        if (warte) return;
        warte = setTimeout(() => { warte = null; setzeKomp(`${k}/komp/${inp.dataset.kompFeld}`, Number(inp.value)); }, 40);
      });
    }
    reihe.append(s);
  }
  zeigeKomp();
}
function zeigeKomp(nur) {
  for (const s of $$('.fxstreifen')) {
    const k = s.dataset.kanal;
    if (nur && nur !== k) continue;
    const an = kompWert(k, 'an', 0) >= 0.5;
    const b = s.querySelector('.komp-an');
    b.classList.toggle('an', an);
    b.setAttribute('aria-pressed', String(an));
    for (const r of KOMP_REGLER) {
      const inp = s.querySelector(`input[data-komp-feld="${r.feld}"]`);
      const w = kompWert(k, r.feld, r.vorgabe);
      if (document.activeElement !== inp) inp.value = String(w);
      inp.nextElementSibling.textContent = r.text(w);
    }
    const g = kompGr[k];
    const db = an && g && performance.now() - g.t < 400 ? g.db : 0;
    s.querySelector('.gr i').style.width = `${Math.min(100, (db / 24) * 100)}%`;
    const sc = kompWert(k, 'sc', 0), scName = KOMP_SCHLUESSEL.find(([w]) => w === sc)?.[1];
    s.querySelector('.grzahl').textContent = an ? `GR ${db.toFixed(1)} dB${sc ? ` · KEY ${scName ?? sc}` : ''}` : 'GR –';
  }
}
// Schritt 3: aufgeklappt (⤢) das Detail des gewählten Kanals: alle Regler, Presets, Kennlinie, Verlauf der Absenkung (10 s)
const KOMP_DETAIL = [
  { feld: 'schwelle', name: 'THRESHOLD', min: -60, max: 0, schritt: 0.5, vorgabe: -18, text: (w) => `${w.toFixed(1)} dB` },
  { feld: 'ratio', name: 'RATIO', min: 1, max: 20, schritt: 0.1, vorgabe: 4, text: (w) => `${w.toFixed(1)}:1` },
  { feld: 'attack', name: 'ATTACK', min: 0.1, max: 100, schritt: 0.1, vorgabe: 10, text: (w) => `${w.toFixed(1)} ms` },
  { feld: 'release', name: 'RELEASE', min: 10, max: 1000, schritt: 1, vorgabe: 120, text: (w) => `${Math.round(w)} ms` },
  { feld: 'makeup', name: 'MAKEUP', min: 0, max: 24, schritt: 0.1, vorgabe: 0, text: (w) => `+${w.toFixed(1)} dB` },
  { feld: 'mix', name: 'MIX', min: 0, max: 1, schritt: 0.01, vorgabe: 1, text: (w) => `${Math.round(w * 100)}%` },
];
let fxGewaehlt = 'erz/1';
const kompVerlauf = {};   // kanal -> letzte 100 Absenkungen (10 Hz)
function grJetzt(k) { const g = kompGr[k]; return kompWert(k, 'an', 0) >= 0.5 && g && performance.now() - g.t < 400 ? g.db : 0; }
function waehleFx(k) {
  fxGewaehlt = k;
  for (const s of $$('.fxstreifen')) s.classList.toggle('gewaehlt', s.dataset.kanal === k);
  baueFxDetail();
}
function baueFxDetail() {
  const d = $('#fxdetail');
  const k = fxGewaehlt;
  const name = FX_KANAELE.find(([p]) => p === k)?.[1] ?? k;
  d.innerHTML = `<div class="fxkopf"><b>${name}</b><span class="klein">${k}</span><button class="komp-an" title="Compressor on/off">COMP</button>
      <select class="preset" aria-label="Preset"><option value="">Preset…</option>${Object.keys(KOMP_PRESETS).map((n) => `<option>${n}</option>`).join('')}</select>
      <label class="klein">KEY <select class="schluessel" title="Sidechain: the detector listens to this channel's input (Kick Sidechain: DRUMS)">${KOMP_SCHLUESSEL.filter(([w]) => w === 0 || w !== FX_INDEX[k] + 1).map(([w, n]) => `<option value="${w}">${n}</option>`).join('')}</select></label></div>
    <div class="regler-liste">${KOMP_DETAIL.map((r) => `<label>${r.name}<input type="range" data-komp-feld="${r.feld}" min="${r.min}" max="${r.max}" step="${r.schritt}"><output></output></label>`).join('')}</div>
    <div class="bilder"><span class="bildtitel">TRANSFER CURVE (knee 6 dB)</span>
      <svg viewBox="0 0 240 168" aria-label="Transfer curve"><line class="achse" x1="0" y1="168" x2="240" y2="48"/><line class="schwelle"/><path class="kurve"/></svg>
      <span class="bildtitel">GAIN REDUCTION, LAST 10 S</span><canvas width="480" height="100" aria-label="Gain reduction history"></canvas></div>
    ${k.startsWith('pad/') ? `<div class="autobereich"><span class="bildtitel">AUTOMATION OF THE LOOP <b class="autoname">–</b> · saved with the loop, plays on every pass ·
      click: add point · drag: move · double click: remove</span>
      <div class="autokopf"><select class="autopfad" aria-label="Automated control">${Object.keys(AUTO_BEREICH).map((p) => `<option>${p}</option>`).join('')}</select>
      <label class="klein">LENGTH <select class="autolaenge" title="Lane length in loop passes; long lanes start on a multiple of their length (phrase)">${DURCHGAENGE.map((d) => `<option value="${d}">${d}× loop</option>`).join('')}</select></label>
      <select class="autovorlage" aria-label="Template for this lane"></select>
      <button class="autospeichern">SAVE</button><button class="autoleeren">CLEAR LANE</button><span class="autostatus"></span></div>
      <svg class="autospur" viewBox="0 0 480 120" aria-label="Automation lane"></svg></div>` : ''}`;
  d.querySelector('.komp-an').addEventListener('click', () => setzeKomp(`${k}/komp/an`, kompWert(k, 'an', 0) >= 0.5 ? 0 : 1));
  d.querySelector('.schluessel').addEventListener('change', (e) => setzeKomp(`${k}/komp/sc`, Number(e.target.value)));
  d.querySelector('.preset').addEventListener('change', async (e) => {
    const p = KOMP_PRESETS[e.target.value];
    e.target.value = '';
    if (!p) return;
    for (const [feld, w] of Object.entries(p)) await setzeKomp(`${k}/komp/${feld}`, w);
  });
  for (const inp of d.querySelectorAll('input[data-komp-feld]')) {
    let warte = null;
    inp.addEventListener('input', () => {
      inp.nextElementSibling.textContent = KOMP_DETAIL.find((r) => r.feld === inp.dataset.kompFeld).text(Number(inp.value));
      if (warte) return;
      warte = setTimeout(() => { warte = null; setzeKomp(`${k}/komp/${inp.dataset.kompFeld}`, Number(inp.value)); }, 40);
    });
  }
  if (k.startsWith('pad/')) bindeAutomation(d, Number(k.slice(4)));
  zeigeFxDetail();
}
function zeigeFxDetail() {
  const d = $('#fxdetail');
  if (!d || !d.firstChild) return;
  const k = fxGewaehlt;
  const an = kompWert(k, 'an', 0) >= 0.5;
  const b = d.querySelector('.komp-an');
  b.classList.toggle('an', an);
  b.setAttribute('aria-pressed', String(an));
  for (const r of KOMP_DETAIL) {
    const inp = d.querySelector(`input[data-komp-feld="${r.feld}"]`);
    const w = kompWert(k, r.feld, r.vorgabe);
    if (document.activeElement !== inp) inp.value = String(w);
    inp.nextElementSibling.textContent = r.text(w);
  }
  const sl = d.querySelector('.schluessel');
  if (sl && document.activeElement !== sl) sl.value = String(kompWert(k, 'sc', 0));
  const t = kompWert(k, 'schwelle', -18), ra = kompWert(k, 'ratio', 4), mu = kompWert(k, 'makeup', 0);
  d.querySelector('.kurve').setAttribute('d', kennlinienPfad(t, ra, mu, 240, 168));
  const sx = ((t + 60) / 60) * 240;
  const s = d.querySelector('.schwelle');
  s.setAttribute('x1', sx); s.setAttribute('x2', sx); s.setAttribute('y1', 0); s.setAttribute('y2', 168);
}
// Schritt 4: Automation je Loop. Daten aus GET /loop/automation, Bearbeiten im Feld, SAVE schreibt sie in loop.json
let autoDaten = [];        // [{pfad, punkte}] des Loops in der gewählten Box
let autoLoop = { name: '', beats: 0 };
function bindeAutomation(d, box) {
  const svg = d.querySelector('.autospur');
  const sel = d.querySelector('.autopfad');
  const lsel = d.querySelector('.autolaenge');
  const vsel = d.querySelector('.autovorlage');
  const vorlagenFuellen = () => {
    vsel.innerHTML = `<option value="">Template…</option>${(AUTO_VORLAGEN[sel.value] ?? []).map((v, i) => `<option value="${i}">${v.name}</option>`).join('')}`;
  };
  const status = d.querySelector('.autostatus');
  const l = zustand.loops[box];
  autoLoop = { name: l?.name ?? '', beats: Number(l?.beats) || 0 };
  d.querySelector('.autoname').textContent = autoLoop.name ? `${autoLoop.name} (${autoLoop.beats} beats)` : 'no loop in this box';
  autoDaten = [];
  const spur = () => { let s = autoDaten.find((x) => x.pfad === sel.value); if (!s) { s = { pfad: sel.value, punkte: [], durchgaenge: 1 }; autoDaten.push(s); } return s; };
  const laenge = () => (autoLoop.beats || 4) * (spur().durchgaenge ?? 1);
  const zeichne = () => {
    const b = laenge(), lb = autoLoop.beats || 4, [lo, hi] = AUTO_BEREICH[sel.value];
    lsel.value = String(spur().durchgaenge ?? 1);
    const px = (beat) => (beat / b) * 480, py = (w) => 120 - ((w - lo) / (hi - lo)) * 120;
    const p = spur().punkte;
    let html = '';
    const schritt = b > 32 ? 4 : 1;   // lange Spuren: Linien je Takt, kräftig an den Loop-Grenzen
    for (let i = 0; i <= b; i += schritt) html += `<line class="${i % lb === 0 ? 'schwelle' : 'achse'}" x1="${px(i)}" y1="0" x2="${px(i)}" y2="120"/>`;
    if (p.length) {
      const pts = [...p.map(([x, y]) => `${px(x)},${py(y)}`), `${px(b + p[0][0])},${py(p[0][1])}`];
      html += `<polyline class="kurve" points="${p.length > 1 ? pts.join(' ') : `${px(p[0][0])},${py(p[0][1])} ${px(b)},${py(p[0][1])}`}"/>`;
      html += p.map(([x, y], i) => `<circle data-i="${i}" cx="${px(x)}" cy="${py(y)}" r="5" class="autopunkt"/>`).join('');
    }
    svg.innerHTML = html;
  };
  const stelle = (e) => { const r = svg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 480, ((e.clientY - r.top) / r.height) * 120]; };
  const sortiere = (s) => { s.punkte.sort((a, b) => a[0] - b[0]); s.punkte = s.punkte.filter((q, i, a) => i === 0 || q[0] !== a[i - 1][0]); };
  let zieht = null;
  svg.addEventListener('pointerdown', (e) => {
    if (!autoLoop.beats) return;
    const c = e.target.closest('circle');
    if (c) { zieht = Number(c.dataset.i); svg.setPointerCapture(e.pointerId); return; }
    const s = spur();
    if (s.punkte.length >= 64) return;
    s.punkte.push(punktAusStelle(...stelle(e), 480, 120, laenge(), AUTO_BEREICH[sel.value]));
    sortiere(s); status.textContent = 'not saved'; zeichne();
  });
  svg.addEventListener('pointermove', (e) => {
    if (zieht === null) return;
    const s = spur();
    s.punkte[zieht] = punktAusStelle(...stelle(e), 480, 120, laenge(), AUTO_BEREICH[sel.value]);
    status.textContent = 'not saved'; zeichne();
  });
  svg.addEventListener('pointerup', () => { if (zieht !== null) { sortiere(spur()); zieht = null; zeichne(); } });
  svg.addEventListener('dblclick', (e) => {
    const c = e.target.closest('circle');
    if (!c) return;
    spur().punkte.splice(Number(c.dataset.i), 1); status.textContent = 'not saved'; zeichne();
  });
  sel.addEventListener('change', () => { vorlagenFuellen(); zeichne(); });
  vorlagenFuellen();
  vsel.addEventListener('change', () => {
    const v = AUTO_VORLAGEN[sel.value]?.[Number(vsel.value)];
    vsel.value = '';
    if (!v || !autoLoop.beats) return;
    spur().punkte = vorlagePunkte(v, laenge());
    status.textContent = 'not saved'; zeichne();
  });
  lsel.addEventListener('change', () => {
    const s = spur(), alt = laenge();
    s.durchgaenge = Number(lsel.value);
    const neu = laenge();
    s.punkte = s.punkte.map(([x, y]) => [Math.round((x / alt) * neu * 4) / 4, y]).filter(([x], i, a) => x < neu && (i === 0 || x !== a[i - 1][0]));   // Kurve mitstrecken
    status.textContent = 'not saved'; zeichne();
  });
  d.querySelector('.autoleeren').addEventListener('click', () => { spur().punkte = []; status.textContent = 'not saved'; zeichne(); });
  d.querySelector('.autospeichern').addEventListener('click', async () => {
    if (!autoLoop.name) return;
    const automation = autoDaten.filter((s) => s.punkte.length).map((s) => ({ pfad: s.pfad, punkte: s.punkte, ...((s.durchgaenge ?? 1) > 1 ? { durchgaenge: s.durchgaenge } : {}) }));
    try {
      const r = await fetch('/loop/automation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: autoLoop.name, automation }) });
      const j = await r.json();
      status.textContent = r.status === 200 ? 'saved' : `refused: ${j.text ?? j.fehler}`;
    } catch (e) { status.textContent = `unreachable: ${e.message}`; }
  });
  if (autoLoop.name) {
    fetch(`/loop/automation?name=${encodeURIComponent(autoLoop.name)}`).then((r) => r.json()).then((j) => {
      autoDaten = (j.automation ?? []).map((s) => ({ pfad: s.pfad, punkte: s.punkte.map((p) => [...p]), durchgaenge: s.durchgaenge ?? 1 }));
      if (autoDaten.length) sel.value = autoDaten[0].pfad;
      vorlagenFuellen();
      zeichne();
    }).catch(() => zeichne());
  } else zeichne();
}

function zeichneVerlauf() {
  const c = $('#fxdetail canvas');
  if (!c) return;
  const v = kompVerlauf[fxGewaehlt] ?? [];
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--warn') || '#e8a33c';
  g.lineWidth = 2;
  g.beginPath();
  v.forEach((db, i) => { const x = (i / 99) * c.width, y = Math.min(c.height, (db / 24) * c.height); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
}

// Was auf jedem Kanal läuft, aus /lage (dieselbe Quelle wie Cyphers Hand): Deck-Titel, Strudel-Muster und Klang, Loop der Box.
// Nur abgefragt, solange die Effekt-Sektion offen ist (alle 2 s).
async function holeFxInhalt() {
  if ($('#effekte').hidden) return;
  try {
    const lage = await (await fetch('/lage')).json();
    for (const [k] of FX_KANAELE) {
      const el = $(`[data-fxinhalt="${CSS.escape(k)}"]`);
      if (el) { const t = fxInhaltText(k, lage); el.textContent = t; el.title = t; el.classList.toggle('laeuft', t.startsWith('▶')); }
    }
  } catch { /* Seite gleich wieder */ }
}

function bindeEffekte() {
  for (const t of $$('[data-bereich]')) t.addEventListener('click', () => setzeBereich(t.dataset.bereich));
  baueFxStreifen();
  $('#fxstreifen').addEventListener('click', (e) => {
    const s = e.target.closest('.fxstreifen');
    if (s && !e.target.closest('button, input')) waehleFx(s.dataset.kanal);
  });
  waehleFx(fxGewaehlt);
  setInterval(() => {   // 10 Hz: Verlauf der Absenkung aller Kanäle mitschreiben, das Detail zeichnen
    for (const [k] of FX_KANAELE) { const v = (kompVerlauf[k] ??= []); v.push(grJetzt(k)); if (v.length > 100) v.shift(); }
    if (document.body.classList.contains('lib-gross') && !$('#effekte').hidden) zeichneVerlauf();
  }, 100);
  let b = 'library';
  try { b = localStorage.getItem('djk-bereich') || 'library'; } catch { /* ohne Speicher: Library */ }
  setzeBereich(b === 'effekte' ? 'effekte' : 'library');
  setInterval(() => { if (!$('#effekte').hidden) zeigeKomp(); }, 250);   // GR fällt ohne Meldung auf 0
  setInterval(holeFxInhalt, 2000);
}

// SOUND COLOR FX (2026-10-11, wie am XDJ-XZ): Art und PARAMETER global über /regler (sofort, Quelle andreas), angezeigt aus
// /e/regler. Der COLOR-Regler jedes Kanals ist `filter`; seine Beschriftung zeigt die gewählte Art.
const COLOR_ARTEN = ['FILTER', 'SPACE', 'DUB ECHO', 'SWEEP', 'NOISE', 'CRUSH'];
function colorArt() { const w = zustand.regler?.['color/art']; return typeof w === 'number' ? Math.round(w) : 0; }
function zeigeColor() {
  const a = colorArt();
  for (const b of $$('[data-colorart]')) { const an = Number(b.dataset.colorart) === a; b.classList.toggle('an', an); b.setAttribute('aria-checked', String(an)); }
  for (const l of $$('.knopf[data-teil="filter"] + .beschrift label')) l.textContent = COLOR_ARTEN[a] ?? 'FILTER';
  const p = zustand.regler?.['color/param'];
  const s = $('#colorparam');
  if (s && typeof p === 'number' && document.activeElement !== s) s.value = String(p);
  const o = $('[data-colorparam]');
  if (o) o.textContent = typeof p === 'number' ? `${Math.round(p * 100)}%` : '–';
}
async function setzeColor(pfad, nach) {
  try {
    const r = await fetch('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, nach, ab: 'jetzt' }) });
    const j = await r.json();
    window.djkGesendet.push({ [pfad]: nach, code: r.status, antwort: j });
    if (r.status !== 200) melde(`Color FX refused: ${j?.fehler ?? r.status}`, true);
    else if (j?.quittung?.status === 6) melde(`Color FX refused: ${j.quittung.grund}`, true);
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); }
}
function bindeColor() {
  for (const b of $$('[data-colorart]')) {
    b.addEventListener('click', () => {
      const n = Number(b.dataset.colorart);
      setzeColor('color/art', n === colorArt() ? 0 : n);   // wie am Pult: die leuchtende Taste noch einmal = zurück auf FILTER
    });
  }
  const s = $('#colorparam');
  let warte = null;
  s?.addEventListener('input', () => {
    if (warte) return;
    warte = setTimeout(() => { warte = null; setzeColor('color/param', Number(s.value)); }, 40);
  });
  zeigeColor();
}

function bindeTempo() {
  $('#keylock')?.addEventListener('click', schalteKeylock);
  zeigeKeylock();
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

// ---------- Library: Browser über die Mediathek (Plan 2026-10-10-mediathek-browser) ----------
const stz = { typ: 'track', sort: null, ab: false, seite: 0, treffer: [], gesamt: 0, limit: 100, wahl: -1, lauf: 0, seiteOk: 0, ordner: null, feld: null, wert: null, facetteOffen: {}, baumLauf: 0,
  liste: null, listeArt: null, listenOffen: {} };   // liste: Slug der in der Mitte gezeigten Liste (S2b), sonst null
zustand.stoebern = stz;
async function stoebernLaden() {
  if (stz.liste) return ladeListe();
  const nr = ++stz.lauf;                                   // nur die letzte Antwort zählt (schnelles Klicken)
  const r = await fetch(stoebernUrl(stz));
  const j = await r.json();
  if (nr !== stz.lauf) return;
  if (!r.ok) { leereDetail(); stz.seite = stz.seiteOk; $('#libliste').textContent = ''; zustand.libraryInfo = j.fehler === 'katalog_fehlt' ? 'Catalog missing — run “mediathek katalog”'
    : j.fehler === 'suchfeld_nicht_anwendbar' ? 'Library: patterns have only name: and rolle: as search fields' : `Library: ${j.fehler}`; return zeigeReiterInfo(); }
  stz.seiteOk = j.seite;
  Object.assign(stz, { treffer: j.treffer, gesamt: j.gesamt, limit: j.limit, sort: j.sort, ab: j.richtung === 'ab' });
  zeigeKopfzeile();
  $('.st-seiten').hidden = false;
  const tb = $('#libliste');
  tb.textContent = '';
  j.treffer.forEach((t, i) => tb.append(stoebernZeile(t, i)));
  const seiten = Math.max(1, Math.ceil(j.gesamt / j.limit));
  $('#st-seite').textContent = `Page ${j.seite + 1} of ${seiten.toLocaleString('en')}`;
  $('#st-zurueck').disabled = j.seite === 0; $('#st-weiter').disabled = j.seite + 1 >= seiten;
  const art = TYP_ART[stz.typ];
  zustand.libraryInfo = stz.typ === 'strudel' ? `${j.gesamt.toLocaleString('en')} ${art}`
    : `${j.gesamt.toLocaleString('en')} ${art} · catalog ${j.gebaut_am ? new Date(j.gebaut_am).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '?'}`;
  zeigeReiterInfo();
  behalteWahl();
}
function zeigeKopfzeile(spalten = SPALTEN[stz.typ]) {
  const k = $('#st-kopfzeile');
  k.textContent = '';
  for (const s of spalten) {
    const th = document.createElement('th');
    th.textContent = s.titel + (s.sort && s.sort === stz.sort ? (stz.ab ? ' ▾' : ' ▴') : '');
    if (s.sort) { th.dataset.sort = s.sort; th.classList.add('sortierbar'); }
    k.append(th);
  }
  k.append(document.createElement('th'));                  // Aktionen
}
// spalten: in der Listenansicht die der Liste (LISTEN_SPALTEN), sonst die des Zeilentyps
function stoebernZeile(t, i, spalten = SPALTEN[t.typ] ?? SPALTEN[stz.typ]) {
  const tr = document.createElement('tr');
  if (t.sha) tr.dataset.sha = t.sha;
  tr.dataset.i = String(i);
  if (t.typ === 'track') tr.dataset.material = t.material_id;
  if (t.typ === 'strudel' ? !t.ladbar : !t.pfad_da) tr.classList.add('fehlt');
  for (const s of spalten) { const td = document.createElement('td'); td.textContent = zelle(s, t); if (s.klasse) td.className = s.klasse; tr.append(td); }
  const td = document.createElement('td'); td.className = 'aktion';
  aktionsKnoepfe(td, t);
  tr.append(td);
  return tr;
}
// Aktionen einer Zeile UND des Details (S5): je Typ dieselben Knöpfe, damit die Spalte nichts anbietet, was die Zeile nicht kann.
// Die Track-Knöpfe liegen in einem eigenen span: libKnoepfe leert seinen Behälter (PREPARING…), + SET und + LIST dürfen dabei nicht mitgehen.
function aktionsKnoepfe(td, t) {
  for (const a of aktionenFuer(t)) {
    if (a === 'track') { const sp = document.createElement('span'); sp.className = 'track-aktion'; trackKnoepfe(sp, t); td.append(sp); }
    else if (a === 'loopbox') loopBoxKnoepfe(td, t);
    else if (a === 'editor' || a === 'kopieren') strudelKnoepfe(td, t);
    else if (a === 'set') {
      const plus = document.createElement('button');            // wie die alte Trefferliste (probe_sets klickt button.in-set in der Zeile)
      plus.className = 'laden in-set'; plus.textContent = '+ SET'; plus.title = 'Add to the active set (S)';
      plus.addEventListener('click', () => inSet(t));
      td.append(plus);
    } else if (a === 'liste') {
      const liste = document.createElement('button');
      liste.className = 'laden in-liste'; liste.textContent = '+ LIST ▾'; liste.title = 'Add to a list';
      liste.addEventListener('click', (e) => { e.stopPropagation(); oeffneListenMenue(t, liste); });
      td.append(liste);
    }
  }
}
// Loop aus der Mediathek → L1/L2 (S6): der Server dekodiert, dehnt auf 128 BPM, schneidet auf die exakten Frames und legt den Loop in
// die Loop-Bibliothek (POST /loops/aus-katalog), die Seite lädt ihn dann wie jeden Loop. Während ein Import läuft (der Server rechnet
// höchstens einen) sind ALLE → L-Knöpfe aus, auch die der anderen Zeilen. nur_live: kein Knopf, der Grund steht da.
let loopImportLaeuft = false;
function loopBoxKnoepfe(td, t) {
  const s = loopBoxStatus(t);
  const sp = el('span', 'loopbox-aktion');
  if (t.nur_live) { sp.append(el('span', 'loopbox-grund', s.grund)); td.append(sp); return; }
  for (const n of BOXEN) {
    const b = el('button', `laden in-box l${n}`, `→ L${n}`);
    b.dataset.ok = s.aktiv ? '1' : '0';
    b.disabled = !s.aktiv || loopImportLaeuft;
    b.title = s.aktiv ? `${s.titel} L${n}` : s.titel;
    b.addEventListener('click', (e) => { e.stopPropagation(); loopAusKatalog(t, n); });
    sp.append(b);
  }
  if (s.grund) sp.append(el('span', 'loopbox-grund', s.grund));
  td.append(sp);
}
function setzeImportSperre(an) {
  loopImportLaeuft = an;
  for (const b of $$('button.in-box')) b.disabled = an || b.dataset.ok !== '1';
}
async function loopAusKatalog(t, n) {
  if (loopImportLaeuft) return;
  setzeImportSperre(true);
  melde(`Importing “${t.name}” — stretching to 128 BPM …`);
  try {
    const r = await postJson('/loops/aus-katalog', { sha: t.sha });
    if (!r.ok) return melde(`Loop import: ${IMPORT_FEHLER_TEXT[r.j.fehler] ?? r.j.fehler}`, true);
    const geladen = await loopAktion({ aktion: 'laden', box: n, name: r.j.name });
    ladeLoops();                                              // der neue Loop steht auch im Reiter LOOPS
    if (geladen) melde(r.j.schon_da ? `“${r.j.name}” was already imported — loaded into L${n}` : `“${r.j.name}” imported (${r.j.beats} beats at 128 BPM) and loaded into L${n}`);
  } catch (e) { melde(`Loop import: ${e.message}`, true); }
  finally { setzeImportSperre(false); }
}
// STRUDEL-Zeile: ladbare Muster gehen in den Editor einer Instanz, Archiv-Muster nur in die Zwischenablage
function strudelKnoepfe(td, t) {
  if (t.ladbar) {
    for (const [strom, text] of [[1, 'DRUMS'], [2, 'BASS'], [3, 'MELODY']]) {
      const b = document.createElement('button');
      b.className = 'laden in-editor'; b.dataset.strom = String(strom); b.textContent = `→ ${text}`;
      b.title = `Put the pattern into the ${text} editor (nothing is sent)`;
      b.addEventListener('click', () => inEditor(t, strom));
      td.append(b);
    }
    return;
  }
  const b = document.createElement('button');
  b.className = 'laden kopieren'; b.textContent = 'COPY'; b.title = 'Archive pattern: copy the text, adapt it, then SAVE it as your own';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(t.text); melde(`“${t.name}” copied`); } catch (e) { melde(`Copy failed: ${e.message}`, true); }
  });
  td.append(b);
}
// Laden heißt: in den Editor, nicht senden. Wie Tippen: das Feld wird schmutzig, AUTO geht aus, Andreas drückt PLAY im richtigen Moment.
function inEditor(t, strom) {
  const i = instanzen.get(strom);
  if (!i) return melde('Strudel editor not ready', true);
  const f = $('.muster-feld', i.w);
  // Ungesendeter Text im Editor wird nicht still überschrieben (REVERT holt nur das Laufende zurück; Review S2b Befund 3)
  if (i.schmutzig && f.value !== t.text && !confirm(`The ${['DRUMS', 'BASS', 'MELODY'][strom - 1]} editor has text that was not played. Replace it with “${t.name}”?`)) return;
  waehleRolle(strom);
  f.value = t.text; f.dispatchEvent(new Event('input'));
  melde(`“${t.name}” is in the ${['DRUMS', 'BASS', 'MELODY'][strom - 1]} editor — press PLAY when it fits (one change per 8 bars)`);
}
// Track-Aktionen: im Bestand LOAD A/B, sonst PREPARE / MISSING / PREPARING… (wie die alte Trefferliste)
function trackKnoepfe(td, t) {
  td.textContent = '';
  const e = t.laden_mid ? zustand.bestand.find((x) => x.material_id === t.laden_mid) : null;
  if (e) {
    for (const n of DECKS) {
      const b = document.createElement('button');
      b.className = `laden ${BUCHSTABE[n].toLowerCase()}`; b.textContent = `LOAD ${BUCHSTABE[n]}`;
      b.addEventListener('click', () => laden(n, e));
      td.append(b);
    }
    return;
  }
  t.vorbereitung = t.status === 'laeuft' ? 'laeuft' : null;   // libKnoepfe liest das alte Feld (Review m3): PREPARING… statt klickbarem PREPARE
  libKnoepfe(td, t);
}
// + SET postet die echte Art (Spec §7: track; loop/oneshot mit quelle mediathek, Task 1.6). Ersetzt die alte inSet (art fest 'track').
async function inSet(t) {
  const slug = aktivesSet();
  if (!slug) return melde('No active set — create one in SETS', true);
  const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/posten`, postenKoerper(t));
  if (!r.ok) return melde(`Add to set: ${r.j.fehler}`, true);
  const n = t.titel ?? t.name;
  melde(r.j.schon_drin ? `“${n}” is already in the set` : `“${n}” added to the set`);
}
// ---------- Detail-Spalte (S5): Fakten, Welle, Angaben mit Quelle, Aktionen ----------
let detailLauf = 0, welleTimer = 0, welleAbbruch = null;   // welleAbbruch: AbortController der laufenden Wellen-Anfrage (S5-Review B2)
const brichWelleAb = () => { clearTimeout(welleTimer); welleAbbruch?.abort(); welleAbbruch = null; };
const wahlSchluessel = (t) => `${t.typ}:${t.sha ?? t.id ?? t.material_id}`;
function markiereWahl() {
  for (const tr of $$('#libliste tr')) tr.classList.toggle('gewaehlt', tr.dataset.i === String(stz.wahl));
}
function leereDetail() {
  ++detailLauf; brichWelleAb();
  Object.assign(stz, { wahl: -1, wahlKey: null });
  $('#st-detail').textContent = '';
  markiereWahl();
}
// Nach jedem Neuladen der Mitte: die gewählte Zeile bleibt gewählt (z. B. nach PREPARE), wenn sie noch da ist, sonst wird das Detail leer
function behalteWahl() {
  const i = stz.wahlKey ? stz.treffer.findIndex((t) => wahlSchluessel(t) === stz.wahlKey) : -1;
  if (i < 0) return leereDetail();
  zeigeDetail(i, false);
}
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
// ---------- Vorhören (S7): Leertaste spielt/stoppt das gewählte Element über den Cue des Kerns (Kopfhörer), nie auf dem Master ----------
let vorhoerUhr = null;
const VORHOER_TEXT = { kein_kopfhoerer: 'Headphones not connected — plug in the FiiO (cue output has no link). Nothing plays on the speakers.',
  nur_live: 'Ableton Live only (encrypted) — cannot be previewed here', datei_fehlt: 'File not found (drive unplugged?)',
  kern_ohne_vorhoerkanal: 'Preview needs the updated audio engine (restart pending) — nothing was played' };
const hoerId = (t) => t.sha ?? t.material_id;                  // Listen-Zeilen tragen bei Tracks nur material_id (Review S7 m3)
function zeigeHoert() {
  const t = stz.treffer[stz.wahl];
  for (const b of $$('.st-vorhoeren')) { const an = !!t && stz.hoert === hoerId(t); b.textContent = an ? '■' : '▶'; b.classList.toggle('an', an); }
}
let vorhoerNr = 0;                                             // Laufnummer je Anfrage (Review S7 B1): eine überholte Antwort fasst weder Poll noch Zustand der neuesten an
async function vorhoeren(t) {
  if (!t || t.typ === 'strudel') return;
  const nr = ++vorhoerNr;
  stz.wartet = hoerId(t);                                      // F1: bis zur Antwort gilt die Anfrage in der Luft als „aktiv“, ↓ lenkt sie um
  let r;
  try { r = await postJson('/vorhoeren', t.sha ? { sha: t.sha } : { mid: t.material_id }); }
  catch (e) { if (nr === vorhoerNr) { stz.wartet = null; melde(`Preview: ${e.message}`, true); } return; }
  if (nr !== vorhoerNr) return;
  stz.wartet = null;
  if (!r.ok) {
    clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert();
    return melde(VORHOER_TEXT[r.j.fehler] ?? (r.j.fehler?.startsWith('format:') ? `Cannot play this file (${r.j.fehler.slice(8)})` : `Preview: ${r.j.fehler}`), true);
  }
  stz.hoert = hoerId(t); zeigeHoert();
  if (r.j.gekuerzt) melde('Long file: the preview covers the first 30 minutes only', false);
  clearInterval(vorhoerUhr);
  vorhoerUhr = setInterval(async () => {
    let s;
    try { s = await (await fetch('/vorhoeren')).json(); } catch { return; }
    if (!s.kopfhoerer) { clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert(); return melde(VORHOER_TEXT.kein_kopfhoerer, true); }
    if (!s.spielt) { clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert(); return; }
    const w = stz.detailWelle;                                 // von ladeDetailWelle gesetzt, beim Wechsel der Wahl null (Review S7 m2)
    const wahl = stz.treffer[stz.wahl];
    if (wahl && stz.hoert === hoerId(wahl) && w?.w && s.dauer_s && s.s !== null) w.zeichne(vorhoerCursor(s, laengeFrames(w.w), SR), 0);
  }, 200);
}
async function vorhoerenStopp() { vorhoerNr++; stz.wartet = null; clearInterval(vorhoerUhr); stz.hoert = null; zeigeHoert(); await postJson('/vorhoeren', { aktion: 'stopp' }); }
function vorhoerenSpringe(richtung) { return postJson('/vorhoeren', { aktion: 'springe', richtung }); }
function vorhoerKnoepfe(t) {
  const sp = el('span', 'st-vorhoer-knoepfe');
  const mk = (text, titel, f, klasse = '') => { const b = el('button', `laden ${klasse}`.trim(), text); b.title = titel; b.addEventListener('click', (e) => { e.stopPropagation(); f(); }); sp.append(b); return b; };
  mk('◀◀', 'Jump back (←)', () => { if (stz.hoert) vorhoerenSpringe(-1); });
  mk('▶', 'Preview on headphones (Space)', () => (stz.hoert === hoerId(t) ? vorhoerenStopp() : vorhoeren(t)), 'st-vorhoeren');
  mk('▶▶', 'Jump forward (→)', () => { if (stz.hoert) vorhoerenSpringe(1); });
  return sp;
}
async function zeigeDetail(i, scrollen = true) {
  const t = stz.treffer[i]; if (!t) return;
  if (scrollen && i === stz.wahl && stz.wahlKey === wahlSchluessel(t) && $('#st-detail').firstChild) return;   // ↓ auf der letzten, ↑ auf der ersten Zeile: nichts neu starten (Re-Review L4)
  const nr = ++detailLauf; brichWelleAb(); stz.detailWelle = null;   // S7: die Position wird nur in die Welle der gehörten Zeile gezeichnet                    // die alte Welle wird nicht mehr gebraucht: Anfrage abbrechen, der Server beendet ffmpeg
  Object.assign(stz, { wahl: i, wahlKey: wahlSchluessel(t) });
  markiereWahl();
  if (scrollen) $$('#libliste tr')[i]?.scrollIntoView({ block: 'nearest' });
  const d = $('#st-detail'); d.textContent = '';
  d.append(el('h3', '', t.typ === 'track' ? `${t.kuenstler ?? '–'} – ${t.titel ?? '–'}${t.mix ? ` (${t.mix})` : ''}` : (t.name ?? '–')));
  const knoepfe = el('div', 'st-aktionen'); aktionsKnoepfe(knoepfe, t); if (t.typ !== 'strudel') knoepfe.append(vorhoerKnoepfe(t)); d.append(knoepfe);
  zeigeHoert();
  if (vorhoerFolgt(t, hoerId(t), { wartet: stz.wartet, hoert: stz.hoert })) vorhoeren(t);   // Wahl wechselt während des Hörens: die neue Zeile spielt sofort, wie im Finder
  const fakten = el('dl', 'st-fakten');
  for (const [k, v] of detailFakten(t)) { fakten.append(el('dt', '', k)); const dd = el('dd', k === 'Folder' ? 'st-ordner' : '', v); if (k === 'Folder') dd.title = v; fakten.append(dd); }
  d.append(fakten);
  if (t.typ === 'strudel') {                                  // Muster: Code statt Welle, nichts vom Server nötig
    d.append(el('div', 'st-hinweis', t.ladbar ? 'Loading puts the code into the editor; nothing is sent until you press PLAY.' : 'Archive pattern: view and copy only. Adapt it, then SAVE it as your own.'));
    d.append(el('pre', 'st-code', t.text || '(empty)'));
    return;
  }
  const feld = el('div', 'st-wellefeld'); d.append(feld);
  const status = welleStatus(t);
  if (status.grund) feld.textContent = status.grund;
  let j;
  try {
    const r = await fetch(`/stoebern/detail?${t.sha ? `sha=${t.sha}` : `mid=${t.material_id}`}`);
    if (nr !== detailLauf) return;
    j = r.ok ? await r.json() : null;
    if (!j) { d.append(el('div', 'st-hinweis', r.status === 404 ? 'Not in the catalog (rebuild it with “mediathek katalog”).' : `Details unavailable (${r.status}).`)); if (!status.anfordern) return; }
  } catch (e) { if (nr === detailLauf) d.append(el('div', 'st-hinweis', `Details unavailable: ${e.message}`)); return; }
  if (nr !== detailLauf) return;
  if (j) {
    const e = j.eintrag;
    if (j.pfad) { fakten.append(el('dt', '', 'File')); const dd = el('dd', 'st-ordner', j.pfad.split('/').pop()); dd.title = j.pfad; fakten.append(dd); }
    const tab = el('table', 'st-angaben');
    const kopf = tab.insertRow(); for (const x of ['Field', 'Value', 'Source']) kopf.append(el('th', '', x));
    for (const a of j.angaben) {
      const r = tab.insertRow(); if (!a.gilt) r.className = 'ueberstimmt';
      r.title = a.gilt ? `Wins · seen ${a.erhoben_am}` : `Overridden by a higher-ranked source · seen ${a.erhoben_am}`;
      for (const x of [feldText(a.feld), a.wert, a.quelle]) r.insertCell().textContent = x;
    }
    if (j.angaben.length) d.append(tab); else d.append(el('div', 'st-hinweis', 'No Mediathek tags for this file.'));
    // Welle: erst nach kurzer Ruhe (↑/↓ im Schnelldurchlauf rechnet nicht jede Datei an), und nur, wenn sie gelingen kann
    const ws = welleStatus(e);
    feld.textContent = ws.grund ?? '';
    if (ws.anfordern) {
      feld.textContent = 'Waveform …';
      welleAbbruch = new AbortController();
      const signal = welleAbbruch.signal;
      welleTimer = setTimeout(() => ladeDetailWelle(nr, j.objekt_sha ?? e.sha, feld, signal), 150);   // objekt_sha: die Datei des angeklickten Objekts (B6)
    }
  }
}
async function ladeDetailWelle(nr, sha, feld, signal) {
  try {
    const r = await fetch(`/welle?sha=${sha}`, { signal });
    if (nr !== detailLauf) return;
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      feld.textContent = `Waveform unavailable (${r.status === 422 ? 'cannot decode this file' : r.status === 504 ? 'waveform timed out' : r.status === 404 ? 'file not found' : `error ${r.status}`})`;
      feld.title = j.fehler ?? '';                         // der Wortlaut (ffmpeg-Meldung) nur als Tooltip
      return;
    }
    const w = leseWelle(await r.arrayBuffer());
    if (nr !== detailLauf) return;
    feld.textContent = '';
    const cv = el('canvas', 'st-welle'); feld.append(cv);
    const u = new Uebersicht(cv); u.setzeWelle(w); u.zeichne(0, 0); stz.detailWelle = u;
  } catch (e) { if (nr === detailLauf && e.name !== 'AbortError') feld.textContent = `Waveform unavailable (${e.message})`; }
}
// Ordner-Baum und Facetten (Plan 2.3). Zähler gelten je Typ, nicht je Filter (Plan Abweichung 4). Ein Klick setzt genau einen Filter.
const FACETTEN_TITEL = { genre: 'Genre', pack: 'Pack', instrument: 'Instrument', quelle: 'Source', rolle: 'Role' };
const FACETTEN_WERT = { quelle: { eigen: 'mine', track: 'track', dirigent: 'archive' }, rolle: { drums: 'DRUMS', bass: 'BASS', melodie: 'MELODY' } };
const TYP_ART = { track: 'tracks', loop: 'loops', oneshot: 'samples', strudel: 'patterns' };
function waehleFilter(f) {
  Object.assign(stz, { ordner: null, feld: null, wert: null, seite: 0, liste: null, listeArt: null }, f);
  markiereTyp(); stoebernLaden(); ladeBaum();
}
// Der Typ-Knopf des gezeigten Typs ist markiert; in der Listenansicht keiner
function markiereTyp() {
  for (const x of $$('[data-typ]')) x.classList.toggle('an', !stz.liste && x.dataset.typ === stz.typ);
  // Filterleiste je Typ (S3-Concern): nur die Felder des Typs, der Rest wird zurückgesetzt und verschwindet, nie unsichtbar wirksam.
  // In der Listenansicht gelten keine Filter: Leiste weg, Zustand bleibt für die Rückkehr.
  $('.lib-filter').hidden = !!stz.liste;
  if (stz.liste) return;
  const ok = filterFuer(stz.typ);
  Object.assign(stz, filterBereinigt(stz.typ, stz));
  $('#lib-key').hidden = !ok.includes('camelot'); $('#lib-nachbarn').closest('label').hidden = !ok.includes('camelot');
  $('#lib-bpm').hidden = !ok.includes('bpm'); $('#lib-energie').hidden = !ok.includes('energie');
  $('#lib-suche').value = stz.text ?? '';
  $('#lib-key').value = stz.camelot ?? ''; $('#lib-nachbarn').checked = !!stz.nachbarn; $('#lib-bpm').value = stz.bpm ?? ''; $('#lib-energie').value = stz.energie ?? '';
}
// Knoten: Name (kürzt bei Platzmangel, der volle Name steht im title), Zähler (kürzt nie). opt.vorn: Ellipse vorn, damit das
// unterscheidende Ende eines Ordnerpfads sichtbar bleibt (<bdi> hält die Zeichenfolge dabei in Leserichtung).
function baumKnoten(text, n, an, klick, opt = {}) {
  const d = document.createElement('div'); d.className = 'st-knoten' + (an ? ' an' : ''); d.title = text;
  const nm = document.createElement('span'); nm.className = 'st-name';
  if (opt.vorn) { const b = document.createElement('bdi'); b.textContent = text; nm.append(b); nm.classList.add('vorn'); } else nm.textContent = text;
  d.append(nm, ' ');
  const z = document.createElement('span'); z.className = 'zahl'; z.textContent = n.toLocaleString('en'); d.append(z);
  d.addEventListener('click', klick); return d;
}
async function ladeBaum() {
  const nr = ++stz.baumLauf;
  const r = await fetch(`/stoebern/baum?typ=${stz.typ}`);
  const j = await r.json();
  if (nr !== stz.baumLauf) return;
  const nav = $('#st-baum'); nav.textContent = '';
  // Der Lists-Ast steht gleich unter „All …“ (nicht am Ende): hinter 40 Genres und den Ordnern wäre er nie zu sehen
  const listenBox = document.createElement('div');
  if (!r.ok) { nav.append(listenBox); return zeichneListen(listenBox, nr); }   // ohne Katalog bleiben die Listen erreichbar
  const alle = baumKnoten(`All ${TYP_ART[stz.typ]}`, 0, !stz.ordner && !stz.feld, () => waehleFilter({}));
  alle.querySelector('.zahl').remove();
  nav.append(alle, listenBox);
  // Ordner stehen vor den Facetten: hinter bis zu 64 Facettenknoten lagen sie 1228 px tief und der gewählte Ordner war nicht zu sehen (S2-Review B3)
  if (j.ordner.length) { const h = document.createElement('h4'); h.textContent = 'Folders'; nav.append(h); }
  // Ein Ordner klappt auf, sobald er oder ein Nachfahre gewählt ist (mit „/" geprüft: /m/A ist kein Vorfahr von /m/AB).
  const zeichne = (liste, tiefe) => {
    for (const k of liste) {
      const d = baumKnoten(k.name, k.n, stz.ordner === k.pfad, () => waehleFilter({ ordner: k.pfad }), { vorn: true });
      d.style.paddingLeft = `${tiefe * 10}px`; d.title = k.pfad; nav.append(d);
      if (k.kinder.length && stz.ordner && (stz.ordner === k.pfad || stz.ordner.startsWith(`${k.pfad}/`))) zeichne(k.kinder, tiefe + 1);
    }
  };
  zeichne(baueBaum(j.ordner), 0);
  for (const [feld, werte] of Object.entries(j.facetten)) {
    const h = document.createElement('h4'); h.textContent = FACETTEN_TITEL[feld] ?? feld; nav.append(h);
    // 40 zeigen, Rest hinter „+N more" (Tracks haben 66 Genres; Review m6). Ein gewählter Wert bleibt immer sichtbar.
    const offen = stz.facetteOffen[feld];
    werte.forEach(({ wert, n }, i) => {
      const an = stz.feld === feld && stz.wert === wert;
      if (i < 40 || offen || an) nav.append(baumKnoten(FACETTEN_WERT[feld]?.[wert] ?? (wert || '(none)'), n, an, () => waehleFilter({ feld, wert })));
    });
    if (!offen && werte.length > 40) {
      const mehr = document.createElement('div'); mehr.className = 'st-knoten st-mehr'; mehr.textContent = `+${werte.length - 40} more`;
      mehr.addEventListener('click', () => { stz.facetteOffen = { ...stz.facetteOffen, [feld]: true }; ladeBaum(); });
      nav.append(mehr);
    }
  }
  await zeichneListen(listenBox, nr);
  if (nr !== stz.baumLauf) return;
  // Der gewählte Knoten bleibt im Bild (erst nach den Listen, die schieben den Rest nach unten; nur der Baum scrollt, nie die Seite)
  const gewaehlt = nav.querySelector('.st-knoten.an');
  if (gewaehlt) { const k = gewaehlt.getBoundingClientRect(), v = nav.getBoundingClientRect(); if (k.top < v.top) nav.scrollTop -= v.top - k.top; else if (k.bottom > v.bottom) nav.scrollTop += k.bottom - v.bottom; }
}

// ---------- Listen (S2b): PLAYLIST · LOOP LIST · STRUDEL LIST ----------
let traktorListen = null;
const neuesFeld = (platz, ok, abbruch) => {
  const i = document.createElement('input'); i.className = 'st-eingabe'; i.placeholder = platz; i.maxLength = 80; i.setAttribute('aria-label', platz);
  i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && i.value.trim()) ok(i.value.trim()); if (e.key === 'Escape') abbruch(); });
  i.addEventListener('click', (e) => e.stopPropagation());
  return i;
};
async function zeichneListen(nav, nr) {
  let alle;
  try { alle = await (await fetch('/sammlungen')).json(); } catch { return; }
  if (nr !== stz.baumLauf || !Array.isArray(alle)) return;
  const h = document.createElement('h4'); h.textContent = 'Lists'; nav.append(h);
  for (const art of Object.keys(LISTEN_TEXT)) {
    const meine = alle.filter((e) => e.art === art);
    const offen = !!stz.listenOffen[art];
    const kopf = baumKnoten(LISTEN_TEXT[art], meine.length, false, () => { stz.listenOffen = { ...stz.listenOffen, [art]: !offen }; ladeBaum(); });
    kopf.dataset.listenart = art; kopf.classList.add('st-listenart'); kopf.setAttribute('aria-expanded', String(offen));
    nav.append(kopf);
    if (!offen) continue;
    for (const e of meine) {
      const k = baumKnoten(e.name, e.posten, stz.liste === e.slug, () => waehleListe(e.slug, art));
      k.dataset.liste = e.slug; k.classList.add('st-listenknoten');
      const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = e.name; k.firstChild.replaceWith(nm);   // lange Namen kürzen, ✎ und ✕ bleiben erreichbar
      k.title = e.name;
      for (const [zeichen, titel, tun] of [['✎', 'Rename', () => benenneListe(e, k)], ['✕', 'Move to the trash', () => loescheListe(e)]]) {
        const b = document.createElement('button'); b.className = 'st-mini'; b.textContent = zeichen; b.title = titel; b.setAttribute('aria-label', `${titel} ${e.name}`);
        b.addEventListener('click', (ev) => { ev.stopPropagation(); tun(); });
        k.append(b);
      }
      nav.append(k);
    }
    const neu = document.createElement('div'); neu.className = 'st-knoten st-mehr'; neu.textContent = '+ new';
    neu.addEventListener('click', () => {
      const f = neuesFeld(`New ${LISTEN_TEXT[art].toLowerCase().replace(/s$/, '')}…`, async (name) => {
        const rr = await postJson('/sammlungen', { name, art });
        if (!rr.ok) return melde(`New list: ${rr.j.fehler}`, true);
        melde(`“${name}” created`); ladeBaum();
      }, () => ladeBaum());
      neu.replaceWith(f); f.focus();
    });
    nav.append(neu);
    if (art === 'playlist') {
      const sel = document.createElement('select'); sel.className = 'st-import'; sel.setAttribute('aria-label', 'Import a Traktor playlist');
      sel.append(new Option('Import Traktor…', ''));
      try { traktorListen ??= await (await fetch('/mediathek/listen')).json(); } catch { traktorListen = []; }
      if (nr !== stz.baumLauf) return;
      for (const l of Array.isArray(traktorListen) ? traktorListen : []) sel.append(new Option(`${l.name} (${l.n})`, String(l.id)));
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        const rr = await postJson('/sammlungen/import', { liste_id: Number(sel.value), art: 'playlist' });
        if (!rr.ok) return melde(`Import: ${rr.j.fehler}`, true);
        melde(`Imported ${rr.j.posten} tracks as a playlist`); ladeBaum();
      });
      nav.append(sel);
    }
  }
}
function waehleListe(slug, art) {
  Object.assign(stz, { liste: slug, listeArt: art, ordner: null, feld: null, wert: null, seite: 0 });
  markiereTyp(); stoebernLaden(); ladeBaum();
}
function benenneListe(e, knoten) {
  const f = neuesFeld('Name', async (name) => {
    const rr = await postJson(`/sammlungen/${encodeURIComponent(e.slug)}/umbenennen`, { name });
    if (!rr.ok) return melde(`Rename: ${rr.j.fehler}`, true);
    ladeBaum(); if (stz.liste === e.slug) stoebernLaden();
  }, () => ladeBaum());
  f.value = e.name; knoten.textContent = ''; knoten.append(f); f.focus(); f.select();
}
async function loescheListe(e) {
  if (!confirm(`Move list “${e.name}” to the trash?`)) return;
  const rr = await postJson(`/sammlungen/${encodeURIComponent(e.slug)}/loeschen`, {});
  if (!rr.ok) return melde(`Delete list: ${rr.j.fehler}`, true);
  if (stz.liste === e.slug) { Object.assign(stz, { liste: null, listeArt: null }); markiereTyp(); stoebernLaden(); }
  ladeBaum(); melde(`“${e.name}” moved to the trash`);
}
// Zeile → Körper für POST …/posten (Muster tragen ref statt material_id)
const postenKoerper = (t) => (t.typ === 'strudel' ? { art: 'muster', ref: t.id } : { art: t.typ, material_id: t.material_id });
// „+ LIST ▾“: Menü am Knopf mit den Listen der passenden Art und „New list…“. Enter legt die Liste an UND die Zeile hinein.
function schliesseListenMenue() { const m = $('#listen-menue'); m.hidden = true; m.textContent = ''; }
async function legeInListe(slug, name, t) {
  const rr = await postJson(`/sammlungen/${encodeURIComponent(slug)}/posten`, postenKoerper(t));
  if (!rr.ok) return melde(`Add to list: ${rr.j.fehler}`, true);
  melde(rr.j.schon_drin ? `“${t.titel ?? t.name}” is already in “${name}”` : `“${t.titel ?? t.name}” added to “${name}”`);
  if (stz.liste === slug) stoebernLaden();
  ladeBaum();
}
async function oeffneListenMenue(t, knopf) {
  schliesseListenMenue();
  const art = listenArtFuer(t.typ);
  const m = $('#listen-menue');
  const r = knopf.getBoundingClientRect();
  m.style.top = `${Math.min(r.bottom + 2, innerHeight - 220)}px`; m.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 240))}px`;
  m.hidden = false;
  const kopf = document.createElement('div'); kopf.className = 'listen-kopf'; kopf.textContent = `Add to ${LISTEN_TEXT[art].toLowerCase().replace(/s$/, '')}`;
  const platz = document.createElement('div'); platz.className = 'listen-eintraege';
  const neu = neuesFeld('New list…', async (name) => {
    const rr = await postJson('/sammlungen', { name, art });
    if (!rr.ok) return melde(`New list: ${rr.j.fehler}`, true);
    schliesseListenMenue();
    await legeInListe(rr.j.slug, name, t);
  }, schliesseListenMenue);
  neu.id = 'listen-neu';
  m.append(kopf, platz, neu);
  try {
    const liste = await (await fetch(`/sammlungen?art=${art}`)).json();
    for (const e of liste) {
      const d = document.createElement('div'); d.className = 'listen-eintrag'; d.dataset.liste = e.slug; d.setAttribute('role', 'menuitem');
      d.textContent = `${e.name} `; const z = document.createElement('span'); z.className = 'zahl'; z.textContent = String(e.posten); d.append(z);
      d.addEventListener('click', () => { schliesseListenMenue(); legeInListe(e.slug, e.name, t); });
      platz.append(d);
    }
    if (!liste.length) platz.textContent = 'No list yet';
  } catch { platz.textContent = 'Lists unavailable'; }
}
// Die gewählte Liste in der Mitte: Zeilen = die Browser-Zeilen (eintrag), dazu ↑ ↓ ✕ und Ziehen. Reihenfolge = die des Arrays.
async function ladeListe() {
  const nr = ++stz.lauf;
  const r = await fetch(`/sammlungen/${encodeURIComponent(stz.liste)}`);
  const j = await r.json();
  if (nr !== stz.lauf) return;
  if (!r.ok) { melde(`List: ${j.fehler}`, true); Object.assign(stz, { liste: null, listeArt: null }); markiereTyp(); return stoebernLaden(); }
  const art = j.art ?? stz.listeArt ?? 'playlist';
  const spalten = LISTEN_SPALTEN[art] ?? LISTEN_SPALTEN.playlist;
  stz.listeArt = art;
  zeigeKopfzeile(spalten);
  $('.st-seiten').hidden = true;
  const tb = $('#libliste'); tb.textContent = '';
  const ids = j.posten.map((p) => p.id);
  const sicht = [];                                          // die gezeigten Zeilen (Posten ohne Eintrag fehlen): Grundlage für Detail und ↑/↓
  j.posten.forEach((p, idx) => {
    if (!p.eintrag) return;
    const tr = stoebernZeile(p.eintrag, sicht.length, spalten);
    sicht.push(p.eintrag);
    tr.dataset.posten = p.id;
    const td = tr.querySelector('td.aktion');
    for (const [klasse, zeichen, titel, tun, aus] of [
      ['hoch', '↑', 'Move up', () => verschiebePosten(p.id, idx - 1), idx === 0],
      ['runter', '↓', 'Move down', () => verschiebePosten(p.id, idx + 1), idx === ids.length - 1],
      ['raus', '✕', 'Remove from the list', () => entfernePosten(p.id), false]]) {
      const b = document.createElement('button'); b.className = `laden ${klasse}`; b.textContent = zeichen; b.title = titel; b.disabled = aus;
      b.addEventListener('click', tun); td.append(b);
    }
    tr.draggable = true;
    tr.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; tr.classList.add('zieht'); });
    tr.addEventListener('dragend', () => tr.classList.remove('zieht'));
    tr.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      const gezogen = e.dataTransfer.getData('text/plain');
      if (!gezogen || gezogen === p.id) return;
      const rect = tr.getBoundingClientRect();
      const nach = ziehZiel(ids, gezogen, p.id, e.clientY > rect.top + rect.height / 2);   // untere Hälfte: hinter diese Zeile; null = bleibt
      if (nach !== null) verschiebePosten(gezogen, nach);
    });
    tb.append(tr);
  });
  $('#st-seite').textContent = '';
  stz.treffer = sicht;
  zustand.libraryInfo = `${j.name} · ${j.posten.length} ${j.posten.length === 1 ? 'item' : 'items'} · ${LISTEN_TEXT[art].replace(/s$/, '').toLowerCase()}`;
  zeigeReiterInfo();
  behalteWahl();
}
async function verschiebePosten(id, nach) {
  const rr = await postJson(`/sammlungen/${encodeURIComponent(stz.liste)}/posten/verschieben`, { id, nach });
  if (!rr.ok) return melde(`Reorder: ${rr.j.fehler}`, true);
  stoebernLaden();
}
async function entfernePosten(id) {
  const rr = await postJson(`/sammlungen/${encodeURIComponent(stz.liste)}/posten/entfernen`, { id });
  if (!rr.ok) return melde(`Remove: ${rr.j.fehler}`, true);
  stoebernLaden(); ladeBaum();
}
function bindeLibrary() {
  for (const b of $$('[data-typ]')) b.addEventListener('click', () => {
    for (const x of $$('[data-typ]')) x.classList.toggle('an', x === b);
    Object.assign(stz, { typ: b.dataset.typ, sort: null, ab: false, seite: 0, ordner: null, feld: null, wert: null, facetteOffen: {}, liste: null, listeArt: null });
    markiereTyp(); stoebernLaden(); ladeBaum();
  });
  // Filterleiste (S3): Enter im Textfeld, sofort bei Haken und Auswahl; Fehler (400) zeigt stoebernLaden als „Library: …"
  const filter = () => { Object.assign(stz, { text: $('#lib-suche').value, camelot: $('#lib-key').value, nachbarn: $('#lib-nachbarn').checked, bpm: $('#lib-bpm').value, energie: $('#lib-energie').value, seite: 0 }); stoebernLaden(); };
  for (const id of ['#lib-suche', '#lib-key', '#lib-bpm']) $(id).addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') filter();
    // ↑/↓ im Feld gehen an die Liste (S5-Review B5): Fokus raus, Zeile wählen. Sonst reagierten ↑/↓/S nach einer Suche nicht.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.metaKey && stz.treffer.length) {
      e.preventDefault(); e.target.blur();
      zeigeDetail(e.key === 'ArrowDown' ? Math.min(stz.treffer.length - 1, stz.wahl + 1) : Math.max(0, stz.wahl - 1));
    }
  });
  for (const id of ['#lib-nachbarn', '#lib-energie']) $(id).addEventListener('change', filter);
  // × und Esc leeren das Suchfeld (Chrome: input mit leerem Wert) und suchen neu. Nicht „search“: Chrome feuert es auch auf Enter, das
  // keydown schon bedient, jedes Enter schickte zwei Anfragen (S4-Review 4); Firefox kennt „search“ gar nicht.
  $('#lib-suche').addEventListener('input', () => { if ($('#lib-suche').value === '' && (stz.text ?? '') !== '') filter(); });
  $('#libliste').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr && !e.target.closest('button')) zeigeDetail(Number(tr.dataset.i));
  });
  $('#st-kopfzeile').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    if (stz.sort === th.dataset.sort) stz.ab = !stz.ab; else Object.assign(stz, { sort: th.dataset.sort, ab: false });
    stz.seite = 0; stoebernLaden();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#listen-menue, .in-liste')) schliesseListenMenue(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#listen-menue').hidden) { schliesseListenMenue(); e.stopPropagation(); } }, true);
  $('#st-zurueck').addEventListener('click', () => { if (stz.seite > 0) { stz.seite--; stoebernLaden(); } });
  // Nicht über die letzte Seite hinaus, auch bei Doppelklick vor der Antwort (stz.seite zählt schon, stz.gesamt gilt noch; Review S1 MINOR 8)
  $('#st-weiter').addEventListener('click', () => {
    if (stz.seite + 1 >= Math.max(1, Math.ceil(stz.gesamt / stz.limit))) return;
    stz.seite++; stoebernLaden();
  });
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
  let zeile = null, fehlerzeile = false;
  if (!t.pfad_da) { b.textContent = 'MISSING'; b.disabled = true; b.title = 'File not found (drive unplugged?)'; }
  else if (t.vorbereitung === 'laeuft') {
    b.textContent = 'PREPARING…'; b.disabled = true;   // der Knopf bleibt kurz (Spalte!), Stufe, Prozent und Zeit stehen darunter
    beobachteVorbereitung(t);   // Seite neu geladen oder Liste neu gezeichnet, Lauf besteht noch: weiter beobachten
    zeile = vorbereitAnzeigen.get(t.material_id) ?? null;
  }
  else {
    // FAILED-Grund: aus der Beobachtung dieser Sitzung, sonst aus den /stoebern-Daten (überlebt F5; der Server nennt Grund und Stufe)
    const f = fehlerAnzeige(t, vorbereitFehler.get(t.material_id));
    if (f) { zeile = f; fehlerzeile = true; }
    b.textContent = f ? 'RETRY' : 'PREPARE'; b.addEventListener('click', () => vorbereiten(t, td));
  }
  td.append(b);
  if (zeile) {
    const z = document.createElement('div');
    z.className = fehlerzeile ? 'vorbereit-zeile vorbereit-fehler' : 'vorbereit-zeile';
    z.textContent = zeile; z.title = zeile;
    td.append(z);
  }
  vorbereitZelle.set(t.material_id, { t, td });
}
async function vorbereiten(t, td) {
  const r = await fetch('/mediathek/vorbereiten', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ material_id: t.material_id }) });
  const j = await r.json();
  if (r.status === 200) { await ladeBestand(); return stoebernLaden(); }
  if (r.status !== 202) return melde(`Prepare rejected: “${t.titel}” ${j.fehler}`, true);
  vorbereitFehler.delete(t.material_id); vorbereitAnzeigen.delete(t.material_id);
  t.vorbereitung = 'laeuft'; setzeVorbereitLive(t.material_id, 'laeuft'); libKnoepfe(td, t); zeichneVorbereitung(t.material_id);
  melde(`Preparing “${t.titel}” …`);
}
// Fragt den Stand alle 2 s ab und zeigt Stufe, Prozent, Zeit und „no progress for N s“ (stoebern.js vorbereitText). Eine Beobachtung je Track;
// Text und Fehler liegen je material_id, weil die Liste neu gezeichnet wird (neue Zeilenobjekte) und die Beobachtung weiterläuft.
const vorbereitAnzeigen = new Map(), vorbereitFehler = new Map(), vorbereitZelle = new Map(), beobachtet = new Set();
const zeichneVorbereitung = (mid) => {
  const z = vorbereitZelle.get(mid);
  if (!z || !z.td.isConnected) return;
  libKnoepfe(z.td, z.t);
  const sz = z.td.closest('tr')?.querySelector('td.status');   // Status-Spalte der Zeile: PREPARING… bzw. FAILED statt PREPARE
  if (sz) sz.textContent = statusText(z.t);
};
async function beobachteVorbereitung(t) {
  const mid = t.material_id;
  if (beobachtet.has(mid)) return;
  beobachtet.add(mid);
  let haengtGemeldet = false;
  try {
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 2000));
      let s = null, rs = null;
      try { rs = await fetch(`/mediathek/vorbereiten?material_id=${mid}`); s = await rs.json(); } catch { /* Server kurz weg: weiter fragen */ }
      if (!rs || (rs.ok && !s)) continue;   // Server kurz weg oder 200 ohne JSON: weiter fragen
      if (rs.ok && s?.status === 'laeuft') {
        const text = vorbereitText(s);
        if (text !== vorbereitAnzeigen.get(mid)) { vorbereitAnzeigen.set(mid, text); zeichneVorbereitung(mid); }
        if (s.haengt && !haengtGemeldet) melde(`“${t.titel}”: ${text}`, true);
        haengtGemeldet = !!s.haengt;
        continue;
      }
      vorbereitAnzeigen.delete(mid);
      t.vorbereitung = null;
      if (!rs.ok || s?.status === 'fehler') {
        const text = vorbereitText(s?.status === 'fehler' ? s : { status: 'fehler', grund: s?.fehler ?? `http ${rs.status}` });
        vorbereitFehler.set(mid, text); setzeVorbereitLive(mid, 'fehler');
        for (const z of [vorbereitZelle.get(mid)]) if (z) z.t.vorbereitung = null;
        zeichneVorbereitung(mid);
        return melde(`Prepare failed — “${t.titel}”: ${text}`, true);
      }
      vorbereitFehler.delete(mid); setzeVorbereitLive(mid, null);
      await ladeBestand();
      stoebernLaden();
      return melde(`“${t.titel}” is ready to load`);
    }
  } finally { beobachtet.delete(mid); }
}
// ---------- Sets (Plan 2026-10-03-sets-mit-tracks) ----------
const SET_STATUS_TEXT = { ready: 'READY', prepare: 'PREPARE', missing: 'MISSING', wartet: 'QUEUED', kein_track: 'NOT A TRACK', laeuft: 'PREPARING…', fehler: 'FAILED', unbekannt: '?' };
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
  const liste = await (await fetch('/sammlungen?art=set')).json();
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
  for (const [w, k] of [[titel, 'titelzelle'], [p.kuenstler ?? '–', ''], [p.bpm ?? '–', 'zahl'], [p.camelot ?? '–', 'zahl'], [p.energie ?? '–', 'zahl'],
    [p.genre ?? '–', ''], [p.dauer_s ? fmtZeit(p.dauer_s) : '–', 'zahl'], [SET_STATUS_TEXT[p.status] ?? p.status, `status st-${p.status}`]]) {
    const td = document.createElement('td'); td.textContent = w; td.className = k; tr.append(td);
  }
  if (p.grund) tr.title = p.grund;
  const td = document.createElement('td');
  td.className = 'aktion';
  if (p.art !== 'track') {                                   // Loop/Sample: kein LOAD A/B, nur die Art als Hinweis
    const hinweis = document.createElement('span'); hinweis.className = 'grund'; hinweis.textContent = postenArtText(p.art);
    td.append(hinweis);
  }
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
  if (!$('[data-tabelle="library"]').hidden) { $('#bestand-info').textContent = zustand.libraryInfo ?? 'Browse the whole library'; return; }
  const loops = !$('[data-tabelle="loops"]').hidden;
  $('#bestand-info').textContent = loops ? `${zustand.loopliste.length} ${zustand.loopliste.length === 1 ? 'loop' : 'loops'}, stored at 128 BPM, played at master tempo`
    : `${zustand.bestand.length} versions, all rendered at 128 BPM`;
}

function bindeReiter() {
  for (const b of $$('[data-reiter]')) b.addEventListener('click', () => {
    if (document.body.classList.contains('lib-zu')) schublade(true);   // Reiter bei eingeklappter Schublade: aufklappen statt still nichts zeigen
    for (const x of $$('[data-reiter]')) x.classList.toggle('an', x === b);
    for (const t of $$('[data-tabelle]')) t.hidden = t.dataset.tabelle !== b.dataset.reiter;
    if (b.dataset.reiter === 'loops') ladeLoops(); else if (b.dataset.reiter === 'library') { if (!stz.treffer.length) { stoebernLaden(); ladeBaum(); } zeigeReiterInfo(); $('#lib-suche').focus(); } else if (b.dataset.reiter === 'sets') { ladeSetListe(); zeigeReiterInfo(); } else zeigeReiterInfo();
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
// Großer Modus (Plan 2.4): gilt nur jetzt, kein localStorage
function gross(an) {
  document.body.classList.toggle('lib-gross', an);
  if (an) schublade(true);                                  // groß heißt offen
  $('#gross').setAttribute('aria-pressed', String(an));
}
function schublade(auf) {
  if (!auf) { document.body.classList.remove('lib-gross'); $('#gross').setAttribute('aria-pressed', 'false'); }   // zu heißt nicht mehr groß
  document.body.classList.toggle('lib-zu', !auf);
  $('#schublade').textContent = auf ? '▾' : '▸';
  try { localStorage.setItem('djk-lib', auf ? 'auf' : 'zu'); } catch { /* ohne Speicher: nur jetzt */ }
}
function bindeSchublade() {
  $('#schublade').addEventListener('click', () => schublade(document.body.classList.contains('lib-zu')));
  $('#gross').addEventListener('click', () => gross(!document.body.classList.contains('lib-gross')));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, [contenteditable]')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;          // Review: Strg+L u. a. bleiben beim Browser
    if (e.key === 'l' || e.key === 'L') schublade(document.body.classList.contains('lib-zu'));
    if (e.key === 'g' || e.key === 'G') gross(!document.body.classList.contains('lib-gross'));
    // Detail-Spalte (S5): ↑/↓ wählen die Zeile, S legt sie ins aktive Set. Nur bei sichtbarer Library (Reiter LIBRARY, oder PRODUCTION: dort zeigt sie
    // produktion.css, das hidden-Attribut bleibt vom DJ-Reiter bestimmt) und offener Schublade.
    if ((!$('[data-tabelle="library"]').hidden || document.body.classList.contains('produktion')) && !document.body.classList.contains('lib-zu') && $('#listen-menue').hidden && stz.treffer.length && !e.target.closest('select')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); zeigeDetail(Math.min(stz.treffer.length - 1, stz.wahl + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); zeigeDetail(Math.max(0, stz.wahl - 1)); return; }
      if ((e.key === 's' || e.key === 'S') && stz.wahl >= 0) { inSet(stz.treffer[stz.wahl]); return; }
      if (e.key === ' ' && stz.wahl >= 0) { e.preventDefault(); const t = stz.treffer[stz.wahl]; if (t.typ === 'strudel') return; stz.hoert === hoerId(t) ? vorhoerenStopp() : vorhoeren(t); return; }
      if (e.key === 'ArrowRight' && stz.hoert) { e.preventDefault(); vorhoerenSpringe(1); return; }
      if (e.key === 'ArrowLeft' && stz.hoert) { e.preventDefault(); vorhoerenSpringe(-1); return; }
    }
    if (e.key === 'Escape') { if (document.body.classList.contains('lib-gross')) gross(false); else schublade(false); }
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
    try { produktion?.ereignis(a, f); } catch (e) { console.error('Production view:', e); }   // D1 V1: proj, /zustand/arr; ein Fehler dort hält die DJ-Anzeige nicht an
    switch (a) {
      case 'stand':
        Object.assign(zustand.regler, f.regler);
        for (const [n, z] of Object.entries(f.decks)) zustand.decks[n] = z;
        for (const [n, g] of Object.entries(f.geladen)) zustand.geladen[n] = g.material_id;
        for (const p of Object.keys(f.regler)) zeigeWert(p);
        zeigeKeylock();   // Keylock 3
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
      case '/e/regler':
        zustand.regler[f.pfad] = f.wert; zeigeWert(f.pfad);
        if (f.pfad === 'keylock') { zeigeKeylock(); zeigeDeck(1); zeigeDeck(2); }   // Keylock 3: Taste und VARI
        if (f.pfad === 'color/art' || f.pfad === 'color/param') zeigeColor();
        { const m = /^(.+)\/komp\/\w+$/.exec(f.pfad); if (m) { zeigeKomp(m[1]); if (m[1] === fxGewaehlt) zeigeFxDetail(); } }
        break;
      case '/zustand/komp':
        kompGr[f.kanal] = { db: Number(f.gr_db), t: performance.now() };
        zeigeKomp(f.kanal);
        break;
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
      case '/e/loop': {
        const alt = zustand.loops[f.box]?.name;
        zustand.loops[f.box] = f; zeigeBox(f.box);
        if (fxGewaehlt === `pad/${f.box}` && alt !== f.name) baueFxDetail();   // anderer Loop: andere Automation
        break;
      }
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
  // SAVE: speichert, was die Instanz SPIELT (nicht den Text im Feld) als eigenes Muster in die Bibliothek
  const nameFeld = q('.muster-name');
  const speichere = async (ueberschreiben = false) => {
    const name = nameFeld.value.trim().toLowerCase().replace(/\s+/g, '-');
    let r, j;
    try { r = await jsonPost('/muster', { name, strom: i.strom, ...(ueberschreiben ? { ueberschreiben: true } : {}) }); j = await r.json(); }
    catch { return zeigeFehler('page server unreachable, not saved'); }
    if (r.ok) {
      nameFeld.hidden = true; zeigeOk(`saved as “${j.name}”`);
      if (stz.typ === 'strudel' && !stz.liste) { stoebernLaden(); ladeBaum(); }
      return;
    }
    if (j.fehler === 'name_vergeben') { if (confirm(`“${name}” already exists. Overwrite?`)) return speichere(true); return; }
    if (j.fehler === 'kein_muster') return zeigeFehler('Nothing is playing on this instance');
    if (j.fehler === 'name_ungueltig') return zeigeFehler('Name: a-z, 0-9, - and _ only, up to 48 characters');
    zeigeFehler(j.fehler ?? `save failed (${r.status})`);
  };
  q('.muster-sichern').addEventListener('click', () => {
    if (!nameFeld.hidden) { nameFeld.hidden = true; return; }
    const jetzt = new Date();
    nameFeld.hidden = false;
    nameFeld.value = nameFeld.value || `${['drums', 'bass', 'melody'][i.strom - 1]}-${String(jetzt.getHours()).padStart(2, '0')}${String(jetzt.getMinutes()).padStart(2, '0')}`;
    nameFeld.focus(); nameFeld.select();
  });
  nameFeld.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); speichere(); } if (e.key === 'Escape') nameFeld.hidden = true; });
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
// D1 V1: dritter Wert PRODUCTION (Modul produktion/produktion.js, gekapselt wie die Spurbänder)
const ANSICHTEN = ['dj', 'studio', 'produktion'];
let produktion = null;
function setzeAnsicht(a) {
  for (const k of ['studio', 'produktion']) document.body.classList.toggle(k, a === k);
  for (const b of $$('[data-ansicht]')) { const an = b.dataset.ansicht === a; b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
  try { localStorage.setItem('djk-ansicht', a); } catch { /* ohne Speicher: DJ */ }
  if (a === 'produktion') produktion?.zeige(); else produktion?.verberge();
}
function bindeAnsicht() {
  for (const b of $$('[data-ansicht]')) b.addEventListener('click', () => setzeAnsicht(b.dataset.ansicht));
  let a = 'dj';
  try { const g = localStorage.getItem('djk-ansicht'); a = ANSICHTEN.includes(g) ? g : 'dj'; } catch { /* Vorgabe */ }
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
  a.rasterWahl = 4; a.loopLaenge = 4; a.hotcues = {}; a.zieh = 0; a.ziehBasis = null; a.cueArt = 'shot'; a.muell = false;
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
  // Ziehen im Zoomfenster: die Welle folgt der Hand und der Kern spielt dazu (Hörbares Ziehen, 2026-10-17: /deck/scrub, ~60 Hz,
  // roh ohne Keylock). Beim Loslassen bleibt der Kopf (stehendes Deck) bzw. läuft das Deck um die Strecke versetzt weiter (laufend,
  // derselbe Ort wie der Sprung D7 ohne Raster). Mit Loop oder wenn der Griff den Kern nicht erreicht: wie bisher stumm ziehen und
  // beim Loslassen EIN Sprung um die Strecke.
  const lauf = $('[data-lauf]', d);
  let x0 = null;
  const zieher = new ScrubZieher({ senden: async (phase, delta) => {
    try {
      const r = await fetch('/deck/scrub', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deck: n, phase, delta }) });
      return r.ok;
    } catch { return false; }
  } });
  // Nach dem Los hält die Anzeige die Zugstrecke, bis die Meldungen des Kerns den neuen Kopf tragen (stehend: der Kern schwingt aus,
  // 300 ms; laufend: bis der Kopf um die halbe Strecke vom alten Lauf abweicht), höchstens 800 ms. Ein neuer Griff gewinnt.
  const ziehNull = (delta = 0) => {
    const marke = a.ziehMarke = (a.ziehMarke ?? 0) + 1, t0 = performance.now();
    const lief = a.ziehBasis === null, q0 = a.kopf.beat(t0), u0 = uhrKopf.beat(t0);
    const iv = setInterval(() => {
      if (x0 !== null || marke !== a.ziehMarke) { clearInterval(iv); return; }
      const jetzt = performance.now();
      const gelandet = lief ? Math.abs(a.kopf.beat(jetzt) - (q0 + uhrKopf.beat(jetzt) - u0)) > 0.5 * Math.abs(delta) : jetzt - t0 > 300;
      if (gelandet || jetzt - t0 > 800) { a.zieh = 0; a.ziehBasis = null; clearInterval(iv); }
    }, 20);
  };
  lauf.addEventListener('pointerdown', (e) => {
    if (a.raster && a.lauf.w) {
      x0 = e.clientX; lauf.setPointerCapture(e.pointerId);
      zieher.beginne(!loopAktiv(zustand.decks[n]));
      // stehendes Deck: die Meldungen des Kerns folgen der Hand, die Anzeige hält darum den Griffpunkt fest (laufend: Kopf + Strecke)
      a.ziehBasis = (zustand.decks[n]?.status ?? 0) < 2 ? a.raster.ersterSchlagFrame + a.kopf.beat(performance.now()) * a.raster.framesProBeat : null;
    }
  });
  lauf.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const fpp = a.lauf.takte * 4 * a.raster.framesProBeat / lauf.getBoundingClientRect().width;
    a.zieh = -(e.clientX - x0) * fpp;
    zieher.bewege(e.clientX - x0, a.zieh / a.raster.framesProBeat);
  });
  const los = async (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, delta = a.zieh / a.raster.framesProBeat;
    x0 = null;
    const r = await zieher.ende(delta);
    if (Math.abs(dx) < 3) { a.zieh = 0; a.ziehBasis = null; return; }
    if (r.gescrubbt && r.griffOk) { ziehNull(delta); return; }
    await deckPost('/deck/sprung', { deck: n, delta, raster: 0 }, 'Drag');
    a.zieh = 0; a.ziehBasis = null;
  };
  lauf.addEventListener('pointerup', los);
  lauf.addEventListener('pointercancel', () => { const delta = a.zieh / a.raster.framesProBeat; x0 = null; zieher.abbruch(); ziehNull(delta); });
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
    const f = (a.ziehBasis ?? (a.raster.ersterSchlagFrame + a.kopf.beat(jetzt) * a.raster.framesProBeat)) + (a.zieh ?? 0);
    const marken = hotcueMarken(a);
    a.lauf.zeichne(f, null, marken); a.ueber.zeichne(f, a.lauf.takte * 4 * a.raster.framesProBeat, marken);
  }
  window.djkBild.push(performance.now() - jetzt); if (window.djkBild.length > 600) window.djkBild.shift();
  requestAnimationFrame(bild);
}
// Glanz 2.1 (F22): Punkt OUT aus GET /ausgang, jede Sekunde. Es gibt nur ein Meldungsfeld (melde, Zeile 70): ein Alarm
// kommt wieder, sobald das Feld leer ist; die kurze Notiz eines geheilten Falls schreibt nie über die stehende
// Prüfmodus-Meldung (Zeile 84), und nach dem Alarm kommt diese zurück.
let ausgangFaelle = null, ausgangAlarm = false;
async function ausgang() {
  let a;
  try { a = await (await fetch('/ausgang')).json(); } catch { return; }
  const z = ausgangAnzeige(a, ausgangFaelle);
  const p = $('#v-out');
  p.classList.remove('an', 'alarm', 'leer'); p.classList.add(z.klasse); p.title = z.titel;
  if (z.klasse === 'alarm') {
    if (!ausgangAlarm || $('#meldung').textContent === '') melde(z.meldung.text, true, true);
  } else if (ausgangAlarm) {
    if (pruefmodusAus) melde(HAND_PRUEFMODUS_TEXT, true, true);
    else melde(z.klasse === 'an' ? 'Digital output back on' : '', false);
  } else if (z.meldung && !pruefmodusAus) {
    melde(z.meldung.text, true, false);
  }
  ausgangAlarm = z.klasse === 'alarm'; ausgangFaelle = a.faelle;
}
// ---------- Aufbau: am Ende der Datei, nach allen Definitionen (dreimal am 2026-09-28 griff der Aufbau auf ein const,
// das weiter unten stand: Temporal Dead Zone; hier unten gilt jedes const der Datei schon) ----------
zeigeCypher();
baueDecks();
baueBoxen();
baueRec();
bindeReiter();
bindeLibrary(); markiereTyp();
bindeSets();
bindeSchublade();
bindeTempo();
bindeColor();
bindeEffekte();
bindeMusterFeld();
try { bindeSpurbaender(jsonPost, () => letzterBeat); } catch (e) { console.error('Studio S7 lanes:', e); }   // Studio S7
try { produktion = bindeProduktion({ post: jsonPost, bpm: () => zustand.bpm ?? 128, stoebern: () => zustand.stoebern, bibliothek: () => { if (!stz.treffer.length) { stoebernLaden(); ladeBaum(); } } }); } catch (e) { console.error('Production view:', e); }   // D1 V1
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
ausgang(); setInterval(ausgang, 1000);

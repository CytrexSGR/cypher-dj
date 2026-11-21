// Deck sections: building, library load, waveforms, status line, level meters.
import { DECKS } from './curves.js';
import { CONTAINER, playerKanal } from './kanaele.js';
import { Laufansicht, Uebersicht, Kopf, SR, leseWelle, ersteVolleEins } from './wave.js';
import { einsHinweis, EINS_HINWEIS_TEXT, KOPIE_TEXT, variText, keylockStand } from './messages.js';
import { $, $$, BUCHSTABE, LADE_DECKS, deckAnsicht, klasseLaden, melde, zustand } from './page_state.js';
import { bindeDeckBedienung, holeHotcues, holeLoop, holeRaster, loopAktiv } from './deck_griffe.js';
import { filtere, zeigeReiterInfo } from './seitenrahmen.js';
import { zeigePlaetzeSpaeter } from './slots_view.js';
import { zeigeExport } from './live_view.js';
import { proTaktJetzt, zeigeSchlagPunkte } from './bar_live.js';
const STATUS_TEXT = ['LOADED', 'LOADED', 'PLAYING', 'LOOP', 'ROLL', 'FALLBACK'];

// ---------- Aufbau ----------
export function baueDecks() {
  for (const n of DECKS) {
    const d = $(`.deck[data-deck="${n}"]`);
    d.append($('#deck-vorlage').content.cloneNode(true));
    deckAnsicht[n] = { sektion: d, lauf: new Laufansicht($('[data-lauf]', d)), ueber: new Uebersicht($('[data-ueber]', d)), kopf: new Kopf(), id: null, raster: null };
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
    $('[data-kanal]', d).dataset.kanal = playerKanal(n);
    for (const t of $$('[data-taste]', d)) { t.dataset.pfad = `${playerKanal(n)}/${t.dataset.taste}`; t.disabled = true; }
  }
  for (const c of CONTAINER) baueZug($(`.zug[data-kanalzug="${c.pfad}"]`), c.pfad);   // the four container strips A..D, one per place
}
// A channel strip from the template: the controls address `<kanal>/<teil>`; a strip the page does not carry is skipped
export function baueZug(z, k) {
  if (!z) return;
  z.append($('#zug-vorlage').content.cloneNode(true));
  for (const e of $$('[data-teil]', z)) e.dataset.pfad = `${k}/${e.dataset.teil}`;
  for (const e of $$('[data-wert-teil]', z)) e.dataset.wert = `${k}/${e.dataset.wertTeil}`;
  $('[data-kanal]', z).dataset.kanal = k;
  for (const b of $$('[data-fxzuweisung]', z)) b.dataset.kanal = k;
}

// ---------- Bestand ----------
export const fmtZeit = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const takteVon = (e) => (e.beats ? Math.floor((e.beats - e.erste_eins_quell_beat) / 4) : null);

export async function ladeBestand() {
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
    for (const n of LADE_DECKS) {
      const b = document.createElement('button');
      b.className = `laden ${klasseLaden(n)}`;
      b.textContent = `LOAD ${BUCHSTABE[n]}`;
      b.dataset.deck = n;
      b.addEventListener('click', () => laden(n, e));
      td.append(b);
    }
    tr.append(td);
    tb.append(tr);
  }
  zeigePlaetzeSpaeter();   // the LOAD buttons of the stock list follow the places
  zeigeReiterInfo();
  filtere();
}

export async function laden(deck, e) {
  const r = await fetch('/laden', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deck, material_id: e.material_id, basis_bpm: e.basis_bpm, fassung: e.fassung }) });
  const j = await r.json();
  window.djkGesendet.push({ laden: deck, material_id: e.material_id, code: r.status, antwort: j });
  if (!r.ok) return melde(`Load rejected: “${e.titel}” ${KOPIE_TEXT[j.fehler] ?? j.fehler}`, true);
  zustand.eigeneLaden.set(j.felder.id, { deck, titel: e.titel });
  melde(`Loading “${e.titel}” to deck ${BUCHSTABE[deck]} …`);
  return true;   // answered 200: the library marks the sample as recently used
}

// KOPIE_TEXT (Antwort des Seiten-Servers, wenn nichts an den Kern ging) steht in messages.js

export const GRUND_TEXT = {
  deck_hoerbar: 'deck is playing with its fader open: stop it or pull the fader down first', material_fehlt: 'track not in the working set',
  pruefung: 'version failed the check', budget_speicher: 'not enough memory',
};

// ---------- Decks ----------
export function eintragVon(id) { return zustand.bestand.find((e) => e.material_id === id); }

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

export function zeigeDeck(n) {
  zeigePlaetzeSpaeter();
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
  zeigeExport(n);
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
  // Keylock 3b: VARI nur, wenn das Deck wirklich im Varispeed klingt (Knopf UND Hörweg aus /zustand/deck, messages.js variText)
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

export function zeigePegel(kanal, db) {
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
export function zeigeSchlag(beat) {
  zeigeSchlagPunkte($('#schlaege'), beat, proTaktJetzt());   // one dot per beat of the open project's bar (4 without a project)
}

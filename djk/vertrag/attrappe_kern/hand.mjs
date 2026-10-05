// Test-Handeingang /test/hand (SCHNITTSTELLEN §19.0) mit der Semantik der Hand (§7.3): erster Wert nur Stellung,
// Totzone 3/128 gegenüber dem Übernahmepunkt, solange ein Plan den Regler hält, Übernahme skaliert, Abbruch nur dieses
// Reglers und seiner Gruppe am selben Sample, Rückgabe nach 32 Beats Ruhe oder per Freigabe-Geste, Tasten, Deck-Halter.
// Skalierte Übernahme aus proben/09-ki-steuerung/stellwerk.mjs (handAnwenden). Ohne Mapping-Datei gilt je Regler die
// Kurve "linear" über den Bereich aus §1.5.

import { REGLER, kanalVon } from './vertrag.mjs';
import { llround } from './uhr.mjs';
import { wertBei, meldeRegler, setzeHalter } from './regler.mjs';
import decksModul, { laeuft, loese, starteDeck, stoppeDeck } from './decks.mjs';

export const TOTZONE = 3 / 128;
const RUHE_BEATS = 32;
const HAND_ABSTAND = 2400;          // /e/hand höchstens 20 Hz je Pfad
const TASTEN = new Set(['annehmen', 'verwerfen', 'cypher_vorschlag', 'cypher_hoeren', 'stopp', 'freigabe', 'urteil_gut',
  'urteil_daneben', 'autonomie', 'spielart', 'laenge', 'spielart_start', 'basstausch', 'kiste_laden', 'kiste_wahl', 'tempo_basis', 'zuruf']);
const DECK_AKTION = /^deck\/([1-4])\/(play|cue|hotcue\/[1-8]|hotcue_setzen\/[1-8]|loop|loop_laenge|roll\/[0-9.]+|sprung_plus|sprung_minus|nudge|tap|slip|laden)$/;

const norm = (info, v) => (v - info.min) / (info.max - info.min);
const denorm = (info, u) => info.min + u * (info.max - info.min);

function planHaelt(K, pfad, r) {
  return r.halter !== 'frei' && r.halter !== 'mensch' || K.offeneTeile().some((t) => t.art === 'regler' && t.pfad === pfad);
}

function handAmRegler(K, e, s) {
  const pfad = e.pfad;
  const info = REGLER.get(pfad);
  const r = K.r.get(pfad);
  const u = Math.max(0, Math.min(1, e.u));
  const melde = () => {
    if (s - r.handGemeldet >= HAND_ABSTAND) { r.handGemeldet = s; K.aus('/e/hand', [pfad, wertBei(K, pfad, s), BigInt(s), K.uhr.beat(s)]); }
  };
  const k = kanalVon(pfad);
  if (k?.startsWith('deck/')) loese(K, K.decks[Number(k[5])], s);
  if (r.physisch === null) {                       // erster Wert nach Start oder Neuverbindung: nur Stellung
    r.physisch = u;
    r.punkt = u;
    return melde();
  }
  if (K.hand.freigabe) {                           // Freigabe-Geste: Taste freigabe plus Bewegen des Reglers
    K.hand.freigabe = false;
    r.physisch = u;
    r.punkt = u;
    r.letzteHand = null;
    setzeHalter(K, pfad, 'frei', s);
    return melde();
  }
  if (r.halter !== 'mensch') {
    if (planHaelt(K, pfad, r) && Math.abs(u - r.punkt) <= TOTZONE) { r.physisch = u; return melde(); }
    for (const t of K.offeneTeile().filter((x) => x.art === 'regler' && x.pfad === pfad)) K.gruppeAbbrechen(t, s, 'hand');
    setzeHalter(K, pfad, 'mensch', s);
  }
  const alt = r.physisch;
  let w;
  if (info.einheit === 'schalter') w = u >= 0.5 ? 1 : 0;
  else if (info.einheit === 'stufe') w = Math.round(u * info.max);
  else {
    let x = norm(info, wertBei(K, pfad, s));
    if (r.eingerastet || Math.abs(u - x) <= 1e-3) { x = u; r.eingerastet = true; }
    else if (u > alt && alt < 1) x = x + ((u - alt) * (1 - x)) / (1 - alt);
    else if (u < alt && alt > 0) x = x - ((alt - u) * x) / alt;
    w = denorm(info, Math.max(0, Math.min(1, x)));
  }
  r.wert = w;
  r.spur = null;
  r.physisch = u;
  r.punkt = u;
  r.letzteHand = s;
  melde();
  meldeRegler(K, pfad, s);
}

function taste(K, name, u, s) {
  const wert = Math.round(u * 127);
  K.aus('/e/taste', [name, wert, BigInt(s), K.uhr.beat(s)]);
  if (wert === 0) return;
  if (name === 'freigabe') { K.hand.freigabe = true; return; }
  if (name === 'stopp') {
    if (K.hand.freigabe) { K.hand.freigabe = false; K.kiFrei?.(s, 'freigabe'); }
    else K.kiStopp?.(s, 'andreas', 'taste');
  }
}

function deckAktion(K, n, aktion, u, s) {
  const d = K.decks[n];
  decksModul.setzeDeckHalter(K, n, s);
  loese(K, d, s);
  K.aus('/e/hand', [`deck/${n}/${aktion}`, u, BigInt(s), K.uhr.beat(s)]);
  if (aktion !== 'play' || u < 0.5 || d.status === 0) return;
  const b = K.uhr.beat(s);
  if (laeuft(d)) stoppeDeck(K, d, b, 'andreas');
  else {
    starteDeck(K, d, b, d.anker.q);
    d.unterbunden = d.m.inhalt;                     // Play-Taste von Andreas unterbindet den Frist-Wächter
  }
}

export default {
  name: 'hand',
  init(K) {
    K.hand = { q: [], freigabe: false, seq: 0 };
  },
  befehle: {
    '/test/hand': (K, a, b, von) => {
      const pfad = a.pfad;
      if (!REGLER.has(pfad) && !pfad.startsWith('taste/') && !DECK_AKTION.test(pfad)) return K.protokollfehler('/test/hand', 'unbekannter_regler', von);
      if (pfad.startsWith('taste/') && !TASTEN.has(pfad.slice(6))) return K.protokollfehler('/test/hand', 'unbekannter_regler', von);
      let s = Number(a.sample);
      if (s < K.jetzt) s = K.jetzt;
      K.hand.q.push({ pfad, u: a.midi_roh, s, seq: ++K.hand.seq });
    },
  },
  punkte(K, s0, s1) {
    const p = [];
    const bleiben = [];
    for (const e of K.hand.q) {
      if (e.s < s1) p.push({ s: Math.max(e.s, s0), prio: 0, seq: e.seq, tu: () => this.anwenden(K, e, Math.max(e.s, s0)) });
      else bleiben.push(e);
    }
    K.hand.q = bleiben;
    for (const [pfad, r] of K.r) {                  // Rückgabe nach 32 Beats ohne Handbewegung (§7.3 Punkt 4)
      if (r.halter !== 'mensch' || r.letzteHand === null) continue;
      const sf = llround(K.uhr.sample(K.uhr.beat(r.letzteHand) + RUHE_BEATS));
      if (sf < s1) {
        const seit = r.letzteHand;
        p.push({ s: Math.max(sf, s0), prio: 3, seq: 0, tu: () => { if (r.halter === 'mensch' && r.letzteHand === seit) { r.letzteHand = null; setzeHalter(K, pfad, 'frei', Math.max(sf, s0)); } } });
      }
    }
    return p;
  },
  anwenden(K, e, s) {
    if (e.pfad.startsWith('taste/')) return taste(K, e.pfad.slice(6), e.u, s);
    const m = DECK_AKTION.exec(e.pfad);
    if (m && !REGLER.has(e.pfad)) return deckAktion(K, Number(m[1]), m[2], e.u, s);
    return handAmRegler(K, e, s);
  },
  setNeu(K) {
    for (const r of K.r.values()) if (r.letzteHand !== null) r.letzteHand = 0;
  },
};

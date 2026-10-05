// Offen, hörbar und "Tief offen" nach SCHNITTSTELLEN §1.6, als reine Funktionen über eine Sicht auf den Zustand.
// Eine Sicht liefert Reglerwerte und Deck-Laufzustand; die Frist-Vorhersage benutzt dieselben Funktionen mit einer
// Sicht auf den geplanten Zustand.

import { SPIELKANAELE, istDeck, deckNr } from './vertrag.mjs';
import { wertBei } from './regler.mjs';

const LAEUFT = new Set([2, 3, 4, 5]);

export function sicht(K, s) {
  return {
    wert: (p) => wertBei(K, p, s),
    deckLaeuft: (n) => LAEUFT.has(K.decks?.[n]?.status ?? 0),
    mitStems: (n) => Boolean(K.decks?.[n]?.m?.mit_stems),
  };
}

export const kanalpegel = (v, k) => v.wert(`${k}/trim`) + v.wert(`${k}/fader`);

export function offen(K, v, k) {
  return kanalpegel(v, k) > K.cfg.hoerbar_db;
}

// Crossfader-Gewicht einer Seite in dB (xseite 0 = A, 1 = durch, 2 = B), linear mit beiden Seiten voll in der Mitte.
export function xGewichtDb(v, seite) {
  if (seite === 1) return 0;
  const x = v.wert('xfader');
  const g = seite === 0 ? (x <= 0 ? 1 : 1 - x) : (x >= 0 ? 1 : 1 + x);
  return g <= 0 ? -200 : 20 * Math.log10(g);
}

export function effektiv(v, k) {
  const z = k.startsWith('bus/') ? 0 : v.wert(`${k}/ziel`);
  const master = v.wert('master/pegel');
  if (z > 0) {
    const bus = `bus/${z}`;
    return kanalpegel(v, k) + v.wert(`${bus}/fader`) + xGewichtDb(v, v.wert(`${bus}/xseite`)) + master;
  }
  return kanalpegel(v, k) + xGewichtDb(v, v.wert(`${k}/xseite`)) + master;
}

export function hoerbar(K, v, k) {
  if (!(effektiv(v, k) > K.cfg.hoerbar_db)) return false;
  return istDeck(k) ? v.deckLaeuft(deckNr(k)) : true;
}

export function tiefOffen(K, v, k) {
  if (!hoerbar(K, v, k)) return false;
  if (v.wert(`${k}/kill/tief`) !== 0) return false;
  if (!(v.wert(`${k}/eq/tief`) > K.cfg.tief_offen_db)) return false;
  if (istDeck(k) && v.mitStems(deckNr(k)) && !(v.wert(`${k}/stem/bass`) > K.cfg.tief_offen_db)) return false;
  return true;
}

export const hoerbarMenge = (K, v) => new Set(SPIELKANAELE.filter((k) => hoerbar(K, v, k)));
export const tiefOffenMenge = (K, v) => new Set(SPIELKANAELE.filter((k) => tiefOffen(K, v, k)));

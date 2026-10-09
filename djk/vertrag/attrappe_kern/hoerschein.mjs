// Hörschein-Register und I3 "neuer Inhalt nur mit Hörschein" (SCHNITTSTELLEN §4.5, §17 I3a und I3d; I3b und I3c
// prüft erzeuger.mjs mit gueltig()). Gültig: Kanal und Inhalt passen, beat ≤ gueltig_bis_beat,
// |bpm_jetzt/bpm_messung − 1| ≤ 0,005; bei Decks liegt die Quellposition in [quell_von, quell_bis + 64].
// Abgelaufene Hörscheine bleiben im Register, bis ihr Platz gebraucht wird: nur so kann der Kern
// hoerschein_abgelaufen melden statt kein_hoerschein (Golden-Folge hoerschein_rand).

import { SPIELKANAELE, ID_MUSTER, istDeck, deckNr, kanalVon } from './vertrag.mjs';
import { offen, sicht } from './pegel.mjs';
import { pos, zielQuellBeat } from './decks.mjs';

const MAX_HOERSCHEINE = 32;
const ABSCHNITT_ZUGABE = 64;

export function gueltig(K, hs, kanal, inhalt, beat) {
  if (!hs) return 'kein_hoerschein';
  if (hs.kanal !== kanal) return 'hoerschein_anderer_kanal';
  if (inhalt !== null && hs.inhalt !== inhalt) return 'hoerschein_anderer_inhalt';
  if (Math.abs(K.uhr.bpmBeiBeat(beat) / hs.bpm_messung - 1) > 0.005) return 'hoerschein_anderes_tempo';
  if (beat > hs.gueltig_bis_beat) return 'hoerschein_abgelaufen';
  return null;
}

const imAbschnitt = (hs, q) => q >= hs.quell_von && q <= hs.quell_bis + ABSCHNITT_ZUGABE;

// I3a: ein Planteil, der einen geschlossenen Kanal öffnet (Trim plus Fader über der Schwelle). §17 „die Hand wird
// nie blockiert": Andreas' eigene Teile (auch seine Seite über /regler) nimmt der Kern aus (Ohr T14 Befund Slice 2).
function i3a(K, t, s) {
  if (t.quelle === 'andreas') return null;
  if (!/\/(fader|trim)$/.test(t.pfad)) return null;
  const k = kanalVon(t.pfad);
  if (!SPIELKANAELE.includes(k)) return null;
  if (k.startsWith('erz/')) return null;   // wie Kern e9baf64 (stellwerk/src/i3.cpp): Strudel-Kanäle öffnen ohne Hörschein (Andreas 2026-09-29)
  if (k.startsWith('pad/')) return null;   // Andreas 2026-10-05: „diese fader solltest du selber steuern können alle“; Herkunft des Box-Inhalts prüft die Seite (server.ts eigenePad)
  const v = sicht(K, s);
  if (offen(K, v, k)) return null;
  const nachher = t.pfad.endsWith('/fader') ? t.nach + v.wert(`${k}/trim`) : t.nach + v.wert(`${k}/fader`);
  if (!(nachher > K.cfg.hoerbar_db)) return null;
  const beat = K.uhr.beat(s);
  const hs = K.hs.get(t.hoerschein);
  const deck = istDeck(k) ? K.decks[deckNr(k)] : null;
  const g = gueltig(K, hs, k, deck ? deck.m?.inhalt ?? '' : null, beat);
  if (g) return g;
  if (deck && !imAbschnitt(hs, pos(deck, beat))) return 'hoerschein_anderer_abschnitt';
  return null;
}

// I3d: Cyphers Sprung oder Hotcue (und Start) auf einem offenen Deck braucht ein gemessenes Ziel oder die Annahme
function i3d(K, t, s) {
  if (t.quelle !== 'cypher') return null;
  const k = `deck/${t.deck}`;
  const d = K.decks[t.deck];
  if (!offen(K, sicht(K, s), k)) return null;
  if (t.hoerschein.startsWith('annahme:')) return null;
  const beat = K.uhr.beat(s);
  const ziel = zielQuellBeat(K, t, beat);
  const kandidaten = t.hoerschein ? [K.hs.get(t.hoerschein)] : [...K.hs.values()].filter((h) => h.kanal === k);
  for (const hs of kandidaten) if (hs && !gueltig(K, hs, k, d.m?.inhalt ?? '', beat) && imAbschnitt(hs, ziel)) return null;
  return 'ziel_ungehoert';
}

export default {
  name: 'hoerschein',
  init(K) {
    K.hs = new Map();
    K.pruefeI3 = (t, s) => {
      let g = null;
      if (t.art === 'regler' && !K.mutation.has('i3a_aus')) g = i3a(K, t, s);
      else if (t.art === 'deck' && ['sprung', 'hotcue', 'start'].includes(t.aktion) && !K.mutation.has('i3d_aus')) g = i3d(K, t, s);
      if (g) K.aus('/e/invariante', ['hoerschein', t.plan, t.teil, BigInt(s), K.uhr.beat(s)]);
      return g;
    };
  },
  befehle: {
    '/k/hoerschein': (K, a, b) => {
      if (!ID_MUSTER.test(a.hs_id)) return K.q(b, 6, 'ausserhalb_bereich');
      if (!SPIELKANAELE.includes(a.kanal)) return K.q(b, 6, 'unbekannter_regler');
      if (a.urteil !== 'ok' || !(a.bpm_messung > 0) || !Number.isFinite(a.gueltig_bis_beat)) return K.q(b, 6, 'ausserhalb_bereich');
      if (!K.hs.has(a.hs_id) && K.hs.size >= MAX_HOERSCHEINE) {      // abgelaufene entfallen, wenn Platz gebraucht wird
        const beat = K.uhr.beat(K.jetzt);
        for (const [id, hs] of K.hs) if (beat > hs.gueltig_bis_beat) K.hs.delete(id);
        if (K.hs.size >= MAX_HOERSCHEINE) return K.q(b, 6, 'ausserhalb_bereich');
      }
      K.sofort(b, () => {
        K.hs.set(a.hs_id, { hs_id: a.hs_id, kanal: a.kanal, inhalt: a.inhalt, bpm_messung: a.bpm_messung, gueltig_bis_beat: a.gueltig_bis_beat,
          quell_von: a.quell_von, quell_bis: a.quell_bis, sync_ms: a.sync_ms, pegel_diff_db: a.pegel_diff_db, lufs_kurz: a.lufs_kurz });
        return null;
      });
    },
    '/k/hoerschein/weg': (K, a, b) => {
      K.sofort(b, () => { K.hs.delete(a.hs_id); return null; });
    },
  },
};

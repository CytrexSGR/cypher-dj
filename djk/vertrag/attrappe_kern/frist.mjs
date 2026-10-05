// Frist-Wächter und /e/frist (SCHNITTSTELLEN §5.9, §17, ADR 023 Entscheidung 4).
// Ist ein laufendes Deck der einzige hörbare Kanal, ohne Loop, mit beats_bis_ende < 32, und macht kein angenommener Teil
// einen anderen Kanal vor dem Ende hörbar, legt der Kern einen Loop über [q0, q0 + 16) mit
// q0 = e + floor((Q_ende − e − 16)/16)·16 (e = erste_eins_quell_beat) und meldet /e/rueckfall an = 1.
// Nur ein ausgeführter Stopp mit Quelle andreas oder seine Play-Taste unterbindet ihn für dieses Material.

import { SPIELKANAELE } from './vertrag.mjs';
import { llround } from './uhr.mjs';
import { sicht, hoerbar, hoerbarMenge } from './pegel.mjs';
import { wertBei } from './regler.mjs';
import { pos, endeBeat, laeuft } from './decks.mjs';

const FRIST_BEATS = 32;
const LOOP_BEATS = 16;
const FRISTEN = [128, 64, 32, 16];

// Vorhersage: wird bis zum Ende-Beat bE ein anderer Kanal hörbar, wenn alle angenommenen Teile davor wirken?
export function andererWirdHoerbar(K, n, bE) {
  const werte = new Map();
  const status = K.decks.map((d) => d?.status ?? 0);
  const teile = K.teile.filter((t) => (t.status === 'wartet' || t.status === 'laeuft') && t.ab_eff < bE)
    .sort((x, y) => x.ab_eff - y.ab_eff || x.seq - y.seq);
  for (const t of teile) {
    if (t.art === 'regler') werte.set(t.pfad, t.nach);
    else if (t.art === 'deck' && t.aktion === 'start') status[t.deck] = 2;
    else if (t.art === 'deck' && t.aktion === 'stopp') status[t.deck] = 1;
  }
  const v = {
    wert: (p) => (werte.has(p) ? werte.get(p) : wertBei(K, p, K.stempel)),
    deckLaeuft: (m) => [2, 3, 4, 5].includes(status[m]),
    mitStems: (m) => Boolean(K.decks[m]?.m?.mit_stems),
  };
  return SPIELKANAELE.some((k) => k !== `deck/${n}` && hoerbar(K, v, k));
}

export default {
  name: 'frist',
  init(K) {
    K.leds = K.leds ?? {};
  },
  nachBlock(K, s0, s1) {
    const b0 = K.uhr.beat(s0);
    const b1 = K.uhr.beat(s1);
    const H = hoerbarMenge(K, sicht(K, s1));
    for (const d of K.decks) {
      if (!d || !d.m || !laeuft(d)) continue;
      const k = `deck/${d.nr}`;
      if (H.has(k) && !d.loop && !d.roll) {
        const bE = endeBeat(d);
        for (const f of FRISTEN) {
          const bf = bE - f;
          if (bf >= b0 && bf < b1) K.aus('/e/frist', [d.nr, f, bf, BigInt(llround(K.uhr.sample(bf)))]);
        }
      }
      if (K.mutation.has('frist_aus')) continue;
      if (d.status !== 2 || d.loop || d.roll) continue;
      if (d.unterbunden === d.m.inhalt) continue;
      if (!(H.size === 1 && H.has(k))) continue;
      if (!(d.m.Q - pos(d, b1) < FRIST_BEATS)) continue;
      if (andererWirdHoerbar(K, d.nr, endeBeat(d))) continue;
      const e = d.m.e;
      const q0 = e + Math.floor((d.m.Q - e - LOOP_BEATS) / LOOP_BEATS) * LOOP_BEATS;
      d.loop = { ls: q0, L: LOOP_BEATS };
      d.status = 5;
      d.rueckfall = true;
      K.leds.rueckfall = 1;
      K.aus('/e/rueckfall', [d.nr, 1, q0, LOOP_BEATS, b1, BigInt(s1)]);
    }
  },
};

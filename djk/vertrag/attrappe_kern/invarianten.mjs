// Laufzeit-Invarianten I1 und I2 (SCHNITTSTELLEN §17, ADR 023). Geprüft nach allen Teilen eines Samples (diskrete
// Änderungen: Setzen, Deck-Teile, Hand) und am Ende jedes Zyklus (Rampen). Die Hand wird nie blockiert.
// I1: würde ein Planteil einen zweiten Kanal "Tief offen" machen, fällt er samt Gruppe; der Wert bleibt am Ist-Wert.
//     Am Start-Sample heißt das: der Teil wird zurückgerollt und nie wirksam (nur Quittung 7).
// I2: würde ein Planteil oder Deck-Stopp den letzten hörbaren Kanal unhörbar machen, hält der Teil am Ist-Wert bzw.
//     wartet der Stopp, bis ein anderer Kanal hörbar ist; dann weiter mit unverändertem Ende-Beat.

import { kanalVon, SPIELKANAELE } from './vertrag.mjs';
import { sicht, hoerbarMenge, tiefOffenMenge, hoerbar, tiefOffen } from './pegel.mjs';
import { wertBei } from './regler.mjs';

const TIEF_PFADE = /\/(fader|trim|eq\/tief|stem\/bass)$/;
const PEGEL_PFADE = /\/(fader|trim)$/;

export function kanalVonTeil(t) {
  if (t.art === 'regler') return kanalVon(t.pfad);
  if (t.art === 'deck') return `deck/${t.deck}`;
  return null;
}

function w0(K, t) {
  return t.w0 ?? wertBei(K, t.pfad, K.stempel);
}

export function oeffnend(K, t, k) {
  if (kanalVonTeil(t) !== k) return false;
  if (t.art === 'deck') return t.aktion === 'start';
  if (t.art !== 'regler') return false;
  if (t.pfad.endsWith('/kill/tief')) return t.nach === 0 && w0(K, t) === 1;
  return TIEF_PFADE.test(t.pfad) && t.nach > w0(K, t);
}

// Deck-Stopps fallen nur unter I2, wenn sie aus einem Plan kommen (plan ≠ ""): "Ein Stopp aus einem Plan wartet" (§4.4);
// ein direkter Stopp (etwa Andreas' Makro) wird ausgeführt und kann so den Frist-Wächter unterbinden (§17).
export function schliessend(K, t, k) {
  if (kanalVonTeil(t) !== k) return false;
  if (t.art === 'deck') return t.aktion === 'stopp' && t.plan !== '';
  return t.art === 'regler' && PEGEL_PFADE.test(t.pfad) && t.nach < w0(K, t);
}

function meldeInvariante(K, art, t, s) {
  K.aus('/e/invariante', [art, t.plan, t.teil, BigInt(s), K.uhr.beat(s)]);
}

function halteAmStart(K, t, s) {
  K.arten[t.art].rueck?.(K, t, s);
  if (t.art === 'deck') {
    t.status = 'wartet';
    t.i2warten = true;
    const i = K.startQ.indexOf(t);
    if (i >= 0) K.startQ.splice(i, 1);
  } else {
    t.status = 'halt';
    t.setzenGehalten = true;
  }
  if (!t.i2gemeldet) { t.i2gemeldet = true; meldeInvariante(K, 'master_leer', t, s); }
}

function fortsetzen(K, s, H) {
  for (const t of K.teile.filter((x) => x.status === 'halt').sort((x, y) => x.seq - y.seq)) {
    const k = kanalVonTeil(t);
    if (![...H].some((c) => c !== k)) continue;
    const erg = K.arten[t.art].setzeFort(K, t, s);
    if (erg === 'fertig') {
      t.status = 'fertig';
      K.entferne(t);
      K.q(t.b, 3, '', s);
    } else t.status = 'laeuft';
  }
}

// Wer hat den Zustand verändert? Am Sample: was dort gestartet und sofort wirksam ist (Setzen, Deck-Teile);
// am Zyklusende: laufende Rampen.
function kandidaten(K, amStart) {
  if (amStart) return K.gestartetBei.filter((t) => t.status === 'fertig' && !t.b.intern);
  return K.teile.filter((t) => t.status === 'laeuft' && t.art === 'regler' && !t.b.intern);
}

// Hat gerade dieser Teil den Kanal k "Tief offen" gemacht? Gegenprobe: derselbe Zustand mit dem Regler des Teils auf
// seinem Wert vor der Änderung (am Start: w0; im Zyklus: Wert am Blockanfang s0). Bleibt k dann tief offen, war es ein
// anderer Regler (Golden-Folge sub_doppelt: B's Fader-Rampe läuft weiter, nur B's eq/tief-Rampe fällt).
function istUrsache(K, t, k, v, amStart, s0) {
  if (t.art !== 'regler') return true;
  const vorher = amStart ? w0(K, t) : wertBei(K, t.pfad, s0);
  const gegen = { ...v, wert: (p) => (p === t.pfad ? vorher : v.wert(p)) };
  return !tiefOffen(K, gegen, k);
}

// Lesart n (Andreas 2026-09-25, §17 I1 "hart"): I1 sieht über die Schaltrampe eines Setzens (192 Samples) den
// offeneren von altem und neuem Wert des Reglers (kill/tief: 0 ist offen; sonst der größere).
function schaltSicht(K, v, s) {
  return { ...v, wert: (p) => {
    const w = v.wert(p);
    const sr = K.r.get(p)?.schalt;
    if (!sr || s >= sr.bis) return w;
    return p.endsWith('/kill/tief') ? Math.min(w, sr.alt) : Math.max(w, sr.alt);
  } };
}

function pruefe(K, s, v0, { amStart, s0 = s }) {
  const v = schaltSicht(K, v0, s);
  let T = tiefOffenMenge(K, v);
  let H = hoerbarMenge(K, v);
  if (!K.mutation.has('i1_aus') && T.size >= 2) {
    const neu = [...T].filter((k) => !K.inv.T.has(k));
    const oeffnende = kandidaten(K, amStart).filter((t) => neu.some((k) => oeffnend(K, t, k)));
    const ursache = oeffnende.filter((t) => neu.some((k) => oeffnend(K, t, k) && istUrsache(K, t, k, v, amStart, s0)));
    const opfer = ursache.length ? ursache : oeffnende;
    for (const t of [...opfer].reverse()) {
      const sr = amStart ? s : Math.max(s, t.s_start);
      meldeInvariante(K, 'sub_doppelt', t, sr);
      K.gruppeAbbrechen(t, sr, 'invariante_sub_doppelt', { rueck: amStart });
    }
    if (opfer.length) { T = tiefOffenMenge(K, v); H = hoerbarMenge(K, v0); }
  }
  H = hoerbarMenge(K, v0);
  if (!K.mutation.has('i2_aus') && H.size === 0 && K.inv.H.size > 0) {
    const vorher = [...K.inv.H];
    const opfer = kandidaten(K, amStart).filter((t) => vorher.some((k) => schliessend(K, t, k)));
    for (const t of [...opfer].reverse()) {
      if (amStart) halteAmStart(K, t, s);
      else {
        const sr = Math.max(s, t.s_start);
        K.arten[t.art].halte(K, t, sr);
        t.status = 'halt';
        if (!t.i2gemeldet) { t.i2gemeldet = true; meldeInvariante(K, 'master_leer', t, sr); }
      }
    }
    if (opfer.length) { T = tiefOffenMenge(K, v); H = hoerbarMenge(K, v0); }
  }
  return { T, H };
}

export default {
  name: 'invarianten',
  init(K) {
    K.inv = { T: new Set(), H: new Set() };
    K.hoerbarOhne = (v, k) => SPIELKANAELE.some((c) => c !== k && hoerbar(K, v, c));
  },
  nachSample(K, s) {
    const v = sicht(K, s);
    const { T, H } = pruefe(K, s, v, { amStart: true });
    fortsetzen(K, s, H);
    K.inv = { T: tiefOffenMenge(K, schaltSicht(K, v, s)), H: hoerbarMenge(K, v) };
  },
  nachBlock(K, s0, s1) {
    const v = sicht(K, s1);
    const { H } = pruefe(K, s0, v, { amStart: false, s0 });
    fortsetzen(K, s1, H);
    K.inv = { T: tiefOffenMenge(K, schaltSicht(K, v, s1)), H: hoerbarMenge(K, v) };
  },
};

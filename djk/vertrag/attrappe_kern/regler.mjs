// Regler-Tabelle und Planteile an Reglern (SCHNITTSTELLEN §1.2, §1.5, §4.3, §17 I4).
// Rampen in Beats: wert(beat) = w0 + (nach − w0)·f((beat − ab)/dauer), f linear oder S-Kurve 3u² − 2u³.
// dB-Rampen von oder nach "stumm" laufen bis bzw. ab −60 dB und setzen am Ende −200 (§1.2).

import { REGLER, kanalVon } from './vertrag.mjs';
import { llround } from './uhr.mjs';

const STUMM = -200;
const STUMM_GRENZE = -120;
const RAMPEN_GRENZE = -60;
const MELDE_ABSTAND = 960;            // /e/regler höchstens 50 Hz je Regler
export const SCHALTRAMPE = 192;       // Samples, Schaltrampe eines Setzens (§17 I1, Lesart n)

export function rampenWert(sp, beat) {
  if (sp.halt !== undefined) return sp.halt;
  let u = sp.dauer > 0 ? (beat - sp.ab) / sp.dauer : 1;
  u = Math.max(0, Math.min(1, u));
  const f = sp.form === 1 ? u * u * (3 - 2 * u) : u;
  if (!sp.db) return sp.w0 + (sp.nach - sp.w0) * f;
  const vonStumm = sp.w0 <= STUMM_GRENZE;
  const nachStumm = sp.nach <= STUMM_GRENZE;
  if (vonStumm && nachStumm) return STUMM;
  if (nachStumm) {
    if (u >= 1) return STUMM;
    return sp.w0 > RAMPEN_GRENZE ? sp.w0 + (RAMPEN_GRENZE - sp.w0) * f : sp.w0;
  }
  if (vonStumm) {
    if (sp.nach <= RAMPEN_GRENZE) return u >= 1 ? sp.nach : STUMM;
    return RAMPEN_GRENZE + (sp.nach - RAMPEN_GRENZE) * f;
  }
  return sp.w0 + (sp.nach - sp.w0) * f;
}

export function wertBei(K, pfad, s) {
  const r = K.r.get(pfad);
  if (!r) return undefined;
  return r.spur ? rampenWert(r.spur, K.uhr.beat(s)) : r.wert;
}

export function meldeRegler(K, pfad, s) {
  const r = K.r.get(pfad);
  r.gemeldet = s;
  K.aus('/e/regler', [pfad, wertBei(K, pfad, s), r.halter, BigInt(s), K.uhr.beat(s)]);
}

export function setzeHalter(K, pfad, halter, s) {
  const r = K.r.get(pfad);
  if (r.halter === halter) return;
  r.halter = halter;
  K.aus('/e/halter', [pfad, halter, BigInt(s), K.uhr.beat(s)]);
}

// I4 (§17): zwei Teile am selben Regler überlappen, wenn ihre Zeiträume sich schneiden; ein Setzen am selben Beat
// wie eine anschließende Rampe ist erlaubt, ein Setzen am Ende einer Rampe auch.
export function ueberlappt(a, b) {
  if (a.dauer > 0 && b.dauer > 0) return a.ab < b.ab + b.dauer && b.ab < a.ab + a.dauer;
  if (a.dauer === 0 && b.dauer === 0) return a.ab === b.ab;
  const [p, r] = a.dauer === 0 ? [a, b] : [b, a];
  return p.ab > r.ab && p.ab < r.ab + r.dauer;
}

function haltername(t) {
  return t.plan ? `plan:${t.plan}` : t.quelle;
}

function bereichOk(info, t) {
  const v = t.nach;
  if (!Number.isFinite(v)) return false;
  if (info.einheit === 'schalter') return (v === 0 || v === 1) && t.dauer === 0;
  if (info.einheit === 'stufe') return Number.isInteger(v) && v >= info.min && v <= info.max && t.dauer === 0;
  return v >= info.min - 1e-6 && v <= info.max + 1e-6;
}

export const reglerArt = {
  pruefeEin(K, t) {
    const info = REGLER.get(t.pfad);
    if (!info) return 'unbekannter_regler';
    if (info.nurHand && t.quelle !== 'andreas') return 'nur_hand';
    if (t.politik !== 0 && t.politik !== 1) return 'ausserhalb_bereich';
    if (t.form !== 0 && t.form !== 1) return 'ausserhalb_bereich';
    if (!(t.dauer >= 0) || !Number.isFinite(t.ab)) return 'ausserhalb_bereich';
    if (!bereichOk(info, t)) return 'ausserhalb_bereich';
    if (!K.mutation.has('i4_aus')) {
      for (const u of K.offeneTeile()) {
        if (u.art === 'regler' && u.pfad === t.pfad && ueberlappt({ ab: t.ab, dauer: t.dauer }, { ab: u.ab_eff, dauer: u.dauer_eff })) return 'ueberlappung';
      }
    }
    return null;
  },
  pruefeStart(K, t, s) {
    const r = K.r.get(t.pfad);
    if (r.halter === 'mensch') return 'regler_beim_menschen';
    if (t.quelle === 'cypher' && K.ki?.gestoppt) return 'ki_gestoppt';
    if (/^deck\/[1-4]\/stem\//.test(t.pfad)) {
      const d = K.decks?.[Number(t.pfad[5])];
      if (!d || d.status === 0 || !d.m?.mit_stems) return 'keine_stems';
    }
    return K.pruefeI3?.(t, s) ?? null;
  },
  start(K, t, s) {
    const r = K.r.get(t.pfad);
    t.vorher = { wert: r.wert, spur: r.spur, halter: r.halter, schalt: r.schalt };
    t.w0 = wertBei(K, t.pfad, s);
    if (t.dauer_eff <= 0) {
      // Schaltrampe des Setzens (§1.5, 192 Samples): für I1 zählt über sie der offenere von altem und neuem Wert
      // (Lesart n, Andreas 2026-09-25); der gemeldete Wert springt weiter am Ziel-Sample (F9)
      r.schalt = { alt: t.w0, bis: s + SCHALTRAMPE };
      r.wert = t.nach;
      r.spur = null;
      meldeRegler(K, t.pfad, s);
      return 'fertig';
    }
    r.spur = { w0: t.w0, nach: t.nach, ab: t.ab_eff, dauer: t.dauer_eff, form: t.form, db: REGLER.get(t.pfad).einheit === 'db', key: t.b.key };
    setzeHalter(K, t.pfad, haltername(t), s);
    meldeRegler(K, t.pfad, s);
    return 'laeuft';
  },
  rueck(K, t) {
    const r = K.r.get(t.pfad);
    Object.assign(r, { wert: t.vorher.wert, spur: t.vorher.spur, schalt: t.vorher.schalt });
    if (r.halter !== t.vorher.halter && r.halter !== 'mensch') setzeHalter(K, t.pfad, t.vorher.halter, K.stempel);
  },
  endeSample(K, t) {
    return llround(K.uhr.sample(t.ab_eff + t.dauer_eff));
  },
  ende(K, t, s) {
    const r = K.r.get(t.pfad);
    r.wert = t.nach;
    r.spur = null;
    if (r.halter !== 'mensch') setzeHalter(K, t.pfad, 'frei', s);
    meldeRegler(K, t.pfad, s);
  },
  abbruch(K, t, s) {
    const r = K.r.get(t.pfad);
    if (r.spur && r.spur.key === t.b.key) {
      r.wert = wertBei(K, t.pfad, s);
      r.spur = null;
      if (r.halter !== 'mensch') setzeHalter(K, t.pfad, 'frei', s);
      meldeRegler(K, t.pfad, s);
    }
  },
  // I2: Teil hält am Ist-Wert. Das Anhalten ist eine Änderung (die Rampe steht): /e/regler meldet den gehaltenen Wert
  // (§5.7), sonst sähe ein Läufer über UDP nur die letzte Meldung davor (gefunden 2026-09-23 mit echtzeit.mjs an
  // master_leer und b_verriegelt_a_laeuft_aus: −25,934 statt −25,985 dB).
  halte(K, t, s) {
    const r = K.r.get(t.pfad);
    if (r.spur && r.spur.key === t.b.key) {
      r.spur.halt = wertBei(K, t.pfad, s);
      meldeRegler(K, t.pfad, s);
    }
    t.haltWert = r.spur?.halt ?? r.wert;
  },
  // I2: Teil läuft weiter mit unverändertem Ende-Beat (ist das Ende vorbei: Schaltrampe)
  setzeFort(K, t, s) {
    const r = K.r.get(t.pfad);
    const beat = K.uhr.beat(s);
    const ende = t.ab_eff + t.dauer_eff;
    const von = t.setzenGehalten ? r.wert : r.spur?.key === t.b.key ? rampenWert(r.spur, beat) : t.haltWert;
    if (t.setzenGehalten || ende - beat <= 0) {
      r.wert = t.nach;
      r.spur = null;
      if (r.halter !== 'mensch') setzeHalter(K, t.pfad, 'frei', s);
      meldeRegler(K, t.pfad, s);
      return 'fertig';
    }
    r.spur = { w0: von, nach: t.nach, ab: beat, dauer: ende - beat, form: t.form, db: REGLER.get(t.pfad).einheit === 'db', key: t.b.key };
    meldeRegler(K, t.pfad, s);
    return 'laeuft';
  },
};

// Richtung eines Teils: öffnet oder schließt er (für I1, I2)
export function richtung(K, t) {
  const vorher = t.w0 ?? wertBei(K, t.pfad, K.stempel);
  if (t.nach > vorher) return 1;
  if (t.nach < vorher) return -1;
  return 0;
}

export default {
  name: 'regler',
  init(K) {
    K.r = new Map();
    for (const [pfad, info] of REGLER) K.r.set(pfad, { wert: info.vorgabe, halter: 'frei', spur: null, physisch: null, punkt: null, letzteHand: null, gemeldet: -Infinity, handGemeldet: -Infinity });
  },
  befehle: {
    '/k/teil': (K, a, b) => {
      K.einsortieren(K.teilNeu(b, a, 'regler', { pfad: a.pfad, nach: a.nach, form: a.form }));
    },
    '/k/abbruch': (K, a, b) => {
      K.sofort(b, (s) => {
        const nrn = a.teile === '*' ? null : new Set(a.teile.split(',').map((x) => Number(x.trim())));
        const ziel = K.offeneTeile().filter((t) => t.plan === a.plan && (nrn === null || nrn.has(t.teil)));
        for (const t of ziel) K.gruppeAbbrechen(t, s, 'abbruch');
        return null;
      });
    },
  },
  arten: { regler: reglerArt },
  ausgaben(K, s0) {
    for (const [pfad, r] of K.r) if (r.spur && r.spur.halt === undefined && s0 - r.gemeldet >= MELDE_ABSTAND) meldeRegler(K, pfad, s0);
  },
  schnappschuss(K, s) {
    const w = {};
    for (const pfad of K.r.keys()) w[pfad] = wertBei(K, pfad, s);
    return w;
  },
  kanal: kanalVon,
};

// Decks 1 bis 4 der Attrappe (SCHNITTSTELLEN §4.4, §5.5, §13): Material aus dem Arbeitsbestand (nur Metadaten, Größe
// und NaN-Stichprobe, kein Ton), Quellposition in Quell-Beats über einen Anker (Master-Beat ↔ Quell-Beat), Loop, Roll mit
// Schatten, Sprung, Hotcue phasentreu, Slip, Fassungstausch. Direktweg: Quell-Beats laufen 1:1 mit Master-Beats.

import fs from 'node:fs';
import path from 'node:path';
import { SR, llround } from './uhr.mjs';
import { meldeRegler } from './regler.mjs';
import { offen, sicht } from './pegel.mjs';

const LAEUFT = new Set([2, 3, 4, 5]);
export const laeuft = (d) => LAEUFT.has(d.status);
const RASTER = new Set([0.25, 1, 4, 16, 32]);  // 16 seit 2026-09-28 (Plan E9 D2, vier Takte)
const STEMS = ['drums', 'bass', 'vocals', 'other'];
const HALTER_BEATS = 32;
const VORLAUF_MS = (2 * 256 * 1000) / SR;       // §3: Direktweg 2 Zyklen

function neuesDeck(nr) {
  return { nr, status: 0, m: null, anker: { b: 0, q: 0 }, schatten: null, loop: null, roll: null, slip: false, hotcues: {}, hotcuesHand: {}, rueckfall: false, unterbunden: null, halterBis: null };
}

// hörbare Quellposition bei Master-Beat b
export function pos(d, b) {
  if (!laeuft(d)) return d.anker.q;
  if (d.roll) {
    const x = b - d.roll.ab;
    return d.roll.ls + (((x % d.roll.L) + d.roll.L) % d.roll.L);
  }
  const p = d.anker.q + (b - d.anker.b);
  if (d.loop && p >= d.loop.ls + d.loop.L) return d.loop.ls + ((p - d.loop.ls) % d.loop.L);
  return p;
}

// Master-Beat, an dem das Material endet (nur ohne Loop und Roll)
export function endeBeat(d) {
  return d.anker.b + (d.m.Q - d.anker.q);
}

const frac = (x) => x - Math.floor(x);
const wrap = (x) => x - Math.floor(x + 0.5);          // nach [−0,5; 0,5)

export function hotcueZiel(p, hc) {
  return hc + wrap(frac(p) - frac(hc));
}

// Ziel-Quellposition eines Deck-Teils (für I3d)
export function zielQuellBeat(K, t, beat) {
  const d = K.decks[t.deck];
  if (t.aktion === 'start') return t.quell_beat;
  if (t.aktion === 'sprung') return pos(d, beat) + t.delta;
  if (t.aktion === 'hotcue') {
    const hc = d.hotcues[t.nr];
    return hc === undefined ? NaN : hotcueZiel(pos(d, beat), hc);
  }
  return pos(d, beat);
}

export function inhaltVon(material_id, basis_bpm, fassung) {
  return `${material_id}/${Math.round(basis_bpm * 1000)}_r${fassung}`;
}

// Lader: Fassung aus dem Arbeitsbestand prüfen (§4.4, §13.2), ohne Ton zu lesen außer der NaN-Stichprobe
export function lesefassung(K, material_id, basis_bpm, fassung, mit_stems) {
  const dir = path.join(K.cfg.arbeitsbestand, material_id, 'fassungen', `${Math.round(basis_bpm * 1000)}_r${fassung}`);
  const fj = path.join(dir, 'fassung.json');
  if (!fs.existsSync(fj)) return { grund: 'material_fehlt' };
  let j;
  try { j = JSON.parse(fs.readFileSync(fj, 'utf8')); } catch { return { grund: 'pruefung' }; }
  if (j.material_id !== material_id || j.basis_bpm !== basis_bpm || j.fassung !== fassung || !Number.isInteger(j.frames)) return { grund: 'pruefung' };
  if ((j.analyse_quelle ?? 'basis') !== (mit_stems ? 'stems' : 'basis')) return { grund: 'pruefung' };
  const dateien = mit_stems ? STEMS.map((n) => path.join(dir, j.stems?.[n]?.datei ?? `stems/${n}.f32`)) : [path.join(dir, j.datei ?? 'basis.f32')];
  let bytes = 0;
  for (const f of dateien) {
    if (!fs.existsSync(f)) return { grund: 'material_fehlt' };
    const groesse = fs.statSync(f).size;
    if (groesse !== j.frames * 8) return { grund: 'pruefung' };
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(Math.min(groesse, 4096 * 8));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (let o = 0; o + 4 <= buf.length; o += 4) if (Number.isNaN(buf.readFloatLE(o))) return { grund: 'pruefung' };
    bytes += groesse;
  }
  const hotcues = {};
  for (const h of j.hotcues ?? []) if (Number.isInteger(h.nr) && Number.isFinite(h.quell_beat)) hotcues[h.nr] = h.quell_beat;
  return {
    info: {
      material_id, basis_bpm, fassung, mit_stems, frames: j.frames, bytes, hotcues,
      e: j.erste_eins_quell_beat ?? 0,
      Q: ((j.frames - (j.erster_schlag_frame ?? 0)) * basis_bpm) / (60 * SR),
      lufs: j.lautheit?.lufs_integriert ?? K.cfg.ziel_lufs,
      schuesse: j.schuesse ?? [],
      inhalt: inhaltVon(material_id, basis_bpm, fassung),
    },
  };
}

function deckHalterMensch(K, d, beat) {
  return d.halterBis !== null && beat < d.halterBis;
}

// Rückfall lösen: jeder Griff oder Befehl an diesem Deck (§17); der Loop bleibt als gewöhnlicher Loop stehen
export function loese(K, d, s) {
  if (!d.rueckfall) return;
  d.rueckfall = false;
  if (d.status === 5) d.status = d.loop ? 3 : 2;
  if (K.leds) K.leds.rueckfall = K.decks.some((x) => x?.rueckfall) ? 1 : 0;
  K.aus('/e/rueckfall', [d.nr, 0, d.loop?.ls ?? NaN, d.loop?.L ?? 0, K.uhr.beat(s), BigInt(s)]);
}

export function starteDeck(K, d, b, q) {
  d.anker = { b, q };
  d.status = 2;
  d.loop = null;
  d.roll = null;
  d.schatten = null;
  d.rueckfall = false;
}

export function stoppeDeck(K, d, b, quelle) {
  d.anker = { b, q: pos(d, b) };
  d.status = 1;
  d.loop = null;
  d.roll = null;
  d.schatten = null;
  if (quelle === 'andreas') d.unterbunden = d.m.inhalt;
}

const deckArt = {
  pruefeEin(K, t) {
    if (!(t.deck >= 1 && t.deck <= 4)) return 'unbekanntes_deck';
    const erlaubt = t.aktion === 'start' || t.aktion === 'stopp' || t.aktion === 'basis_tausch' ? [0, 1] : [0, 1, 2];
    if (!erlaubt.includes(t.politik)) return 'ausserhalb_bereich';
    if (t.politik === 2 && !RASTER.has(t.raster)) return 'ausserhalb_bereich';
    if ((t.aktion === 'loop' || t.aktion === 'roll') && !(t.laenge === 0 || (t.laenge >= 1 / 32 && t.laenge <= 128))) return 'ausserhalb_bereich';
    if (t.aktion === 'roll' && t.rollArt !== 0 && t.rollArt !== 1) return 'ausserhalb_bereich';
    if (t.aktion === 'roll' && t.rollArt === 1) return 'kein_stretcher';
    if (t.aktion === 'hotcue' && !(t.nr >= 1 && t.nr <= 8)) return 'ausserhalb_bereich';
    if (t.aktion === 'start' && !Number.isFinite(t.quell_beat)) return 'ausserhalb_bereich';
    if (t.quelle === 'cypher' && deckHalterMensch(K, K.decks[t.deck], K.uhr.beat(K.jetzt))) return 'deck_beruehrt';
    return null;
  },
  pruefeStart(K, t, s) {
    const d = K.decks[t.deck];
    const beat = K.uhr.beat(s);
    if (d.status === 0) return 'nicht_geladen';
    if (t.quelle === 'cypher' && deckHalterMensch(K, d, beat)) return 'deck_beruehrt';
    if (t.quelle === 'cypher' && K.ki?.gestoppt) return 'ki_gestoppt';
    if (t.aktion === 'start' && Math.abs(K.uhr.bpm(s) / d.m.basis_bpm - 1) >= 1e-6) return 'kein_stretcher';
    if (t.aktion === 'hotcue' && d.hotcues[t.nr] === undefined) return 'ausserhalb_bereich';
    if (t.aktion === 'basis_tausch') {
      const r = lesefassung(K, d.m.material_id, t.basis_bpm, t.fassung, d.m.mit_stems);
      if (r.grund) return r.grund;
      t.neu = r.info;
    }
    if (t.aktion === 'stopp' && t.i2warten && !K.mutation.has('i2_aus')) {
      const v = sicht(K, s);
      const andere = K.hoerbarOhne?.(v, `deck/${t.deck}`);
      if (andere === false) return 'warten';
    }
    return K.pruefeI3?.(t, s) ?? null;
  },
  start(K, t, s) {
    const d = K.decks[t.deck];
    const b = s === llround(K.uhr.sample(t.ab_eff)) ? t.ab_eff : K.uhr.beat(s);
    t.vorher = { ...structuredClone({ ...d, m: null }), m: d.m };
    loese(K, d, s);
    if (t.aktion === 'start') starteDeck(K, d, b, t.quell_beat);
    else if (t.aktion === 'stopp') stoppeDeck(K, d, b, t.quelle);
    else if (t.aktion === 'loop') {
      if (t.laenge > 0) {
        const p = pos(d, b);
        if (d.slip && !d.schatten) d.schatten = { ...d.anker };
        d.anker = { b, q: p };
        d.loop = { ls: p, L: t.laenge };
        if (laeuft(d)) d.status = d.roll ? 4 : 3;
      } else if (d.loop) {
        if (d.slip && d.schatten) { d.anker = d.schatten; d.schatten = null; } else d.anker = { b, q: pos(d, b) };
        d.loop = null;
        if (laeuft(d)) d.status = d.roll ? 4 : 2;
      }
    } else if (t.aktion === 'roll') {
      if (t.laenge > 0) {
        d.roll = { ab: b, ls: pos(d, b), L: t.laenge };
        if (laeuft(d)) d.status = 4;
      } else if (d.roll) {
        d.roll = null;
        if (laeuft(d)) d.status = d.loop ? 3 : 2;
      }
    } else if (t.aktion === 'sprung') {
      if (d.slip && !d.schatten) d.schatten = { ...d.anker };
      if (d.loop) {
        d.loop = { ls: d.loop.ls + t.delta, L: d.loop.L };
        d.anker = { b: d.anker.b, q: d.anker.q + t.delta };
      } else d.anker = { b, q: pos(d, b) + t.delta };
    } else if (t.aktion === 'hotcue') {
      if (d.slip && !d.schatten) d.schatten = { ...d.anker };
      d.anker = { b, q: laeuft(d) ? hotcueZiel(pos(d, b), d.hotcues[t.nr]) : d.hotcues[t.nr] };   // stehend genau (2026-09-28)
      d.loop = null;
      if (laeuft(d)) d.status = d.roll ? 4 : 2;
    } else if (t.aktion === 'basis_tausch') {
      d.m = t.neu;
      d.hotcues = { ...t.neu.hotcues, ...d.hotcuesHand };
    }
    return 'fertig';
  },
  rueck(K, t) {
    const d = K.decks[t.deck];
    Object.assign(d, t.vorher);
  },
};

function deckTeil(aktion, extra) {
  return (K, a, b) => {
    K.einsortieren(K.teilNeu(b, a, 'deck', { deck: a.deck, aktion, ...extra(a) }));
  };
}

export default {
  name: 'decks',
  init(K) {
    K.decks = [null, 1, 2, 3, 4].map((n) => (n ? neuesDeck(n) : null));
  },
  befehle: {
    '/k/deck/laden': (K, a, b) => {
      if (!(a.deck >= 1 && a.deck <= 4)) return K.q(b, 6, 'unbekanntes_deck');
      if (a.mit_stems !== 0 && a.mit_stems !== 1) return K.q(b, 6, 'ausserhalb_bereich');
      const r = lesefassung(K, a.material_id, a.basis_bpm, a.fassung, a.mit_stems);
      if (r.grund) return K.q(b, 6, r.grund);
      const belegt = K.decks.reduce((x, d) => x + (d?.m && d.nr !== a.deck ? d.m.bytes : 0), 0);
      if (belegt + r.info.bytes > K.cfg.speicher_budget_mib * 1024 * 1024) return K.q(b, 6, 'budget_speicher');
      K.sofort(b, (s) => {
        const d = K.decks[a.deck];
        if (K.decks[a.deck]?.status >= 2 && offen(K, sicht(K, s), `deck/${a.deck}`)) return 'deck_hoerbar';  // §4.4: nur laufend und offen (2026-09-27)
        Object.assign(d, neuesDeck(a.deck), { m: r.info, status: 1, hotcues: { ...r.info.hotcues }, hotcuesHand: {}, anker: { b: K.uhr.beat(s), q: 0 }, halterBis: d.halterBis });
        const k = `deck/${a.deck}`;
        for (const [p, w] of [[`${k}/fader`, -200], [`${k}/pfl`, 0], [`${k}/trim`, Math.max(-24, Math.min(24, K.cfg.ziel_lufs - r.info.lufs))]]) {
          const reg = K.r.get(p);
          reg.wert = w;
          reg.spur = null;
          meldeRegler(K, p, s);
        }
        K.aus('/e/geladen', [a.deck, a.material_id, a.basis_bpm, a.fassung, a.mit_stems, BigInt(s)]);
        return null;
      });
    },
    '/k/deck/entladen': (K, a, b) => {
      if (!(a.deck >= 1 && a.deck <= 4)) return K.q(b, 6, 'unbekanntes_deck');
      K.sofort(b, (s) => {
        if (K.decks[a.deck]?.status >= 2 && offen(K, sicht(K, s), `deck/${a.deck}`)) return 'deck_hoerbar';  // §4.4: nur laufend und offen (2026-09-27)
        const halter = K.decks[a.deck].halterBis;
        K.decks[a.deck] = Object.assign(neuesDeck(a.deck), { halterBis: halter });
        return null;
      });
    },
    '/k/deck/start': deckTeil('start', (a) => ({ quell_beat: a.quell_beat })),
    '/k/deck/stopp': deckTeil('stopp', () => ({})),
    '/k/deck/loop': deckTeil('loop', (a) => ({ laenge: a.laenge_beats })),
    '/k/deck/roll': deckTeil('roll', (a) => ({ laenge: a.laenge_beats, rollArt: a.art })),
    '/k/deck/sprung': deckTeil('sprung', (a) => ({ delta: a.delta_beats })),
    '/k/deck/hotcue': deckTeil('hotcue', (a) => ({ nr: a.nr })),
    '/k/deck/basis_tausch': (K, a, b) => {
      K.einsortieren(K.teilNeu(b, { ...a, politik: 1 }, 'deck', { deck: a.deck, aktion: 'basis_tausch', basis_bpm: a.basis_bpm, fassung: a.fassung }));
    },
    '/k/deck/hotcue_setzen': (K, a, b) => {
      if (!(a.deck >= 1 && a.deck <= 4)) return K.q(b, 6, 'unbekanntes_deck');
      if (!(a.nr >= 1 && a.nr <= 8)) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, (s) => {
        const d = K.decks[a.deck];
        if (d.status === 0) return 'nicht_geladen';
        if (Number.isNaN(a.quell_beat)) { delete d.hotcues[a.nr]; delete d.hotcuesHand[a.nr]; }
        else { d.hotcues[a.nr] = a.quell_beat; d.hotcuesHand[a.nr] = a.quell_beat; }
        K.aus('/e/hotcue', [a.deck, d.m.material_id, a.nr, a.quell_beat, BigInt(s)]);
        return null;
      });
    },
    // Plan Grid: Raster-Versatz der geladenen Fassung (Frames). Die Attrappe rechnet in Quell-Beats; der Quell-Beat unter
    // dem Kopf bleibt (D1), darum ändert sich an anker nichts. /e/raster trägt die Änderung in ms.
    '/k/deck/raster': (K, a, b) => {
      if (!(a.deck >= 1 && a.deck <= 4)) return K.q(b, 6, 'unbekanntes_deck');
      if (!(Number.isInteger(a.versatz_frames) && Math.abs(a.versatz_frames) <= 192000)) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, (s) => {
        const d = K.decks[a.deck];
        if (d.status === 0 || d.m.material_id !== a.material_id || d.m.basis_bpm !== a.basis_bpm || d.m.fassung !== a.fassung) return 'nicht_geladen';
        const alt = d.raster ?? 0;
        d.raster = a.versatz_frames;
        K.aus('/e/raster', [a.deck, d.m.material_id, pos(d, K.uhr.beat(s)), (a.versatz_frames - alt) / 48, BigInt(s)]);
        return null;
      });
    },
    '/k/deck/slip': (K, a, b) => {
      if (!(a.deck >= 1 && a.deck <= 4)) return K.q(b, 6, 'unbekanntes_deck');
      K.sofort(b, () => {
        const d = K.decks[a.deck];
        d.slip = a.an === 1;
        if (!d.slip && d.schatten) { d.anker = d.schatten; d.schatten = null; d.loop = null; if (laeuft(d)) d.status = d.roll ? 4 : 2; }
        return null;
      });
    },
  },
  arten: { deck: deckArt },
  punkte(K, s0, s1) {
    const p = [];
    for (const d of K.decks) {
      if (!d || !d.m) continue;
      if (laeuft(d) && !d.loop && !d.roll) {
        let s = llround(K.uhr.sample(endeBeat(d)));
        if (s < s1) {
          if (s < s0) s = s0;
          p.push({ s, prio: 3, seq: 0, tu: () => { if (laeuft(d) && !d.loop && !d.roll) { d.anker = { b: endeBeat(d), q: d.m.Q }; d.status = 1; } } });
        }
      }
      if (d.halterBis !== null) {
        const s = llround(K.uhr.sample(d.halterBis));
        if (s < s1) p.push({ s: Math.max(s, s0), prio: 3, seq: 0, tu: () => { d.halterBis = null; K.aus('/e/halter', [`deck/${d.nr}/transport`, 'frei', BigInt(Math.max(s, s0)), K.uhr.beat(Math.max(s, s0))]); } });
      }
    }
    return p;
  },
  ausgaben(K, s0, s1) {
    if (Math.floor((s1 - 1) / 960) === Math.floor((s0 - 1) / 960)) return;
    const b = K.uhr.beat(s0);
    for (const d of K.decks) {
      if (!d || !d.m) continue;
      const p = pos(d, b);
      K.aus('/zustand/deck', [d.nr, d.status, d.m.material_id, d.m.basis_bpm, d.m.fassung, p, d.loop || d.roll ? Infinity : d.m.Q - p,
        K.uhr.bpm(s0) / d.m.basis_bpm, VORLAUF_MS, 0, -1, 0]);
    }
    if (Math.floor((s1 - 1) / 2400) !== Math.floor((s0 - 1) / 2400)) {
      for (const d of K.decks) if (d?.m) K.aus('/pegel', [`deck/${d.nr}`, -200, -200, -200, -200, -200, -200, -200]);
      K.aus('/pegel', ['master', -200, -200, -200, -200, -200, -200, -200]);
      K.aus('/pegel', ['cue', -200, -200, -200, -200, -200, -200, -200]);
    }
  },
  schnappschuss(K, s) {
    const w = {};
    const b = K.uhr.beat(s);
    for (const d of K.decks) {
      if (!d) continue;
      const p = pos(d, b);
      w[`deck/${d.nr}/status`] = d.status;
      w[`deck/${d.nr}/quell_beat`] = p;
      if (d.m) {
        w[`deck/${d.nr}/beats_bis_ende`] = d.loop || d.roll ? Infinity : d.m.Q - p;
        w[`deck/${d.nr}/faktor`] = K.uhr.bpm(s) / d.m.basis_bpm;
      }
    }
    return w;
  },
  // Deck-Halter: jede Transport-Taste setzt deck/<n>/transport für 32 Beats auf mensch (§7.3 Punkt 5)
  setzeDeckHalter(K, n, s) {
    const d = K.decks[n];
    const war = d.halterBis !== null;
    d.halterBis = K.uhr.beat(s) + HALTER_BEATS;
    if (!war) K.aus('/e/halter', [`deck/${n}/transport`, 'mensch', BigInt(s), K.uhr.beat(s)]);
  },
};

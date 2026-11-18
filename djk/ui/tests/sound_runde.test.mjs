import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  merkmale, wirkung, kosinus, schluesselVon, kandidaten, annehmbar, auffuellen, zahlText, platzA, bauePlatz,
  aufgeloest, stammbaumNachWahl, stammbaumZurueck, wegVon, wortFrei, stufenWerte, weiter, ausgleichDb,
} from '../project/sound_runde.ts';
import {
  pruefeStammbaum, STAMM_MAX_KNOTEN, SKALA, WORTE, WORT_MIN, MERKMALE, RUNGEN, MAX_STUFEN_KNOPF, START_RUNGE, UEBERSCHUSS,
} from '../project/sound_runde_contract.ts';
import { ZWOELFTEL_HZ } from '../project/sound_contract.ts';

const NULL = { hell: 0, sub: 0, hoehen: 0, bewegung: 0, fuelle: 0, breite: 0, punch: 0, pegel: 0 };
const mit = (o) => ({ ...NULL, ...o });

// A hand-made measurement: `band` gets `db`, every other band -120 dB; `terz` is spalten x 30 cells.
function messung({ band = null, db = 0, spalten = 4, terz = null, breite = 0, rms = -12, crest = 9, stumm = false } = {}) {
  const mittel = ZWOELFTEL_HZ.map((_, i) => (i === band ? db : -120));
  const spaltenTerz = new Float32Array(spalten * 30);
  for (let c = 0; c < spalten; c++) for (let j = 0; j < 30; j++) spaltenTerz[c * 30 + j] = terz ? terz(c, j) : -20;
  return {
    stumm, spitze_db: -3, rms_db: rms, crest_db: crest,
    stereo: { korrelation: 1, korrelation_min: 1, breite_db: breite, baender: [] },
    spektrum: { hz: [...ZWOELFTEL_HZ], mittel_db: mittel, max_db: mittel },
    zeitbild: { spalten, zeilen: 30, sek_je_spalte: 0.1, db_min: -90, db_max: 0, daten: '' },
    spaltenTerz, spalten,
  };
}
const nah = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('a pure sine band gives its log2 frequency as brightness', () => {
  for (const i of [30, 53, 90]) nah(merkmale(messung({ band: i })).hell, Math.log2(ZWOELFTEL_HZ[i]));
});

test('sub and high shares', () => {
  const sub = merkmale(messung({ band: 20 }));   // about 33 Hz
  assert.ok(ZWOELFTEL_HZ[20] < 100);
  nah(sub.sub, 0);
  assert.equal(sub.hoehen, -60);
  const hoch = merkmale(messung({ band: 100 }));
  nah(hoch.hoehen, 0);
  assert.equal(hoch.sub, -60);
  const m = messung({});
  m.spektrum.mittel_db = ZWOELFTEL_HZ.map((hz) => (hz < 100 ? 0 : -120));
  m.spektrum.mittel_db[100] = -3.0103;   // half the power of the sub band above 4 kHz
  const nSub = ZWOELFTEL_HZ.filter((hz) => hz < 100).length;
  nah(merkmale(m).sub, 10 * Math.log10(nSub / (nSub + 0.5)), 1e-3);
  nah(merkmale(m).hoehen, 10 * Math.log10(0.5 / (nSub + 0.5)), 1e-3);
});

test('a steady picture has no movement and full length, an on/off picture has half length and no movement either', () => {
  const steady = merkmale(messung({ spalten: 8 }));
  assert.equal(steady.bewegung, 0);
  nah(steady.fuelle, 0, 1e-6);
  // the same timbre switched on and off: it only changes its level, so it does not move
  const onoff = merkmale(messung({ spalten: 8, terz: (c) => (c % 2 === 0 ? -20 : -80) }));
  assert.equal(onoff.bewegung, 0);
  nah(onoff.fuelle, 10 * Math.log10(0.5), 0.01);   // sounds half of the time: -3 dB
  assert.equal(merkmale(messung({ spalten: 1 })).bewegung, 0);
});

test('movement is the change of the timbre: a fading sound does not move, a sweeping one does', () => {
  // all bands fall by 6 dB per column: the shape stays, nothing moves
  nah(merkmale(messung({ spalten: 6, terz: (c) => -20 - 6 * c })).bewegung, 0, 1e-6);
  // the energy walks from band 5 to band 10 at the same level: two bands change by their full depth (floor 40 dB under the column level)
  const sweep = merkmale(messung({ spalten: 2, terz: (c, j) => (j === (c === 0 ? 5 : 10) ? -20 : -200) }));
  nah(sweep.bewegung, 40, 1e-6);   // the two bands that count each move by 40 dB; the silent ones are not counted
  // a column more than 40 dB below the loudest one is not looked at
  const leise = merkmale(messung({ spalten: 2, terz: (c, j) => (c === 0 ? -20 : (j === 3 ? -90 : -200)) }));
  assert.equal(leise.bewegung, 0);
});

test('a silent measurement has the fixed vector', () => {
  assert.deepEqual(merkmale(messung({ stumm: true, band: 50 })),
    { hell: 0, sub: -60, hoehen: -60, bewegung: 0, fuelle: -40, breite: -40, punch: 0, pegel: -200 });
});

test('stereo width is limited, crest and level are taken over', () => {
  assert.equal(merkmale(messung({ breite: -90 })).breite, -40);
  assert.equal(merkmale(messung({ breite: 30 })).breite, 12);
  const m = merkmale(messung({ breite: 2, rms: -14, crest: 7 }));
  assert.equal(m.breite, 2); assert.equal(m.punch, 7); assert.equal(m.pegel, -14);
});

test('effect, strength, leading feature and word ignore the level', () => {
  const a = mit({ hell: 8, pegel: -12 });
  const w = wirkung(a, mit({ hell: 8 + SKALA.hell * 2, pegel: -2, punch: -SKALA.punch }));
  nah(w.e.hell, 2); nah(w.e.punch, -1); nah(w.e.pegel, 10 / SKALA.pegel);
  nah(w.staerke, Math.sqrt(5));
  assert.equal(w.fuehrend, 'hell');
  assert.equal(w.wort, WORTE.hell[0]);
  const f = wirkung(a, mit({ hell: 8, pegel: 30, sub: -SKALA.sub * 3 }));
  assert.equal(f.fuehrend, 'sub'); assert.equal(f.wort, WORTE.sub[1]);
  assert.equal(wirkung(a, mit({ hell: 8, pegel: 40 })).staerke, 0);
});

test('cosine ignores the level and is 0 for a zero vector', () => {
  nah(kosinus(mit({ hell: 1 }), mit({ hell: 2 })), 1);
  nah(kosinus(mit({ hell: 1 }), mit({ sub: 1 })), 0);
  nah(kosinus(mit({ hell: 1 }), mit({ hell: -1 })), -1);
  nah(kosinus(mit({ pegel: 5, hell: 1 }), mit({ pegel: -5, hell: 1 })), 1);
  assert.equal(kosinus(NULL, mit({ hell: 1 })), 0);
  assert.equal(kosinus(mit({ pegel: 4 }), mit({ hell: 1 })), 0);
});

const TABELLE = ['a', 'b', 'c', 'd'].map((n, i) => ({ name: `k${i + 1}`, vorgabe: 0.5 }));
const leer = { gesperrt: new Set(), nicht: new Set(), vorwissen: new Map(), versatz: 0 };
const keys = (l) => l.map(schluesselVon);

const SCHW = { schwelle: 2 };

test('stufenWerte clamps, dedupes and ends at the range end', () => {
  assert.deepEqual(RUNGEN, [0.18, 0.35, 0.6, 1]);
  assert.deepEqual(stufenWerte(0.5, -1).map((x) => x.wert), [0.32, 0.15, 0]);
  assert.deepEqual(stufenWerte(0.5, -1).map((x) => x.weg), [0.18, 0.35, 0.5]);
  assert.deepEqual(stufenWerte(0.9, 1), [{ wert: 1, weg: 0.1, stufe: 0 }]);
  assert.deepEqual(stufenWerte(0.95, 1), [], 'a move of less than 0.09 is dropped, the edge only goes inward');
  assert.deepEqual(stufenWerte(0.2, 1).map((x) => x.wert), [0.38, 0.55, 0.8, 1]);
  assert.deepEqual(stufenWerte(0.2, 1).map((x) => x.stufe), [0, 1, 2, 3]);
  assert.equal(stufenWerte(1, -1).at(-1).wert, 0);
});

test('candidates: both directions, the edge only inward, locked and excluded keys are skipped, the first try is the start rung', () => {
  const o = { ...leer, ...SCHW, tabelle: TABELLE, werte: { k1: 1, k2: 0, k3: 0.95 } };
  const l = kandidaten(o);
  // k1 at 1: down only; k2 at 0: up only; k3 at 0.95: down only (up leaves 0.05 < 0.09); k4 default 0.5: both
  // order: first one direction per knob (up, down, up, down along the table), then the other direction
  assert.equal(START_RUNGE, 1);
  assert.deepEqual(keys(l), ['k4-', 'k1-', 'k2+', 'k3-', 'k4+']);
  assert.deepEqual(l.map((k) => k.wert), [0.15, 0.65, 0.35, 0.6, 0.85]);
  assert.deepEqual(l.map((k) => [k.jetzt, k.weg, k.versuch]), [[0.5, 0.35, 1], [1, 0.35, 1], [0, 0.35, 1], [0.95, 0.35, 1], [0.5, 0.35, 1]]);
  assert.deepEqual(keys(kandidaten({ ...o, gesperrt: new Set(['k2']), nicht: new Set(['k1-', 'k4+']) })), ['k4-', 'k3-']);
  assert.equal(kandidaten({ ...o, tabelle: [] }).length, 0);
});

test('candidates keep a move of exactly half a step of room', () => {
  const l = kandidaten({ ...leer, ...SCHW, tabelle: [{ name: 'k1', vorgabe: 0.5 }], werte: { k1: 0.91 } });
  assert.deepEqual(l.map((k) => [schluesselVon(k), k.wert]), [['k1+', 1], ['k1-', 0.56]]);
});

test('candidate order: known strong first, unknown next in rotated table order, known weak last', () => {
  const vorwissen = new Map([['k3-', 30], ['k2+', 3]]);
  const l = kandidaten({ ...leer, ...SCHW, tabelle: TABELLE, werte: {}, vorwissen, versatz: 6 });   // 6 mod 4 = 2: k3 is first in the table order
  assert.deepEqual(keys(l), ['k3-', 'k3+', 'k4-', 'k1+', 'k2-', 'k4+', 'k1-', 'k2+']);
  assert.deepEqual(keys(kandidaten({ ...leer, ...SCHW, tabelle: TABELLE, werte: {} })).slice(0, 3), ['k1+', 'k2-', 'k3+']);
});

test('candidates start at the predicted rung from the remembered sensitivity (D per travel), at the start rung without, and skip hopeless keys', () => {
  const t = [{ name: 'k1', vorgabe: 0.5 }];
  const wert = (vorwissen, richtung = 1) => kandidaten({ ...leer, ...SCHW, tabelle: t, werte: {}, vorwissen })
    .find((k) => k.richtung === richtung)?.wert;
  assert.equal(wert(new Map()), 0.85, 'unknown: rung 1 (0.35 of the travel)');
  assert.equal(wert(new Map([['k1+', 30]])), 0.59, 'very sensitive: narrower than the smallest rung (5.4 is over 1.5 x the target), the least move 0.09');
  assert.equal(wert(new Map([['k1+', 15]])), 0.68, 'sensitive: the smallest rung predicted to reach D 2 (15 * 0.18 = 2.7, within 1.5 x the target)');
  assert.equal(wert(new Map([['k1+', 6]])), 0.85, '6 * 0.18 = 1.08 is not enough, 6 * 0.35 = 2.1 is');
  assert.equal(wert(new Map([['k1+', 3.5]])), 1, 'only the range end is predicted to reach it (3.5 * 0.5 = 1.75 is under 2 but over half of it)');
  assert.equal(wert(new Map([['k1+', 1]])), undefined, 'predicted at the range end under half of the target: not listed');
  assert.equal(wert(new Map([['k1+', 1]]), -1), 0.15, 'the other direction of the key is not affected');
});

test('weiter: the next rung of the same key, null when reached, at three tries, at the range end or when hopeless', () => {
  const k0 = (extra = {}) => ({ ...kandidaten({ ...leer, ...SCHW, tabelle: [{ name: 'k1', vorgabe: 0.2 }], werte: {}, vorwissen: new Map() })[0],
    ...extra });
  const mess = (k, d, e = {}) => ({ ...k, merkmale: NULL, e: mit(e), staerke: d, wort: 'x' });
  const t1 = mess(k0(), 1);                       // first try 0.55 (the start rung, 0.35 of the travel)
  assert.equal(t1.versuch, 1);
  const t2 = weiter(t1, 2);
  assert.ok(t2 && t2.versuch === 2 && t2.wert > t1.wert && t2.weg > t1.weg && t2.jetzt === 0.2 && t2.param === 'k1' && t2.richtung === 1);
  assert.equal(weiter(mess(k0(), 2), 2), null, 'reached');
  const t3 = weiter(mess(t2, 1), 2);
  assert.ok(t3 && t3.versuch === 3 && t3.wert === 1 && t3.weg === 0.8, 'the third try is the range end');
  assert.equal(weiter(mess(t3, 1), 2), null, 'at three tries');
  assert.equal(weiter(mess({ ...k0(), wert: 1, weg: 0.8, versuch: 1 }, 1), 2), null, 'the range end was the try');
  assert.equal(t1.wert, 0.55);
  assert.equal(weiter(mess(k0(), 1, { pegel: -20 }), 2), null, 'a try far quieter than A: wider is no better');
  assert.equal(MAX_STUFEN_KNOPF, 3);
});

test('the third try is the range end even when the first rung was the smallest (0.18, 0.35, then 1.0, never 0.6)', () => {
  const k = kandidaten({ ...leer, ...SCHW, tabelle: [{ name: 'k1', vorgabe: 0.2 }], werte: {}, vorwissen: new Map([['k1+', 12]]) })[0];
  assert.deepEqual([k.wert, k.versuch], [0.38, 1]);
  const mess = (c) => ({ ...c, merkmale: NULL, e: NULL, staerke: 0.1, wort: 'x' });
  const k2 = weiter(mess(k), 2), k3 = weiter(mess(k2), 2);
  assert.deepEqual([k2.wert, k2.versuch], [0.55, 2]);
  assert.deepEqual([k3.wert, k3.versuch], [1, 3]);
  assert.equal(weiter(mess(k3), 2), null);
});

test('weiter narrows a try that overshoots the target (D over UEBERSCHUSS x target), so a sensitive knob does not give the same place at every level', () => {
  const k = { ...kandidaten({ ...leer, ...SCHW, tabelle: [{ name: 'k1', vorgabe: 0.2 }], werte: {}, vorwissen: new Map() })[0] };
  const mess = (c, d) => ({ ...c, merkmale: NULL, e: mit({ hell: 1 }), staerke: d, wort: 'x' });
  assert.equal(k.weg, 0.35);
  assert.equal(weiter(mess(k, UEBERSCHUSS * 2), 2), null, 'at the bound itself: it is a place');
  const n = weiter(mess(k, 5.98), 1);   // the finding: D 5.98 at 0.35, subtle target 1 -> aim 1.2 at 0.35 * 1.2 / 5.98 (under MIN_WEG: 0.09)
  assert.ok(n && n.versuch === 2 && n.weg === 0.09 && n.wert === 0.29 && n.jetzt === 0.2 && n.richtung === 1, JSON.stringify(n));
  const m = weiter(mess(k, 5.98), 2);
  assert.ok(m && m.weg < k.weg && m.weg > 0.09, `clear: ${JSON.stringify(m)}`);
  assert.equal(weiter(mess(k, 5.98), 4.5), null, 'a target of 4.5: 5.98 is within 1.5 x 4.5, it is a place');
  const w = weiter({ ...mess({ ...k, weg: 0.09, wert: 0.29, versuch: 2 }, 0.5), e: mit({ hell: 1 }) }, 1);   // a narrowed try under the target: aims again
  assert.ok(w && w.versuch === 3 && w.weg > 0.09 && w.weg < 0.35, `widen again: ${JSON.stringify(w)}`);
  assert.equal(weiter(mess({ ...k, weg: 0.09, wert: 0.29 }, 5), 1), null, 'already at the smallest move: nothing narrower');
  assert.equal(weiter(mess({ ...k, versuch: 3 }, 5.98), 1), null, 'at three tries');
});

const gem = (param, richtung, e, extra = {}) => {
  const w = wirkung(NULL, mit(e));
  return { param, richtung, wert: 0.5, merkmale: mit(e), e: w.e, staerke: w.staerke, wort: w.wort, ...extra };
};

test('acceptance refuses the inaudible, the same knob and the same direction of effect', () => {
  const a = gem('k1', 1, { hell: SKALA.hell * 2 });
  assert.equal(typeof annehmbar(a, [], 1), 'string');
  assert.equal(annehmbar(gem('k2', 1, { hell: SKALA.hell * 0.5 }), [], 1), null);   // strength 0.5
  assert.equal(annehmbar(gem('k1', -1, { sub: SKALA.sub * 2 }), [a], 1), null);      // same knob
  assert.equal(annehmbar(gem('k2', 1, { hell: SKALA.hell * 3 }), [a], 1), null);     // same direction
  assert.equal(typeof annehmbar(gem('k3', 1, { sub: SKALA.sub * 2 }), [a], 1), 'string');
  assert.equal(typeof annehmbar(gem('k4', 1, { hell: -SKALA.hell * 3 }), [a], 1), 'string');     // opposite direction is fine
});

test('a silent or far quieter candidate is no variant, neither accepted nor filled up', () => {
  const leise = gem('k5', -1, { hell: -SKALA.hell * 40, pegel: -25 });
  assert.equal(annehmbar(leise, [], 1), null);
  assert.deepEqual(auffuellen([leise], [], 1), []);
  assert.equal(typeof annehmbar(gem('k5', -1, { hell: -SKALA.hell * 4, pegel: -6 }), [], 1), 'string');   // quieter, but still a sound
});

const eVon = (m) => wirkung(NULL, mit(m)).e;

test('wortFrei: the second "fewer highs" gets its next strong feature', () => {
  const e1 = eVon({ hoehen: -SKALA.hoehen * 2.4 }), e2 = eVon({ hoehen: -SKALA.hoehen * 2, hell: -SKALA.hell * 1.2 });
  assert.equal(wortFrei(e1, new Set()), 'fewer highs');
  assert.equal(wortFrei(e2, new Set(['fewer highs'])), 'darker');
  assert.equal(wortFrei(e2, new Set()), 'fewer highs');
});

test('wortFrei: null when no other feature is clearly present, and a feature under WORT_MIN never names', () => {
  assert.equal(wortFrei(eVon({ hoehen: -SKALA.hoehen * 2, hell: -SKALA.hell * 0.4 }), new Set(['fewer highs'])), null);
  assert.equal(wortFrei(eVon({ hoehen: -SKALA.hoehen * 0.4 }), new Set()), null);
  // half of the strongest is needed too: 0.9 of 2.0 is under one
  assert.equal(wortFrei(eVon({ hoehen: -SKALA.hoehen * 2, hell: -SKALA.hell * 0.9 }), new Set(['fewer highs'])), null);
  assert.equal(WORT_MIN, 0.5);
});

test('wortFrei: over 200 random effect vectors a sequential acceptance never yields two equal words', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let lauf = 0; lauf < 200; lauf++) {
    const vergeben = new Set();
    for (let i = 0; i < 6; i++) {
      const m = {};
      for (const n of MERKMALE) if (n !== 'pegel') m[n] = (rnd() * 6 - 3) * SKALA[n];
      const w = wortFrei(eVon(m), vergeben);
      if (w === null) continue;
      assert.equal(vergeben.has(w), false);
      vergeben.add(w);
    }
  }
});

test('annehmbar returns the free word and null when the word is taken and no other feature is clear', () => {
  const a = gem('k1', 1, { hoehen: -SKALA.hoehen * 2.4 });
  assert.equal(annehmbar(a, [], 1), 'fewer highs');
  const b = gem('k2', -1, { hoehen: -SKALA.hoehen * 2, sub: SKALA.sub * 0.2 });
  assert.equal(annehmbar(b, [{ ...a, wort: 'fewer highs' }], 1), null);
});

test('fill-up never repeats a word and takes only candidates that get a free word', () => {
  const x = { ...gem('k1', 1, { hoehen: -SKALA.hoehen * 2.4 }), wort: 'fewer highs' };
  const gemessen = [
    gem('k2', 1, { hoehen: -SKALA.hoehen * 2 }),                                      // would repeat the word, nothing else clear
    gem('k3', 1, { hoehen: -SKALA.hoehen * 2, hell: -SKALA.hell * 1.5 }),             // 'darker'
    gem('k4', 1, { sub: SKALA.sub * 1.5 }),
    x,
  ];
  const r = auffuellen(gemessen, [x], 1);
  assert.deepEqual(r.map((g) => g.wort), ['fewer highs', 'darker', 'more sub']);
  assert.equal(new Set(r.map((g) => g.wort)).size, r.length);
});

test('fill-up: a range-end candidate under the target but audible at subtle is a fallback marked anschlag, after the ones that reach the target', () => {
  const x = { ...gem('k1', 1, { hell: SKALA.hell * 4 }), wert: 0.8, wort: 'brighter' };            // reaches the target 3
  const enden = [
    gem('k2', 1, { sub: SKALA.sub * 1.5 }, { wert: 1 }),                                              // strength 1.5 x 2.9... see below
    gem('k3', 1, { hoehen: SKALA.hoehen * 1.6 }, { wert: 0 }),
    gem('k4', 1, { punch: SKALA.punch * 0.2 }, { wert: 1 }),                                          // inaudible even at the end
    gem('k2', -1, { sub: -SKALA.sub * 1.4 }, { wert: 0 }),                                            // second direction of k2
  ];
  const ziel = 2.9, mitSt = (g, st) => ({ ...g, staerke: st });
  const gemessen = [mitSt(enden[0], 1.5), mitSt(enden[1], 1.3), mitSt(enden[2], 0.3), mitSt(enden[3], 1.45)];
  const r = auffuellen(gemessen, [mitSt(x, 3.2)], ziel);
  assert.deepEqual(keys(r), ['k1+', 'k2+', 'k3+']);
  assert.deepEqual(r.map((g) => !!g.anschlag), [false, true, true]);
  // the other direction of a knob only when no other knob is left
  assert.deepEqual(keys(auffuellen(gemessen, [mitSt(x, 3.2)], ziel, 4)), ['k1+', 'k2+', 'k3+', 'k2-']);
  const still = mitSt(gem('k4', 1, { punch: SKALA.punch * 0.2 }, { wert: 1 }), 0.3);
  assert.deepEqual(auffuellen([still], [], ziel), [], 'inaudible even at its range end: no place');
  const mitte = mitSt(gem('k2', 1, { sub: SKALA.sub * 1.5 }, { wert: 0.7 }), 1.5);
  assert.equal(auffuellen([mitte], [], ziel).length, 0, 'not at the range end: no fallback');
});

test('fill-up prefers new knobs', () => {
  const x = gem('k1', 1, { hell: SKALA.hell * 2 });
  const gemessen = [
    gem('k1', -1, { hell: -SKALA.hell * 5 }),      // strongest, but k1 is already accepted (darker: a free word)
    gem('k2', 1, { sub: SKALA.sub * 3 }),
    gem('k2', -1, { sub: -SKALA.sub * 2.5 }),      // same knob as the one before: second pass (less sub: a free word)
    gem('k3', 1, { hoehen: SKALA.hoehen * 1 }),
    gem('k4', 1, { punch: SKALA.punch * 0.2 }),    // inaudible
    x,
  ];
  const r = auffuellen(gemessen, [x], 1);
  assert.deepEqual(keys(r), ['k1+', 'k2+', 'k3+']);
  assert.deepEqual(keys(auffuellen(gemessen, [x], 1, 4)), ['k1+', 'k2+', 'k3+', 'k1-']);
  assert.deepEqual(keys(auffuellen(gemessen, [x], 1, 6)), ['k1+', 'k2+', 'k3+', 'k1-', 'k2-']);
  assert.equal(auffuellen([], [], 1).length, 0);
  assert.deepEqual(keys(auffuellen(gemessen, [x, gemessen[1], gemessen[3]], 1)), ['k1+', 'k2+', 'k3+']);
});

test('place text and number format', () => {
  assert.equal(zahlText(420), '420'); assert.equal(zahlText(0.35), '0.35'); assert.equal(zahlText(1234.5), '1230');
  assert.equal(zahlText(12345), '12300'); assert.equal(zahlText(0.5), '0.5'); assert.equal(zahlText(0), '0');
  assert.equal(zahlText(-0.0004), '-0.0004'); assert.equal(zahlText(1.2), '1.2'); assert.equal(zahlText(0.00000123), '0.00000123');
  const a = platzA(mit({ pegel: -12 }));
  assert.equal(a.platz, 'A'); assert.equal(a.param, null); assert.equal(a.wert, null); assert.equal(a.text, 'current');
  assert.equal(a.wort, 'current'); assert.equal(a.staerke, 0); assert.equal(a.pegel_db, 0); assert.equal(a.label, '');
  const k = gem('k3', 1, { hell: SKALA.hell * 2, pegel: 3.04 });
  const p = bauePlatz('B', { ...k, wert: 0.6 }, { label: 'Cutoff', basisWert: 0.4, basis: mit({ pegel: 0 }), anzeige: (n) => 100 + 1000 * n });
  assert.equal(p.platz, 'B'); assert.equal(p.param, 'k3'); assert.equal(p.wert, 0.6);
  assert.equal(p.von_text, '500'); assert.equal(p.nach_text, '700'); assert.equal(p.pegel_db, 3);
  assert.equal(p.text, 'brighter · Cutoff 500 → 700');
  assert.equal(p.label, 'Cutoff'); assert.equal(p.staerke, k.staerke);
});

const BASIS = { k1: 0.5, k2: 0.25, k3: 1 };

test('first pick creates root with all knobs and one child', () => {
  const b = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'brighter · Cutoff 420 → 610' });
  assert.deepEqual(b, { graph: 'g1', aktiv: 'n2', knoten: [
    { id: 'n1', eltern: null, werte: BASIS, text: 'start' },
    { id: 'n2', eltern: 'n1', werte: { k1: 0.68 }, text: 'brighter · Cutoff 420 → 610' },
  ] });
  assert.deepEqual(pruefeStammbaum(b), []);
  const lang = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'x'.repeat(200) });
  assert.equal(lang.knoten[1].text.length, 80);
});

test('second pick appends', () => {
  const b1 = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'p1' });
  const b2 = stammbaumNachWahl({ baum: b1, graph: 'g1', basis: { ...BASIS, k1: 0.68 }, param: 'k2', wert: 0.43, text: 'p2' });
  assert.equal(b2.knoten.length, 3);
  assert.deepEqual(b2.knoten[2], { id: 'n3', eltern: 'n2', werte: { k2: 0.43 }, text: 'p2' });
  assert.equal(b2.aktiv, 'n3');
  assert.deepEqual(aufgeloest(b2), { k1: 0.68, k2: 0.43, k3: 1 });
  assert.deepEqual(aufgeloest(b2, 'n2'), { k1: 0.68, k2: 0.25, k3: 1 });
  assert.deepEqual(aufgeloest(b2, 'n1'), BASIS);
  assert.deepEqual(pruefeStammbaum(b2), []);
});

test('a manual change is recorded as its own node', () => {
  const b1 = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'p1' });
  const b2 = stammbaumNachWahl({ baum: b1, graph: 'g1', basis: { k1: 0.68, k2: 0.9, k3: 0.5 }, param: 'k1', wert: 0.86, text: 'p2' });
  assert.deepEqual(b2.knoten.slice(2), [
    { id: 'n3', eltern: 'n2', werte: { k2: 0.9, k3: 0.5 }, text: 'manual' },
    { id: 'n4', eltern: 'n3', werte: { k1: 0.86 }, text: 'p2' },
  ]);
  assert.equal(b2.aktiv, 'n4');
  nah(aufgeloest(b2).k2, 0.9); nah(aufgeloest(b2).k1, 0.86);
  assert.deepEqual(pruefeStammbaum(b2), []);
  // a difference below the tolerance is no manual change
  const b3 = stammbaumNachWahl({ baum: b1, graph: 'g1', basis: { k1: 0.68 + 1e-8, k2: 0.25, k3: 1 }, param: 'k2', wert: 0.4, text: 'p' });
  assert.equal(b3.knoten.length, 3);
});

test('another graph and a full tree start again', () => {
  const b1 = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'p1' });
  const b2 = stammbaumNachWahl({ baum: b1, graph: 'g2', basis: BASIS, param: 'k2', wert: 0.4, text: 'p' });
  assert.equal(b2.graph, 'g2'); assert.equal(b2.knoten.length, 2); assert.equal(b2.knoten[0].id, 'n1');
  let b = b1;
  while (b.knoten.length < STAMM_MAX_KNOTEN) b = stammbaumNachWahl({ baum: b, graph: 'g1', basis: aufgeloest(b), param: 'k2', wert: 0.1, text: 'q' });
  assert.equal(b.knoten.length, STAMM_MAX_KNOTEN);
  assert.deepEqual(pruefeStammbaum(b), []);
  const neu = stammbaumNachWahl({ baum: b, graph: 'g1', basis: { ...aufgeloest(b), k3: 0.2 }, param: 'k1', wert: 0.9, text: 'r' });
  assert.equal(neu.knoten.length, 2);
  assert.deepEqual(neu.knoten[0].werte, { ...aufgeloest(b), k3: 0.2 });
  assert.equal(neu.aktiv, 'n2');
  assert.deepEqual(pruefeStammbaum(neu), []);
});

test('back gives the knobs to write and null at the root', () => {
  const b1 = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'p1' });
  const b2 = stammbaumNachWahl({ baum: b1, graph: 'g1', basis: { ...BASIS, k1: 0.68 }, param: 'k2', wert: 0.43, text: 'p2' });
  const basis2 = { k1: 0.68, k2: 0.43, k3: 1 };
  const r = stammbaumZurueck({ baum: b2, basis: basis2 });
  assert.equal(r.baum.aktiv, 'n2'); assert.deepEqual(r.werte, { k2: 0.25 }); assert.equal(r.baum.knoten.length, 3);
  const r1 = stammbaumZurueck({ baum: b2, ziel: 'n1', basis: basis2 });
  assert.equal(r1.baum.aktiv, 'n1'); assert.deepEqual(r1.werte, { k1: 0.5, k2: 0.25 });
  assert.equal(stammbaumZurueck({ baum: r1.baum, basis: BASIS }), null);               // at the root
  assert.equal(stammbaumZurueck({ baum: b2, ziel: 'n9', basis: basis2 }), null);        // unknown id
  assert.equal(stammbaumZurueck({ baum: b2, ziel: 'n3', basis: basis2 }), null);        // the active node, no manual change
  // a manual change is recorded before the move
  const m = stammbaumZurueck({ baum: b2, basis: { k1: 0.68, k2: 0.43, k3: 0.4 } });
  assert.equal(m.baum.knoten.length, 4);
  assert.deepEqual(m.baum.knoten[3], { id: 'n4', eltern: 'n3', werte: { k3: 0.4 }, text: 'manual' });
  assert.equal(m.baum.aktiv, 'n2'); assert.deepEqual(m.werte, { k2: 0.25, k3: 1 });
  assert.deepEqual(pruefeStammbaum(m.baum), []);
  // the active node with a manual change: record it and go back to the node
  const same = stammbaumZurueck({ baum: b2, ziel: 'n3', basis: { k1: 0.68, k2: 0.43, k3: 0.4 } });
  assert.equal(same.baum.aktiv, 'n3'); assert.deepEqual(same.werte, { k3: 1 });
});

test('path with branch counts', () => {
  const b1 = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'p1' });
  const b2 = stammbaumNachWahl({ baum: b1, graph: 'g1', basis: { ...BASIS, k1: 0.68 }, param: 'k2', wert: 0.43, text: 'p2' });
  const back = stammbaumZurueck({ baum: b2, ziel: 'n1', basis: { k1: 0.68, k2: 0.43, k3: 1 } }).baum;
  const b3 = stammbaumNachWahl({ baum: back, graph: 'g1', basis: BASIS, param: 'k3', wert: 0.7, text: 'p3' });
  assert.equal(b3.knoten.at(-1).id, 'n4'); assert.equal(b3.knoten.at(-1).eltern, 'n1');
  assert.deepEqual(wegVon(b3), [{ id: 'n1', text: 'start', zweige: 1 }, { id: 'n4', text: 'p3', zweige: 0 }]);
  assert.deepEqual(wegVon(b2), [{ id: 'n1', text: 'start', zweige: 0 }, { id: 'n2', text: 'p1', zweige: 0 }, { id: 'n3', text: 'p2', zweige: 0 }]);
});

test('the input tree is never mutated', () => {
  const b1 = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.68, text: 'p1' });
  const snap = JSON.stringify(b1), basisSnap = JSON.stringify(BASIS);
  stammbaumNachWahl({ baum: b1, graph: 'g1', basis: { k1: 0.1, k2: 0.2, k3: 0.3 }, param: 'k2', wert: 0.9, text: 'p' });
  stammbaumZurueck({ baum: b1, basis: { k1: 0.1, k2: 0.2, k3: 0.3 } });
  stammbaumZurueck({ baum: b1, ziel: 'n1', basis: BASIS });
  assert.equal(JSON.stringify(b1), snap);
  assert.equal(JSON.stringify(BASIS), basisSnap);
  const root = stammbaumNachWahl({ baum: null, graph: 'g1', basis: BASIS, param: 'k1', wert: 0.1, text: 't' });
  root.knoten[0].werte.k1 = 0.99;
  assert.equal(BASIS.k1, 0.5);   // the root does not alias the basis
});

test('ausgleichDb: -pegel clamped to -12..12, to the fader maximum, 0 under 0.2 dB, 0 for -200 dB', () => {
  assert.equal(ausgleichDb(3, -6), -3);
  assert.equal(ausgleichDb(-3, -6), 3);
  assert.equal(ausgleichDb(30, -6), -12);
  assert.equal(ausgleichDb(-30, -20), 12);
  assert.equal(ausgleichDb(-5, 3), 3, 'the fader maximum +6 dB is the ceiling: 6 - 3');
  assert.equal(ausgleichDb(-5, 6), 0);
  assert.equal(ausgleichDb(0.1, -6), 0);
  assert.equal(ausgleichDb(-0.19, -6), 0);
  assert.equal(ausgleichDb(0.2, -6), -0.2);
  assert.equal(ausgleichDb(-200, -6), 0);
  assert.equal(ausgleichDb(3, -200), 0);
  assert.equal(ausgleichDb(Number.NaN, -6), 0);
  assert.equal(platzA(mit({})).ausgleich_db, 0);
  const g = { ...gem('k1', 1, { hell: SKALA.hell * 2, pegel: 3 }), wert: 0.6 };
  const o = { label: 'Cutoff', basisWert: 0.4, basis: mit({ pegel: 0 }), anzeige: (n) => n };
  assert.equal(bauePlatz('B', g, o).ausgleich_db, 0);
  assert.equal(bauePlatz('B', g, { ...o, ausgleich: -3 }).ausgleich_db, -3);
});

test('the module keeps lines within 160 characters', () => {
  for (const f of ['../project/sound_runde.ts', './sound_runde.test.mjs']) {
    readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').forEach((z, i) => assert.ok(z.length <= 160, `${f}:${i + 1} has ${z.length}`));
  }
});

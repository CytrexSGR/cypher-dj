// 1.12 automation slice 4 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, unit U3): the four editor commands auto_vereinfachen, auto_dehnen,
// auto_neigen and auto_form (decisions D3 to D6), the device tolerance of the simplifier, one undo step each, the lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { laneWert } from '../project/lane.ts';
import { toleranzVon, TOLERANZ_FADER_DB, TOLERANZ_PAN } from '../project/simplify.ts';
import { dehne, neige, formPunkte, bereichVereinfacht, FORMEN_EINFUEGEN } from '../project/lane_tools.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { ohneAbgeleitetes } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 120)}`);
function pruefe(p, r) {   // valid, vor/zurueck go back and forth (one undo step), input untouched
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))).fehler, undefined);
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt), 'redo equal');
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'undo equal');
}
// s1 audio, s2 internal RB-338
const basis = () => {
  let p = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }).projekt;
  return p;
};
// a fixture with one lane of `ziel` on track `spur` carrying exactly `punkte`; the lane id is returned too
function mitLane(ziel, punkte, spur = 's1') {
  let p = ok(basis(), { befehl: 'auto_neu', spur_id: spur, ziel }).projekt;
  const lane = p.spuren.find((s) => s.id === spur).automation[0];
  p = ok(p, { befehl: 'auto_punkte', lane_id: lane.id, setze: punkte, loesche_von: 0, loesche_bis: 1e5 }).projekt;
  return { p, id: lane.id };
}
const laneIn = (p, id) => p.spuren.flatMap((s) => s.automation ?? []).find((l) => l.id === id);
// a small seeded generator (mulberry32): the noise of T3.2 is the same in every run
function zufall(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const runde = (x) => Math.round(x * 1e6) / 1e6;

// --- T3.1 ----------------------------------------------------------------------------------------------------------------
test('U3 T3.1 toleranzVon: device lanes 0.004 (0.4 % of 0..1); fader and pan unchanged (negative control)', () => {
  for (const z of ['geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod', 'geraet.lautstaerke']) assert.equal(toleranzVon(z), 0.004, z);
  assert.equal(toleranzVon('fader'), TOLERANZ_FADER_DB); assert.equal(TOLERANZ_FADER_DB, 0.3);
  assert.equal(toleranzVon('pan'), TOLERANZ_PAN); assert.equal(TOLERANZ_PAN, 0.008);
});

// --- T3.2 ----------------------------------------------------------------------------------------------------------------
test('U3 T3.2 auto_vereinfachen (AK16): 500-point sine with noise -> at most 60 points, deviation <= 0.3 dB; outside unchanged', (t) => {
  const r = zufall(1212);
  const sinus = Array.from({ length: 500 }, (_, i) => {
    const beat = runde(i * 16 / 499);
    return { beat, wert: runde(-12 + 6 * Math.sin(2 * Math.PI * 2 * beat / 16) + (r() * 2 - 1) * 0.05) };
  });
  const aussen = [{ beat: 20, wert: -3 }, { beat: 24, wert: -9, form: 's' }, { beat: 30, wert: -1, form: 'sprung' }];
  const { p, id } = mitLane('fader', [...sinus, ...aussen]);
  const e = ok(p, { befehl: 'auto_vereinfachen', lane_id: id, von_beat: 0, bis_beat: 16 });
  pruefe(p, e);
  const neu = laneIn(e.projekt, id).punkte;
  const drin = neu.filter((q) => q.beat <= 16);
  let max = 0;
  for (const q of sinus) max = Math.max(max, Math.abs(laneWert(neu, q.beat, 'fader') - q.wert));
  t.diagnostic(`AK16: 500 points -> ${drin.length} points, max deviation ${max.toFixed(4)} dB at the 500 original beats`);
  assert.ok(drin.length <= 60, `at most 60 points (got ${drin.length})`);
  assert.ok(max <= 0.3, `max deviation ${max} <= 0.3 dB`);
  assert.deepEqual(neu.filter((q) => q.beat > 16), aussen, 'points outside the range deep equal');
  // tolerance 0 keeps every point (negative control)
  const null0 = ok(p, { befehl: 'auto_vereinfachen', lane_id: id, von_beat: 0, bis_beat: 16, toleranz: 0 });
  assert.deepEqual(laneIn(null0.projekt, id).punkte, laneIn(p, id).punkte);
  // a mute lane comes back unchanged
  const m = mitLane('mute', [{ beat: 0, wert: 0 }, { beat: 1, wert: 0 }, { beat: 2, wert: 1 }, { beat: 3, wert: 1 }, { beat: 4, wert: 0 }]);
  assert.deepEqual(laneIn(ok(m.p, { befehl: 'auto_vereinfachen', lane_id: m.id, von_beat: 0, bis_beat: 8 }).projekt, m.id).punkte, laneIn(m.p, m.id).punkte);
});

test('U3 T3.2 auto_vereinfachen (D6): a sprung staircase keeps all 17 points; the same staircase linear collapses to 2 (negative control)', () => {
  const treppe = Array.from({ length: 17 }, (_, i) => ({ beat: i * 0.25, wert: -20 + i, form: 'sprung' }));
  const a = mitLane('fader', treppe);
  const r = ok(a.p, { befehl: 'auto_vereinfachen', lane_id: a.id, von_beat: 0, bis_beat: 4 });
  const neu = laneIn(r.projekt, a.id).punkte;
  assert.equal(neu.length, 17, 'every step stays');
  for (let b = 0; b <= 4; b += 1 / 64) assert.ok(Math.abs(laneWert(neu, b, 'fader') - laneWert(treppe, b, 'fader')) <= 0.3, `beat ${b}`);
  const linear = Array.from({ length: 17 }, (_, i) => ({ beat: i * 0.25, wert: -20 + i }));
  const l = mitLane('fader', linear);
  assert.deepEqual(laneIn(ok(l.p, { befehl: 'auto_vereinfachen', lane_id: l.id, von_beat: 0, bis_beat: 4 }).projekt, l.id).punkte,
    [{ beat: 0, wert: -20 }, { beat: 4, wert: -4 }]);
});

test('U3 T3.2 auto_vereinfachen (D6): a linear run with one s point keeps the s point and its neighbours, the linear run is simplified', () => {
  const lin = Array.from({ length: 9 }, (_, i) => ({ beat: i * 0.5, wert: -20 + i }));      // 0..4 beats, straight line: collapses
  const mix = [...lin, { beat: 5, wert: -6, form: 's' }, { beat: 5.5, wert: -5 }, { beat: 6, wert: -4 }, { beat: 6.5, wert: -3 }, { beat: 7, wert: -2 }];
  const a = mitLane('fader', mix);
  const neu = laneIn(ok(a.p, { befehl: 'auto_vereinfachen', lane_id: a.id, von_beat: 0, bis_beat: 8 }).projekt, a.id).punkte;
  const beats = neu.map((q) => q.beat);
  for (const b of [4, 5, 5.5]) assert.ok(beats.includes(b), `the s point and its neighbours stay (${b})`);
  assert.deepEqual(neu.find((q) => q.beat === 5), { beat: 5, wert: -6, form: 's' });
  assert.ok(!beats.includes(2), 'the linear run is simplified');
  assert.ok(neu.length < mix.length);
  for (let b = 0; b <= 8; b += 1 / 32) assert.ok(Math.abs(laneWert(neu, b, 'fader') - laneWert(mix, b, 'fader')) <= 0.3, `beat ${b}`);
});

test('U3 T3.2 bereichVereinfacht (pure): device default tolerance 0.004, range edges kept', () => {
  const p = Array.from({ length: 11 }, (_, i) => ({ beat: i, wert: 0.5 + (i % 2) * 0.003 }));
  const neu = bereichVereinfacht(p, 2, 8, 'geraet.cutoff');
  assert.deepEqual(neu.filter((q) => q.beat < 2 || q.beat > 8), p.filter((q) => q.beat < 2 || q.beat > 8));
  assert.ok(neu.some((q) => q.beat === 2) && neu.some((q) => q.beat === 8), 'edges kept');
  assert.equal(neu.filter((q) => q.beat > 2 && q.beat < 8).length, 0, 'wobble below 0.004 is dropped');
  assert.equal(bereichVereinfacht(p, 2, 8, 'geraet.cutoff', 0.001).length, 11, 'below a smaller tolerance it stays');
});

// --- T3.3 ----------------------------------------------------------------------------------------------------------------
const rampe = [{ beat: 0, wert: -30 }, { beat: 4, wert: -30 }, { beat: 8, wert: 0 }, { beat: 10, wert: -6 }, { beat: 40, wert: -20 }];
const pruefeAussen = (alt, neu, von, m) => {
  for (let b = 0; b <= von; b += 0.125) assert.ok(Math.abs(laneWert(neu, b, 'fader') - laneWert(alt, b, 'fader')) < 1e-9, `left of von, beat ${b}`);
  for (let b = m; b <= m + 20; b += 0.125) assert.ok(Math.abs(laneWert(neu, b, 'fader') - laneWert(alt, b, 'fader')) < 1e-9, `after max(bis, neu_bis), beat ${b}`);
};
test('U3 T3.3 auto_dehnen (D3): double and halve; outside unchanged; identity deep equal; neu_bis <= von refused', () => {
  const { p, id } = mitLane('fader', rampe);
  for (const neuBis of [14, 7]) {             // range (2, 8] doubled to (2, 14], halved to (2, 5]
    const r = ok(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 2, bis_beat: 8, neu_bis_beat: neuBis });
    pruefe(p, r);
    const neu = laneIn(r.projekt, id).punkte, k = (neuBis - 2) / 6;
    pruefeAussen(rampe, neu, 2, Math.max(8, neuBis));
    for (let b = 2; b < 8; b += 0.25) {   // at 8 itself the grown case holds the old value (jump pair)
      assert.ok(Math.abs(laneWert(neu, 2 + (b - 2) * k, 'fader') - laneWert(rampe, b, 'fader')) < 1e-9, `stretched content at source beat ${b}`);
    }
  }
  // identity: negative control
  const id0 = ok(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 2, bis_beat: 8, neu_bis_beat: 8 });
  assert.deepEqual(laneIn(id0.projekt, id).punkte, rampe);
  lehntAb(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 2, bis_beat: 8, neu_bis_beat: 2 }, 'bereich_leer');
  lehntAb(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 2, bis_beat: 8, neu_bis_beat: 1 }, 'bereich_leer');
  lehntAb(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 8, bis_beat: 8, neu_bis_beat: 9 }, 'bereich_leer');
  lehntAb(p, { befehl: 'auto_dehnen', lane_id: id, von_beat: 2, bis_beat: 8 }, 'argument_ungueltig');
});
test('U3 T3.3 dehne (pure): a grown stretch removes the points of the target span and keeps the old value after it with a jump pair', () => {
  const alt = [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }, { beat: 6, wert: 0.2 }, { beat: 12, wert: 0.4 }];
  const neu = dehne(alt, 0, 4, 8, 'pan');
  assert.ok(!neu.some((q) => q.beat === 6), 'the point at 6 lay in the target span (4, 8] and is gone');
  pruefeAussen(alt.map((q) => ({ ...q })), neu, 0, 8);
  assert.equal(laneWert(neu, 6, 'pan'), laneWert(alt, 3, 'pan'), 'the stretched content: old beat 3 now at 6');
  assert.equal(neu.filter((q) => q.beat === 8).length, 2, 'a jump pair at the edge');
  assert.equal(laneWert(neu, 8, 'pan'), laneWert(alt, 8, 'pan'), 'from the edge on: the old value');
  assert.deepEqual(dehne(alt, 0, 4, 4, 'pan'), alt, 'identity');
});

// --- T3.4 ----------------------------------------------------------------------------------------------------------------
test('U3 T3.4 auto_neigen (D4): faktor 0 identity; faktor 1 moves u 0.5 to 0.0625; order and forms kept; 1.5 refused', () => {
  const alt = [{ beat: 0, wert: -10 }, { beat: 4, wert: -20 }, { beat: 8, wert: -2, form: 's' }, { beat: 10, wert: -7, form: 'sprung' }, { beat: 12, wert: -30 }, { beat: 20, wert: -1 }];
  const { p, id } = mitLane('fader', alt);
  assert.deepEqual(laneIn(ok(p, { befehl: 'auto_neigen', lane_id: id, von_beat: 4, bis_beat: 12, faktor: 0 }).projekt, id).punkte, alt, 'faktor 0');
  const r = ok(p, { befehl: 'auto_neigen', lane_id: id, von_beat: 4, bis_beat: 12, faktor: 1 });
  pruefe(p, r);
  const neu = laneIn(r.projekt, id).punkte;
  assert.deepEqual(neu.map((q) => q.wert), alt.map((q) => q.wert), 'values unchanged');
  assert.deepEqual(neu.map((q) => q.form), alt.map((q) => q.form), 'forms unchanged');
  assert.equal(neu[2].beat, 4 + 0.0625 * 8, 'u 0.5 -> 0.0625');
  assert.equal(neu[3].beat, 4 + 0.75 ** 4 * 8);
  assert.deepEqual([neu[0], neu[1], neu[4], neu[5]], [alt[0], alt[1], alt[4], alt[5]], 'end points and outside fixed');
  for (let i = 1; i < neu.length; i++) assert.ok(neu[i].beat >= neu[i - 1].beat, 'order kept');
  const r2 = ok(p, { befehl: 'auto_neigen', lane_id: id, von_beat: 4, bis_beat: 12, faktor: -1 });
  assert.equal(laneIn(r2.projekt, id).punkte[2].beat, 4 + 0.5 ** 0.25 * 8, 'faktor -1: u^(1/4)');
  lehntAb(p, { befehl: 'auto_neigen', lane_id: id, von_beat: 4, bis_beat: 12, faktor: 1.5 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_neigen', lane_id: id, von_beat: 12, bis_beat: 4, faktor: 1 }, 'bereich_leer');
  lehntAb(p, { befehl: 'auto_neigen', lane_id: id, von_beat: -1, bis_beat: 4, faktor: 1 }, 'bereich_leer');
});
test('U3 T3.4 neige (pure): a range edge inside a segment gets an anchor, so the lane outside keeps its values', () => {
  const alt = [{ beat: 0, wert: 0 }, { beat: 6, wert: 1 }, { beat: 16, wert: 0 }];
  const neu = neige(alt, 2, 10, 0.5, 'pan');
  for (let b = 0; b <= 2; b += 0.25) assert.ok(Math.abs(laneWert(neu, b, 'pan') - laneWert(alt, b, 'pan')) < 1e-12, `beat ${b}`);
  for (let b = 10; b <= 16; b += 0.25) assert.ok(Math.abs(laneWert(neu, b, 'pan') - laneWert(alt, b, 'pan')) < 1e-12, `beat ${b}`);
  assert.deepEqual(neige(alt, 2, 10, 0, 'pan'), alt, 'faktor 0 identity');
});

// --- T3.5 ----------------------------------------------------------------------------------------------------------------
const extreme = (punkte, von, bis, ziel, unten, oben) => {   // number of separate runs at the top of the range, sampled densely in [von, bis)
  const eps = (oben - unten) / 100;
  let n = 0, oben_ = false;
  for (let b = von; b < bis; b += (bis - von) / 4000) {
    const hoch = laneWert(punkte, b, ziel) >= oben - eps;
    if (hoch && !oben_) n++;
    oben_ = hoch;
  }
  return n;
};
test('U3 T3.5 auto_form (D5): five forms on fader and pan; periods; values within the range; outside unchanged', () => {
  assert.deepEqual([...FORMEN_EINFUEGEN], ['rampe_auf', 'rampe_ab', 'sinus', 'dreieck', 'rechteck']);
  for (const [ziel, alt, unten, oben] of [['fader', [{ beat: 0, wert: -6 }, { beat: 16, wert: -12 }], -60, 0], ['pan', [{ beat: 0, wert: 0.3 }, { beat: 16, wert: -0.4 }], -1, 1]]) {
    const { p, id } = mitLane(ziel, alt);
    for (const form of FORMEN_EINFUEGEN) {
      const r = ok(p, { befehl: 'auto_form', lane_id: id, von_beat: 4, bis_beat: 12, form });
      pruefe(p, r);
      const neu = laneIn(r.projekt, id).punkte;
      for (const q of neu.filter((x) => x.beat > 4 && x.beat < 12)) assert.ok(q.wert >= unten && q.wert <= oben, `${ziel} ${form} ${q.wert}`);
      for (const b of [0, 2, 3.999, 12.001, 14, 16]) assert.ok(Math.abs(laneWert(neu, b, ziel) - laneWert(alt, b, ziel)) < 1e-9, `${ziel} ${form} outside at ${b}`);
      if (form === 'rampe_auf') { assert.equal(laneWert(neu, 4, ziel), unten); assert.equal(laneWert(neu, 11.999999, ziel) > oben - 0.01, true); }
      if (form === 'rechteck') assert.ok(neu.filter((x) => x.beat > 4 && x.beat < 12).every((x) => x.form === 'sprung'));
      if (form === 'sinus') assert.ok(neu.filter((x) => x.beat > 4 && x.beat < 12).every((x) => x.form === 's'));
      const vier = laneIn(ok(p, { befehl: 'auto_form', lane_id: id, von_beat: 4, bis_beat: 12, form, perioden: 4, unten: ziel === 'pan' ? -0.5 : -40, oben: ziel === 'pan' ? 0.5 : -10 }).projekt, id).punkte;
      if (form !== 'rampe_auf' && form !== 'rampe_ab') assert.equal(extreme(vier, 4, 12, ziel, ziel === 'pan' ? -0.5 : -40, ziel === 'pan' ? 0.5 : -10), 4, `${ziel} ${form}: four periods`);
      else assert.equal(vier.filter((x) => x.beat > 4 && x.beat < 12).length, 6, `${ziel} ${form}: three inner jump pairs`);
      for (const q of vier.filter((x) => x.beat > 4 && x.beat < 12)) assert.ok(Math.abs(q.wert) <= (ziel === 'pan' ? 0.5 : 40) && (ziel === 'pan' || q.wert <= -10));
    }
  }
});
test('U3 T3.5 auto_form: mute takes only rechteck (sprung points); bad forms and ranges refused', () => {
  const m = mitLane('mute', [{ beat: 0, wert: 0 }]);
  lehntAb(m.p, { befehl: 'auto_form', lane_id: m.id, von_beat: 0, bis_beat: 4, form: 'sinus' }, 'form_ungueltig');
  const r = ok(m.p, { befehl: 'auto_form', lane_id: m.id, von_beat: 0, bis_beat: 4, form: 'rechteck', perioden: 2 });
  pruefe(m.p, r);
  const neu = laneIn(r.projekt, m.id).punkte;
  assert.ok(neu.every((q) => q.form === 'sprung' && (q.wert === 0 || q.wert === 1)));
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 5].map((b) => laneWert(neu, b, 'mute')), [1, 0, 1, 0, 0]);
  const f = mitLane('fader', [{ beat: 0, wert: 0 }]);
  lehntAb(f.p, { befehl: 'auto_form', lane_id: f.id, von_beat: 0, bis_beat: 4, form: 'kreis' }, 'form_ungueltig');
  lehntAb(f.p, { befehl: 'auto_form', lane_id: f.id, von_beat: 0, bis_beat: 4, form: 'sinus', perioden: 65 }, 'argument_ungueltig');
  lehntAb(f.p, { befehl: 'auto_form', lane_id: f.id, von_beat: 0, bis_beat: 4, form: 'sinus', unten: -10, oben: -20 }, 'argument_ungueltig');
  lehntAb(f.p, { befehl: 'auto_form', lane_id: f.id, von_beat: 0, bis_beat: 4, form: 'sinus', oben: 7 }, 'argument_ungueltig');
  lehntAb(f.p, { befehl: 'auto_form', lane_id: f.id, von_beat: 4, bis_beat: 4, form: 'sinus' }, 'bereich_leer');
  lehntAb(f.p, { befehl: 'auto_form', lane_id: f.id, von_beat: 0, bis_beat: 200000, form: 'sinus' }, 'bereich_leer');
  // a device lane: default range 0..1
  const g = mitLane('geraet.cutoff', [{ beat: 0, wert: 0.5 }], 's2');
  const gn = laneIn(ok(g.p, { befehl: 'auto_form', lane_id: g.id, von_beat: 0, bis_beat: 4, form: 'dreieck' }).projekt, g.id).punkte;
  assert.deepEqual([laneWert(gn, 0, 'geraet.cutoff'), laneWert(gn, 2, 'geraet.cutoff'), laneWert(gn, 3.999999, 'geraet.cutoff') < 0.001], [0, 1, true]);
  assert.deepEqual(formPunkte('rechteck', 0, 2, 1, 0, 1), [{ beat: 0, wert: 1 }, { beat: 1, wert: 0, form: 'sprung' }, { beat: 2, wert: 0, form: 'sprung' }]);
});

// Review fix (MAJOR): a range that starts on an existing point keeps the form of the segment INTO that point (D5: the lane outside the range is unchanged)
test('U3 T3.5 auto_form review fix: a range starting on an existing point keeps the segment into it (linear lane, next point has form s)', () => {
  const alt = [{ beat: 0, wert: -60 }, { beat: 4, wert: -20, form: 'linear' }, { beat: 8, wert: -10, form: 's' }];
  const { p, id } = mitLane('fader', alt);
  for (const form of FORMEN_EINFUEGEN) {
    const r = ok(p, { befehl: 'auto_form', lane_id: id, von_beat: 4, bis_beat: 6, form });
    pruefe(p, r);
    const neu = laneIn(r.projekt, id).punkte;
    for (const b of [0, 1, 2, 3, 3.9]) assert.ok(Math.abs(laneWert(neu, b, 'fader') - laneWert(alt, b, 'fader')) < 1e-9, `${form} at ${b}: ${laneWert(neu, b, 'fader')} vs ${laneWert(alt, b, 'fader')}`);
    for (const b of [6.001, 7, 8]) assert.ok(Math.abs(laneWert(neu, b, 'fader') - laneWert(alt, b, 'fader')) < 4, `${form} right of the range at ${b}`);
  }
  // negative control: no point at von (a linear segment is split by an anchor), the lane left of the range is unchanged as before
  const lin = [{ beat: 0, wert: -60 }, { beat: 8, wert: -10 }];
  const q = mitLane('fader', lin);
  const n = laneIn(ok(q.p, { befehl: 'auto_form', lane_id: q.id, von_beat: 4, bis_beat: 6, form: 'rampe_auf' }).projekt, q.id).punkte;
  for (const b of [0, 1, 3, 3.9]) assert.ok(Math.abs(laneWert(n, b, 'fader') - laneWert(lin, b, 'fader')) < 1e-9, `no point at von, ${b}`);
});

// --- T3.6 ----------------------------------------------------------------------------------------------------------------
test('U3 T3.6 each command is one undo step and refused on a locked lane (lane_gesperrt); reasons have texts and codes', () => {
  const { p: p0, id } = mitLane('fader', rampe);
  const befehle = [
    { befehl: 'auto_vereinfachen', lane_id: id, von_beat: 0, bis_beat: 40 },
    { befehl: 'auto_dehnen', lane_id: id, von_beat: 2, bis_beat: 8, neu_bis_beat: 12 },
    { befehl: 'auto_neigen', lane_id: id, von_beat: 2, bis_beat: 8, faktor: 0.5 },
    { befehl: 'auto_form', lane_id: id, von_beat: 2, bis_beat: 8, form: 'sinus' },
  ];
  for (const b of befehle) pruefe(p0, ok(p0, b));
  const zu = ok(p0, { befehl: 'auto_aendern', lane_id: id, gesperrt: true }).projekt;
  for (const b of befehle) lehntAb(zu, b, 'lane_gesperrt');
  for (const b of befehle) lehntAb(p0, { ...b, lane_id: 'a99' }, 'lane_unbekannt');
  for (const b of befehle) lehntAb(p0, { ...b, extra: 1 }, 'argument_unbekannt');
  for (const g of ['bereich_leer', 'form_ungueltig']) {
    assert.equal(grundCode(g), 400, g);
    assert.equal(typeof GRUND_TEXT[g], 'string', g);
  }
});

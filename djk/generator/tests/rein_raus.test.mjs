import test from 'node:test';
import assert from 'node:assert/strict';
import { kompiliere } from '../src/compile.mjs';
import { Planer } from '../src/planner.mjs';
import { ereignisse } from '../src/window.mjs';

const haps = (m, a, b) => m.queryArc(a, b).filter((h) => h.hasOnset());
const gainBei = (m, z) => haps(m, z, z + 1).map((h) => Number(h.value.gain));

test('rein(4) with anchor 8: silent before, k^2 ramp, full from cycle 12', () => {
  const m = kompiliere('s("hh*16").rein(4)', { anker: 8 }).muster;
  assert.equal(Math.max(...gainBei(m, 7)), 0);
  assert.equal(gainBei(m, 8)[0], 0);                       // first onset of cycle 8: k = 0
  assert.ok(Math.abs(gainBei(m, 10)[0] - 0.25) < 1e-9);    // onset at cycle 10: k = 0.5
  assert.ok(Math.abs(gainBei(m, 12)[0] - 1) < 1e-9);
  assert.ok(Math.abs(gainBei(m, 20)[5] - 1) < 1e-9);
});

test('raus(2) ends at 0, full before the anchor', () => {
  const m = kompiliere('s("hh*4").raus(2)', { anker: 8 }).muster;
  assert.ok(Math.abs(gainBei(m, 7)[0] - 1) < 1e-9);
  assert.ok(Math.abs(gainBei(m, 8)[0] - 1) < 1e-9);
  assert.ok(Math.abs(gainBei(m, 9)[0] - 0.25) < 1e-9);     // k = 0.5: (1-k)^2
  assert.equal(Math.max(...gainBei(m, 10)), 0);
  assert.equal(Math.max(...gainBei(m, 15)), 0);
});

test('level field: gain wins, else velocity, else a scaled default gain', () => {
  const k = (t) => haps(kompiliere(t, { anker: 0 }).muster, 1, 2)[0].value;   // k = 0.5 at cycle 1 with n = 2
  assert.ok(Math.abs(k('s("hh").gain(0.8).rein(2)').gain - 0.2) < 1e-9);
  const v = k('s("hh").velocity(0.8).rein(2)');
  assert.ok(Math.abs(v.velocity - 0.2) < 1e-9);
  assert.equal(v.gain, undefined);
  assert.ok(Math.abs(k('s("hh").rein(2)').gain - 0.25) < 1e-9);
});

test('ANKER reads the anchor; default 0', () => {
  const m = kompiliere('s("hh").gain(ANKER)', { anker: 8 }).muster;
  assert.equal(haps(m, 0, 1)[0].value.gain, 8);
  assert.equal(haps(kompiliere('s("hh").gain(ANKER + 1)').muster, 0, 1)[0].value.gain, 1);
});

test('anchors of two compiles do not leak into each other', () => {
  const a = kompiliere('s("hh").rein(4)', { anker: 8 }).muster;
  const b = kompiliere('s("hh").rein(4)', { anker: 100 }).muster;
  assert.equal(gainBei(a, 12)[0], 1);
  assert.equal(gainBei(b, 12)[0], 0);
});

test('stacked layers fade on their own methods; velocity reaches the event', () => {
  const m = kompiliere('stack(note("c3*4"), note("e3*4").rein(4))', { anker: 0 }).muster;
  const evs = ereignisse([{ ab: 0, muster: m, nr: 1 }], { midi: true }, 0, 4).evs;
  assert.equal(evs.length, 8);
  assert.ok(evs.filter((e) => e.note === 48).every((e) => Math.abs(e.velocity - 0.9) < 1e-9));   // c3: untouched
  assert.ok(evs.filter((e) => e.note === 52).every((e) => e.velocity < 0.9 * 0.2));       // e3 at cycle 0 (k = 0 .. 0.19)
});

test('Planer.abFuer matches the beat setze picks', () => {
  const p = new Planer({ strom: 1, kit: null, sende: () => {} });
  assert.equal(p.abFuer(3), -Infinity);                    // no plan yet: applies at once
  const mu = kompiliere('s("bd")').muster;
  p.setze(mu, -Infinity);
  assert.equal(p.abFuer(3), 4);
  assert.equal(p.abFuer(3.7), 4);
  assert.equal(p.abFuer(4), 8);
  assert.equal(p.abFuer(-Infinity), -Infinity);
  assert.equal(p.setze(mu, 5), p.abFuer(5));
});

test('rein(4, 2) with anchor 10: 0.25 at cycle 10, full from 12', () => {
  const m = kompiliere('s("hh*16").rein(4, 2)', { anker: 10 }).muster;
  assert.ok(Math.abs(gainBei(m, 10)[0] - 0.25) < 1e-9);
  assert.ok(Math.abs(gainBei(m, 11)[0] - 0.5625) < 1e-9);   // k = 0.75
  assert.ok(Math.abs(gainBei(m, 12)[0] - 1) < 1e-9);
  assert.ok(Math.abs(gainBei(m, 20)[3] - 1) < 1e-9);
});

test('raus(4, 2) with anchor 10: 0.25 at cycle 10, silent from 12', () => {
  const m = kompiliere('s("hh*4").raus(4, 2)', { anker: 10 }).muster;
  assert.ok(Math.abs(gainBei(m, 10)[0] - 0.25) < 1e-9);
  assert.equal(Math.max(...gainBei(m, 12)), 0);
});

test('schon out of range is refused with a clear text', () => {
  for (const t of ['s("hh").rein(4, 4)', 's("hh").rein(4, -1)', 's("hh").raus(2, 3)', 's("hh").rein(4, "x")']) {
    assert.match(kompiliere(t, { anker: 0 }).fehler ?? '', /schon must be >= 0 and < n/, t);
  }
});

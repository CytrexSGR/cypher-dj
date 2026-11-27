// Note editor (slice 1, B4): the pure helpers of the note render cache (project/notes_cache.ts): which notes changed between two lists (the
// incremental render of the engine) and which cache entries go. No disk, no process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geaenderteIds, raeumePlan } from '../project/notes_cache.ts';

const liste = () => [
  { id: 't1', qa: 0.1, qe: 0.3, qton: 60, p: 0.9 },
  { id: 't2', qa: 0.4, qe: 0.6, qton: 62, p: 0.9 },
  { id: 't3', qa: 0.7, qe: 0.9, qton: 64, p: 0.9 },
];

test('geaenderteIds: changed ton of t3 -> [t3]; reset of t3 -> [t3]; different qa anywhere -> null; equal lists -> []', () => {
  const alt = liste(); alt[0].ton = 61; alt[2].ton = 66;
  const neu = structuredClone(alt);
  assert.deepEqual(geaenderteIds(alt, neu), [], 'equal lists');
  neu[2].ton = 67;
  assert.deepEqual(geaenderteIds(alt, neu), ['t3'], 'changed ton of t3');
  const zurueck = structuredClone(alt); delete zurueck[2].ton;
  assert.deepEqual(geaenderteIds(alt, zurueck), ['t3'], 'reset of t3');
  const neuAn = structuredClone(alt); neuAn[1].ton = 63;
  assert.deepEqual(geaenderteIds(alt, neuAn), ['t2'], 'a target set where there was none');
  const beide = structuredClone(alt); beide[0].ton = 62; beide[1].ton = 70;
  assert.deepEqual(geaenderteIds(alt, beide), ['t1', 't2'], 'in list order');
  for (const [feld, wert] of [['qa', 0.11], ['qe', 0.31], ['qton', 60.5]]) {
    const x = structuredClone(alt); x[1][feld] = wert;
    assert.equal(geaenderteIds(alt, x), null, `different ${feld} anywhere`);
  }
  const andereId = structuredClone(alt); andereId[2].id = 't9';
  assert.equal(geaenderteIds(alt, andereId), null, 'different id');
  assert.equal(geaenderteIds(alt, alt.slice(0, 2)), null, 'a note gone');
  assert.equal(geaenderteIds(alt, [...alt, { id: 't4', qa: 1, qe: 1.2, qton: 60, p: 0.9 }]), null, 'a note added');
});

test('geaenderteIds: compares as the render key does (rounded), p never counts', () => {
  const alt = liste(); alt[0].ton = 61;
  const neu = structuredClone(alt);
  neu[0].ton = 61.00001; neu[1].p = 0.2; neu[2].qa = 0.7000001;                  // below the rounding of the key: the same render
  assert.deepEqual(geaenderteIds(alt, neu), []);
  neu[0].ton = 61.0002;
  assert.deepEqual(geaenderteIds(alt, neu), ['t1']);
  const andereZiele = liste(); andereZiele[1].vib = 0.5;
  assert.deepEqual(geaenderteIds(liste(), andereZiele), ['t2'], 'every target field counts, not only ton');
});

const e = (schluessel, o = {}) => ({ schluessel, slug: 'p1', clip_id: 'c1', quelle: 'a'.repeat(64), kurve: 'pyin-1.noten_hmm-1', maschine: 'teilton-2',
  liste: [], bytes: 100, zeit: 1000, ...o });

test('raeumePlan keeps the 3 newest per clip, then removes oldest first down to maxBytes, never a key in use', () => {
  const alle = [
    e('k1', { zeit: 1 }), e('k2', { zeit: 2 }), e('k3', { zeit: 3 }), e('k4', { zeit: 4 }), e('k5', { zeit: 5 }),     // clip c1 of p1: five renders
    e('m1', { clip_id: 'c2', zeit: 10 }), e('m2', { clip_id: 'c2', zeit: 11 }),                                         // another clip
    e('n1', { slug: 'p2', zeit: 0 }),                                                                                   // the same clip id in another project
  ];
  const weg = (o) => raeumePlan(alle, { proKlip: 3, maxBytes: 1e9, benutzt: new Set(), ...o });
  assert.deepEqual(weg(), ['k1', 'k2'], 'the 3 newest of c1 stay; c2 and the clip of p2 are separate groups');
  assert.deepEqual(weg({ benutzt: new Set(['k1']) }), ['k2'], 'a key in use stays even beyond the count');
  // 8 entries of 100 bytes: after the count rule 6 are left (600 bytes); 350 bytes allowed -> the oldest go first until 300 is left
  assert.deepEqual(weg({ maxBytes: 350 }), ['k1', 'k2', 'n1', 'k3', 'k4'], 'then oldest first by time, over all groups');
  assert.deepEqual(weg({ maxBytes: 0 }), ['k1', 'k2', 'n1', 'k3', 'k4', 'k5', 'm1', 'm2'], 'down to nothing');
  assert.deepEqual(weg({ maxBytes: 0, benutzt: new Set(['k5', 'm2', 'n1']) }), ['k1', 'k2', 'k3', 'k4', 'm1'], 'what is in use never goes, even over the size');
  assert.deepEqual(weg({ maxBytes: 600 }), ['k1', 'k2'], 'exactly at the limit: nothing more');
  assert.deepEqual(raeumePlan([], { proKlip: 3, maxBytes: 0, benutzt: new Set() }), []);
  assert.deepEqual(alle.map((x) => x.schluessel), ['k1', 'k2', 'k3', 'k4', 'k5', 'm1', 'm2', 'n1'], 'the argument stays as it is');
});

test('raeumePlan counts the bytes of every entry, not a flat size', () => {
  const alle = [e('a', { zeit: 1, bytes: 500 }), e('b', { clip_id: 'c2', zeit: 2, bytes: 100 }), e('c', { clip_id: 'c3', zeit: 3, bytes: 100 })];
  assert.deepEqual(raeumePlan(alle, { proKlip: 3, maxBytes: 250, benutzt: new Set() }), ['a'], 'the big old one alone brings it under the limit');
  assert.deepEqual(raeumePlan(alle, { proKlip: 3, maxBytes: 150, benutzt: new Set() }), ['a', 'b']);
});

// Automation rows for returns and master (slice 1, T2): lane lookup, strand of a lane row and the free chain targets of a return or the master
import test from 'node:test';
import assert from 'node:assert/strict';
import { laneMitId, laneStrang, offeneStraenge, freieZieleStrang, freieZieleGruppe } from '../public/production/lanes.js';

const ZIEL = 'insert.i1.b1/freq';
const lane = (id, ziel = ZIEL) => ({ id, ziel, punkte: [{ beat: 0, wert: 100 }] });
const P = () => ({
  spuren: [{ id: 's1', clips: [], automation: [lane('a3', 'fader')] }],
  gruppen: [{ id: 'g1', nr: 1, name: 'G1', inserts: [], automation: [] }],
  returns: [{ id: 'r1', inserts: [{ id: 'i1', art: 'eq' }], automation: [lane('a1')] }, { id: 'r2', inserts: [], automation: [] }],
  master: { fader_db: 0, inserts: [{ id: 'i1', art: 'eq' }], automation: [lane('a2')] },
});

test('T2 laneMitId finds a lane on a return and on the master, and still one of a track', () => {
  const p = P();
  const r = laneMitId(p, 'a1');
  assert.equal(r?.art, 'return'); assert.equal(r.strang, p.returns[0]); assert.equal(r.lane.id, 'a1');
  const m = laneMitId(p, 'a2');
  assert.equal(m?.art, 'master'); assert.equal(m.strang, p.master); assert.equal(m.lane.id, 'a2');
  assert.equal(laneMitId(p, 'a3')?.art, 'spur');
  assert.equal(laneMitId(p, 'zz'), null);
  assert.equal(laneMitId({ spuren: [] }, 'a1'), null, 'a project without returns and master is fine');
});

test('T2 laneStrang: a lane row of a return or the master gives that strip, other rows give what they gave before', () => {
  const p = P();
  assert.deepEqual(laneStrang(p, { art: 'lane', strang: 'r1' }), { art: 'return', id: 'r1', strang: p.returns[0] });
  assert.deepEqual(laneStrang(p, { art: 'lane', strang: 'r2' }), { art: 'return', id: 'r2', strang: p.returns[1] });
  assert.deepEqual(laneStrang(p, { art: 'lane', strang: 'master' }), { art: 'master', id: 'master', strang: p.master });
  assert.equal(laneStrang(p, { art: 'lane', strang: 'r9' }), null, 'a deleted return');
  assert.equal(laneStrang({ spuren: [] }, { art: 'lane', strang: 'master' }), null);
  assert.deepEqual(laneStrang(p, { art: 'lane', gruppe: 0 }), { art: 'gruppe', id: 'g1', strang: p.gruppen[0] });
  assert.deepEqual(laneStrang(p, { art: 'lane', spur: 0 }), { art: 'spur', id: 's1', strang: p.spuren[0] });
});

test('T2 offeneStraenge keeps listing groups only (returns and master are listed by their own ids)', () => {
  assert.deepEqual(offeneStraenge(P(), new Set(['g1', 'r1', 'master'])), [{ art: 'gruppe', id: 'g1' }]);
});

test('T2 free targets of a return or the master: chain targets only, empty without inserts, used targets excluded', () => {
  const p = P();
  assert.deepEqual(freieZieleStrang(p.returns[1]), [], 'no insert, no rack: no target');
  assert.deepEqual(freieZieleStrang(null), []);
  const frei = freieZieleStrang({ ...p.master, automation: [] });
  assert.ok(frei.includes(ZIEL)); assert.ok(!frei.includes('fader'));
  assert.ok(!freieZieleStrang(p.master).includes(ZIEL), 'the master already has a lane on that target');
  assert.deepEqual(freieZieleStrang({ id: 'r3', rack: {}, automation: [] }), ['rack.m1', 'rack.m2', 'rack.m3', 'rack.m4']);
  assert.deepEqual(freieZieleStrang(p.returns[0]), freieZieleGruppe(p.returns[0]), 'same rule as a group');
});

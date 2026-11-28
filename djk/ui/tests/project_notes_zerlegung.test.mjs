// Note editor slice 3 (task T10): the vibrato/drift decomposition of the server (contract notes.md D12, the same as render.cpp `zerlege`) and the
// widths in `mass`. Pure functions, no server, no test instance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zerlege, breiten, notenMass } from '../project/notes_audio.ts';

const HOP_S = 256 / 48000;
// a synthetic curve: note 60 from 0.5 s to 4.5 s, 6 Hz vibrato +-50 ct and a drift ramp of 40 ct over the note; frames outside unvoiced (0)
function kurve({ loecher = false } = {}) {
  const ct = [];
  for (let j = 0; j < Math.ceil(5 / HOP_S); j++) {
    const t = j * HOP_S;
    if (t < 0.5 || t > 4.5 || (loecher && j % 7 === 3)) { ct.push(0); continue; }
    ct.push(6000 + 50 * Math.sin(2 * Math.PI * 6 * t) + 40 * (t - 0.5) / 4);
  }
  return ct;
}
const NOTE = { id: 't1', qa: 0.5, qe: 4.5, qton: 60, p: 0.5 };

test('widths of a 6 Hz +-50 ct vibrato with a 40 ct drift: vib_ct 100 +-5, drift_ct 40 +-5', () => {
  const b = breiten(kurve(), HOP_S, NOTE);
  assert.ok(Math.abs(b.vib_ct - 100) <= 5, `vib_ct ${b.vib_ct}`);
  assert.ok(Math.abs(b.drift_ct - 40) <= 5, `drift_ct ${b.drift_ct}`);
});

test('unvoiced holes are interpolated: the widths stay', () => {
  const b = breiten(kurve({ loecher: true }), HOP_S, NOTE);
  assert.ok(Math.abs(b.vib_ct - 100) <= 6, `vib_ct ${b.vib_ct}`);
  assert.ok(Math.abs(b.drift_ct - 40) <= 5, `drift_ct ${b.drift_ct}`);
});

test('a note without voiced frames: null decomposition and null widths in mass', () => {
  const ct = kurve().map(() => 0);
  assert.equal(zerlege(ct, HOP_S, NOTE), null);
  const [m] = notenMass([NOTE], { f0_ct: ct, hop: 256 });
  assert.equal(m.mass.vib_ct, null);
  assert.equal(m.mass.drift_ziel_ct, null);
});

test('mass with a curve: every note carries it, the target widths follow the factors', () => {
  const ct = kurve();
  const [ohne, mit] = notenMass([NOTE, { ...NOTE, id: 't2', vib: 0, drift: 2 }], { f0_ct: ct, hop: 256 });
  assert.ok(ohne.mass, 'a note without a target carries mass when the curve is known');
  assert.equal(ohne.mass.vib_ziel_ct, ohne.mass.vib_ct);
  assert.equal(mit.mass.vib_ziel_ct, 0);
  assert.ok(Math.abs(mit.mass.drift_ziel_ct - 2 * mit.mass.drift_ct) <= 0.1);
  assert.equal(notenMass([NOTE])[0].mass, undefined, 'without a curve: only notes with a target');
});

test('the frames are qa <= j * hop / sr <= qe (1e-9) and the drift is the mean applied twice', () => {
  const ct = kurve();
  const z = zerlege(ct, HOP_S, NOTE);
  assert.equal(z.j0, Math.ceil(0.5 / HOP_S - 1e-9));
  assert.equal(z.vib.length, Math.floor(4.5 / HOP_S + 1e-9) - z.j0 + 1);
  // a constant dev gives a flat drift and no vibrato
  const flach = ct.map((v) => (v > 0 ? 6030 : 0));
  const zf = zerlege(flach, HOP_S, NOTE);
  assert.ok(zf.vib.every((v) => Math.abs(v) < 1e-12));
  assert.ok(zf.drift.every((d) => Math.abs(d - 0.3) < 1e-12));
});

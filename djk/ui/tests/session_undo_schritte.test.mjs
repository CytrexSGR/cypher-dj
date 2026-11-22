// Session view S1b review: every write route of the cell editor is ONE undo step. Measured two ways on the open project: the revision grows by exactly one,
// and a single undo gives back the cells exactly as they were before the call (a route that sends one command per field fails both).
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAufbau } from './support/live_module.mjs';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';
import { sessionBereich } from '../areas/live/session.ts';

const SHA = 'a'.repeat(64), FRAMES = 96000;
const audio = Float32Array.from({ length: FRAMES * 2 }, (_, i) => Math.fround(Math.sin(i * 0.011) * 0.4));
const frames = (sha) => (sha === SHA ? FRAMES : null);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });

async function aufbau(t) {
  const z = await liveAufbau(t);
  const kern = { id: 1000 };
  const ctx = { ...z.ctx, sende() { return ++kern.id; }, async warteQuittung() { return { status: 1, grund: '' }; }, kiGestoppt: () => false, quelle: () => 'andreas', verteile: () => {} };
  const ld = loopdeckBereich(ctx, z.zugang, { jetzt: () => 5000, frames });
  const bereich = sessionBereich(ctx, z.zugang, ld, { frames, audio: (sha) => (sha === SHA ? audio : null), ladenGesperrt: () => false });
  await z.aendern([{ befehl: 'loopdeck_neu', platz: 1 }]);
  const spuren = z.projekt().spuren.filter((x) => x.zellen);
  const ohneBeats = (({ beats, ...r }) => r)(Z({ art: 'einmal' }));
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: spuren[0].id, index: 1, zelle: Z() }, { befehl: 'zelle_setzen', spur_id: spuren[1].id, index: 1, zelle: ohneBeats }]);
  const zellen = () => JSON.stringify(z.projekt().spuren.map((s) => s.zellen ?? null));
  // the call, then exactly one revision more and one undo back to the cells before it
  const einSchritt = async (name, rufe) => {
    const vorher = zellen(), rev = z.projekt().rev;
    const a = await rufe();
    assert.equal(a.code, 200, `${name}: ${JSON.stringify(a.j)}`);
    assert.notEqual(zellen(), vorher, `${name}: changed something`);
    assert.equal(z.projekt().rev, rev + 1, `${name}: one revision`);
    const u = await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
    assert.equal(u.code, 200, `${name}: ${JSON.stringify(u.j)}`);
    assert.equal(zellen(), vorher, `${name}: one undo restores everything`);
  };
  return { ...z, bereich, ld, spuren, einSchritt };
}

test('/session/zelle with several fields at once is one undo step', async (t) => {
  const z = await aufbau(t);
  await z.einSchritt('zelle', () => z.bereich.zelleAendern({ spur_id: z.spuren[0].id, zelle: 1, transponieren: 3, rueckwaerts: true, blende: true, name: 'Edit', gain_db: -3, farbe: 5 }, 'andreas'));
});

test('/session/huelle is one undo step', async (t) => {
  const z = await aufbau(t);
  await z.einSchritt('huelle', () => z.bereich.huelle({ spur_id: z.spuren[0].id, zelle: 1, ziel: 'filter', punkte: [{ beat: 0, wert: -1 }, { beat: 2, wert: 1 }] }, 'andreas'));
});

test('/session/scheiben is one undo step, also when it stores the derived length of an einmal cell with the slices', async (t) => {
  const z = await aufbau(t);
  await z.einSchritt('scheiben loop', () => z.bereich.scheiben({ spur_id: z.spuren[0].id, zelle: 1, teilung: '1/8' }, 'andreas'));
  await z.einSchritt('scheiben einmal', () => z.bereich.scheiben({ spur_id: z.spuren[1].id, zelle: 1, teilung: '1/8' }, 'andreas'));
});

test('/session/neue_zelle is one undo step', async (t) => {
  const z = await aufbau(t);
  await z.einSchritt('neue_zelle', () => z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1 }, 'andreas'));
});

// fix round: the rev of a write is read when it is applied (inside the serial chain), so two quick writes both succeed
test('two concurrent /session/zelle writes are both applied as two undo steps, no rev_veraltet', async (t) => {
  const z = await aufbau(t);
  const sp = z.spuren[0].id, rev = z.projekt().rev, zelle = () => z.projekt().spuren.find((s) => s.id === sp).zellen[0];
  const [a, b] = await Promise.all([
    z.bereich.zelleAendern({ spur_id: sp, zelle: 1, name: 'First' }, 'andreas'),
    z.bereich.zelleAendern({ spur_id: sp, zelle: 1, gain_db: -4 }, 'andreas'),
  ]);
  assert.deepEqual([a.code, b.code], [200, 200], JSON.stringify([a.j, b.j]));
  assert.deepEqual([zelle().name, zelle().gain_db], ['First', -4]);
  assert.equal(z.projekt().rev, rev + 2, 'two revisions = two undo steps');
  for (let k = 0; k < 2; k++) assert.equal((await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas')).code, 200);
  assert.deepEqual([zelle().name, zelle().gain_db], ['Loop', 0]);
});

test('two concurrent /loopdeck/zelle writes are both applied as well', async (t) => {
  const z = await aufbau(t);
  const rev = z.projekt().rev;
  const [a, b] = await Promise.all([
    z.ld.zelle({ deck: 1, spur: 1, zelle: 1, name: 'One' }, 'andreas'),
    z.ld.zelle({ deck: 1, spur: 1, zelle: 1, farbe: 5 }, 'andreas'),
  ]);
  assert.deepEqual([a.code, b.code], [200, 200], JSON.stringify([a.j, b.j]));
  assert.equal(z.projekt().rev, rev + 2);
});

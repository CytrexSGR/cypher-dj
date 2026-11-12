// Plan live-module, final round: key source (analysis before the catalogue tag) and the live tempo follows the core tempo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung } from './support/proj_context.mjs';
import { tonartQuelle } from '../areas/live/key.ts';

test('key source: the analysis comes first, the catalogue tag only as a fallback', () => {
  assert.equal(tonartQuelle('4A', '6A'), '4A');
  assert.equal(tonartQuelle(null, '6A'), '6A');
  assert.equal(tonartQuelle('', '6A'), '6A');
  assert.equal(tonartQuelle(undefined, undefined), null);
});

const uhr = (z, bpm) => z.s.ereignis('/uhr', { beat: 0, bpm, sample: 0n });

test('opening the live container sets the project tempo to the core tempo while no deck plays', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  uhr(z, 128);
  const r = await z.s.liveOeffnen('andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(z.s.offen.projekt.tempo_bpm, 128);
  const rev = z.s.offen.projekt.rev;
  assert.equal((await z.s.liveOeffnen('andreas')).code, 200);
  assert.equal(z.s.offen.projekt.rev, rev, 'already in step: nothing is written again');
});

test('a playing deck keeps the project tempo (tempo_setzen is refused then); no clock keeps it too', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  uhr(z, 128);
  z.s.ereignis('/zustand/deck', { deck: 1, status: 2 });
  const r = await z.s.liveOeffnen('andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(z.s.offen.projekt.tempo_bpm, 120);
  const y = sitzung(t, { arrFristMs: 30 });
  assert.equal((await y.s.liveOeffnen('andreas')).code, 200);
  assert.equal(y.s.offen.projekt.tempo_bpm, 120);
});

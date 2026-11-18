// SEQ scenes T2: the bar target (pure), the same-block pair of /uhr and /zustand/arr, and the one bar source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { szenenZielBeat, taktBeats } from '../areas/proj/szenen_bar.ts';
import { vorlaufBeats } from '../tempo_ramp.ts';
import { KernLage } from '../areas/proj/state.ts';

const BASIS = { kBeat: 100, offset: 0, bpm: 128, loopVon: 0, loopBis: 64, loopAn: false, laeuft: true };
const ziel = (o) => szenenZielBeat({ ...BASIS, ...o });
const nah = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('target is next bar boundary on the project grid', () => {
  // offset 0.37: core beat 5.57 is project beat 5.2; the next project bar is 8, that is core beat 8.37 = kBeat + 2.8
  nah(ziel({ kBeat: 5.57, offset: 0.37 }), 5.57 + 2.8);
  nah(ziel({ kBeat: 5.57, offset: 0.37 }), 8.37);
});

test('target respects minimum lead', () => {
  const lead = vorlaufBeats(128);
  // project beat 7.99 is closer to bar 8 than the lead: the target moves one bar on
  nah(ziel({ kBeat: 7.99, offset: 0 }), 12);
  // a press just far enough before the bar keeps it
  nah(ziel({ kBeat: 8 - lead - 0.01, offset: 0 }), 8);
  // the lead is measured from the CURRENT core beat: a late kBeat with an old pair offset still moves on
  nah(ziel({ kBeat: 108.35, offset: 0.37 }), 112.37);
  nah(ziel({ kBeat: 107.95, offset: 0.37 }), 108.37);
});

test('a press exactly on the bar targets the next bar', () => {
  nah(ziel({ kBeat: 8, offset: 0 }), 12);
});

test('seam rule', () => {
  // loop 64 is a multiple of the bar: the bar grid carries over the seam, the target stays the bar
  nah(ziel({ kBeat: 61.5, offset: 0, loopAn: true, loopBis: 64 }), 64);
  nah(ziel({ kBeat: 63.95, offset: 0, loopAn: true, loopBis: 64 }), 68);
  // loop 62 is not a multiple: a bar target behind the seam becomes the seam
  nah(ziel({ kBeat: 61, offset: 0, loopAn: true, loopVon: 0, loopBis: 62 }), 62);
  // a bar before the seam is untouched
  nah(ziel({ kBeat: 57, offset: 0, loopAn: true, loopVon: 0, loopBis: 62 }), 60);
  // loop off: no seam
  nah(ziel({ kBeat: 61, offset: 0, loopAn: false, loopBis: 62 }), 64);
});

test('stopped transport returns null', () => {
  assert.equal(ziel({ laeuft: false }), null);
});

test('taktBeats is the only bar source', () => {
  assert.equal(taktBeats(), 4);
  const lies = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n')
    .filter((z) => !/^\s*\/\//.test(z) && !/export const taktBeats/.test(z)).map((z) => z.replace(/\/\/.*$/, '')).join('\n');
  for (const f of ['areas/proj/szenen_bar.ts', 'project/commands_szenen.ts']) {
    assert.doesNotMatch(lies(f), /[%*/]\s*4\b|\b4\s*[%*/]|\b4\b/, `${f} must take the bar from taktBeats()`);
  }
});

test('pair of /uhr and /zustand/arr gives the offset', () => {
  const l = new KernLage();
  const arr = (pb, st = 2, loop = 0) => ({ nr: 1, status: st, loop_an: loop, projekt_beat: pb, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  assert.equal(l.zielLage({ von_beat: 0, bis_beat: 64 }), null);
  l.nimm('/uhr', { beat: 105.57, bpm: 128 });
  l.nimm('/zustand/arr', arr(5.2));
  const z = l.zielLage({ von_beat: 0, bis_beat: 64 });
  nah(z.offset, 100.37); nah(z.kBeat, 105.57); assert.equal(z.laeuft, true); assert.equal(z.loopAn, false); assert.equal(z.bpm, 128);
  // the newest /uhr moves kBeat, the offset stays
  l.nimm('/uhr', { beat: 106, bpm: 128 });
  nah(l.zielLage({ von_beat: 0, bis_beat: 64 }).kBeat, 106);
  nah(l.zielLage({ von_beat: 0, bis_beat: 64 }).offset, 100.37);
});

test('arr without a fresh /uhr does not form a pair', () => {
  const l = new KernLage();
  const arr = (pb) => ({ nr: 1, status: 2, loop_an: 0, projekt_beat: pb, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  l.nimm('/uhr', { beat: 10, bpm: 128 });
  l.nimm('/zustand/arr', arr(2));
  l.nimm('/zustand/arr', arr(3));        // no /uhr in between: this must not be paired with the old /uhr
  nah(l.zielLage({ von_beat: 0, bis_beat: 64 }).offset, 8);
  l.nimm('/uhr', { beat: 20, bpm: 128 });
  l.nimm('/uhr', { beat: 21, bpm: 128 });  // second /uhr before the arr: the arr belongs to the newest one
  l.nimm('/zustand/arr', arr(5));
  nah(l.zielLage({ von_beat: 0, bis_beat: 64 }).offset, 16);
});

test('stopped or waiting arrangement is not running; a new core forgets the pair', () => {
  const l = new KernLage();
  const arr = (st) => ({ nr: 1, status: st, loop_an: 1, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  l.nimm('/uhr', { beat: 10, bpm: 128 }); l.nimm('/zustand/arr', arr(1));
  assert.equal(l.zielLage({ von_beat: 0, bis_beat: 64 }).laeuft, false);
  l.nimm('/uhr', { beat: 10, bpm: 128 }); l.nimm('/zustand/arr', arr(2));
  const z = l.zielLage({ von_beat: 4, bis_beat: 60 });
  assert.equal(z.laeuft, true); assert.equal(z.loopAn, true); assert.equal(z.loopVon, 4); assert.equal(z.loopBis, 60);
  l.nimm('/e/neustart', { generation: 1 }); l.nimm('/e/neustart', { generation: 2 });
  assert.equal(l.zielLage({ von_beat: 0, bis_beat: 64 }), null);
});

// 64 knobs, page side: the path patterns. A knob number is 1..64 without a leading zero; two-digit numbers must not be
// mistaken for bk/1 or bk/3 (anchored patterns). The insert stage number of ins/bk/<n>/ stays 1..8 (the pool), only k grows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PFAD } from '../hand_operation.ts';

const GUT = (p) => assert.ok(PFAD.test(p), `${p} must be a hand path`);
const SCHLECHT = (p) => assert.ok(!PFAD.test(p), `${p} must not be a hand path`);
const KANAELE = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];

test('PFAD: <kanal>/bk/1..64 on all 12 graph channels, nothing else', () => {
  for (const k of KANAELE) {
    for (const n of [1, 8, 9, 32, 33, 48, 63, 64]) GUT(`${k}/bk/${n}`);
    for (const n of ['0', '65', '66', '70', '99', '100', '00', '01', '033', '09', '010', '1x', 'x', '', '1/2', '-1']) SCHLECHT(`${k}/bk/${n}`);
  }
  for (const k of ['fx/3', 'fx/4']) {
    for (const n of [1, 33, 64]) GUT(`${k}/bk/${n}`);
    for (const n of ['0', '65', '033']) SCHLECHT(`${k}/bk/${n}`);
  }
  for (const p of ['erz/4/bk/9', 'erz/8/bk/9', 'deck/5/bk/9', 'fx/1/bk/9', 'fx/2/bk/32', 'bus/1/bk/32', 'pad/3/bk/9', 'xdeck/1/bk/9', 'deck/1/bk/9/x', '/deck/1/bk/9', 'erz/4/bk/64']) SCHLECHT(p);
});

test('PFAD: ins/bk/<stage 1..8>/(an|k1..k64)', () => {
  for (const st of [1, 8]) for (const n of [1, 9, 32, 33, 48, 63, 64]) GUT(`ins/bk/${st}/k${n}`);
  GUT('ins/bk/3/an');
  SCHLECHT('ins/bk/9/k64');   // stage 9 does not exist
  for (const p of ['ins/bk/9/k1', 'ins/bk/0/k1', 'ins/bk/1/k0', 'ins/bk/1/k65', 'ins/bk/1/k01', 'ins/bk/1/k100', 'ins/bk/10/k1', 'ins/bk/1/k', 'ins/bk/1/k1x', 'ins/bk/1/k033']) SCHLECHT(p);
});

test('PFAD: the track patterns spur/1..32 are not widened by the knob limit', () => {
  GUT('spur/32/fader'); SCHLECHT('spur/33/fader'); SCHLECHT('spur/64/fader');
});

// Sampler group panels (ins-*, smp-*, ton-*, sampler-fairlight): every rule names controls of its panel and has a text,
// and every knob of the graph is bound by some control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { steuerungen, parameterVon } from '../public/panel.js';

const GRAPHEN = path.join(os.homedir(), 'cypherdj/werke/geraete');
const NAMEN = [
  'ins-grand-piano-ab80', 'ins-limette-84c2', 'ins-trombone-394b', 'ins-upright-piano-knight-36df', 'ins-vibraphone-soft-mallet-ca84',
  'smp-acid-groove-1-da24', 'smp-hit-light1-6fb3', 'smp-komp-roh-drums-6916', 'smp-loop-122-bpm-eliot-9c5d', 'smp-sr-brk-c-3b2c', 'smp-vde3-125-bpm-wobble-kit-954c',
  'ton-hit-light1-6fb3-1', 'ton-komp-roh-drums-6916-1', 'ton-sr-brk-c-3b2c-1', 'ton-sr-brk-c-3b2c-2', 'ton-vde3-125-bpm-wobble-954c-1',
  'sampler-fairlight',
];
const lies = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const panel = (name) => lies(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url));
const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);

for (const name of NAMEN) {
  test(`${name}: every rule names controls of the panel and has a text`, () => {
    const sts = steuerungen(panel(name));
    const ids = new Set(sts.map((c) => c.id));
    for (const c of sts.filter((x) => x.wirkt)) {
      assert.equal(typeof c.wirkt_text, 'string', `${c.id}: text`);
      for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
    }
  });
  test(`${name}: every knob of the graph is bound by a control`, (t) => {
    const f = path.join(GRAPHEN, `${name}.json`);
    if (!fs.existsSync(f)) return t.skip('graph not installed');
    const nrn = lies(f).knoten.filter((n) => n.art === 'regler').map((n) => `k${n.nr}`);
    const gebunden = new Set(steuerungen(panel(name)).flatMap(parameterVon));
    for (const k of nrn) assert.ok(gebunden.has(k), `${k} is not bound`);
  });
}

test('graphs of one prefix share one panel structure (same controls, same labels)', () => {
  const sig = (n) => steuerungen(panel(n)).map((c) => `${c.type}:${c.label ?? ''}:${c.bind?.param ?? ''}`).join('|');
  const gruppe = (pre) => NAMEN.filter((n) => n.startsWith(pre));
  for (const pre of ['smp-', 'ton-']) for (const n of gruppe(pre)) assert.equal(sig(n), sig(gruppe(pre)[0]), n);
});

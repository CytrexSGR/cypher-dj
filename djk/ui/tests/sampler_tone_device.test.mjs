// Sampler C task 1: the tone device graph and panel. The probe graph is also the fixture the block test (modular_dsp/tests/ton_geraet.rs) plays.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalisierePanel, pruefePanel, reglerBereiche } from '../graphs.ts';
import { TON_KURZ_MAX, noteHz, notenName, tonGraph, tonGraphName, tonPanel } from '../sampler/tone.ts';

const probe = { graph: 'ton-probe-0000-1', schnitt_id: 'probe-0000', name: 'Probe', a: 4800, b: 52800, grund: 57 };
const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'instruments', 'modular_dsp', 'tests', 'common', 'ton-probe.json');

test('tonGraphName fits 32 characters', () => {
  assert.equal(TON_KURZ_MAX, 25);
  assert.equal(tonGraphName('l4-ab12', 1), 'ton-l4-ab12-1');
  const lang = 'abcdefghijklmnopqrstuvw-9f3c';            // 28 characters
  assert.equal(lang.length, 28);
  assert.equal(tonGraphName(lang, 99), 'ton-abcdefghijklmnopqrst-9f3c-99');
  assert.ok(tonGraphName(lang, 99).length <= 32);
  // a trailing '-' of the shortened id is removed
  assert.equal(tonGraphName('abcdefghijklmnopqrs-uvwxyz-9f3c', 1), 'ton-abcdefghijklmnopqrs-9f3c-1');
  assert.ok(tonGraphName('a'.repeat(25), 99).length === 32);
});

test('note names and frequencies', () => {
  assert.equal(noteHz(69), 440);
  assert.ok(Math.abs(noteHz(57) - 220) < 1e-9);
  assert.equal(notenName(60), 'C3');
  assert.equal(notenName(57), 'A2');
  assert.equal(notenName(16), 'E-1');
  assert.equal(notenName(95), 'B5');
});

test('tonGraph: pitch mode on one region, 8 voices, the knobs of C-D3', () => {
  const g = tonGraph(probe), s = g.knoten.find((k) => k.art === 'sampler');
  assert.deepEqual([s.datei, s.grenzen, s.noten_wahl, s.schleife, s.grund], ['smp-probe-0000.f32', [4800, 52800], 0, 0, 220]);
  assert.equal(g.stimmen, 8);
  assert.equal(g.format, 'baukasten/2');
  assert.deepEqual(Object.values(g.regler_namen), ['Tune', 'Attack', 'Decay', 'Sustain', 'Release', 'Cutoff', 'Reso', 'Level']);
  assert.deepEqual(pruefePanel(normalisierePanel(tonPanel(probe)), probe.graph, reglerBereiche(g)), []);
  const p = tonPanel(probe);
  assert.equal(p.title, 'Tone · Probe');
  assert.deepEqual(p.geraet, { art: 'bk', graph: probe.graph });
  assert.equal(p.sections.length, 1);
  assert.deepEqual([p.sections[0].id, p.sections[0].title, p.sections[0].cols], ['tone', 'TONE', 4]);
  assert.deepEqual(p.sections[0].controls.map((c) => c.bind.param), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
});

test('a long tone name is cut to the 40 characters of a panel title', () => {
  const t = tonPanel({ ...probe, name: 'x'.repeat(60) }).title;
  assert.ok(t.length <= 40);
  assert.ok(t.endsWith('…'));
});

test('the probe graph is the fixture the block test plays', () => {
  if (process.env.TON_PROBE_SCHREIBEN === '1') {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(tonGraph(probe), null, 2)}\n`);
    return;
  }
  assert.deepEqual(tonGraph(probe), JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
});

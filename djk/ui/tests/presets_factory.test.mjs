// Factory presets: every file valid and described, presets/register.json without drift, compressor presets equal to the VST3
// presets.json (plugin parameter names) and, through the kern mapping of the page, to KOMP_PRESETS (presets/DECISIONS.md P-R3, D5)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PresetSpeicher, WERK_VORGABE } from '../presets/store.ts';
import { bauen, pruefe, liesRegister, WERK_REGISTER } from '../presets/register.ts';
import { KOMP_PRESETS } from '../public/effects.js';
import { kernKompAusPreset } from '../public/presets.js';

function werkSpeicher(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-w-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return new PresetSpeicher({ werk: WERK_VORGABE, nutzer: path.join(d, 'user') });
}

test('factory presets: all valid, all described, no duplicate sound', (t) => {
  const { register, ungueltig, doppelt } = bauen(werkSpeicher(t), ['werk']);
  assert.deepEqual(ungueltig, []);
  assert.deepEqual(doppelt, []);
  const je = {};
  for (const e of register.eintraege) je[e.geraet] = (je[e.geraet] ?? 0) + 1;
  assert.deepEqual(je, { komp: 6, eq: 11, hall: 11, saett: 10, rb338: 10, baukasten: 58 });
});

test('factory register is up to date (after changing a factory preset: node presets/tool.ts bauen)', (t) => {
  const s = werkSpeicher(t);
  const d = pruefe(liesRegister(WERK_REGISTER), s, ['werk']);
  assert.deepEqual(d, { sauber: true, fehlend: [], verwaist: [], doppelt: [], geaendert: [], ungueltig: [], vokabular_veraltet: false });
  assert.deepEqual(liesRegister(WERK_REGISTER), bauen(s, ['werk']).register);
});

test('compressor factory presets equal the VST3 presets.json and, mapped to the kern compressor, KOMP_PRESETS of the page', (t) => {
  const s = werkSpeicher(t);
  const werk = Object.fromEntries(s.liste({ herkunft: 'werk', geraet: 'komp' }).map((e) => [e.name, s.lies('werk', 'komp', e.slug).werte]));
  const { _quelle, ...vst } = JSON.parse(fs.readFileSync(new URL('../../instruments/comp/presets/presets.json', import.meta.url), 'utf8'));
  assert.deepEqual(werk, vst);
  assert.deepEqual(Object.keys(werk).sort(), Object.keys(KOMP_PRESETS).sort());
  for (const [name, w] of Object.entries(werk)) {
    const { sc, ...kern } = KOMP_PRESETS[name];
    assert.deepEqual(kernKompAusPreset(w).felder, kern, name);
    assert.equal(w.extsc, sc !== 0, `${name}: external sidechain in the plugin ↔ a key channel on the kern compressor`);
  }
});

test('compressor factory presets are described as compressors with the matching sub-kind', (t) => {
  const { register } = bauen(werkSpeicher(t), ['werk']);
  const komp = Object.fromEntries(register.eintraege.filter((e) => e.geraet === 'komp').map((e) => [e.name, `${e.art}/${e.unterart}`]));
  assert.deepEqual(komp, {
    Bass: 'compressor/channel', 'Bus Glue': 'compressor/glue', 'Drum Bus': 'compressor/bus',
    'Kick Sidechain': 'compressor/sidechain', Lead: 'compressor/channel', Parallel: 'compressor/parallel',
  });
});

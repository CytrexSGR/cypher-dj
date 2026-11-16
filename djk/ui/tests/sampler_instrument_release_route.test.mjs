// Sample player stage 2b, strand S: the routes with loops and release samples: the `instrument` field of /sampler/dateien, `release: false` on POST /sampler/instrument,
// the counts in the list row and the build text. Server with the kern stand-in; roots, store and graph folder are temp folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { sinusWav } from './support/sinus_wav.mjs';
import { wavMitSchleife } from './support/schleifen_files.mjs';

const HZ = { C: 261.6256, E: 329.6276, G: 391.9954 };

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-insrel-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), lib: path.join(root, 'lib') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: d.lib }]));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  // Horn/Sus: three notes, two of them looped; Horn/Rel: three release samples; Plain: three notes, nothing else
  for (const n of ['C', 'E', 'G']) wavMitSchleife(path.join(d.lib, 'Horn', 'Sus', `Hrn ${n}3.wav`), { rate: 44100, frames: 30000, hz: HZ[n], schleifen: n === 'G' ? null : [[8000, 20000]] });
  for (const n of ['C', 'E', 'G']) sinusWav(path.join(d.lib, 'Horn', 'Releases', `Hrn ${n}3 rel.wav`), { hz: HZ[n], sekunden: 0.3, rate: 48000, kanaele: 1 });
  for (const n of ['C', 'E', 'G']) sinusWav(path.join(d.lib, 'Plain', `Pl ${n}3.wav`), { hz: HZ[n], sekunden: 0.4, rate: 48000, kanaele: 1 });
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;
  s.optionen.samplerOrdner = d.sampler;
  return { ...s, d };
}

test('GET /sampler/dateien: the instrument field names release files and looped files when there are any', async (t) => {
  const z = await aufbau(t);
  let r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&ordner=Horn%2FSus');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.instrument, { noten: 3, lagen: 1, takes: 1, dateien: 3, release: 3, schleifen: 2 });
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&ordner=Plain');
  assert.deepEqual(r.j.instrument, { noten: 3, lagen: 1, takes: 1, dateien: 3 });
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&ordner=Horn%2FReleases');
  assert.equal('release' in (r.j.instrument ?? {}), false, 'the release folder itself has no sibling release folder');
});

test('POST /sampler/instrument: loops and release samples in the answer, the text, the list row and the store; release false leaves them out', async (t) => {
  const z = await aufbau(t);
  const r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Horn/Sus', name: 'Horn' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const i = r.j.instrument;
  assert.deepEqual([i.noten, i.zonen, i.schleifen, i.release], [3, 3, 2, 3]);
  assert.match(r.j.text, /3 zones/);
  assert.match(r.j.text, /2 looped zones/);
  assert.match(r.j.text, /3 release zones/);
  const l = (await ruf(z.url, 'GET', '/sampler/instrumente')).j.instrumente;
  assert.deepEqual([l[0].noten, l[0].zonen, l[0].schleifen, l[0].release], [3, 3, 2, 3]);
  const eintrag = JSON.parse(fs.readFileSync(path.join(z.d.sampler, 'instrumente', i.id, 'instrument.json'), 'utf8'));
  assert.equal(eintrag.zonen.length, 6);
  assert.deepEqual(eintrag.zonen.map((x) => x.art), [undefined, undefined, undefined, 'release', 'release', 'release']);
  assert.deepEqual(eintrag.zonen.map((x) => Array.isArray(x.loop)), [true, true, false, false, false, false]);
  const graph = JSON.parse(fs.readFileSync(path.join(z.d.bk, `ins-${i.id}.json`), 'utf8'));
  assert.equal(graph.regler_namen['10'], 'Rel smp');
  assert.equal(graph.knoten.find((k) => k.id === 'smp').zonen.length, 72);

  const o = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Horn/Sus', name: 'Horn ohne', release: false });
  assert.equal(o.code, 200, JSON.stringify(o.j));
  assert.equal('release' in o.j.instrument, false);
  assert.equal(o.j.instrument.schleifen, 2);
  assert.doesNotMatch(o.j.text, /release/);
  const g2 = JSON.parse(fs.readFileSync(path.join(z.d.bk, `ins-${o.j.instrument.id}.json`), 'utf8'));
  assert.deepEqual(Object.keys(g2.regler_namen), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);

  const falsch = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Horn/Sus', release: 'nein' });
  assert.equal(falsch.code, 400);
});

test('POST /sampler/instrument: a folder without loops or release folder answers the rows of stage 2a', async (t) => {
  const z = await aufbau(t);
  const r = await ruf(z.url, 'POST', '/sampler/instrument', { wurzel: 'Lib', ordner: 'Plain' });
  assert.deepEqual(Object.keys(r.j.instrument).sort(), ['bytes', 'erstellt', 'graph', 'id', 'name', 'noten', 'zonen']);
  assert.doesNotMatch(r.j.text, /looped|release/);
});

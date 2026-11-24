// Browser plan 6, task 9: the own-bundle list is the same in all three twins and plugin_pfade.txt never changes it. Temp HOME only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { eigeneVst3Pfade } from '../../contract/orte.ts';

const WURZEL = path.resolve(import.meta.dirname, '../../..');
const CARLA = path.join(WURZEL, 'djk/hosts/carla');

function heim(t, { mitDatei }) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'orte-vst3-'));
  t.after(() => fs.rmSync(h, { recursive: true, force: true }));
  const a = path.join(h, 'fremd-a'), b = path.join(h, 'fremd-b');
  fs.mkdirSync(path.join(a, 'rb338.vst3'), { recursive: true });   // the decoy
  fs.mkdirSync(b);
  if (mitDatei) {
    fs.mkdirSync(path.join(h, '.config/cypherdj'), { recursive: true });
    fs.writeFileSync(path.join(h, '.config/cypherdj/plugin_pfade.txt'), `# mine\n${a}\n\nrelativ/x\n${b}\n`);
  }
  return { h, a, b };
}
// A temp install root with its own djk/ (orte.sh resolves the root from DJK) and a copy of plugin_scan.py (it resolves the root from its own location): <checkout>/lib is never touched.
function wurzelMit(t, h, mitPaket) {
  const w = fs.mkdtempSync(path.join(h, 'wurzel-'));
  fs.mkdirSync(path.join(w, 'djk/hosts/carla'), { recursive: true });
  fs.copyFileSync(path.join(CARLA, 'plugin_scan.py'), path.join(w, 'djk/hosts/carla/plugin_scan.py'));
  if (mitPaket) fs.mkdirSync(path.join(w, 'lib/vst3'), { recursive: true });
  return w;
}
const shell = (w, h, env) => spawnSync('bash', ['-c', `DJK=${w}/djk; . ${WURZEL}/djk/start/orte.sh; ${env}`], { env: { ...process.env, HOME: h, CYPHERDJ_VST3_PFADE: 'a:b' }, encoding: 'utf8' }).stdout.trim();
const python = (w, h) => JSON.parse(spawnSync('python3', ['-c', 'import json,plugin_scan;print(json.dumps(plugin_scan.eigene_pfade()))'],
  { cwd: path.join(w, 'djk/hosts/carla'), env: { ...process.env, HOME: h, CYPHERDJ_VST3_PFADE: 'a:b' }, encoding: 'utf8' }).stdout);

test('order: nutzer, umgebung elements, paket', (t) => {
  const { h } = heim(t, { mitDatei: true });
  const w = fs.mkdtempSync(path.join(h, 'wurzel-'));
  fs.mkdirSync(path.join(w, 'lib/vst3'), { recursive: true });
  assert.deepEqual(eigeneVst3Pfade({ home: h, env: { CYPHERDJ_VST3_PFADE: 'a::b:' }, wurzel: w }), [
    { pfad: path.join(h, '.local/lib/cypherdj/vst3'), quelle: 'nutzer' }, { pfad: 'a', quelle: 'umgebung' }, { pfad: 'b', quelle: 'umgebung' },
    { pfad: path.join(w, 'lib/vst3'), quelle: 'paket' }]);
  assert.deepEqual(eigeneVst3Pfade({ home: h, env: {}, wurzel: '/nonexistent-root' }).map((r) => r.quelle), ['nutzer']);
});

test('parity: TypeScript, orte.sh and plugin_scan.eigene_pfade give the same lines, with and without the file', (t) => {
  const mit = heim(t, { mitDatei: true }), ohne = heim(t, { mitDatei: false });
  const rel = (h) => { const w = wurzelMit(t, h, true); return { ts: eigeneVst3Pfade({ home: h, env: { CYPHERDJ_VST3_PFADE: 'a:b' }, wurzel: w }).map((r) => r.pfad), sh: shell(w, h, 'orte_vst3_pfade').split('\n'), py: python(w, h), w }; };
  const m = rel(mit.h), o = rel(ohne.h);
  assert.equal(m.ts.length, 4);
  assert.deepEqual(m.ts, m.sh); assert.deepEqual(m.ts, m.py);
  const norm = (r, h) => r.ts.map((p) => p.replace(r.w, '<root>').replace(h, '~'));
  assert.deepEqual(norm(m, mit.h), norm(o, ohne.h));   // (d) the file changes nothing
});

test('shadow pin: a decoy rb338.vst3 and baukasten.vst3 in a file folder do not change orte_bundle', (t) => {
  const mit = heim(t, { mitDatei: true });
  fs.mkdirSync(path.join(mit.a, 'baukasten.vst3'), { recursive: true });   // the decoys sit in a folder of plugin_pfade.txt
  const w = wurzelMit(t, mit.h, false);
  for (const name of ['rb338.vst3', 'baukasten.vst3']) {
    assert.equal(shell(w, mit.h, `orte_bundle ${name}`), '');   // no own folder has it: the decoy stays invisible
    const eigen = path.join(mit.h, '.local/lib/cypherdj/vst3');
    fs.mkdirSync(path.join(eigen, name), { recursive: true });
    assert.equal(shell(w, mit.h, `orte_bundle ${name}`), path.join(eigen, name));
    fs.rmSync(path.join(eigen, name), { recursive: true });
  }
});

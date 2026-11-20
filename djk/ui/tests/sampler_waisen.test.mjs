// Orphan slot banks: the sweep removes banks and slot files that no project or module names, and keeps everything else.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { raeumeWaisenBaenke } from '../sampler/waisen.ts';

const TAG = 24 * 3600_000;
function aufbau() {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'waisen-'));
  const bk = path.join(w, 'bk'), projekte = path.join(w, 'projekte'), module = path.join(w, 'module');
  for (const d of [path.join(bk, 'samples'), path.join(bk, 'panels'), path.join(projekte, 'song'), module]) fs.mkdirSync(d, { recursive: true });
  const bank = (name, slotDatei, alterTage = 3) => {
    fs.writeFileSync(path.join(bk, `${name}.json`), JSON.stringify({ plaetze: [{ datei: slotDatei }] }));
    fs.writeFileSync(path.join(bk, 'panels', `${name}.json`), '{}');
    fs.writeFileSync(path.join(bk, 'samples', slotDatei), 'x');
    const t = new Date(Date.now() - alterTage * TAG);
    for (const p of [path.join(bk, `${name}.json`), path.join(bk, 'panels', `${name}.json`), path.join(bk, 'samples', slotDatei)]) fs.utimesSync(p, t, t);
  };
  return { w, bk, projekte, module, bank, ra: (extra = {}) => raeumeWaisenBaenke({ bk, wurzeln: [projekte, module], ...extra }),
    da: (n) => fs.existsSync(path.join(bk, n)), weg: () => fs.rmSync(w, { recursive: true, force: true }) };
}

test('a bank that no project names is removed with its panel and its slot file; a bank a saved project names stays', (t) => {
  const x = aufbau(); t.after(x.weg);
  x.bank('amiga-aaaaaa', 'smp-p11111111.f32');
  x.bank('amiga-bbbbbb', 'smp-p22222222.f32');
  fs.writeFileSync(path.join(x.projekte, 'song', 'project.json'), JSON.stringify({ spuren: [{ geraet: { graph: 'amiga-bbbbbb' } }] }));
  const r = x.ra();
  assert.deepEqual([r.graphen, r.samples, r.uebersprungen], [['amiga-aaaaaa'], ['smp-p11111111.f32'], null]);
  assert.ok(!x.da('amiga-aaaaaa.json') && !x.da('panels/amiga-aaaaaa.json') && !x.da('samples/smp-p11111111.f32'));
  assert.ok(x.da('amiga-bbbbbb.json') && x.da('panels/amiga-bbbbbb.json') && x.da('samples/smp-p22222222.f32'));
});

test('a bank named only in a module or in an old history line stays; so does a slot file a project names directly', (t) => {
  const x = aufbau(); t.after(x.weg);
  x.bank('amiga-cccccc', 'smp-p33333333.f32');
  x.bank('amiga-dddddd', 'smp-p44444444.f32');
  x.bank('amiga-eeeeee', 'smp-p55555555.f32');
  fs.mkdirSync(path.join(x.module, 'm1'));
  fs.writeFileSync(path.join(x.module, 'm1', 'modul.json'), '{"graph":"amiga-cccccc"}');
  fs.writeFileSync(path.join(x.projekte, 'song', 'verlauf.jsonl'), '{"vor":"amiga-dddddd"}\n');
  fs.writeFileSync(path.join(x.projekte, 'song', 'notiz.txt'), 'uses smp-p55555555.f32');
  const r = x.ra();
  assert.deepEqual(r.graphen, ['amiga-eeeeee'], 'only the bank nobody names goes');
  assert.deepEqual(r.samples, [], 'its slot file is named by a project text and stays');
  assert.ok(x.da('samples/smp-p33333333.f32') && x.da('samples/smp-p44444444.f32') && x.da('samples/smp-p55555555.f32'));
});

test('files younger than the grace time stay, whatever names them', (t) => {
  const x = aufbau(); t.after(x.weg);
  x.bank('amiga-ffffff', 'smp-p66666666.f32', 0);
  const r = x.ra();
  assert.deepEqual([r.graphen, r.samples], [[], []]);
  assert.ok(x.da('amiga-ffffff.json') && x.da('samples/smp-p66666666.f32'));
  assert.deepEqual(x.ra({ minAlterMs: 0 }).graphen, ['amiga-ffffff'], 'the same files go once the grace time is over');
});

test('nothing is deleted when a project folder cannot be scanned; the factory files, the cut audio and other graphs are never touched', (t) => {
  const x = aufbau(); t.after(x.weg);
  x.bank('amiga-abcdef', 'smp-p77777777.f32');
  for (const n of ['amiga-quadrat.f32', 'amiga-leer.f32', 'smp-cut1.f32']) fs.writeFileSync(path.join(x.bk, 'samples', n), 'x');
  fs.writeFileSync(path.join(x.bk, 'amiga.json'), '{}');
  fs.writeFileSync(path.join(x.bk, 'synth.json'), '{"x":"smp-p88888888.f32"}');
  fs.writeFileSync(path.join(x.bk, 'samples', 'smp-p88888888.f32'), 'x');
  const alt = new Date(Date.now() - 3 * TAG);
  for (const n of ['amiga-quadrat.f32', 'amiga-leer.f32', 'smp-cut1.f32', 'smp-p88888888.f32']) fs.utimesSync(path.join(x.bk, 'samples', n), alt, alt);
  const kaputt = path.join(x.projekte, 'song', 'project.json');
  fs.writeFileSync(kaputt, 'x'); fs.chmodSync(kaputt, 0);
  if (process.getuid?.() !== 0) {
    const r = x.ra();
    assert.deepEqual([r.graphen, r.samples], [[], []]);
    assert.ok(r.uebersprungen !== null);
    assert.ok(x.da('amiga-abcdef.json'));
  }
  fs.chmodSync(kaputt, 0o644);
  fs.rmSync(kaputt);
  const r2 = x.ra();
  assert.deepEqual(r2.graphen, ['amiga-abcdef']);
  assert.deepEqual(r2.samples, ['smp-p77777777.f32']);
  for (const n of ['amiga.json', 'synth.json', 'samples/amiga-quadrat.f32', 'samples/amiga-leer.f32', 'samples/smp-cut1.f32', 'samples/smp-p88888888.f32']) assert.ok(x.da(n), n);
});

test('a bank named by a project behind a folder link stays; orphans are moved into .waisen, not deleted', (t) => {
  const x = aufbau(); t.after(x.weg);
  x.bank('amiga-121212', 'smp-p12121212.f32');
  x.bank('amiga-343434', 'smp-p34343434.f32');
  const draussen = path.join(x.w, 'pruefen', 'probe');
  fs.mkdirSync(draussen, { recursive: true });
  fs.writeFileSync(path.join(draussen, 'project.json'), '{"graph":"amiga-121212"}');
  fs.symlinkSync(draussen, path.join(x.projekte, 'probe'));
  fs.symlinkSync(x.projekte, path.join(x.projekte, 'schleife'));   // a link loop ends
  const r = x.ra();
  assert.deepEqual([r.graphen, r.samples, r.uebersprungen], [['amiga-343434'], ['smp-p34343434.f32'], null]);
  assert.ok(x.da('amiga-121212.json') && x.da('samples/smp-p12121212.f32'), 'the linked project keeps its bank');
  const korb = fs.readdirSync(path.join(x.bk, '.waisen'));
  assert.equal(korb.length, 1);
  for (const rel of ['amiga-343434.json', 'panels/amiga-343434.json', 'samples/smp-p34343434.f32'])
    assert.ok(fs.existsSync(path.join(x.bk, '.waisen', korb[0], rel)), `${rel} is in .waisen`);
});

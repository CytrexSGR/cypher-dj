// The box (panel section) of a Baukasten knob in GET /lernen: boxIndexe (pure), panelBoxen (cache by file mtime), boxVon (channel and track paths).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boxIndexe, panelBoxen, boxVon } from '../areas/learn/box.ts';

const sek = (id, ...controls) => ({ id, controls });
const knob = (id, k) => ({ id, type: 'knob', bind: { param: `k${k}` } });

test('boxIndexe: section order without rows, xy binds both axes, unbound knobs absent', () => {
  const p = { format: 'cypherdj-panel/2', sections: [sek('a', knob('c1', 1), knob('c2', 2)), sek('b', { id: 'xy', type: 'xy', bind: { x: { param: 'k3' }, y: { param: 'k4' } } }, { id: 'l', type: 'label' })] };
  assert.deepEqual(boxIndexe(p), { 1: 0, 2: 0, 3: 1, 4: 1 });
  assert.deepEqual(boxIndexe(null), {});
  assert.deepEqual(boxIndexe({ sections: 5 }), {});
});

test('boxIndexe: layout.rows order, then unnamed sections in file order; first section wins on a double bind', () => {
  const p = { format: 'cypherdj-panel/2', layout: { rows: [['c', 'a'], ['d']] }, sections: [sek('a', knob('x', 1)), sek('b', knob('y', 2)), sek('c', knob('z', 3)), sek('d', knob('w', 1), knob('v', 4))] };
  // page order: c, a, d, then b
  assert.deepEqual(boxIndexe(p), { 3: 0, 1: 1, 4: 2, 2: 3 });
});

test('boxIndexe: a v1 panel (bind.regler) is read as v2', () => {
  const p = { format: 'baukasten-panel/1', graph: 'g', sections: [sek('a', { id: 'c', type: 'knob', bind: { regler: 7 } })] };
  assert.deepEqual(boxIndexe(p), { 7: 0 });
});

function ordner() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-box-'));
  fs.mkdirSync(path.join(d, 'panels'));
  fs.writeFileSync(path.join(d, 'g.json'), JSON.stringify({ format: 'baukasten/2', name: 'g', stimmen: 1, regler_namen: { 1: 'Rate' }, knoten: [{ id: 'n', art: 'note' }, { id: 'r1', art: 'regler', nr: 1, min: 0, max: 1 }, { id: 'r2', art: 'regler', nr: 2, min: 0, max: 1 }, { id: 'o', art: 'ausgang' }], kanten: [] }));
  return d;
}
const panelDatei = (d, sections) => fs.writeFileSync(path.join(d, 'panels', 'g.json'), JSON.stringify({ format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'g' }, sections }));

test('panelBoxen: reads the sidecar, follows a changed file, {} without a valid panel', (t) => {
  const d = ordner();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  assert.deepEqual(panelBoxen('g', d), {}, 'no panel file');
  panelDatei(d, [sek('a', knob('c1', 1)), sek('b', knob('c2', 2))]);
  assert.deepEqual(panelBoxen('g', d), { 1: 0, 2: 1 });
  assert.equal(panelBoxen('g', d), panelBoxen('g', d), 'unchanged files: the cached answer');
  panelDatei(d, [sek('b', knob('c2', 2)), sek('a', knob('c1', 1))]);
  fs.utimesSync(path.join(d, 'panels', 'g.json'), new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(panelBoxen('g', d), { 2: 0, 1: 1 }, 'a new mtime reloads');
  assert.deepEqual(panelBoxen('Bad Name', d), {});
});

test('boxVon: channel path via the loaded graph, track path via the slot, other paths none', (t) => {
  const d = ordner();
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  panelDatei(d, [sek('a', knob('c1', 1)), sek('b', knob('c2', 2))]);
  const projekt = { spuren: [{ id: 's1', name: 'Lead', nr: 1, geraet: { art: 'intern', name: 'bk', graph: 'g' } }] };
  const ctx = { baukasten: { geladen: () => ({ 'erz/5': 'g' }) }, projekt: () => projekt };
  assert.equal(boxVon(ctx, 'erz/5/bk/2', d), 1);
  assert.equal(boxVon(ctx, 'erz/5/bk/9', d), undefined, 'a knob on no control');
  assert.equal(boxVon(ctx, 'spur/1/bk/2', d), 1);
  assert.equal(boxVon(ctx, 'spur/2/bk/2', d), undefined, 'no track on slot 2');
  assert.equal(boxVon(ctx, 'erz/6/bk/1', d), undefined, 'no graph on the channel');
  assert.equal(boxVon(ctx, 'deck/1/filter', d), undefined);
  assert.equal(boxVon({ baukasten: { geladen: () => { throw new Error('x'); } } }, 'erz/5/bk/1', d), undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'move_beweis.mjs');

function repo(alt) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'move-beweis-'));
  const git = (...a) => execFileSync('git', a, { cwd: d });
  git('init', '-q');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'alt.ts'), alt);
  git('add', '.'); git('commit', '-qm', 'x');
  return d;
}
function lauf(d, neu, ...extra) {
  const f = path.join(d, 'neu.ts');
  fs.writeFileSync(f, neu);
  return spawnSync('node', [TOOL, '--old', 'HEAD:alt.ts', '--new', f, ...extra], { cwd: d, encoding: 'utf8' });
}

test('reorder and an import: missing 0, added 1, exit 0', () => {
  const d = repo('a\nb\nb\n');
  const r = lauf(d, 'b\na\nb\nimport x\n');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /missing: 0/);
  assert.match(r.stdout, /added: 1/);
  assert.match(r.stdout, /\+ import x/);
});

test('a duplicate line cannot hide: one b missing exits 1', () => {
  const d = repo('a\nb\nb\n');
  const r = lauf(d, 'a\nb\n');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing: 1/);
});

test('--strip makes this.h.x() match this.x()', () => {
  const d = repo('this.x();\n');
  const r = lauf(d, 'this.h.x();\n', '--strip', 'this.h.', '--strip', 'this.');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /missing: 0/);
  assert.match(r.stdout, /added: 0/);
});

test('an unreadable --old ref exits 2 with a message', () => {
  const d = repo('a\n');
  const r = spawnSync('node', [TOOL, '--old', 'nope:alt.ts', '--new', path.join(d, 'alt.ts')], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read --old/);
});

test('several --new files are pooled', () => {
  const d = repo('a\nb\n');
  fs.writeFileSync(path.join(d, 'n2.ts'), 'b\n');
  fs.writeFileSync(path.join(d, 'n1.ts'), 'a\n');
  const r = spawnSync('node', [TOOL, '--old', 'HEAD:alt.ts', '--new', path.join(d, 'n1.ts'), path.join(d, 'n2.ts')], { cwd: d, encoding: 'utf8' });
  assert.equal(r.status, 0);
});

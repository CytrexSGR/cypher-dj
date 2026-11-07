// pythonVorgabe in a git worktree: the werkstatt venv is not tracked, so a worktree has none and fell back to the system
// python3 (no torchaudio): 18 stems tests red on every worktree, green on the main checkout (measured 2026-11-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pythonVorgabe, hauptCheckout } from '../server.ts';

function baue() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pyvorgabe-'));
  const haupt = path.join(d, 'haupt'), wt = path.join(haupt, '.claude', 'worktrees', 'x');
  fs.mkdirSync(path.join(haupt, '.git', 'worktrees', 'x'), { recursive: true });
  fs.writeFileSync(path.join(haupt, '.git', 'worktrees', 'x', 'commondir'), '../..\n');
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(haupt, '.git', 'worktrees', 'x')}\n`);
  const venv = path.join(haupt, 'djk', 'werkstatt', '.venv', 'bin');
  fs.mkdirSync(venv, { recursive: true });
  fs.writeFileSync(path.join(venv, 'python'), '');
  return { d, haupt, wt, py: path.join(venv, 'python') };
}

test('hauptCheckout: a worktree resolves to the main checkout, the main checkout to itself, no git to null', () => {
  const { d, haupt, wt } = baue();
  assert.equal(hauptCheckout(wt), haupt);
  assert.equal(hauptCheckout(haupt), haupt);
  assert.equal(hauptCheckout(path.join(d, 'nirgends')), null);
});

test('pythonVorgabe: a worktree without its own venv takes the venv of the main checkout', () => {
  const { wt, py } = baue();
  assert.equal(pythonVorgabe(wt, {}), py);
});

test('pythonVorgabe: CYPHERDJ_PYTHON and the own venv still win; without any venv python3', () => {
  const { d, wt } = baue();
  const vorgabe = path.join(d, 'vorgabe-python'); fs.writeFileSync(vorgabe, '');   // an existing file: the variable counts only then
  assert.equal(pythonVorgabe(wt, { CYPHERDJ_PYTHON: vorgabe }), vorgabe);
  const eigen = path.join(wt, 'djk', 'werkstatt', '.venv', 'bin');
  fs.mkdirSync(eigen, { recursive: true }); fs.writeFileSync(path.join(eigen, 'python'), '');
  assert.equal(pythonVorgabe(wt, {}), path.join(eigen, 'python'));
  const leer = path.join(d, 'leer'); fs.mkdirSync(leer);
  assert.equal(pythonVorgabe(leer, {}), 'python3');
});

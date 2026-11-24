// "Last opened" stamps (browser plan 2, task 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liesZuletzt, merkeZuletzt } from '../project/zuletzt.ts';

const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'zuletzt-'));

test('round trip returns the stamp; a second slug keeps the first', () => {
  const w = tmp();
  merkeZuletzt(w, 'a', new Date('2026-11-23T10:00:00Z'));
  merkeZuletzt(w, 'b', new Date('2026-11-23T11:00:00Z'));
  assert.deepEqual(liesZuletzt(w), { a: '2026-11-23T10:00:00.000Z', b: '2026-11-23T11:00:00.000Z' });
  fs.rmSync(w, { recursive: true });
});

test('a corrupt or missing file reads as empty, and the next write repairs it', () => {
  const w = tmp();
  assert.deepEqual(liesZuletzt(w), {});
  fs.writeFileSync(path.join(w, '.zuletzt.json'), '{kaputt');
  assert.deepEqual(liesZuletzt(w), {});
  fs.writeFileSync(path.join(w, '.zuletzt.json'), '[1,2]');
  assert.deepEqual(liesZuletzt(w), {});
  merkeZuletzt(w, 'a', new Date('2026-11-23T10:00:00Z'));
  assert.deepEqual(Object.keys(liesZuletzt(w)), ['a']);
  fs.rmSync(w, { recursive: true });
});

test('merkeZuletzt leaves no temp file', () => {
  const w = tmp();
  merkeZuletzt(w, 'a', new Date());
  assert.deepEqual(fs.readdirSync(w), ['.zuletzt.json']);
  fs.rmSync(w, { recursive: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lesbarerName } from '../names.ts';
import { REPO } from '../paths.ts';

test('readable names match the shared vectors', () => {
  const v = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'interfaces', 'lesbare_namen.json'), 'utf8')).vektoren;
  assert.ok(v.length >= 5);
  for (const x of v) assert.equal(x.max === undefined ? lesbarerName(x.text) : lesbarerName(x.text, x.max), x.erwartet, JSON.stringify(x.text));
});

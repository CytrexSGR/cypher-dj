// A flat project (no nesting) writes the same project file and the same /1 and /2 playback as before nested groups (golden from c3396e9a).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bauFlach } from './support/flach_golden.mjs';

test('flat project: project file and both playback forms equal the golden of the code before nested groups', () => {
  const golden = JSON.parse(fs.readFileSync(new URL('./support/flach_golden.json', import.meta.url), 'utf8'));
  const jetzt = bauFlach();
  assert.equal(jetzt.datei, golden.datei);
  assert.equal(JSON.stringify(jetzt.wiedergabe1), JSON.stringify(golden.wiedergabe1));
  assert.equal(jetzt.wiedergabe2.format, 'cypherdj-arr/2');
  assert.equal(JSON.stringify(jetzt.wiedergabe2), JSON.stringify(golden.wiedergabe2));
  assert.equal(golden.wiedergabe1.format, 'cypherdj-arr/1');
});

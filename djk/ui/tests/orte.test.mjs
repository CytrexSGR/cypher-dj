// contract/orte.ts (package 1.0 task 1): the Strudel folder resolves from the code's own place.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { strudelOrdner } from '../../contract/orte.ts';

const VAR = ['CYPHERDJ_STRUDEL', 'STRUDEL_PAKETE'];
const mit = (env, f) => {
  const alt = Object.fromEntries(VAR.map((k) => [k, process.env[k]]));
  for (const k of VAR) delete process.env[k];
  Object.assign(process.env, env);
  try { return f(); } finally { for (const k of VAR) { if (alt[k] === undefined) delete process.env[k]; else process.env[k] = alt[k]; } }
};

test('orte: CYPHERDJ_STRUDEL pointing nowhere throws and names the variable', () => {
  mit({ CYPHERDJ_STRUDEL: '/missing' }, () => assert.throws(() => strudelOrdner(), { message: 'CYPHERDJ_STRUDEL: /missing does not exist' }));
});
test('orte: strudel folder rules (STRUDEL_PAKETE parent, CYPHERDJ_STRUDEL, home default)', () => {
  mit({ STRUDEL_PAKETE: '/p/q/packages', CYPHERDJ_STRUDEL: os.tmpdir() }, () => assert.equal(strudelOrdner(), '/p/q'));
  mit({ CYPHERDJ_STRUDEL: os.tmpdir() }, () => assert.equal(strudelOrdner(), os.tmpdir()));
  // this checkout has no strudel/ next to djk/, so the default is the home folder
  mit({}, () => assert.equal(strudelOrdner(), path.join(os.homedir(), 'strudel')));
});

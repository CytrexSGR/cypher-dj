// The four kinds that used to live inside the checkout (bestand, sammlungen, muster, journal): env, old place inside the repo root, new place.
// The same fixture file is read by djk/workshop/tests/test_inventory_ort.py (Python side of the same three cases).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from '../paths.ts';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(P.REPO, 'djk', 'ablage', 'tests', 'neue_arten.json'), 'utf8'));
const mitEnv = (kv, f) => { const alt = {}; for (const k of Object.keys(kv)) { alt[k] = process.env[k]; if (kv[k] === undefined) delete process.env[k]; else process.env[k] = kv[k]; }
  try { return f(); } finally { for (const k of Object.keys(alt)) { if (alt[k] === undefined) delete process.env[k]; else process.env[k] = alt[k]; } } };

for (const [art, f] of Object.entries(FIXTURE)) {
  test(`ablage ${art}: env wins, then a non-empty old place inside the repo root, else the new place`, () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ablage-neu-'));
    const repo = path.join(t, 'repo'); const heim = path.join(t, 'heim');
    fs.mkdirSync(repo);
    const env = { HOME: t, CYPHERDJ_HEIM: heim, CYPHERDJ_INSTANZ: undefined, [f.env]: undefined };
    try {
      mitEnv(env, () => {
        assert.equal(P.ablageOrte(art, { repo }).alt, path.join(repo, f.alt));
        assert.equal(P.ablageOrte(art, { repo }).neu, path.join(heim, f.neu));
        assert.equal(P.ablageOrte(art, { repo }).env, f.env);
        assert.equal(P.ablageOrdner(art, { repo }), path.join(heim, f.neu), 'nothing there: new');
        fs.mkdirSync(path.join(repo, f.alt), { recursive: true });
        fs.writeFileSync(path.join(repo, f.alt, 'x'), '1');
        assert.equal(P.ablageOrdner(art, { repo, log: () => {} }), path.join(repo, f.alt), 'old place not empty: old');
      });
      mitEnv({ ...env, [f.env]: '/tmp/eigen-' + art }, () => assert.equal(P.ablageOrdner(art, { repo }), '/tmp/eigen-' + art));
      mitEnv({ ...env, [f.env]: '' }, () => assert.equal(P.ablageOrdner(art, { repo, log: () => {} }), path.join(repo, f.alt), 'empty env counts as unset'));
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  });
}

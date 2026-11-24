// GET /proj/dateien in the real server (browser plan 2, task 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';

const KEYS = ['audio', 'bounces', 'exporte', 'fehlend', 'instrumente', 'kits', 'midi', 'presets', 'resamples', 'stems', 'takes'];
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-dat-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('409 kein_projekt before a project is open, never 500', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  const r = await ruf(url, 'GET', '/proj/dateien');
  assert.deepEqual([r.code, r.j.fehler, r.j.grund, r.j.ok], [409, 'kein_projekt', 'kein_projekt', false]);
  assert.ok(r.j.text.length > 0);
});

test('after POST /proj/neu the answer has all eleven keys, empty', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Files' })).code, 200);
  const r = await ruf(url, 'GET', '/proj/dateien');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(Object.keys(r.j).sort(), KEYS);
});

test('a project folder without audio/ does not break the answer; a slow gerettetListe is awaited', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr'),
    gerettetListe: async () => { await new Promise((r) => setTimeout(r, 50)); return [{ datei: 'take-1-1-gerettet.wav', spur_id: 's1', gerettet: true }]; } } });
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Files' })).code, 200);
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  fs.mkdirSync(path.join(d, 'proj', slug, 'aufnahmen'), { recursive: true });
  fs.writeFileSync(path.join(d, 'proj', slug, 'aufnahmen', 'take-1-1-gerettet.wav'), 'x');
  fs.rmSync(path.join(d, 'proj', slug, 'audio'), { recursive: true, force: true });
  const r = await ruf(url, 'GET', '/proj/dateien');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.takes, [{ datei: 'take-1-1-gerettet.wav', spur_id: 's1', gerettet: true }]);
});

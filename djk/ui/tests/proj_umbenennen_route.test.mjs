// POST /proj/umbenennen and the "recent first" order of GET /proj/liste in the real server (browser plan 2, task 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, warte, CYPHER } from './support/proj_stack.mjs';
import { innen } from './support/inside.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-umb-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const aufbau = async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  return { d, url };
};
const lege = async (url, name) => { const r = await ruf(url, 'POST', '/proj/neu', { name }); assert.equal(r.code, 200, JSON.stringify(r.j)); return r.j.slug; };

test('rename of a stored project that is not open: same slug, new name in the list, folder untouched', async (t) => {
  const { url } = await aufbau(t);
  const a = await lege(url, 'Alpha');
  await lege(url, 'Beta');   // Beta is open now
  const r = await ruf(url, 'POST', '/proj/umbenennen', { slug: a, name: 'Gamma' });
  assert.deepEqual([r.code, r.j.ok, r.j.slug], [200, true, a], JSON.stringify(r.j));
  const liste = (await ruf(url, 'GET', '/proj/liste')).j;
  assert.equal(liste.find((x) => x.slug === a).name, 'Gamma');
});

test('refusals: empty and long names 400 name_ungueltig; a name another project has (other case) 409 name_vergeben; the open project 409 projekt_offen; unknown 404', async (t) => {
  const { url } = await aufbau(t);
  const a = await lege(url, 'Alpha');
  const b = await lege(url, 'Beta');
  const leer = await ruf(url, 'POST', '/proj/umbenennen', { slug: a, name: '   ' });
  assert.deepEqual([leer.code, leer.j.grund, leer.j.fehler, leer.j.ok], [400, 'name_ungueltig', 'name_ungueltig', false]);
  assert.ok(leer.j.text.length > 0);
  assert.equal((await ruf(url, 'POST', '/proj/umbenennen', { slug: a, name: 'x'.repeat(81) })).j.grund, 'name_ungueltig');
  const doppelt = await ruf(url, 'POST', '/proj/umbenennen', { slug: a, name: 'bETA' });
  assert.deepEqual([doppelt.code, doppelt.j.grund], [409, 'name_vergeben']);
  const offen = await ruf(url, 'POST', '/proj/umbenennen', { slug: b, name: 'Delta' });
  assert.deepEqual([offen.code, offen.j.grund], [409, 'projekt_offen']);
  assert.match(offen.j.text, /SAVE AS/);
  const nix = await ruf(url, 'POST', '/proj/umbenennen', { slug: 'gibt-es-nicht', name: 'Q' });
  assert.deepEqual([nix.code, nix.j.grund], [404, 'unbekannt']);
  assert.equal((await ruf(url, 'POST', '/proj/umbenennen', { slug: a, name: 'Q', extra: 1 })).code, 400);
  assert.equal((await ruf(url, 'GET', '/proj/liste')).j.find((x) => x.slug === a).name, 'Alpha', 'nothing changed');
});

test('renaming a project to its own name in another case is allowed', async (t) => {
  const { url } = await aufbau(t);
  const a = await lege(url, 'Alpha');
  await lege(url, 'Beta');
  assert.equal((await ruf(url, 'POST', '/proj/umbenennen', { slug: a, name: 'ALPHA' })).code, 200);
});

test('Stop Cypher refuses a rename by Cypher; Andreas is not stopped', async (t) => {
  const d = tmp(t);
  const st = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  const a = await lege(st.url, 'Alpha');
  await lege(st.url, 'Beta');
  await innen(st.o).kiStopp(true);
  const r = await ruf(st.url, 'POST', '/proj/umbenennen', { slug: a, name: 'Q' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt']);
  assert.equal((await ruf(st.url, 'POST', '/proj/umbenennen', { slug: a, name: 'Q' })).code, 200);
});

test('GET /proj/liste: the most recently opened project is first and carries a later zuletzt', async (t) => {
  const { url } = await aufbau(t);
  const a = await lege(url, 'Alpha');
  await warte(15);
  const b = await lege(url, 'Beta');
  await warte(15);
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug: a })).code, 200);
  await warte(15);
  let l = (await ruf(url, 'GET', '/proj/liste')).j;
  assert.deepEqual(l.map((x) => x.slug), [a, b]);
  assert.ok(Date.parse(l[0].zuletzt) > Date.parse(l[1].zuletzt));
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug: b })).code, 200);
  l = (await ruf(url, 'GET', '/proj/liste')).j;
  assert.deepEqual(l.map((x) => x.slug), [b, a]);
});

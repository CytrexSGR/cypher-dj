// Shelf routes of /stoebern: schutz=aus, vorrang=1, /stoebern/quellen (media browser slice 1, task 1). Server in process, own catalog, own sampler folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel, hole } from './support/media_library.mjs';
import { baueKatalog, ksha } from './support/catalog.mjs';

async function aufbau(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-regal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = path.join(dir, 'lib'), leer = path.join(dir, 'leer'), sampler = path.join(dir, 'sampler');
  fs.mkdirSync(path.join(lib, 'k'), { recursive: true }); fs.mkdirSync(leer); fs.mkdirSync(sampler);   // leer: the mount folder exists but is empty, leer/z is not there
  const f = (rel) => { const p = path.join(lib, rel); fs.writeFileSync(p, 'x'); return p; };
  fs.writeFileSync(path.join(sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: lib }, { name: 'Leer', pfad: leer }]));
  const datei = baueKatalog(path.join(dir, 'kat'), [
    { n: 1, typ: 'oneshot', name: 'kick1', instrument: 'kick', pfad: f('k/kick1.wav') },
    { n: 2, typ: 'oneshot', name: 'kick2', instrument: 'kick', pfad: f('k/kick2.wav') },
    { n: 3, typ: 'oneshot', name: 'aaa', instrument: 'snare', pfad: path.join(leer, 'z', 'aaa.wav') },
    { n: 4, typ: 'oneshot', name: 'prot', instrument: 'pad', schutz: 'ableton', pfad: f('k/prot.wav') },
  ]);
  const s = await stapel(t, { katalog: datei });
  s.optionen.samplerOrdner = sampler;
  return { s, dir, lib, leer };
}

test('/stoebern: schutz=aus and vorrang=1', async (t) => {
  const { s } = await aufbau(t);
  const r = await hole(s.url, '/stoebern?typ=oneshot&schutz=aus&vorrang=1');
  assert.equal(r.code, 200);
  assert.equal(r.j.vorrang, true);
  assert.equal(r.j.gesamt, 3);
  assert.ok(r.j.treffer.every((x) => x.nur_live === false));
  assert.equal(r.j.treffer[0].pfad_da, true);
  assert.deepEqual(r.j.treffer.map((x) => x.name), ['kick1', 'kick2', 'aaa'], 'reachable file first although "aaa" sorts first by name and its mount folder exists (empty)');
  const alt = await hole(s.url, '/stoebern?typ=oneshot');
  assert.equal(alt.j.gesamt, 4);
  assert.equal('vorrang' in alt.j, false, 'without the parameters the answer is as before');
  assert.deepEqual(alt.j.treffer.map((x) => x.name), ['aaa', 'kick1', 'kick2', 'prot']);
});

test('/stoebern: schutz=x is 400 schutz_ungueltig, vorrang=2 is 400 vorrang_ungueltig', async (t) => {
  const { s } = await aufbau(t);
  assert.deepEqual(await hole(s.url, '/stoebern?typ=oneshot&schutz=x'), { code: 400, j: { fehler: 'schutz_ungueltig' } });
  assert.deepEqual(await hole(s.url, '/stoebern?typ=oneshot&vorrang=2'), { code: 400, j: { fehler: 'vorrang_ungueltig' } });
  assert.equal((await hole(s.url, '/stoebern?typ=oneshot&schutz=aus&vorrang=')).code, 200, 'an empty vorrang is absent');
});

test('/stoebern/baum: schutz=aus counts only unprotected rows', async (t) => {
  const { s } = await aufbau(t);
  const mit = await hole(s.url, '/stoebern/baum?typ=oneshot'), ohne = await hole(s.url, '/stoebern/baum?typ=oneshot&schutz=aus');
  assert.ok(mit.j.facetten.instrument.some((x) => x.wert === 'pad'));
  assert.ok(!ohne.j.facetten.instrument.some((x) => x.wert === 'pad'));
  assert.equal((await hole(s.url, '/stoebern/baum?typ=oneshot&schutz=x')).code, 400);
});

test('/stoebern/quellen: a missing root is listed with da false and its count', async (t) => {
  const { s, lib, leer } = await aufbau(t);
  const r = await hole(s.url, '/stoebern/quellen?typ=oneshot&schutz=aus');
  assert.equal(r.code, 200);
  assert.equal(r.j.typ, 'oneshot');
  assert.equal(r.j.gebaut_am, '2026-10-10T17:00:00+00:00');
  assert.deepEqual(r.j.quellen, [{ name: 'Lib', pfad: lib, n: 2, da: true }, { name: 'Leer', pfad: leer, n: 1, da: false, grund: 'ordner' }]);
  const mit = await hole(s.url, '/stoebern/quellen?typ=oneshot');
  assert.equal(mit.j.quellen.find((q) => q.name === 'Lib').n, 3, 'without schutz=aus the protected row counts');
  assert.equal((await hole(s.url, '/stoebern/quellen?typ=midi')).code, 400);
  assert.equal((await hole(s.url, '/stoebern/quellen?typ=oneshot&schutz=x')).code, 400);
});

test('/stoebern/quellen: without a catalog 503 katalog_fehlt', async (t) => {
  const s = await stapel(t, { katalog: '/nicht/da/katalog.sqlite' });
  assert.deepEqual(await hole(s.url, '/stoebern/quellen?typ=oneshot'), { code: 503, j: { fehler: 'katalog_fehlt' } });
});

test('/stoebern vorrang=1: a reachable favourite first, then the most recent, then the column order; treffer carry favorit', async (t) => {
  const koll = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-regal-koll-'));
  t.after(() => fs.rmSync(koll, { recursive: true, force: true }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-regal4-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lib = path.join(dir, 'lib'), leer = path.join(dir, 'leer');
  fs.mkdirSync(lib); fs.mkdirSync(leer);
  const f = (rel) => { const p = path.join(lib, rel); fs.writeFileSync(p, 'x'); return p; };
  const datei = baueKatalog(path.join(dir, 'kat'), [
    { n: 1, typ: 'oneshot', name: 'a1', instrument: 'kick', pfad: f('a1.wav') },
    { n: 2, typ: 'oneshot', name: 'b2', instrument: 'kick', pfad: f('b2.wav') },
    { n: 3, typ: 'oneshot', name: 'c3', instrument: 'kick', pfad: f('c3.wav') },
    { n: 4, typ: 'oneshot', name: 'd4', instrument: 'kick', pfad: f('d4.wav') },
    { n: 5, typ: 'oneshot', name: 'fav-gone', instrument: 'kick', pfad: path.join(leer, 'x', 'fav.wav') },
  ]);
  const s = await stapel(t, { katalog: datei, kollektionen: { ordner: koll } });
  const sampler = path.join(dir, 'sampler'); fs.mkdirSync(sampler);
  fs.writeFileSync(path.join(sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: lib }, { name: 'Leer', pfad: leer }]));
  s.optionen.samplerOrdner = sampler;
  const post = (slug, hinzu) => fetch(`${s.url}/kollektionen/${slug}/posten`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify({ hinzu }) });
  const S = (n) => ({ art: 'sample', sha: ksha(n) });
  assert.equal((await post('favourites', [S(3), S(5)])).status, 200, 'favourites exists before the file does');
  assert.equal((await post('recently-used', [S(2), S(4)])).status, 200);   // newest: 4, then 2
  const r = await hole(s.url, '/stoebern?typ=oneshot&schutz=aus&vorrang=1');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.treffer.map((x) => x.name), ['c3', 'd4', 'b2', 'a1', 'fav-gone'], 'reachable favourite, newest recent, older recent, column order; unreachable last');
  assert.deepEqual(r.j.treffer.map((x) => x.favorit), [true, false, false, false, true]);
  assert.ok(r.j.treffer.every((x) => typeof x.typ === 'string' && x.typ === 'oneshot'), 'typ stays in every row');
  const ohne = await hole(s.url, '/stoebern?typ=oneshot&schutz=aus');
  assert.deepEqual(ohne.j.treffer.map((x) => x.name), ['a1', 'b2', 'c3', 'd4', 'fav-gone'], 'without vorrang the column order is unchanged');
  assert.deepEqual(ohne.j.treffer.map((x) => x.favorit), [false, false, true, false, true], 'favorit is set without vorrang too');
});

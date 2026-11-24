// Browser plan 1, task 6: the source routes of /bibliothek over a real http server and the real `python -m bibliothek` in a sealed temp
// environment (tests/support/bib_environment.mjs). Nothing here touches the real config or the real katalog.sqlite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen, quelleAusKopf } from '../http/transport.ts';
import { KatalogJob } from '../catalog_job.ts';
import { erlaubteWurzeln } from '../importe.ts';
import { bibliothekBereich } from '../areas/bibliothek/area.ts';
import { bibUmgebung, warte, wavBytes } from './support/bib_environment.mjs';

async function stapel(t) {
  const u = bibUmgebung(t);
  const musik = path.join(u.heim, 'Musik');
  fs.mkdirSync(musik);
  const erlaubt = () => erlaubteWurzeln({ heim: u.heim, wurzeln: [] });
  const job = new KatalogJob({ python: u.python, cwd: u.cwd, env: u.env, entprellMs: 60, importeOrdner: () => path.join(u.heim, 'importe') });
  t.after(() => job.schliesse());
  const router = new Router();
  let port = 0;
  router.melde(bibliothekBereich({ log: () => {} }, job, { erlaubt }));
  const server = http.createServer(async (q, a) => {
    quelleAusKopf(q);
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const ruf = async (methode, pfad, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${pfad}`, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const text = await r.text();
    return { code: r.status, j: text ? JSON.parse(text) : null };
  };
  return { ...u, musik, job, ruf };
}

test('GET quellen lists a missing folder with fehlt true; datei is bibliothek.json, and quellen.toml once that file exists', async (t) => {
  const s = await stapel(t);
  assert.deepEqual((await s.ruf('GET', '/bibliothek/quellen')).j, { datei: 'bibliothek.json', quellen: [] });
  fs.writeFileSync(path.join(s.d, 'bibliothek.json'), JSON.stringify({ schema: 1, wurzeln: [{ pfad: s.musik, typ: 'auto' }, { pfad: path.join(s.d, 'Platte-weg'), typ: 'loop' }] }));
  const r = await s.ruf('GET', '/bibliothek/quellen');
  assert.deepEqual(r.j.quellen, [{ pfad: s.musik, typ: 'auto', fehlt: false }, { pfad: path.join(s.d, 'Platte-weg'), typ: 'loop', fehlt: true }]);
  fs.writeFileSync(path.join(s.heimat, 'quellen.toml'), `schema = 1\n\n[[wurzel]]\nname = "musik"\nart = "sample"\npfad = "${s.musik}"\n`);
  const toml = await s.ruf('GET', '/bibliothek/quellen');
  assert.equal(toml.j.datei, 'quellen.toml');
  assert.deepEqual(toml.j.quellen.map((q) => q.pfad), [s.musik]);
});

test('dazu with a relative path or a file is 400 quelle_ungueltig, outside the roots 403 pfad_ausserhalb', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.musik, 'a.wav'), wavBytes(1));
  for (const pfad of ['musik/relativ', path.join(s.musik, 'a.wav'), '']) {
    const r = await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad, typ: 'auto' });
    assert.deepEqual([r.code, r.j.grund, r.j.fehler], [400, 'quelle_ungueltig', 'quelle_ungueltig'], String(pfad));
    assert.equal(typeof r.j.text, 'string');
  }
  const aus = await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: '/etc', typ: 'auto' });
  assert.deepEqual([aus.code, aus.j.grund], [403, 'pfad_ausserhalb']);
  assert.equal((await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: s.musik, typ: 'kaputt' })).code, 400);
  assert.deepEqual((await s.ruf('GET', '/bibliothek/quellen')).j.quellen, []);
});

test('dazu twice with the same folder is ok and registers once; dazu starts a debounced build and writes the scope file', async (t) => {
  const s = await stapel(t);
  fs.writeFileSync(path.join(s.musik, 'kick.wav'), wavBytes(1));
  assert.deepEqual((await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: s.musik, typ: 'auto' })).j, { ok: true });
  assert.deepEqual((await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: s.musik, typ: 'auto' })).j, { ok: true });
  assert.equal((await s.ruf('GET', '/bibliothek/quellen')).j.quellen.length, 1);
  await warte(250);
  await s.job.ruht();
  const e = (await s.ruf('GET', '/bibliothek/stand')).j;
  assert.deepEqual([e.letzter_bau.rc, e.letzter_bau.dateien], [0, 1]);
  assert.equal(e.leer, false);
  assert.ok(fs.existsSync(s.katalog));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(s.katalog), 'analyse_quellen.json'), 'utf8')), { schema: 1, pfade: [s.musik] });
});

test('dazu for a folder inside an existing source is 409 quelle_enthalten, the builder text in detail', async (t) => {
  const s = await stapel(t);
  fs.mkdirSync(path.join(s.musik, 'Drums'));
  await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: s.musik, typ: 'auto' });
  const r = await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: path.join(s.musik, 'Drums'), typ: 'oneshot' });
  assert.deepEqual([r.code, r.j.grund], [409, 'quelle_enthalten']);
  assert.match(r.j.detail, /overlaps/);
  await s.job.ruht();
});

test('weg removes a source and its scope entry; an unknown folder is 404 quelle_unbekannt', async (t) => {
  const s = await stapel(t);
  await s.ruf('POST', '/bibliothek/quellen/dazu', { pfad: s.musik, typ: 'auto' });
  const unbekannt = await s.ruf('POST', '/bibliothek/quellen/weg', { pfad: path.join(s.heim, 'nie-da') });
  assert.deepEqual([unbekannt.code, unbekannt.j.grund], [404, 'quelle_unbekannt']);
  assert.deepEqual((await s.ruf('POST', '/bibliothek/quellen/weg', { pfad: s.musik })).j, { ok: true });
  assert.deepEqual((await s.ruf('GET', '/bibliothek/quellen')).j.quellen, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(s.katalog), 'analyse_quellen.json'), 'utf8')).pfade, []);
  assert.equal((await s.ruf('POST', '/bibliothek/quellen/weg', { pfad: 'relativ' })).j.grund, 'quelle_ungueltig');
  await s.job.schliesse();
});

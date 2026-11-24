// Acceptance probe of plan 7: catalogue of 200 rows -> Python hook -> page server routes -> relations, 50 tags in one call, saved search,
// idempotent re-run. Real wav files for 30 loops. The server runs in-process with a temp store; nothing of the real catalogue is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { tagsBereich } from '../tags/area.ts';
import { baueFixture, hook, klassenDerWavs, itemVon } from './support/tags_fixture.mjs';
import { ruf } from './support/proj_stack.mjs';

let f, url, bereich, server;
const dump = () => {
  const d = new DatabaseSync(f.tags, { readOnly: true });
  try { return JSON.stringify(d.prepare('SELECT * FROM item_tag ORDER BY item, tag, herkunft, quelle').all()); } finally { d.close(); }
};
const alle = async () => (await ruf(url, 'GET', '/tags/suche?limit=500')).j.treffer;

test.before(async () => {
  f = await baueFixture();
  const r = await hook(f);
  assert.equal(r.code, 0, r.aus + r.err);
  assert.match(r.aus.trim().split('\n').pop(), /"phase": "fertig"/);
  const router = new Router();
  bereich = tagsBereich({ log: () => {}, quelle: () => 'andreas' }, { katalog: f.katalog });
  router.melde(bereich);
  let port = 0;
  server = http.createServer(async (q, a) => {
    const u = new URL(q.url ?? '/', 'http://127.0.0.1');
    const route = router.finde(q.method ?? '', u.pathname);
    if (!route) return json(a, 404, { fehler: 'keine_route' });
    if (route.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await route.handler(q, a, u);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  url = `http://127.0.0.1:${port}`;
});
test.after(() => { server?.close(); bereich?.speicher.schliesse(); if (f) fs.rmSync(f.dir, { recursive: true, force: true }); });

test('loops carry tempo and a class exactly where the catalogue or the spectrum gives one; nothing is called unklar', async () => {
  const treffer = await alle();
  assert.equal(treffer.length, 200, '100 loops + 40 one-shots + 58 tracks + 2 MIDI rows, each its own sha');
  const loops = (await ruf(url, 'GET', '/tags/suche?art=loop&limit=500')).j.treffer;
  assert.equal(loops.length, 100);
  const nach = new Map(loops.map((x) => [x.item, x]));
  const ohneTempo = [], ohneTyp = [];
  const wavs = f.loops.filter((z) => z.wav);
  const klassen = await klassenDerWavs(wavs.map((z) => z.pfad));
  for (const z of f.loops) {
    const t = nach.get(itemVon(z.n)).tags;
    if (z.bpm !== null) assert.ok(t.includes(`tempo:${Math.round(z.bpm)}`), `${z.name}: ${t}`); else ohneTempo.push(z.name);
    if (z.instrument) assert.ok(t.includes(`typ:${z.instrument}`), `${z.name}: ${t}`);
    else if (z.wav) assert.equal(t.some((x) => x === `typ:${klassen[z.pfad]}`), klassen[z.pfad] !== null, `${z.name} (${z.wav}) rule says ${klassen[z.pfad]}: ${t}`);
    else assert.ok(!t.some((x) => x.startsWith('typ:')), `${z.name} has no instrument and no file, so no class: ${t}`);
    if (!t.some((x) => x.startsWith('typ:'))) ohneTyp.push(z.name);
  }
  assert.equal(ohneTempo.length, f.loops.filter((z) => z.bpm === null).length);
  assert.equal(ohneTempo.length, 20);
  console.log(`loops without tempo: ${ohneTempo.length}, loops without a class: ${ohneTyp.length} of ${f.loops.length}; classes from the spectrum: ${JSON.stringify(Object.values(klassen))}`);
  assert.ok(Object.values(klassen).some((k) => k !== null), 'the synthetic kick or hat is classified by at least one of the rules');
  for (const x of treffer) assert.ok(!x.tags.some((tg) => /unklar/.test(tg)), `${x.item}: ${x.tags}`);
});

test('a loop made from a track with a genre shows the track in RELATED and the genre as abgeleitet', async () => {
  const quelle = f.zeilen.find((z) => z.typ === 'track' && z.genre === 'Techno');
  assert.ok(quelle);
  bereich.speicher.meldeBezug('made_from', 'loop:meine-version', itemVon(quelle.n), { name: 'meine-version' });
  const v = (await ruf(url, 'GET', '/tags/verwandt?item=loop:meine-version')).j;
  assert.deepEqual(v.gemacht_aus, [itemVon(quelle.n)]);
  const t = (await ruf(url, 'GET', '/tags?item=loop:meine-version')).j.tags;
  assert.deepEqual(t.find((x) => x.tag === 'genre:techno'), { tag: 'genre:techno', herkunft: 'abgeleitet' });
  assert.deepEqual((await ruf(url, 'GET', `/tags/verwandt?item=${itemVon(quelle.n)}`)).j.daraus, ['loop:meine-version']);
});

test('one POST with 50 items sets frei:favorites on all, the search and the saved search count 50, removing empties it', async () => {
  const items = f.zeilen.filter((z) => z.typ === 'loop' || z.typ === 'oneshot').slice(10, 60).map((z) => itemVon(z.n));
  assert.equal(items.length, 50);
  const s = await ruf(url, 'POST', '/tags/setzen', { items, tags: ['frei:favorites'], an: true });
  assert.deepEqual(s.j, { ok: true, geaendert: 50 });
  const such = (await ruf(url, 'GET', '/tags/suche?tags=frei:favorites&limit=500')).j.treffer;
  assert.deepEqual(such.map((x) => x.item).sort(), [...items].sort());
  assert.deepEqual((await ruf(url, 'POST', '/tags/gespeichert', { name: 'favorites', tags: ['frei:favorites'], text: '' })).j, { ok: true });
  const g = (await ruf(url, 'GET', '/tags/gespeichert')).j.suchen;
  assert.deepEqual(g.map((x) => [x.name, x.anzahl]), [['favorites', 50]]);
  const weg = await ruf(url, 'POST', '/tags/setzen', { items, tags: ['frei:favorites'], an: false });
  assert.deepEqual(weg.j, { ok: true, geaendert: 50 });
  assert.equal((await ruf(url, 'GET', '/tags/suche?tags=frei:favorites')).j.treffer.length, 0);
  assert.equal((await ruf(url, 'GET', '/tags/gespeichert')).j.suchen[0].anzahl, 0);
});

test('the hook run twice leaves the tag rows byte-identical', async () => {
  const vor = dump();
  const r = await hook(f);
  assert.equal(r.code, 0, r.aus + r.err);
  assert.equal(dump(), vor, 'the second run writes nothing');
});
